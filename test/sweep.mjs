/* Quét lỗi toàn app bằng Edge không giao diện (DevTools Protocol): dựng cửa hàng mẫu + 30 ngày dữ liệu, đi qua MỌI màn hình, bấm lần lượt các nút "an toàn"
   (bỏ qua nút xoá/đăng xuất/khoá/mua), ghi lại mọi ngoại lệ JavaScript, lỗi console, lỗi tải tài nguyên và lỗi hiển thị.
   Chạy khi máy chủ cục bộ đang chạy (cổng 8080), Node 22+:  node test/sweep.mjs [rộng×cao, mặc định 412x860]  [tối] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', BASE = process.env.BASE || 'http://localhost:8080';
const [W, H] = (process.argv.find(a => /^\d+x\d+$/.test(a)) || '412x860').split('x').map(Number);
const dark = process.argv.includes('tối');
const ROUTES = ['pos', 'sales', 'products', 'stock', 'reports', 'more', 'customers', 'suppliers', 'promos', 'cash', 'settings', 'staff', 'logs', 'export', 'sync', 'plan', 'planadmin', 'help'];
const SKIP = /xo[áa]|x[óo]a|đăng xuất|khoá|khoa|huỷ hoá|hủy|reset|đặt lại|mua|ngắt|gỡ|thu hồi|từ chối|duyệt|tải lên|nạp lại|khôi phục|đăng ký|tạo tài khoản|bắt đầu sử dụng/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'taphoa-sweep-')), port = 9100 + Math.floor(Math.random() * 400);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const waiters = new Map(), problems = [];
let where = 'khởi động';
const note = (kind, msg) => { const m = `[${where}] ${kind}: ${String(msg).slice(0, 300)}`; if (!problems.includes(m)) problems.push(m); };
try {
  let target; for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch (e) { /* chưa sẵn sàng */ } }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); return; }
    if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; note('NGOẠI LỆ', (e.exception && (e.exception.description || e.exception.value)) || e.text); }
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') note('console.error', d.params.args.map(a => a.value || a.description || '').join(' '));
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon|ERR_NAME_NOT_RESOLVED|fonts\./.test(d.params.entry.text + (d.params.entry.url || ''))) note('log', d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiters.set(i, d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  where = 'dựng dữ liệu mẫu';
  await send('Page.navigate', { url: BASE + '/play-listing/tools/shots.html' });
  for (let i = 0; i < 80; i++) { await sleep(500); if (await ev("document.body.innerText.includes('Đã dựng xong')")) break; }
  let clicked = 0;
  for (const route of ROUTES) {
    where = 'màn ' + route;
    await send('Page.navigate', { url: 'about:blank' }); await sleep(200);
    await send('Page.navigate', { url: BASE + '/www/index.html#/' + route });
    for (let i = 0; i < 40; i++) { await sleep(300); if (await ev("!!document.querySelector('.topbar')")) break; }
    await sleep(900);
    const err = await ev("(document.querySelector('.main .banner.red') || {}).textContent || ''");
    if (err) note('lỗi hiển thị', err);
    // bấm lần lượt các nút/liên kết an toàn (đánh số theo thứ tự trên trang lúc đầu)
    const n = await ev(`(() => { window.__btns = [...document.querySelectorAll('.main button, .main a[href^="#"], .main .chip, .main [role=button]')].filter(e => e.offsetParent && !e.disabled); return window.__btns.length; })()`);
    for (let k = 0; k < Math.min(n, 40); k++) {
      const label = await ev(`(() => { const e = window.__btns[${k}]; return e && e.isConnected ? (e.innerText || e.getAttribute('aria-label') || e.title || '').trim().slice(0, 40) : null; })()`);
      if (label === null || SKIP.test(label)) continue;
      where = `màn ${route} · bấm "${label}"`;
      const href = await ev(`(() => { const e = window.__btns[${k}]; return e.tagName === 'A' ? e.getAttribute('href') : ''; })()`);
      if (href && href.startsWith('#/') && href.slice(2) !== route) continue;      // liên kết sang màn khác: đã quét riêng
      await ev(`window.__btns[${k}].click()`); clicked++; await sleep(350);
      const bad = await ev("(document.querySelector('.main .banner.red') || {}).textContent || ''");
      if (bad) note('lỗi hiển thị', bad);
      // đóng hộp thoại / giỏ hàng nếu có, quay về màn gốc
      for (let t = 0; t < 3; t++) { if (await ev("!!document.querySelector('.overlay')")) { await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))"); await sleep(200); } }
      await ev("(() => { const b = document.querySelector('.cartpage.open .cp-back'); if (b) b.click(); })()");
      if (!(await ev(`location.hash === '#/${route}'`))) { await send('Page.navigate', { url: BASE + '/www/index.html#/' + route }); await sleep(600); await send('Page.reload'); await sleep(1200); await ev(`window.__btns = [...document.querySelectorAll('.main button, .main a[href^="#"], .main .chip, .main [role=button]')].filter(e => e.offsetParent && !e.disabled)`); }
    }
  }
  console.log(`Đã quét ${ROUTES.length} màn, bấm ${clicked} nút (${W}x${H}${dark ? ', tối' : ''}).`);
} finally { try { ws && ws.close(); } catch (e) {} edge.kill(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
if (problems.length) { console.log(`\n${problems.length} VẤN ĐỀ:`); problems.forEach(p => console.log(' • ' + p)); process.exitCode = 1; } else console.log('Không có ngoại lệ / lỗi console nào.');
