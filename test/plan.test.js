/* Kiểm thử gói cước + tài khoản lưu trữ + tự tạo Supabase qua OAuth (phía máy chủ trung tâm chạy SQL THẬT trên Postgres bằng PGlite; Edge Function được giả lập). */
import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js';
import * as E from '../www/js/engine/index.js';
import * as Sync from '../www/js/sync/engine.js';
import * as License from '../www/js/license.js';
import * as Central from '../www/js/cloud/central.js';
import { oauthProvision, oauthAvailable } from '../www/js/sync/provision.js';
import { S, memoryAdapter } from '../www/js/store.js';
import { setWriteGuard } from '../www/js/engine/auth.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} mong đợi ${JSON.stringify(b)} nhưng được ${JSON.stringify(a)}`); };
const ok = (v, msg = 'điều kiện sai') => { if (!v) throw new Error(msg); };
const DAY = 86400000;
const rejects = async (fn, re, msg) => { let e = null; try { await fn(); } catch (x) { e = x; } if (!e) throw new Error((msg || 'phải lỗi') + ' — nhưng không lỗi'); if (re && !re.test(e.message)) throw new Error(`${msg || ''} lỗi sai: ${e.message}`); };

/* ---------- Máy chủ trung tâm giả = Postgres thật + khung auth tối thiểu ---------- */
let central = null;
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222', ADM = '99999999-9999-9999-9999-999999999999';
async function bootCentral() {
  const db = new PGlite();
  const sql = await (await fetch('../supabase/central-setup.sql')).text();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema extensions; create function pg_catalog.dummy_pgrst() returns void language sql as 'select 1';`.replace(/create function pg_catalog\.dummy_pgrst[^;]*;/, ''));
  await db.exec(sql.replace('notify pgrst, \'reload schema\';', ''));
  await db.exec(sql.replace('notify pgrst, \'reload schema\';', ''));          // chạy lại lần 2 phải êm
  return db;
}
const as = async (db, uid, fn) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`); try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); } };
const q1 = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
const rpcOn = (db, uid) => async (fn, args = {}) => {
  const names = Object.keys(args), sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  return as(db, uid, async () => (await db.query(sql, names.map(n => args[n]))).rows[0].r);
};

test('SQL trung tâm: cài 2 lần êm; tài khoản mới tự có hồ sơ + gói dùng thử 14 ngày', async () => {
  central = await bootCentral();
  await central.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${U1}', 'chu1@x.vn', '{"shop_name":"Tạp hóa Một"}'), ('${U2}', 'chu2@x.vn', '{}'), ('${ADM}', 'admin@x.vn', '{}')`);
  const s = await rpcOn(central, U1)('get_my_subscription');
  eq(s.status, 'trial'); eq(s.plan_months, 0);
  const days = (Date.parse(s.expires_at) - Date.parse(s.server_now)) / DAY; ok(Math.abs(days - 14) < 0.01, 'dùng thử ' + days);
  eq((await q1(central, `select shop_name from public.profiles where id='${U1}'`)).shop_name, 'Tạp hóa Một');
});

test('SQL trung tâm: chủ chỉ thấy gói của mình; không tự ghi/sửa được gói; anon không gọi được hàm', async () => {
  await rejects(() => as(central, U1, () => central.query(`update public.subscriptions set expires_at = now() + interval '5 years' where owner_id = '${U1}'`)), /permission denied/i, 'tự sửa gói');
  await rejects(() => as(central, U1, () => central.query(`insert into public.subscriptions (owner_id, expires_at) values ('${U2}', now())`)), /permission denied/i, 'tự ghi gói');
  const rows = await as(central, U1, async () => (await central.query('select owner_id from public.subscriptions')).rows);
  eq(rows.length, 1); eq(rows[0].owner_id, U1);
  await central.exec('set role anon');
  await rejects(() => central.query('select public.get_my_subscription()'), /permission denied/i, 'anon gọi hàm');
  await central.exec('reset role');
  await rejects(() => rpcOn(central, U1)('admin_overview'), /Không có quyền/, 'chủ không phải admin');
});

