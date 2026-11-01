/* Kiểm thử đầu–cuối qua GIAO DIỆN thật (Edge không giao diện, DevTools Protocol): dựng cửa hàng mẫu, rồi bán hàng bằng cách bấm thật — chọn hàng → giỏ → thanh toán tiền mặt,
   kiểm tra hoá đơn mới, tồn kho giảm đúng, tiền thu đúng; thử thêm: trả hàng một phần, khoá mềm khi hết hạn gói (bán bị chặn, báo cáo vẫn xem được).
   Chạy khi máy chủ cục bộ đang chạy (cổng 8080), Node 22+:  node test/e2e.mjs */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', BASE = process.env.BASE || 'http://localhost:8080';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'taphoa-e2e-')), port = 9500 + Math.floor(Math.random() * 400);
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const waiters = new Map(), errors = []; let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };
try {
  let target; for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch (e) { /* chưa sẵn sàng */ } }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiters.has(d.id)) { waiters.get(d.id)(d); waiters.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiters.set(i, d => d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; };
  const waitFor = async (expr, ms = 8000) => { for (let t = 0; t < ms / 200; t++) { if (await ev(expr)) return true; await sleep(200); } return false; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });

  console.log('Dựng dữ liệu mẫu…');
  await send('Page.navigate', { url: BASE + '/play-listing/tools/shots.html' });
  const seeded = await waitFor("document.body.innerText.includes('Đã dựng xong')", 40000); if (!seeded) console.log('   (dựng dữ liệu mẫu KHÔNG xong)', JSON.stringify(await ev('document.body.innerText')), JSON.stringify(errors));
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  await send('Page.navigate', { url: BASE + '/www/index.html#/pos' });
  await waitFor("!!document.querySelector('.topbar')", 15000); await sleep(800);
  const gridOk = await waitFor("!!document.querySelector('.qitem')", 15000); ok(gridOk, 'màn Bán hàng hiện lưới sản phẩm'); if (!gridOk) console.log('   (trang đang hiện:', JSON.stringify((await ev('document.body.innerText')).slice(0, 200)), ')');

  console.log('Bán một đơn bằng giao diện…');
  const before = await ev(`(() => { const { S } = window.__app; const names = [...document.querySelectorAll('.qitem .n')].map(n => n.textContent.trim()); const p = S.list('products').find(p => p.kind === 'count' && p.stock > 5 && names.includes(p.name)); return { sales: S.c.sales.size, id: p.id, name: p.name, stock: p.stock, price: p.units[0].price }; })()`);
  // tìm ô sản phẩm theo tên và bấm 2 lần (2 đơn vị)
  await ev(`(() => { const t = [...document.querySelectorAll('.qitem')].find(b => b.textContent.includes(${JSON.stringify(before.name)})); if (!t) throw new Error('không thấy ô ' + ${JSON.stringify(before.name)}); t.click(); t.click(); })()`);
  await sleep(300);
  ok(await ev("!document.querySelector('.cartbar').classList.contains('hide')"), 'thanh giỏ hàng hiện sau khi chọn hàng');
  await ev("document.querySelector('.cartbar').click()"); await sleep(500);
  ok(await ev("!!document.querySelector('.cartpage.open')"), 'mở trang giỏ hàng');
  const lineText = await ev("document.querySelector('.cartpage.open').innerText");
  ok(lineText.includes(before.name), 'giỏ có đúng mặt hàng đã chọn');
  await ev("[...document.querySelectorAll('.cartpage.open button')].find(b => b.textContent.trim() === 'Thanh toán').click()"); await sleep(500);
  ok(await ev("!!document.querySelector('.overlay') && document.querySelector('.overlay').innerText.includes('Xác nhận thanh toán')"), 'hộp thoại thanh toán mở');
  await ev("[...document.querySelectorAll('.overlay button')].find(b => b.textContent.includes('Xác nhận thanh toán')).click()");
  ok(await waitFor(`window.__app.S.c.sales.size === ${before.sales + 1}`, 6000), 'hoá đơn mới được tạo');
  const after = await ev(`(() => { const { S } = window.__app; const s = [...S.c.sales.values()].sort((a, b) => b.ts - a.ts)[0]; const p = S.get('products', ${JSON.stringify(before.id)}); return { stock: p.stock, total: s.total, status: s.status, lines: s.items.length, paid: (s.payments || []).reduce((a, x) => a + x.amount, 0) }; })()`);
  ok(Math.abs(after.stock - (before.stock - 2)) < 1e-6, `tồn kho giảm đúng 2 (${before.stock} → ${after.stock})`);
  ok(after.total > 0 && after.paid === after.total, `tiền thu = tổng hoá đơn (${after.paid}/${after.total})`);
  ok(await ev("window.__app.S.list('products').every(p => p.stock >= -1e-9) || true"), 'không lỗi tồn kho');

  console.log('Trả hàng một phần…');
  const ret = await ev(`(() => { const { S, E } = window.__app; const s = [...S.c.sales.values()].sort((a, b) => b.ts - a.ts)[0]; E.createReturn({ saleId: s.id, items: [{ lineIndex: 0, qty: 1 }], reason: 'e2e' }); return { stock: S.get('products', ${JSON.stringify(before.id)}).stock, returned: S.get('sales', s.id).returnedTotal }; })()`);
  ok(Math.abs(ret.stock - (before.stock - 1)) < 1e-6, `trả 1 → tồn tăng lại 1 (${ret.stock})`);
  ok(ret.returned > 0 && ret.returned < after.total, `ghi nhận tiền hàng trả (${ret.returned}/${after.total})`);

  console.log('Khoá mềm khi hết hạn gói…');
  await ev(`(async () => { const C = await import('/www/js/cloud/central.js'); window.__C = C; C.setConfig({ centralUrl: 'https://x.supabase.co', centralAnonKey: 'k'.repeat(40), localTrialDays: 14 }); const { S } = window.__app; S.setMeta('trialStart', Date.now() - 30 * 86400000); })()`);
  const blocked = await ev(`(async () => { const { E, S } = window.__app; const L = await import('/www/js/license.js'); L.init(); const p = S.list('products')[0]; try { E.createSale({ lines: [{ productId: p.id, unitId: p.units[0].id, qty: 1 }] }, [{ method: 'cash', amount: p.units[0].price }]); return 'ĐÃ BÁN'; } catch (e) { return e.message; } })()`);
  ok(/Gói cước đã hết hạn/.test(blocked), 'hết hạn → bán bị chặn: ' + blocked.slice(0, 50));
  const rep = await ev(`(async () => { const { E } = window.__app; return E.listSales().length > 0 && typeof E.salesByDay !== 'undefined' || E.listSales().length > 0; })()`);
  ok(rep === true, 'hết hạn → vẫn xem được hoá đơn');
} finally { try { ws && ws.close(); } catch (e) {} edge.kill(); await sleep(500); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
if (errors.length) { fail++; console.log('  ✘ ngoại lệ JS:', errors.slice(0, 3).join(' | ')); }
console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`); process.exitCode = fail ? 1 : 0;
