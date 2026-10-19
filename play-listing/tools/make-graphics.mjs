/* Làm lại biểu tượng 512/1024 (từ www/icon.svg bằng sharp) và ảnh bìa 1024x500 (dựng từ feature.html bằng Edge qua DevTools Protocol).
   Chạy từ thư mục gốc dự án, KHI máy chủ cục bộ đang chạy (cổng 8080) và đã có ảnh trong anh-chup-man-hinh/ (make-shots.mjs):
     node play-listing/tools/make-graphics.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', BASE = process.env.BASE || 'http://localhost:8080';
const OUT = path.resolve('play-listing');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Biểu tượng: PNG 32 bit vuông (Play tự bo góc)
const svg = fs.readFileSync('www/icon.svg');
for (const s of [512, 1024]) await sharp(svg, { density: 576 }).resize(s, s).png().toFile(path.join(OUT, `bieu-tuong-${s}.png`));
console.log('✓ bieu-tuong-512.png, bieu-tuong-1024.png');

// Ảnh bìa: Play yêu cầu 1024x500, PNG 24 bit / JPEG, KHÔNG có kênh trong suốt
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'taphoa-gfx-')), port = 9700 + Math.floor(Math.random() * 200);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const waiters = new Map();
try {
  let target; for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch (e) { /* chưa sẵn sàng */ } }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiters.set(i, d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/play-listing/tools/feature.html' }); await sleep(2500);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  await sharp(Buffer.from(data, 'base64')).flatten({ background: '#6d5bf0' }).removeAlpha().png().toFile(path.join(OUT, 'anh-bia-1024x500.png'));
  console.log('✓ anh-bia-1024x500.png');
} finally { try { ws && ws.close(); } catch (e) {} edge.kill(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