test('SQL trung tâm: yêu cầu gia hạn → admin duyệt cộng dồn đúng hạn; gửi lại thay yêu cầu cũ; gói sai bị từ chối', async () => {
  const u1 = rpcOn(central, U1), adm = rpcOn(central, ADM);
  await rejects(() => u1('request_renewal', { p_months: 3, p_note: 'x' }), /Gói không hợp lệ/);
  const id1 = await u1('request_renewal', { p_months: 1, p_note: 'lần 1' }), id2 = await u1('request_renewal', { p_months: 6, p_note: 'lần 2' });
  eq(id1, id2, 'một yêu cầu chờ duy nhất');
  eq((await u1('get_my_requests')).length, 1);
  await central.exec(`insert into public.admins (user_id) values ('${ADM}')`);
  const pend = await adm('admin_pending_requests'); eq(pend.length, 1); eq(pend[0].plan_months, 6); eq(pend[0].email, 'chu1@x.vn');
  const before = Date.parse((await u1('get_my_subscription')).expires_at);
  eq(await adm('admin_approve_renewal', { p_id: id1 }), true);
  const after = await u1('get_my_subscription');
  eq(after.status, 'active'); eq(after.plan_months, 6);
  // hạn mới = hạn cũ (còn dùng thử ~14 ngày) + 6 tháng — gia hạn sớm không mất phần còn lại
  const gain = (Date.parse(after.expires_at) - before) / DAY; ok(gain > 180 && gain < 186, 'cộng ' + gain);
  await rejects(() => adm('admin_approve_renewal', { p_id: id1 }), /không còn ở trạng thái chờ/, 'duyệt lại lần hai');
  eq((await u1('get_my_requests'))[0].status, 'approved');
  eq((await adm('admin_overview')).some(o => o.email === 'admin@x.vn'), false, 'admin không nằm trong danh sách chủ cửa hàng');
  // hết hạn: đặt hạn về quá khứ → trạng thái expired
  await central.exec(`update public.subscriptions set expires_at = now() - interval '1 day' where owner_id = '${U2}'`);
  eq((await rpcOn(central, U2)('get_my_subscription')).status, 'expired');
  await rejects(() => rpcOn(central, U2)('admin_extend', { p_owner: U2, p_months: 1 }), /Không có quyền/, 'chủ tự cộng tháng');
  eq(await adm('admin_extend', { p_owner: U2, p_months: 1 }), true);
  eq((await rpcOn(central, U2)('get_my_subscription')).status, 'active');
});

test('SQL trung tâm: lưu địa chỉ kho hợp lệ, chặn địa chỉ lạ; provision_jobs đóng với client', async () => {
  const u2 = rpcOn(central, U2);
  await rejects(() => u2('save_store_link', { p_url: 'http://x.supabase.co', p_anon: 'a'.repeat(30) }), /không hợp lệ/, 'http thường');
  await rejects(() => u2('save_store_link', { p_url: 'https://x.supabase.co/abc', p_anon: 'a'.repeat(30) }), /không hợp lệ/, 'có đường dẫn');
  await u2('save_store_link', { p_url: 'https://abc.supabase.co', p_anon: 'a'.repeat(30) });
  eq((await u2('get_store_link')).url, 'https://abc.supabase.co');
  await rejects(() => as(central, U2, () => central.query('select * from public.provision_jobs')), /permission denied/i, 'đọc provision_jobs');
  await u2('clear_store_link'); eq(await u2('get_store_link'), null);
});

