/* Cầu nối thiết bị: quét mã vạch, lưu/chia sẻ tệp, in hoá đơn, âm báo. Chạy được cả trên trình duyệt lẫn trong vỏ Capacitor (Android).
   Trên Android, mọi lời gọi plugin đi qua window.NativeBridge (www/native-bridge.js, đóng gói từ src/native/bridge.js bằng esbuild — như app BEPO).
   Không có NativeBridge (trình duyệt) thì dùng phương án dự phòng, nên app vẫn chạy được khi thiếu plugin/quyền. */
import { h, icon, toast, modal } from './ui.js';
import { settings } from './engine/index.js';
import { receiptHtml } from './receipt.js';
import { renderSale, PAPER } from './receipt-image.js';

export const nb = () => window.NativeBridge || null;
export const isNative = () => !!(nb() && nb().isNative);

/** Nạp cầu nối native (chỉ trong vỏ Capacitor). Quá 6 giây không nạp được thì bỏ qua để app vẫn khởi động. */
export function loadNativeBridge() {
  if (window.NativeBridge && window.NativeBridge.isNative) return Promise.resolve(true);      // bản đã gộp (scripts/bundle-web.mjs) nhúng sẵn cầu nối trong index.html
  const cap = window.Capacitor;
  if (!(cap && cap.isNativePlatform && cap.isNativePlatform())) return Promise.resolve(false);
  return new Promise(res => {
    const s = document.createElement('script'); s.src = 'native-bridge.js';
    const t = setTimeout(() => res(false), 6000);
    s.onload = () => { clearTimeout(t); res(!!window.NativeBridge); };
    s.onerror = () => { clearTimeout(t); res(false); };
    document.head.appendChild(s);
  });
}

/* ---------- Âm báo ---------- */
let actx = null;
export function beep(kind = 'ok') {
  try {
    if (!settings().sale.beep) return;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    o.frequency.value = kind === 'ok' ? 1200 : 300; o.type = kind === 'ok' ? 'sine' : 'square';
    g.gain.setValueAtTime(0.15, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + (kind === 'ok' ? 0.12 : 0.35));
    o.start(); o.stop(actx.currentTime + (kind === 'ok' ? 0.12 : 0.35));
  } catch (e) { /* không có âm thanh cũng không sao */ }
  try {
    if (nb() && nb().haptics) { if (kind === 'ok') nb().haptics.tap(); else nb().haptics.error(); }
    else if (navigator.vibrate) navigator.vibrate(kind === 'ok' ? 25 : [60, 40, 60]);
  } catch (e) {}
}

/* ---------- Quét mã vạch ---------- */
export const canScan = () => !!(nb() && nb().scan) || (!!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia && 'BarcodeDetector' in window);

/** Mở màn hình quét. onCode(code) trả về undefined để đóng (quét một lần) hoặc `'keep'` để quét tiếp (liên tục). */
export async function openScanner({ title = 'Quét mã vạch', onCode, continuous = false }) {
  if (nb() && nb().scan) {
    try {
      for (;;) {
        const code = await nb().scan();
        if (!code) return;
        const r = await onCode(code);
        if (!(continuous && r === 'keep')) return;
      }
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast('Không quét được: ' + (e.message || e), 'error', 5000); return; }
  }
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
    toast('Thiết bị này không hỗ trợ quét bằng camera. Hãy dùng máy quét mã vạch (Bluetooth/USB) hoặc gõ mã.', 'error', 5000);
    return;
  }
  let stream, stopped = false, last = '', lastAt = 0;
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const hint = h('div', { class: 'center small' }, 'Đưa mã vạch vào khung');
  const manual = h('input', { class: 'input', placeholder: 'Hoặc gõ mã…', style: { maxWidth: '180px' }, onKeydown: e => { if (e.key === 'Enter' && e.target.value.trim()) { handle(e.target.value.trim()); e.target.value = ''; } } });
  const root = h('div', { class: 'scanner' }, video, h('div', { class: 'frame' }),
    h('div', { class: 'bar2' }, h('div', { class: 'col', style: { width: '100%', alignItems: 'center' } }, hint,
      h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => stop() }, icon('x'), ' Đóng'), manual))));
  document.body.appendChild(root);
  const stop = () => { stopped = true; try { stream && stream.getTracks().forEach(t => t.stop()); } catch (e) {} root.remove(); };
  async function handle(code) {
    const now = Date.now();
    if (code === last && now - lastAt < 1800) return;
    last = code; lastAt = now;
    const r = await onCode(code);
    if (!(continuous && r === 'keep')) stop(); else hint.textContent = 'Đã quét: ' + code;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    video.srcObject = stream; await video.play();
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'] });
    const loop = async () => {
      if (stopped) return;
      try { const r = await det.detect(video); if (r.length) await handle(r[0].rawValue); } catch (e) {}
      if (!stopped) setTimeout(loop, 120);
    };
    loop();
  } catch (e) { stop(); toast('Không mở được camera: ' + (e.message || e), 'error', 5000); }
}

