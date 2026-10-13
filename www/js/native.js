/* Cầu nối thiết bị: quét mã vạch, lưu/chia sẻ tệp, in hoá đơn, âm báo. Chạy được cả trên trình duyệt lẫn trong vỏ Capacitor (Android).
   Mọi chỗ gọi plugin native đều có đường lui, nên app vẫn dùng được khi thiếu plugin/quyền. */
import { h, icon, toast, modal } from './ui.js';
import { settings } from './engine/index.js';
import { receiptHtml, receiptThermal } from './receipt.js';

export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const plugin = name => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;

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
  try { navigator.vibrate && navigator.vibrate(kind === 'ok' ? 25 : [60, 40, 60]); } catch (e) {}
}

/* ---------- Quét mã vạch ---------- */
export const canScan = () => !!plugin('BarcodeScanner') || (!!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia && 'BarcodeDetector' in window);

/** Mở màn hình quét. onCode(code) trả về true/undefined để đóng (quét một lần) hoặc `'keep'` để quét tiếp (liên tục). */
export async function openScanner({ title = 'Quét mã vạch', onCode, continuous = false }) {
  const native = plugin('BarcodeScanner');
  if (native) {
    try {
      const perm = await native.requestPermissions();
      if (perm.camera !== 'granted' && perm.camera !== 'limited') { toast('Chưa cấp quyền camera', 'error'); return; }
      for (;;) {
        const { barcodes } = await native.scan();
        const code = barcodes && barcodes[0] && (barcodes[0].rawValue || barcodes[0].displayValue);
        if (!code) return;
        const r = await onCode(code);
        if (!(continuous && r === 'keep')) return;
      }
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast('Không quét được: ' + (e.message || e), 'error'); return; }
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
export async function saveFile(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const fs = plugin('Filesystem'), share = plugin('Share');
  if (fs && isNative()) {
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const w = await fs.writeFile({ path: filename, data, directory: 'CACHE' });
      if (share) await share.share({ title: filename, url: w.uri, dialogTitle: 'Lưu / gửi tệp' });
      else toast('Đã lưu ' + filename, 'ok');
      return true;
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast('Không lưu được: ' + e.message, 'error'); return false; }
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
  const share = plugin('Share');
  try {
    if (share) { await share.share({ title, text, dialogTitle: 'Chia sẻ' }); return true; }
    if (navigator.share) { await navigator.share({ title, text }); return true; }
  } catch (e) { if (e.name === 'AbortError' || /cancel/i.test(e.message || '')) return false; }
  try { await navigator.clipboard.writeText(text); toast('Đã sao chép vào bộ nhớ tạm', 'ok'); } catch (e) { modal({ title: 'Sao chép nội dung', body: h('textarea', { class: 'textarea', style: { height: '260px' }, value: text }) }); }
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

/* ---------- In hoá đơn ---------- */
/** In: ưu tiên máy in nhiệt Bluetooth (plugin) nếu đã ghép; ngược lại mở hộp thoại in của hệ thống. */
export async function printReceipt(sale) {
  const cfg = settings().print, width = cfg.paper === 80 ? 48 : 32;
  const tp = plugin('CapacitorThermalPrinter');
  if (tp && isNative() && cfg.printerAddress) {
    try {
      await tp.begin().connect({ address: cfg.printerAddress });
      await tp.begin().align('left').text(receiptThermal(sale, width) + '\n\n\n').cutPaper().write().then(() => tp.disconnect());
      return true;
    } catch (e) { toast('Không in được qua Bluetooth (' + (e.message || e) + '). Mở in hệ thống…', 'error'); }
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