/* ---------- Phía máy khách ---------- */
const CFG = { centralUrl: 'https://central.supabase.co', centralAnonKey: 'k'.repeat(40), localTrialDays: 14, supportText: 'Chuyển khoản…' };
async function freshStore(name = 'Tạp hóa T') {
  await S.flush(); await S.init(memoryAdapter());
  await E.setupStore({ store: { name }, owner: { name: 'Chủ', username: 'chu', password: '1234' } });
  await E.login('chu', '1234');
}
const mk = () => E.saveProduct({ name: 'Mì gói', units: [{ name: 'gói', price: 5000, barcodes: [] }], cost: 3000, stock: 50 });
const sellOne = () => { const p = S.list('products')[0] || mk(), cart = { lines: [{ productId: p.id, unitId: p.units[0].id, qty: 1 }] }; return E.createSale(cart, [{ method: 'cash', amount: E.calcCart(cart).total }]); };

test('khoá mềm: chưa cấu hình trung tâm → bản miễn phí, không khoá', async () => {
  Central.setConfig({}); await freshStore(); License.init();
  eq(License.status().locked, false); eq(License.status().enabled, false); ok(/miễn phí/.test(License.describe()));
  License.ensureTrialStart(); eq(S.meta.trialStart, undefined, 'không ghi mốc dùng thử khi miễn phí');
});

test('khoá mềm: dùng thử cục bộ 14 ngày → hết hạn khoá bán/nhập/thu chi nhưng vẫn xem & xuất báo cáo', async () => {
  Central.setConfig(CFG); await freshStore(); License.init();
  const prod = mk();
  License.ensureTrialStart(); eq(License.status().state, 'ok'); eq(License.status().daysLeft, 14);
  sellOne();                                              // còn hạn: bán được
  S.setMeta('trialStart', Date.now() - 20 * DAY);
  const st = License.status(); eq(st.locked, true); ok(/Hết thời gian dùng thử/.test(License.describe()), License.describe());
  await rejects(async () => sellOne(), /Gói cước đã hết hạn/, 'bán khi hết hạn');
  await rejects(async () => E.addCashEntry({ kind: 'in', amount: 1000 }), /Gói cước đã hết hạn/, 'thu chi');
  await rejects(async () => E.createPurchase({ items: [{ productId: prod.id, unitId: prod.units[0].id, qty: 1, cost: 1000 }] }), /Gói cước đã hết hạn/, 'nhập hàng');
  ok(E.listSales().length >= 1, 'xem được hoá đơn');
});

test('khoá mềm: gói trả phí còn hạn mở khoá; chỉnh lùi đồng hồ không kéo dài hạn', async () => {
  S.setMeta('license', { plan_months: 6, status: 'active', expires_at: Date.now() + 100 * DAY, checked_at: Date.now() });
  eq(License.status().locked, false); eq(License.status().plan, 6); ok(License.status().daysLeft >= 99);
  sellOne();
  // đã từng thấy mốc +200 ngày (giờ máy chủ) → đồng hồ máy bị lùi về hiện tại vẫn bị coi là +200 ngày → gói hết hạn
  S.setMeta('clockHw', Date.now() + 200 * DAY);
  eq(License.status().locked, true, 'đồng hồ lùi không được hồi sinh gói');
  await rejects(async () => sellOne(), /Gói cước đã hết hạn/);
  S.setMeta('clockHw', Date.now());                       // dọn
  eq(License.status().locked, false);
});

test('khoá mềm: máy phụ chỉ theo hạn của máy chủ cửa hàng (không có dùng thử riêng)', async () => {
  S.setMeta('license', undefined); S.setMeta('trialStart', Date.now() - 20 * DAY);
  eq(License.status().locked, true, 'máy chủ: hết dùng thử');
  S.setMeta('sync', { enabled: true, role: 'staff', url: 'https://a.supabase.co', anon: 'a', key: 'k' });
  eq(License.status().state, 'unknown', 'máy phụ chưa nhận được hạn → không khoá');
  S.setMeta('license', { plan_months: 1, status: 'active', expires_at: Date.now() - DAY });
  eq(License.status().locked, true, 'hạn của chủ đã hết → máy phụ cũng khoá');
  S.setMeta('license', { plan_months: 1, status: 'active', expires_at: Date.now() + 10 * DAY });
  eq(License.status().locked, false); eq(License.status().state, 'ok');
  S.setMeta('sync', { enabled: false });
});