/* ---------- Máy quét mã vạch dạng bàn phím (Bluetooth/USB) ----------
   Máy quét "gõ" cả chuỗi rất nhanh rồi Enter. Một bộ lắng nghe toàn trang; màn hình/hộp thoại nào cần nhận mã thì đăng ký
   bằng onScan(fn) (đăng ký sau cùng được ưu tiên) và huỷ bằng hàm trả về. Không ai đăng ký thì bàn phím gõ bình thường. */
const wedgeStack = [];
export function onScan(fn) {
  wedgeStack.push(fn);
  return () => { const i = wedgeStack.lastIndexOf(fn); if (i >= 0) wedgeStack.splice(i, 1); };
}
(function installWedge() {
  let buf = '', t0 = 0, lastKey = 0;
  document.addEventListener('keydown', e => {
    const now = Date.now();
    if (e.key === 'Enter') {
      const fast = buf.length >= 4 && now - lastKey < 120 && (now - t0) / buf.length < 60;
      const code = buf; buf = '';
      if (fast && wedgeStack.length) {
        e.preventDefault(); e.stopPropagation();
        if (e.target && /^(input|textarea)$/i.test(e.target.tagName) && e.target.type !== 'checkbox') {
          // bỏ phần ký tự máy quét vừa gõ vào ô đang focus
          const v = e.target.value; if (v.endsWith(code)) { e.target.value = v.slice(0, v.length - code.length); e.target.dispatchEvent(new Event('input', { bubbles: true })); }
        }
        wedgeStack[wedgeStack.length - 1](code);
      }
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (now - lastKey > 80) { buf = ''; t0 = now; }
    buf += e.key; lastKey = now;
  }, true);
})();

/* ---------- Lưu / chia sẻ tệp ---------- */
/** mode 'share' (mặc định): hộp thoại chia sẻ/lưu; mode 'save': ghi vào thư mục riêng của app rồi mở (chỉ Android). Trả false nếu người dùng huỷ/lỗi. */
export async function saveFile(filename, content, mime = 'text/plain', mode = 'share') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  if (isNative()) {
    try {
      const r = await nb().saveFile(filename, blob, mode);
      if (r === 'saved' || r === 'opened') toast('Đã lưu vào ' + await nb().where(), 'ok', 4000);
      return true;
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast('Không lưu được: ' + (e.message || e), 'error'); return false; }
  }
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ files: [file], title: filename }); return true; }
  } catch (e) { if (e.name === 'AbortError') return false; }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Đã tải xuống ' + filename, 'ok');
  return true;
}
export async function shareText(text, title = '') {
  try {
    if (isNative()) { await nb().shareText(text, title); return true; }
    if (navigator.share) { await navigator.share({ title, text }); return true; }
  } catch (e) { if (e.name === 'AbortError' || /cancel/i.test(e.message || '')) return false; }
  try { await navigator.clipboard.writeText(text); toast('Đã sao chép vào bộ nhớ tạm', 'ok'); }
  catch (e) { modal({ title: 'Sao chép nội dung', body: h('textarea', { class: 'textarea', style: { height: '260px' }, value: text }) }); }
  return false;
}
export function pickFile(accept) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, style: { display: 'none' }, onChange: () => { res(i.files[0] || null); i.remove(); } });
    document.body.appendChild(i); i.click();
    window.addEventListener('focus', () => setTimeout(() => { if (!i.files.length) { res(null); i.remove(); } }, 800), { once: true });
  });
}
export const readFileText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f, 'utf-8'); });
/** Thu nhỏ ảnh về tối đa `max` px, trả data URL JPEG (giữ dung lượng dữ liệu nhỏ). */
export function resizeImage(file, max = 240) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Không đọc được ảnh')); };
    img.src = url;
  });
}

