/* Service worker: cache toàn bộ giao diện để app chạy được khi không có mạng (dùng như PWA trên điện thoại/máy tính).
   Tăng VERSION mỗi khi sửa mã để máy khách tải bản mới. */
const VERSION = 'taphoa-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './css/app.css','./js/app.js','./js/engine/auth.js','./js/engine/cash.js','./js/engine/demo.js','./js/engine/index.js','./js/engine/inventory.js','./js/engine/people.js','./js/engine/products.js','./js/engine/promos.js','./js/engine/reports.js','./js/engine/sales.js','./js/engine/stockcore.js','./js/lib/qr.js','./js/lib/vietqr.js','./js/native.js','./js/receipt.js','./js/store.js','./js/theme.js','./js/ui.js','./js/util.js','./js/views/cash.js','./js/views/common.js','./js/views/login.js','./js/views/more.js','./js/views/people.js','./js/views/pos.js','./js/views/products.js','./js/views/promos.js','./js/views/reports.js','./js/views/sales.js','./js/views/settings.js','./js/views/stock.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // ưu tiên bản mới từ mạng, mất mạng thì dùng bản đã lưu
  e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
});