/* Máy khách ↔ trung tâm thật (Postgres) qua fetch giả đi vào đúng các hàm RPC */
function fakeCentralFetch() {
  const st = { calls: [], users: {}, refreshes: 0, failRefresh: false };
  const tok = (u, exp = 3600) => ({ access_token: 'AT-' + u.id + '-' + (++st.refreshes), refresh_token: 'RT-' + u.id, expires_in: exp, user: { id: u.id, email: u.email } });
  st.fetch = async (url, init) => {
    const path = url.replace(CFG.centralUrl, ''), body = init.body ? JSON.parse(init.body) : null;
    st.calls.push({ path, auth: (init.headers || {}).Authorization, body });
    const res = (status, j) => ({ ok: status < 400, status, text: async () => JSON.stringify(j) });
    if ((init.headers || {}).apikey !== CFG.centralAnonKey) return res(401, { message: 'No API key' });
    if (path === '/auth/v1/signup') { if (st.users[body.email]) return res(422, { msg: 'User already registered' }); if (body.password.length < 6) return res(422, { msg: 'Password should be at least 6 characters' });
      const u = { id: U1, email: body.email, password: body.password }; st.users[body.email] = u; return st.confirm ? res(200, { id: u.id, email: u.email }) : res(200, tok(u)); }
    if (path === '/auth/v1/token?grant_type=password') { const u = st.users[body.email]; return u && u.password === body.password ? res(200, tok(u, st.expIn)) : res(400, { error_description: 'Invalid login credentials' }); }
    if (path === '/auth/v1/token?grant_type=refresh_token') { if (st.failRefresh) return res(400, { error_description: 'Invalid Refresh Token' }); const u = Object.values(st.users)[0]; return res(200, tok(u)); }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(); if (!(init.headers.Authorization || '').startsWith('Bearer AT-')) return res(401, { message: 'JWT' });
      try { return res(200, await rpcOn(central, U1)(fn, body || {})); } catch (e) { return res(400, { message: e.message }); }
    }
    return res(404, { message: 'not found' });
  };
  return st;
}

test('tài khoản lưu trữ: đăng ký/đăng nhập, lỗi dịch tiếng Việt, token tự làm mới, lấy gói từ trung tâm thật', async () => {
  Central.setConfig(CFG); await freshStore(); License.init();
  const f = fakeCentralFetch(); Central.setFetch(f.fetch);
  await rejects(() => Central.signUp({ email: 'sai', password: '123456' }), /Email không hợp lệ/);
  await rejects(() => Central.signUp({ email: 'a@b.vn', password: '123' }), /tối thiểu 6/);
  f.confirm = true; const r0 = await Central.signUp({ email: 'a@b.vn', password: '123456', shopName: 'T' }); eq(r0.needConfirm, true); eq(Central.isSignedIn(), false);
  await rejects(() => Central.signUp({ email: 'a@b.vn', password: '123456' }), /đã có tài khoản/);
  await rejects(() => Central.signIn({ email: 'a@b.vn', password: 'sai-mat-khau' }), /Sai email hoặc mật khẩu/);
  f.expIn = 30;                                            // token sống 30s → phải làm mới trước mỗi lần gọi
  await Central.signIn({ email: 'a@b.vn', password: '123456' });
  ok(Central.isSignedIn()); eq(Central.accountEmail(), 'a@b.vn'); ok(S.meta.central.access.startsWith('AT-'));
  const lic = await License.refresh();
  ok(f.calls.some(c => c.path === '/auth/v1/token?grant_type=refresh_token'), 'đã tự làm mới token');
  eq(S.meta.license.status, 'active'); eq(S.meta.license.plan_months, 6); ok(S.meta.license.expires_at > Date.now() + 170 * DAY, 'hạn từ trung tâm (gói 6 tháng đã duyệt ở test trước)');
  eq(lic.plan, 6); eq(lic.locked, false); ok(Math.abs(License.status().expiresAt - S.meta.license.expires_at) < 1, 'hạn hiệu lực = hạn gói');
  await Central.rpc('request_renewal', { p_months: 6, p_note: 'ck' });
  eq((await Central.rpc('get_my_requests'))[0].plan_months, 6);
  // refresh token hỏng → đăng xuất, báo lỗi dễ hiểu
  f.failRefresh = true; S.setMeta('central', Object.assign({}, S.meta.central, { exp: 0 }));
  await rejects(() => Central.rpc('get_my_subscription'), /đăng nhập lại/);
  eq(Central.isSignedIn(), false);
  f.failRefresh = false; Central.signOut();
  ok(!JSON.stringify(S.dump()).includes('RT-'), 'token không nằm trong sao lưu');
});