/* ---------- Thiết bị Android ---------- */
/** Tăng sáng màn hình khi phóng to mã QR thanh toán; restore trả lại như cũ. */
export const boostBrightness = () => { try { if (nb()) nb().brightness.boost(); } catch (e) {} };
export const restoreBrightness = () => { try { if (nb()) nb().brightness.restore(); } catch (e) {} };
/** Nút Back của Android: handler trả true nếu đã xử lý, false → thu nhỏ app. */
/** Gọi khi app quay lại phía trước (đóng hộp thoại của hệ thống như Google Play). Trong vỏ Android WebView KHÔNG chắc phát visibilitychange khi một Activity khác che lên, nên dùng cả sự kiện 'resume' của Capacitor lẫn visibilitychange. */
export function onResume(fn) {
  try { if (nb() && nb().app && nb().app.onResume) nb().app.onResume(fn); } catch (e) { /* không có cầu nối native */ }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fn(); });
}

export function onBack(handler) { try { if (nb()) nb().app.onBack(handler); } catch (e) {} }
/** Quét máy in Bluetooth gần đó. onFound(danh sách [{name,address}]). */
export async function scanPrinters(onFound) {
  if (!(nb() && nb().printer)) throw new Error('Chỉ quét được máy in trong ứng dụng Android');
  return nb().printer.scan(onFound);
}

/* ---------- In hoá đơn ---------- */
/** Android: gửi ẢNH tới máy in nhiệt Bluetooth đã chọn (không in chữ vì máy in rẻ thường không có bảng mã tiếng Việt);
    chưa chọn máy in / in lỗi → lưu ảnh PNG để gửi/in bằng app khác. Trình duyệt: hộp thoại in của hệ thống. */
export async function printReceipt(sale) {
  const cfg = settings().print;
  if (isNative()) {
    try {
      const img = await renderSale(sale, cfg.paper);
      if (cfg.printerAddress && nb().printer) {
        try {
          toast('Đang in hoá đơn…');
          await nb().printer.printImage(img.dataUrl, (PAPER[cfg.paper] || PAPER[58]).mm, cfg.printerAddress);
          toast('Đã gửi hoá đơn tới máy in', 'ok');
          return true;
        } catch (e) { toast('Không in được (' + (e.message || e) + '). Kiểm tra máy in đã bật và ghép đôi Bluetooth. Đang lưu hoá đơn thành ảnh…', 'error', 5000); }
      }
      return saveFile('hoa-don-' + String(sale.code).replace(/[^\w-]+/g, '') + '.png', img.blob, 'image/png');
    } catch (e) { toast('Không tạo được hoá đơn: ' + (e.message || e), 'error'); return false; }
  }
  return printHtml(receiptHtml(sale, cfg.paper));
}
export function printHtml(html) {
  const f = h('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Không in được: ' + e.message, 'error'); } setTimeout(() => f.remove(), 2000); }, 250);
  return true;
}

/* ---------- Tiện ích: sao chép, mở liên kết ---------- */
/** Sao chép văn bản vào bộ nhớ tạm; trả true nếu được. */
export async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
  try {
    const t = h('textarea', { style: { position: 'fixed', top: '-1000px' }, value: text }); document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); if (ok) return true;
  } catch (e) {}
  return false;
}
/** Mở trang web bên ngoài (Android: trình duyệt hệ thống qua plugin Browser; web: tab mới). */
export function openUrl(url) {
  if (!/^https:\/\//i.test(url)) return;
  try { if (nb() && nb().openUrl) { nb().openUrl(url); return; } } catch (e) {}
  window.open(url, '_blank', 'noopener');
}
