/* CẦU NỐI NATIVE — esbuild đóng gói thành www/native-bridge.js (IIFE) và nạp khi chạy trong vỏ Capacitor (Android).
   Gom mọi lời gọi plugin vào một chỗ; phần còn lại của app chỉ dùng `window.NativeBridge` (không có thì dùng phương án dự phòng cho trình duyệt).
   Cách dùng từng plugin theo đúng mã đã chạy được của app BEPO (quét mã, lưu/chia sẻ tệp, in ảnh qua máy in nhiệt, độ sáng, rung, nút Back). */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { FileOpener } from '@capacitor-community/file-opener';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { ScreenBrightness } from '@capacitor-community/screen-brightness';
import { Haptics } from '@capacitor/haptics';
import { CapacitorThermalPrinter } from 'capacitor-thermal-printer';
import { Browser } from '@capacitor/browser';
import { Device } from '@capacitor/device';
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';

const isNative = Capacitor.isNativePlatform();

/** Cầu nối Capacitor đôi khi không trả lời → đặt hạn chót để một lời gọi plugin treo không làm treo cả thao tác (bài học từ BEPO). */
const plug = (p, ms, what) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' không phản hồi (quá ' + Math.round(ms / 1000) + ' giây)')), ms); })]).finally(() => clearTimeout(t));
};

/* ---------- Quét mã vạch (ML Kit) ---------- */
async function scan() {
  if (!isNative) throw new Error('Quét bằng camera chỉ chạy trên ứng dụng Android');
  const perm = await BarcodeScanner.requestPermissions();
  if (perm.camera !== 'granted' && perm.camera !== 'limited') throw new Error('Cần cấp quyền camera để quét mã');
  try {   // một số máy cần tải module quét của Google trước lần đầu
    const { available } = await plug(BarcodeScanner.isGoogleBarcodeScannerModuleAvailable(), 8000, 'Bộ quét mã');
    if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule();
  } catch (e) { /* thiết bị không cần module riêng */ }
  const { barcodes } = await BarcodeScanner.scan();      // mọi định dạng (EAN-13, EAN-8, Code128, QR…)
  return barcodes && barcodes.length ? (barcodes[0].rawValue || barcodes[0].displayValue || null) : null;
}

/* ---------- Lưu / chia sẻ tệp ---------- */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
const SAVE_DIR = 'TapHoa';
/** mode 'save': ghi vào thư mục riêng của app (Android/data/<mã gói>/files/TapHoa — không cần cấp quyền) rồi mở bằng app xem tệp;
    mode 'share' (mặc định): mở hộp thoại chia sẻ/lưu (Zalo, Drive, Gmail…). */
async function saveFile(filename, blob, mode) {
  const data = await blobToBase64(blob);
  if (mode === 'save') {
    await Filesystem.writeFile({ path: SAVE_DIR + '/' + filename, data, directory: Directory.External, recursive: true });
    const { uri } = await Filesystem.getUri({ path: SAVE_DIR + '/' + filename, directory: Directory.External });
    const ext = String(filename).split('.').pop().toLowerCase();
    const contentType = { csv: 'text/csv', json: 'application/json', png: 'image/png', pdf: 'application/pdf', txt: 'text/plain' }[ext] || '*/*';
    try { await FileOpener.open({ filePath: uri, contentType }); return 'opened'; } catch (e) { return 'saved'; }
  }
  await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  await Share.share({ title: filename, url: uri, dialogTitle: 'Lưu hoặc gửi tệp' });
  return 'shared';
}
async function shareText(text, title) { await Share.share({ title: title || '', text, dialogTitle: 'Chia sẻ' }); }
async function where() { try { const i = await App.getInfo(); return 'Android/data/' + i.id + '/files/' + SAVE_DIR; } catch (e) { return 'Android/data/…/files/' + SAVE_DIR; } }

/* ---------- Độ sáng màn hình (phóng to mã QR thanh toán cho dễ quét) ---------- */
let origBrightness = null;
const brightness = {
  async boost() {
    try { if (origBrightness === null) origBrightness = (await ScreenBrightness.getBrightness()).brightness; await ScreenBrightness.setBrightness({ brightness: 1 }); } catch (e) { /* máy chặn quyền: bỏ qua */ }
  },
  async restore() {
    if (origBrightness === null) return;
    try { await ScreenBrightness.setBrightness({ brightness: origBrightness }); } catch (e) {}
    origBrightness = null;
  }
};

/* ---------- Rung ---------- */
const haptics = {
  async tap() { try { await Haptics.vibrate({ duration: 30 }); } catch (e) {} },
  async error() { try { await Haptics.vibrate({ duration: 300 }); } catch (e) {} }
};