test('sao lưu không chứa phiên đăng nhập trung tâm / mốc đồng hồ / mốc dùng thử', async () => {
  S.setMeta('central', { access: 'AT-x', refresh: 'RT-x', exp: 1 }); S.setMeta('clockHw', 5); S.setMeta('trialStart', 6);
  const dump = JSON.stringify(S.dump());
  ok(!dump.includes('RT-x') && !dump.includes('clockHw') && !dump.includes('trialStart'), 'sao lưu lộ meta cục bộ');
  S.setMeta('central', null);
});

test('tự tạo Supabase qua OAuth: start → chờ Authorize → các bước → done → liên kết & đẩy dữ liệu; bấm lại không tạo trùng', async () => {
  Central.setConfig(CFG); await freshStore('Tạp hóa OAuth'); License.init();
  const store = new PGlite(); await store.exec('create role anon; create role authenticated;');
  Sync.setTransportFactory(() => async (fn, args) => {         // máy chủ cửa hàng giả = Postgres thật
    const names = Object.keys(args), sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
    return (await store.query(sql, names.map(n => { const v = args[n]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; }))).rows[0].r;
  });
  const job = { created: 0, sql: null, polls: 0 }, opened = [], progress = [];
  const callFn = async (name, body) => {
    if (name === 'provision-start') { ok(body.sql.includes('pos_records') && body.sql.length > 500, 'gửi kèm script SQL'); job.sql = body.sql; return job.created ? { resume: true } : { authorize_url: 'https://api.supabase.com/v1/oauth/authorize?x=1' }; }
    job.polls++;
    if (job.polls <= 2) return { state: 'awaiting_auth', step: 1, total: 8, message: 'Đang chờ bạn đồng ý…' };
    if (job.polls === 3) { job.created++; return { state: 'creating', step: 4, total: 8, message: 'Dự án đang khởi động…' }; }
    if (job.polls === 4) { await store.exec(job.sql); return { state: 'sql_ok', step: 7, total: 8, message: 'kiểm tra' }; }
    return { state: 'done', step: 8, total: 8, url: 'https://abc.supabase.co', anon_key: 'ANON-KEY-ANON-KEY-ANON-KEY' };
  };
  ok(!oauthAvailable(), 'chưa đăng nhập → chưa dùng được cách nhanh');
  const r = await oauthProvision({ openUrl: u => opened.push(u), onProgress: (i, n, t) => progress.push(i), deps: { callFn, sleep: async () => {}, waitMs: 0, workMs: 0 } });
  eq(opened.length, 1); ok(opened[0].startsWith('https://api.supabase.com/'), 'mở trang Authorize');
  eq(r.url, 'https://abc.supabase.co'); eq(job.created, 1);
  ok(Sync.isEnabled() && Sync.config().role === 'owner', 'đã bật đồng bộ chủ cửa hàng');
  ok(progress.includes(1) && progress.includes(4) && progress.includes(8), 'có tiến độ');
  const n = Number((await store.query('select count(*)::int as n from public.pos_records')).rows[0].n); ok(n > 0, 'dữ liệu đã lên kho vừa tạo: ' + n);
  await Sync.disconnect();
  // lỗi từ máy chủ → ném lỗi tiếng Việt, không vòng lặp vô hạn
  await rejects(() => oauthProvision({ deps: { callFn: async name => name === 'provision-start' ? { resume: true } : { state: 'error', message: 'Tài khoản Supabase của bạn đã đủ số dự án miễn phí.' }, sleep: async () => {}, waitMs: 0, workMs: 0 } }), /đủ số dự án/);
  // quá hạn chờ
  await rejects(() => oauthProvision({ deps: { callFn: async name => name === 'provision-start' ? { resume: true } : { state: 'creating', step: 4, total: 8 }, sleep: async () => {}, waitMs: 0, workMs: 0, maxMs: 30 } }), /Quá thời gian/);
  Sync.setTransportFactory(null);
});

