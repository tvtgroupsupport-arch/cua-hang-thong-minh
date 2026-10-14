/* Kiểm thử đồng bộ: script SQL chạy trên Postgres THẬT (PGlite), nhiều "thiết bị" là nhiều bộ nhớ lưu trữ khác nhau nạp vào cùng một kho S. */
import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js';
import * as E from '../www/js/engine/index.js';
import * as Sync from '../www/js/sync/engine.js';
import { S, memoryAdapter, SYNC_COLLS } from '../www/js/store.js';
import { SyncError } from '../www/js/sync/transport.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} mong đợi ${JSON.stringify(b)} nhưng được ${JSON.stringify(a)}`); };
const ok = (v, msg = 'điều kiện sai') => { if (!v) throw new Error(msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Máy chủ giả = Postgres thật ---------- */
let db = null;
const pgRpc = async (fn, args) => {
  const names = Object.keys(args), sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  const params = names.map(n => { const v = args[n]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
  return (await db.query(sql, params)).rows[0].r;
};
let transportFail = null;       // đặt thành Error để mô phỏng mất mạng
Sync.setTransportFactory(() => async (fn, args) => { if (transportFail) throw transportFail; return pgRpc(fn, args); });

/* ---------- Thiết bị giả lập ---------- */
const devices = {};
async function use(name) {
  await S.flush();
  if (!devices[name]) devices[name] = { adapter: memoryAdapter() };
  await S.init(devices[name].adapter);
}
const login = async () => { await E.login('chu', '1234'); };
const L = (p, qty) => ({ productId: p.id, unitId: p.units[0].id, qty });
const sell = (p, qty, extra = {}) => { const cart = Object.assign({ lines: [L(p, qty)] }, extra); const c = E.calcCart(cart); return E.createSale(cart, [{ method: 'cash', amount: c.total }]); };
const serverCount = async (where = 'true') => Number((await db.query(`select count(*)::int as n from public.pos_records where ${where}`)).rows[0].n);
const stocks = () => Object.fromEntries(S.list('products').map(p => [p.id, p.stock]));
const counts = () => Object.fromEntries(SYNC_COLLS.map(c => [c, S.count(c)]));
const pick = id => S.get('products', id);

/* ============ Kiểm thử ============ */
test('script SQL cài được (chạy 2 lần không lỗi), khoá sai bị từ chối, khoá đúng ping OK', async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated;');
  await use('A');
  await E.setupStore({ store: { name: 'Tạp hóa A' }, owner: { name: 'Chủ', username: 'chu', password: '1234' } });
  const script = Sync.sqlScript();
  await db.exec(script); await db.exec(script);
  const key = S.meta.syncDraft.key;
  eq((await pgRpc('pos_ping', { p_key: key })).ok, true);
  eq((await pgRpc('pos_ping', { p_key: key })).role, 'owner');
  eq((await pgRpc('pos_ping', { p_key: 'sai-khoa-sai-khoa-sai-khoa' })).ok, false);
  eq((await pgRpc('pos_ping', { p_key: 'x' })).ok, false);
  eq((await pgRpc('pos_pull', { p_key: 'sai-khoa-sai-khoa-sai-khoa', p_since: 0, p_limit: 10 })).error, 'auth');
  // bảng bị khoá với anon: truy cập trực tiếp phải bị chặn
  await db.exec('set role anon');
  let blocked = false; try { await db.query('select * from public.pos_records'); } catch (e) { blocked = true; }
  await db.exec('reset role');
  ok(blocked, 'anon không được đọc trực tiếp bảng');
  eq(Sync.draftKey(), key, 'khoá nháp ổn định');
});

test('máy chủ cửa hàng bật đồng bộ: đẩy toàn bộ dữ liệu lên, không đẩy trường suy ra', async () => {
  await login(); E.loadDemo({ days: 6 });
  const r = await Sync.connectOwner({ url: 'https://abc.supabase.co/', anon: 'anon-test' });
  ok(!r.error, 'kết nối: ' + r.error);
  eq(Sync.getStatus().pending, 0, 'hàng đợi đã đẩy hết'); eq(Sync.config().role, 'owner'); eq(Sync.config().tag, 'A');
  const total = SYNC_COLLS.reduce((a, c) => a + S.count(c), 0);
  eq(await serverCount("coll <> '_meta'"), total, 'số bản ghi trên máy chủ = trên máy');
  eq(await serverCount("coll = 'products' and data ? 'stock'"), 0, 'tồn kho không được gửi lên');
  eq(await serverCount("coll = 'customers' and data ?| array['debt','points','totalSpent']"), 0);
  eq(await serverCount("coll = 'batches' and data ? 'qty'"), 0);
  ok(await serverCount("coll = '_meta' and id = 'settings'") === 1, 'cài đặt cửa hàng được đồng bộ');
  ok(total > 300, 'đủ lớn để thử phân trang (200 bản ghi/trang): ' + total);
});

test('máy phụ vào bằng mã kết nối: kéo đủ dữ liệu (nhiều trang), tồn kho/công nợ khớp, đăng nhập được', async () => {
  const code = await Sync.createJoinCode({ name: 'Quầy 2', role: 'staff' });
  ok(code.startsWith('TH1.'));
  const A = { counts: counts(), stocks: stocks(), debts: Object.fromEntries(S.list('customers').map(c => [c.id, c.debt])), sup: Object.fromEntries(S.list('suppliers').map(c => [c.id, c.debt])), pts: Object.fromEntries(S.list('customers').map(c => [c.id, [c.points, c.totalSpent]])) };
  const batchQty = Object.fromEntries(S.list('batches').map(b => [b.id, b.qty]));
  const promoUsed = Object.fromEntries(S.list('promos').map(p => [p.id, p.used]));
  await use('B');
  const r = await Sync.joinWithCode(code);
  ok(!r.error, 'tham gia: ' + r.error); ok(r.pulled > 400, 'kéo nhiều trang: ' + r.pulled);
  eq(counts(), A.counts, 'số bản ghi từng bộ sưu tập');
  eq(stocks(), A.stocks, 'tồn kho tính lại từ sổ kho khớp máy chủ cửa hàng');
  eq(Object.fromEntries(S.list('customers').map(c => [c.id, c.debt])), A.debts, 'nợ khách');
  eq(Object.fromEntries(S.list('suppliers').map(c => [c.id, c.debt])), A.sup, 'nợ NCC');
  eq(Object.fromEntries(S.list('customers').map(c => [c.id, [c.points, c.totalSpent]])), A.pts, 'điểm & tổng mua');
  eq(Object.fromEntries(S.list('batches').map(b => [b.id, b.qty])), batchQty, 'tồn theo lô');
  eq(Object.fromEntries(S.list('promos').map(p => [p.id, p.used])), promoUsed, 'lượt dùng khuyến mãi');
  eq(Sync.config().role, 'staff'); eq(Sync.config().tag, 'B');
  ok(E.isSetUp(), 'có tài khoản chủ'); await login(); ok(E.currentUser().role === 'owner');
  eq(Sync.recomputeDerived(), 0, 'không còn gì cần tính lại');
});

test('bán ở máy B → máy A thấy hoá đơn và tồn kho đúng; mã hoá đơn có mã máy', async () => {
  await use('B'); await login();
  const p = S.list('products').find(x => x.stock > 20 && !x.trackBatch), s0 = p.stock;
  const s = sell(p, 3); ok(/-B\d{3}$/.test(s.code), 'mã máy B: ' + s.code);
  eq(pick(p.id).stock, s0 - 3); ok(Sync.getStatus().pending > 0);
  ok(!(await Sync.syncNow()).error); eq(Sync.getStatus().pending, 0);
  await use('A'); await login();
  eq(pick(p.id).stock, s0, 'chưa đồng bộ nên A vẫn cũ'); ok(!S.list('sales').some(x => x.code === s.code));
  ok(!(await Sync.syncNow()).error);
  eq(pick(p.id).stock, s0 - 3, 'A đã trừ kho theo hoá đơn của B'); ok(S.list('sales').some(x => x.code === s.code));
  world.X = p.id; world.s0 = s0 - 3;
});

test('hai máy cùng bán một mặt hàng khi mất mạng: tồn cuối trừ đủ cả hai, không ghi đè nhau', async () => {
  await use('A'); await login();
  const p = pick(world.X), base = p.stock;
  const sa = sell(p, 2);                               // A bán 2 (chưa đồng bộ)
  await use('B'); await login();
  eq(pick(world.X).stock, base, 'B chưa biết giao dịch của A');
  const sb = sell(pick(world.X), 4);                   // B bán 4 (chưa đồng bộ)
  ok(!(await Sync.syncNow()).error);                   // B đẩy lên (kéo về chưa có của A)
  eq(pick(world.X).stock, base - 4, 'B chỉ biết giao dịch của mình (A chưa đẩy lên)');
  await use('A'); ok(!(await Sync.syncNow()).error);                               // A kéo giao dịch của B, đẩy giao dịch của mình
  eq(pick(world.X).stock, base - 6, 'A: trừ đủ cả hai'); ok(sa.code !== sb.code, 'mã khác nhau');
  eq(S.list('sales').filter(x => x.code === sa.code || x.code === sb.code).length, 2);
  await use('B'); ok(!(await Sync.syncNow()).error); eq(pick(world.X).stock, base - 6);
  world.base = base - 6;
});

test('hai máy sửa cùng một sản phẩm: bản có mốc mới hơn thắng, không bị bản cũ ghi đè', async () => {
  await use('A'); await login();
  const p = S.list('products').find(x => x.id !== world.X);
  E.saveProduct({ id: p.id, name: 'Tên do A sửa', units: pick(p.id).units, categoryId: p.categoryId, kind: p.kind });
  ok(!(await Sync.syncNow()).error);
  await use('B'); await login();
  await sleep(15);
  E.saveProduct({ id: p.id, name: 'Tên do B sửa sau', units: pick(p.id).units, categoryId: p.categoryId, kind: p.kind });   // B sửa SAU, trước khi kéo bản của A
  ok(!(await Sync.syncNow()).error);
  eq(pick(p.id).name, 'Tên do B sửa sau', 'bản cục bộ mới hơn được giữ');
  await use('A'); ok(!(await Sync.syncNow()).error); eq(pick(p.id).name, 'Tên do B sửa sau', 'A nhận bản mới hơn');
  eq(await serverCount(`coll='products' and id='${p.id}' and data->>'name'='Tên do B sửa sau'`), 1);
});

test('xoá lan sang máy khác (bia mộ), không "sống lại"', async () => {
  await use('A'); await login();
  const cat = E.saveCategory({ name: 'Nhóm tạm xoá' });
  ok(!(await Sync.syncNow()).error);
  await use('B'); await login(); ok(!(await Sync.syncNow()).error); ok(S.get('categories', cat.id), 'B có nhóm');
  await use('A'); await login(); E.deleteCategory(cat.id); ok(!(await Sync.syncNow()).error);
  eq(await serverCount(`coll='categories' and id='${cat.id}' and deleted`), 1);
  await use('B'); await login(); ok(!(await Sync.syncNow()).error); eq(S.get('categories', cat.id), null, 'B đã xoá theo');
  await use('A'); await login(); ok(!(await Sync.syncNow()).error); eq(S.get('categories', cat.id), null, 'A không bị "sống lại"');
});

test('máy nhân viên: không ghi được cài đặt/tài khoản nhân viên, không xoá được dữ liệu', async () => {
  await use('B'); await login();
  const before = (await db.query("select data->'store'->>'name' as n from public.pos_records where coll='_meta' and id='settings'")).rows[0].n;
  E.saveSettings({ store: { name: 'Bị chiếm quyền' } });
  const cat = E.saveCategory({ name: 'Nhóm của B' }); ok(!(await Sync.syncNow()).error);
  const r1 = (await db.query("select data->'store'->>'name' as n from public.pos_records where coll='_meta' and id='settings'")).rows[0].n;
  eq(r1, before, 'cài đặt trên máy chủ không đổi'); eq(await serverCount(`coll='categories' and id='${cat.id}'`), 1, 'ghi dữ liệu vận hành thì được');
  eq(E.settings().store.name, before, 'cài đặt trên máy B được đưa về đúng bản máy chủ');
  E.deleteCategory(cat.id); eq(S.get('categories', cat.id), null); ok(!(await Sync.syncNow()).error);
  eq(await serverCount(`coll='categories' and id='${cat.id}' and not deleted`), 1, 'máy nhân viên không xoá được trên máy chủ');
  ok(S.get('categories', cat.id), 'máy B được khôi phục lại bản ghi bị từ chối xoá');
  const key = Sync.config().key;
  eq((await pgRpc('pos_register_device', { p_key: key, p_name: 'x', p_role: 'staff' })).ok, false, 'máy nhân viên không cấp được thiết bị mới');
  eq((await pgRpc('pos_list_devices', { p_key: key })).ok, false);
  const fake = await pgRpc('pos_push', { p_key: key, p_items: [{ c: 'staff', i: 'zzz', d: { id: 'zzz', name: 'giả' }, u: Date.now() }], p_device: 'B' });
  eq([fake.ok, fake.skipped, fake.accepted], [true, 1, 0], 'ghi tài khoản nhân viên bị bỏ qua');
});

test('chủ thu hồi thiết bị: máy đó bị từ chối; cấp lại thì dùng được', async () => {
  await use('A'); await login();
  const d = await Sync.listDevices(); eq(d.devices.length, 2); const staff = d.devices.find(x => x.role === 'staff'); ok(staff);
  await Sync.revokeDevice(staff.hash);
  await use('B'); await login();
  const r = await Sync.syncNow(); eq(r.code, 'auth'); ok(Sync.getStatus().error.includes('không còn quyền'));
  await use('A'); await login(); await Sync.revokeDevice(staff.hash, false);
  await use('B'); await login(); ok(!(await Sync.syncNow()).error); eq(Sync.getStatus().error, '');
  await use('A'); await login();
  let self = false; try { await Sync.revokeDevice(d.me); } catch (e) { self = /chính máy này/.test(e.message); } ok(self, 'không tự thu hồi mình');
});

test('mất mạng: báo lỗi, giữ hàng đợi; có mạng lại thì tự đẩy bù', async () => {
  await use('A'); await login();
  const p = pick(world.X); sell(p, 1);
  transportFail = new SyncError('Không kết nối được máy chủ (kiểm tra mạng và địa chỉ dự án)', 'network');
  const r = await Sync.syncNow(); ok(r.error, 'phải báo lỗi'); ok(Sync.getStatus().pending > 0, 'hàng đợi còn'); ok(Sync.getStatus().error.includes('kết nối'));
  await S.flush(); await use('A'); await login();               // tắt mở lại app: hàng đợi vẫn còn (lưu bền)
  ok(Sync.getStatus().pending > 0, 'hàng đợi được lưu bền');
  transportFail = null;
  ok(!(await Sync.syncNow()).error); eq(Sync.getStatus().pending, 0);
  await use('B'); await login(); ok(!(await Sync.syncNow()).error); eq(pick(world.X).stock, world.base - 1);
});

test('số suy ra luôn khớp sổ ở mọi máy; sao lưu không chứa cấu hình kết nối; số lượng bản ghi hai máy bằng nhau', async () => {
  await use('A'); await login(); ok(!(await Sync.syncNow()).error); const ca = counts(), sa = stocks();
  eq(Sync.recomputeDerived(), 0, 'A: không còn gì lệch');
  const dump = S.dump(); ok(!dump.meta.sync && !dump.meta.syncq && !dump.meta.syncDraft, 'sao lưu không chứa khoá kết nối');
  await use('B'); await login(); ok(!(await Sync.syncNow()).error);
  eq(counts(), ca, 'cùng số bản ghi'); eq(stocks(), sa, 'cùng tồn kho'); eq(Sync.recomputeDerived(), 0, 'B: không còn gì lệch');
});

test('ngắt đồng bộ: giữ dữ liệu trên máy, thôi xếp hàng đợi', async () => {
  await use('B'); await login();
  await Sync.disconnect(); eq(Sync.isEnabled(), false); eq(S.syncOn, false);
  const n = S.count('products'); const p = S.list('products')[0]; E.saveProduct({ id: p.id, name: p.name + ' (sau ngắt)', units: p.units, categoryId: p.categoryId, kind: p.kind });
  eq(S.syncQ.size, 0, 'không xếp hàng nữa'); eq(S.count('products'), n);
  eq((await Sync.syncNow()).skipped, true);
});

const world = {};

/* ============ Chạy ============ */
const out = document.getElementById('out');
let pass = 0, failN = 0;
for (const [name, fn] of tests) {
  const div = document.createElement('div');
  const t0 = performance.now();
  try { await fn(); div.className = 'ok'; div.textContent = `✔ ${name} (${Math.round(performance.now() - t0)}ms)`; pass++; }
  catch (e) { div.className = 'bad'; div.textContent = '✘ ' + name; const pre = document.createElement('pre'); pre.textContent = e.stack || e.message; div.appendChild(pre); failN++; console.error(name, e); }
  out.appendChild(div);
}
const sum = document.createElement('h3'); sum.id = 'summary'; sum.textContent = `KẾT QUẢ: ${pass} đạt, ${failN} lỗi / ${tests.length}`; out.prepend(sum);
window.__done = { pass, fail: failN };