/* ---------- Nút Back của Android ---------- */
const app = {
  /** handler trả true nếu đã xử lý nút Back; false → thu nhỏ app (không thoát hẳn, khỏi mất phiên bán hàng) */
  onBack(handler) { App.addListener('backButton', () => { if (!handler()) App.minimizeApp(); }); },
  onResume(cb) { App.addListener('resume', cb); }
};

/* ---------- Máy in hoá đơn nhiệt Bluetooth: in ẢNH (xem www/js/receipt-image.js) ---------- */
let printerAddr = '';
const printer = {
  async scan(onFound) {
    const handles = [];
    try {
      handles.push(await CapacitorThermalPrinter.addListener('discoverDevices', d => { try { onFound((d && d.devices) || []); } catch (e) {} }));
      const done = new Promise(res => CapacitorThermalPrinter.addListener('discoveryFinish', () => res()).then(h => handles.push(h)));
      await CapacitorThermalPrinter.startScan();
      await Promise.race([done, new Promise(r => setTimeout(r, 15000))]);
    } finally {
      try { await CapacitorThermalPrinter.stopScan(); } catch (e) {}
      handles.forEach(h => { try { h.remove(); } catch (e) {} });
    }
  },
  async connect(address) { const dev = await plug(CapacitorThermalPrinter.connect({ address }), 20000, 'Máy in'); if (dev) printerAddr = address; return dev; },
  async isConnected() { try { return !!(await plug(CapacitorThermalPrinter.isConnected(), 5000, 'Máy in')); } catch (e) { return false; } },
  async disconnect() { try { await CapacitorThermalPrinter.disconnect(); } catch (e) {} printerAddr = ''; },
  /** In một ảnh (data URL PNG) rộng widthMm milimét rồi đẩy/cắt giấy. Tự nối lại máy in nếu mất kết nối. */
  async printImage(dataUrl, widthMm, address) {
    if (!(await this.isConnected()) || (address && printerAddr !== address)) {
      const dev = await this.connect(address);
      if (!dev) throw new Error('Không kết nối được máy in');
    }
    await plug(CapacitorThermalPrinter.begin().align('center').limitWidth(widthMm).image(dataUrl).feedCutPaper().write(), 30000, 'Máy in');
  }
};

/* ---------- Mở trang web ngoài (hướng dẫn tạo Supabase…) ---------- */
const openUrl = url => { if (!String(url).toLowerCase().startsWith('https://')) throw new Error('Chỉ mở được địa chỉ https'); return Browser.open({ url }); };

/* ---------- Định danh máy (Android ID) — chỉ để chặn lấy lại dùng thử miễn phí bằng cách cài lại app / tạo tài khoản mới (máy chủ chỉ nhận mã băm) ---------- */
const device = {
  async androidId() {
    if (!isNative) return '';
    try { return String((await plug(Device.getId(), 4000, 'Device')).identifier || ''); } catch (e) { return ''; }
  }
};

/* ---------- Google Play Billing (chỉ dùng ở bản app "Google Play") ----------
   Không tự quyết định gì về gói cước ở đây — chỉ chuyển tiếp purchaseToken lên Edge Function "verify-purchase" (xem www/js/cloud/play-billing.js)
   để XÁC MINH VỚI GOOGLE rồi mới ghi nhận. Không bao giờ tin thẳng dữ liệu purchaseProduct() trả về. */
const billing = {
  async isSupported() {
    if (!isNative) return false;
    try { return (await NativePurchases.isBillingSupported()).isBillingSupported; } catch (e) { return false; }
  },
  async getProducts(productIds) {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: productIds, productType: PURCHASE_TYPE.SUBS });
    return products;
  },
  /** appAccountToken = id tài khoản lưu trữ của chủ cửa hàng — Google đính kèm lại vào giao dịch để máy chủ đối chiếu đúng người mua.
      planIdentifier = ID base plan trên Play Console (plugin BẮT BUỘC với gói đăng ký trên Android). */
  async purchase(productId, appAccountToken, planIdentifier) {
    return NativePurchases.purchaseProduct({ productIdentifier: productId, planIdentifier, productType: PURCHASE_TYPE.SUBS, appAccountToken });
  },
  async restore() { return NativePurchases.restorePurchases(); },
  async getPurchases(appAccountToken) {
    try { return (await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS, appAccountToken })).purchases || []; }
    catch (e) { return []; }
  },
  async manage() { try { await NativePurchases.manageSubscriptions(); } catch (e) {} },
};

/** HTTP native: không bị chặn CORS (dùng gọi Management API của Supabase). */
const http = async ({ url, method = 'GET', headers = {}, body }) => { const r = await CapacitorHttp.request({ url, method, headers, data: body, responseType: 'json' }); return { status: r.status, data: r.data }; };

window.NativeBridge = { isNative, http, billing, device, platform: Capacitor.getPlatform(), scan, saveFile, shareText, where, brightness, haptics, app, printer, openUrl };