test('máy chủ nhập trong app: nhận khoá anon, từ chối khoá bí mật; bật/gỡ → bản miễn phí ↔ có gói cước', async () => {
  Central.setConfig(null); const keep = window.APP_CONFIG; window.APP_CONFIG = {};
  try {
    await freshStore(); License.init();
    eq(License.enabled(), false); eq(Central.isCustomConfig(), false);
    const jwt = role => 'x.' + btoa(JSON.stringify({ role })).replace(/=+$/, '') + '.y';
    await rejects(async () => Central.setLocalConfig('http://a.supabase.co', jwt('anon') + 'a'.repeat(20)), /https/, 'http thường');
    await rejects(async () => Central.setLocalConfig('https://a.supabase.co', 'ngan'), /quá ngắn/);
    await rejects(async () => Central.setLocalConfig('https://a.supabase.co', jwt('service_role') + 'a'.repeat(20)), /BÍ MẬT/, 'service_role');
    await rejects(async () => Central.setLocalConfig('https://a.supabase.co', 'sb_secret_' + 'a'.repeat(30)), /BÍ MẬT/, 'sb_secret');
    eq(License.enabled(), false, 'khoá sai không được lưu');
    Central.setLocalConfig('https://a.supabase.co/', jwt('anon') + 'a'.repeat(20));
    eq(Central.cfg().centralUrl, 'https://a.supabase.co'); eq(License.enabled(), true); eq(Central.isCustomConfig(), true);
    License.ensureTrialStart(); eq(License.status().state, 'ok'); eq(License.status().daysLeft, 14);
    ok(!JSON.stringify(S.dump()).includes('a.supabase.co'), 'cấu hình máy chủ không nằm trong sao lưu');
    window.APP_CONFIG = { centralUrl: 'https://build.supabase.co', centralAnonKey: 'k'.repeat(40) };   // cấu hình lúc build luôn thắng
    eq(Central.cfg().centralUrl, 'https://build.supabase.co'); eq(Central.isCustomConfig(), false);
    window.APP_CONFIG = {};
    Central.clearLocalConfig(); eq(License.enabled(), false); eq(License.status().locked, false);
  } finally { window.APP_CONFIG = keep; }
});

const out = document.getElementById('out');
let pass = 0, failN = 0;
for (const [name, fn] of tests) {
  const div = document.createElement('div');
  const t0 = performance.now();
  try { await fn(); div.className = 'ok'; div.textContent = `✔ ${name} (${Math.round(performance.now() - t0)}ms)`; pass++; }
  catch (e) { div.className = 'bad'; div.textContent = '✘ ' + name; const pre = document.createElement('pre'); pre.textContent = e.stack || e.message; div.appendChild(pre); failN++; console.error(name, e); }
  out.appendChild(div);
}
setWriteGuard(null); Central.setFetch(null); Central.setConfig(null);
const sum = document.createElement('h3'); sum.id = 'summary'; sum.textContent = `KẾT QUẢ: ${pass} đạt, ${failN} lỗi / ${tests.length}`; out.prepend(sum);
window.__done = { pass, fail: failN };
