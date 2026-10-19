/* Chụp ảnh màn hình điện thoại (900x1800) cho Google Play từ giao diện THẬT + dữ liệu mẫu, bằng Edge không giao diện điều khiển qua DevTools Protocol.
   Chạy từ thư mục gốc dự án, KHI máy chủ cục bộ đang chạy (scripts/serve.ps1, cổng 8080), cần Node 22+ (có WebSocket sẵn):
     node play-listing/tools/make-shots.mjs [sáng|tối]
   Ra: play-listing/anh-chup-man-hinh/NN-ten.png */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE || 'http://localhost:8080';
const dark = /tối|dark/i.test(process.argv[2] || '');
const OUT = path.resolve('play-listing/anh-chup-man-hinh'); fs.mkdirSync(OUT, { recursive: true });
const SHOTS = [['01-ban-hang', 'pos'], ['02-hang-hoa', 'products'], ['03-kho-hang', 'stock'], ['04-bao-cao', 'reports'], ['05-hoa-don', 'sales'], ['06-khach-no', 'customers'], ['07-xuat-excel', 'export']];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'taphoa-shots-'));
const port = 9333 + Math.floor(Math.random() * 300);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const waiters = new Map();
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch (e) { /* chưa sẵn sàng */ } }
  if (!target) throw new Error('Không mở được Edge');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiters.set(i, d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 450, height: 900, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  // 1) dựng dữ liệu mẫu (cửa hàng + 30 ngày bán hàng) vào IndexedDB, đăng nhập sẵn
  await send('Page.navigate', { url: BASE + '/play-listing/tools/shots.html' });
  for (let i = 0; i < 80; i++) { await sleep(500); if (await evalJs("document.body.textContent.includes('Đã dựng xong')")) break; }
  if (!(await evalJs("document.body.textContent.includes('Đã dựng xong')"))) throw new Error('Dựng dữ liệu mẫu không xong');
  // 2) chụp từng màn
  for (const [name, route] of SHOTS) {
    await send('Page.navigate', { url: 'about:blank' }); await sleep(300);      // tải lại hẳn trang (chỉ đổi #route sẽ không nạp lại ứng dụng)
    await send('Page.navigate', { url: BASE + '/www/index.html#/' + route });
    for (let i = 0; i < 40; i++) { await sleep(400); if (await evalJs("!!document.querySelector('.topbar')")) break; }
    await sleep(1200);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('✓', name, (data.length * 0.75 / 1024).toFixed(0) + ' KB');
  }
} finally { try { ws && ws.close(); } catch (e) {} edge.kill(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
