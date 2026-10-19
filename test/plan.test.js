/* Kiểm thử gói cước + tài khoản lưu trữ + tự tạo Supabase qua OAuth (phía máy chủ trung tâm chạy SQL THẬT trên Postgres bằng PGlite; Edge Function được giả lập). */
import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js';
import * as E from '../www/js/engine/index.js';
import * as Sync from '../www/js/sync/engine.js';
import * as License from '../www/js/license.js';
import * as Central from '../www/js/cloud/central.js';
import * as Play from '../www/js/cloud/play-billing.js';
import { oauthProvision, oauthAvailable, resetOauthProbe } from '../www/js/sync/provision.js';
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
function fakeCentralFetch(uid = U1) {
  const st = { calls: [], users: {}, refreshes: 0, failRefresh: false };
  const tok = (u, exp = 3600) => ({ access_token: 'AT-' + u.id + '-' + (++st.refreshes), refresh_token: 'RT-' + u.id, expires_in: exp, user: { id: u.id, email: u.email } });
  st.fetch = async (url, init) => {
    const path = url.replace(CFG.centralUrl, ''), body = init.body ? JSON.parse(init.body) : null;
    st.calls.push({ path, auth: (init.headers || {}).Authorization, body });
    const res = (status, j) => ({ ok: status < 400, status, text: async () => JSON.stringify(j) });
    if ((init.headers || {}).apikey !== CFG.centralAnonKey) return res(401, { message: 'No API key' });
    if (path === '/auth/v1/signup') { if (st.users[body.email]) return res(422, { msg: 'User already registered' }); if (body.password.length < 6) return res(422, { msg: 'Password should be at least 6 characters' });
      const u = { id: uid, email: body.email, password: body.password }; st.users[body.email] = u; return st.confirm ? res(200, { id: u.id, email: u.email }) : res(200, tok(u)); }
    if (path === '/auth/v1/token?grant_type=password') { const u = st.users[body.email]; return u && u.password === body.password ? res(200, tok(u, st.expIn)) : res(400, { error_description: 'Invalid login credentials' }); }
    if (path === '/auth/v1/token?grant_type=refresh_token') { if (st.failRefresh) return res(400, { error_description: 'Invalid Refresh Token' }); const u = Object.values(st.users)[0]; return res(200, tok(u)); }
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop(); if (!(init.headers.Authorization || '').startsWith('Bearer AT-')) return res(401, { message: 'JWT' });
      try { return res(200, await rpcOn(central, uid)(fn, body || {})); } catch (e) { return res(400, { message: e.message }); }
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

/* ---------- Google Play: SQL máy chủ (Postgres thật) ---------- */
const U3 = '33333333-3333-3333-3333-333333333333', U4 = '44444444-4444-4444-4444-444444444444';
const rec = (db, owner, token, product, expISO, state = 'active') => db.query('select public.record_play_purchase($1::uuid, $2, $3, $4::timestamptz, $5, $6::jsonb)', [owner, token, product, expISO, state, '{}']);
const subOf = async uid => rpcOn(central, uid)('get_my_subscription');

test('SQL Google Play: ghi nhận giao dịch đã xác minh → gói google_play; không đổi chủ token; mã gói lạ bị từ chối; thu hồi → hết hạn', async () => {
  await central.exec(`insert into auth.users (id, email) values ('${U3}', 'chu3@x.vn'), ('${U4}', 'chu4@x.vn')`);
  const exp = new Date(Date.now() + 30 * DAY).toISOString();
  await rec(central, U3, 'tok-1', 'goi_1_thang', exp);
  let s = await subOf(U3); eq(s.source, 'google_play'); eq(s.status, 'active'); eq(s.plan_months, 1);
  ok(Math.abs(Date.parse(s.expires_at) - Date.parse(exp)) < 1000, 'hạn đúng ngày Google báo');
  await rejects(() => rec(central, U4, 'tok-1', 'goi_1_thang', exp), /thuộc về tài khoản khác/, 'đổi chủ token');
  await rejects(() => rec(central, U3, 'tok-x', 'goi_99_thang', exp), /Không nhận ra mã gói/, 'mã gói lạ');
  // gia hạn tự động: cùng token, hạn mới
  const exp2 = new Date(Date.now() + 60 * DAY).toISOString(); await rec(central, U3, 'tok-1', 'goi_1_thang', exp2);
  ok(Date.parse((await subOf(U3)).expires_at) > Date.now() + 59 * DAY, 'RTDN gia hạn');
  // hoàn tiền / thu hồi → không còn quyền lợi, hạn lưu KHÔNG ở tương lai
  await rec(central, U3, 'tok-1', 'goi_1_thang', exp2, 'revoked');
  s = await subOf(U3); eq(s.status, 'expired'); ok(Date.parse(s.expires_at) <= Date.now() + 1000, 'hạn không ở tương lai');
  // token cũ hết hạn không ghi đè gói còn hiệu lực từ token mới
  await rec(central, U3, 'tok-2', 'goi_6_thang', new Date(Date.now() + 180 * DAY).toISOString());
  await rec(central, U3, 'tok-1', 'goi_1_thang', new Date(Date.now() - DAY).toISOString(), 'expired');
  s = await subOf(U3); eq(s.status, 'active'); eq(s.plan_months, 6);
});

test('SQL Google Play: admin cộng tay không bị cập nhật từ Google ghi đè; dùng thử chỉ 1 lần/máy; hàm chỉ service_role gọi được', async () => {
  // U4: có gói Google hết hạn, admin cộng 1 tháng → bonus; cập nhật "hết hạn" từ Google không làm mất
  await central.exec(`update public.subscriptions set expires_at = now() - interval '1 day' where owner_id = '${U4}'`);      // hết dùng thử trước (token hết hạn không được ghi đè dùng thử còn hạn)
  await rec(central, U4, 'tok-4', 'goi_1_thang', new Date(Date.now() - DAY).toISOString(), 'expired');
  eq((await subOf(U4)).status, 'expired'); eq((await subOf(U4)).source, 'google_play');
  await rpcOn(central, ADM)('admin_extend', { p_owner: U4, p_months: 1 });
  eq((await subOf(U4)).status, 'active');
  await rec(central, U4, 'tok-4', 'goi_1_thang', new Date(Date.now() - 2 * DAY).toISOString(), 'expired');
  eq((await subOf(U4)).status, 'active', 'phần admin cộng còn nguyên');
  // dùng thử 1 lần mỗi máy
  const q = async (owner, dev, tok) => (await central.query('select public.claim_trial_use($1::uuid, $2, $3) as r', [owner, dev, tok])).rows[0].r;
  eq(await q(U3, 'android-id-12345', 'trial-1'), 'ok'); eq(await q(U3, 'android-id-12345', 'trial-1'), 'ok', 'cùng token gọi lại');
  eq(await q(U4, 'android-id-12345', 'trial-2'), 'used', 'máy đã dùng thử bằng giao dịch khác');
  eq(await q(U4, 'abc', 'trial-3'), 'skipped', 'thiếu mã máy');
  await rejects(() => rec(central, U4, 'trial-2', 'goi_1_thang', new Date(Date.now() + 14 * DAY).toISOString()), /đã dùng thử/, 'token dùng thử bị từ chối');
  // quyền: client không được gọi các hàm ghi nhận
  await rejects(() => as(central, U3, () => central.query("select public.record_play_purchase('" + U3 + "', 't', 'goi_1_thang', now(), 'active', '{}')")), /permission denied/i, 'authenticated gọi record_play_purchase');
  await central.exec('set role anon');
  await rejects(() => central.query("select public.claim_trial_use('" + U3 + "', 'android-id-99999', 'x')"), /permission denied/i, 'anon gọi claim_trial_use');
  await central.exec('reset role');
  await rejects(() => as(central, U3, () => central.query('select * from public.play_purchases')), /permission denied/i, 'đọc play_purchases');
});

/* ---------- Google Play: phía app ---------- */
const labelFor = id => ({ goi_1_thang: 'Gói 1 tháng', goi_6_thang: 'Gói 6 tháng', goi_12_thang: 'Gói 12 tháng' }[id] || id);
const row = (id, o = {}) => Object.assign({ identifier: id.replace(/_/g, '-'), planIdentifier: id, offerId: null, priceString: '₫99.000', title: labelFor(id) }, o);
const trialRow = id => row(id, { offerId: 'free-trial', pricingPhases: [{ price: 0, billingPeriod: 'P14D', priceString: 'Miễn phí' }, { price: 99000, billingPeriod: 'P1M', priceString: '₫99.000' }] });

test('Google Play (app): chu kỳ ISO → tiếng Việt; chuẩn hoá gói + dùng thử; plugin chưa vá thì KHÔNG đoán dùng thử', async () => {
  eq(Play.periodVi('P14D'), '14 ngày'); eq(Play.periodVi('P2W'), '14 ngày'); eq(Play.periodVi('P1M'), '1 tháng'); eq(Play.periodVi('P1Y'), '1 năm'); eq(Play.periodVi('P1M2W'), '1 tháng 14 ngày'); eq(Play.periodVi('xyz'), ''); eq(Play.periodVi('P0D'), '');
  const list = Play.normalizeProducts([row('goi_12_thang'), trialRow('goi_1_thang'), row('goi_1_thang'), row('goi_6_thang'), row('khong_ro')]);
  eq(list.map(Play.productIdOf), ['goi_1_thang', 'goi_6_thang', 'goi_12_thang'], 'thứ tự 1→6→12, bỏ gói lạ');
  eq(list[0].offerId, null, 'giữ dòng giá gốc'); eq(list[0].trial, { period: 'P14D', thenPrice: '₫99.000' }); eq(Play.trialLabel(list[0].trial), 'Dùng thử miễn phí 14 ngày'); eq(list[1].trial, undefined);
  const unpatched = Play.normalizeProducts([row('goi_1_thang'), row('goi_1_thang', { offerId: 'free-trial' })]);
  eq(unpatched[0].trial, undefined, 'không có pricingPhases → không hiện dùng thử');
  eq(Play.trialOf(row('goi_1_thang', { offerId: 'x', pricingPhases: [{ price: 99000, billingPeriod: 'P1M' }] }), null), null, 'giai đoạn đầu có giá → không phải dùng thử');
});

function fakePlay({ products, owned = [] } = {}) {
  const b = { calls: [], owned: owned.slice(), buyResult: null, buyDelay: null };
  Object.assign(b, {
    isSupported: async () => true, getProducts: async () => products, getPurchases: async () => b.owned.slice(), restore: async () => { b.calls.push('restore'); }, manage: async () => { b.calls.push('manage'); },
    purchase: async (id, acct, plan) => { b.calls.push(['purchase', id, acct, plan]); if (b.buyDelay) return b.buyDelay; if (b.buyResult instanceof Error) throw b.buyResult; const tx = { purchaseToken: 'real-' + id + '-' + b.calls.length, productIdentifier: id, purchaseState: '1' }; b.owned.push(tx); return tx; },
  });
  return b;
}
/* máy chủ verify-purchase giả: nhận token, gọi record_play_purchase trên Postgres thật — đúng như Edge Function thật sau khi hỏi Google */
function playServerFetch(uid) {
  const f = fakeCentralFetch(uid); f.verifyCalls = [];
  const inner = f.fetch;
  f.fetch = async (url, init) => {
    const path = url.replace(CFG.centralUrl, '');
    if (path === '/functions/v1/verify-purchase') {
      const body = JSON.parse(init.body); f.verifyCalls.push(body);
      const res = (status, j) => ({ ok: status < 400, status, text: async () => JSON.stringify(j) });
      if (!(init.headers.Authorization || '').startsWith('Bearer AT-')) return res(401, { error: 'Chưa đăng nhập' });
      if (!/^real-goi_\d+_thang/.test(body.purchaseToken)) return res(502, { error: 'Không xác minh được với Google' });
      if (f.trialDevices && body.purchaseToken.includes('trial')) { const c = (await central.query('select public.claim_trial_use($1::uuid,$2,$3) as r', [uid, body.deviceId, body.purchaseToken])).rows[0].r; if (c === 'used') return res(409, { error: 'Máy này đã dùng thử miễn phí rồi', code: 'TRIAL_USED' }); }
      if (f.pending) return res(202, { error: 'Giao dịch đang chờ thanh toán', pending: true });
      const months = Number(/goi_(\d+)_thang/.exec(body.productId)[1]); const exp = new Date(Date.now() + months * 30 * DAY).toISOString();
      await rec(central, uid, body.purchaseToken, body.productId, exp);
      return res(200, { ok: true, state: 'SUBSCRIPTION_STATE_ACTIVE', expires_at: exp });
    }
    return inner(url, init);
  };
  return f;
}

test('Google Play (app): mua gói → gửi token lên máy chủ xác minh → hạn gói cập nhật; huỷ, chờ thanh toán, mua trùng, đang có gói khác, dùng thử đã dùng', async () => {
  const U5 = '55555555-5555-5555-5555-555555555555';
  await central.exec(`insert into auth.users (id, email) values ('${U5}', 'chu5@x.vn')`);
  Central.setConfig(Object.assign({}, CFG, { billingMode: 'play' })); await freshStore(); License.init();
  const f = playServerFetch(U5); Central.setFetch(f.fetch);
  await Central.signUp({ email: 'p@x.vn', password: '123456' });
  eq(Play.enabled(), true);
  const billing = fakePlay({ products: [trialRow('goi_1_thang'), row('goi_1_thang'), row('goi_6_thang'), row('goi_12_thang')] });
  Play.setDeps({ billing, deviceId: 'android-id-777777', retryMs: 5 });
  await Play.loadProducts(); eq(Play.state().products.length, 3); ok(Play.state().products[0].trial, 'hiện dùng thử gói 1 tháng');
  // 1) mua gói 6 tháng thành công
  let r = await Play.purchase('goi_6_thang'); eq(r.status, 'ok');
  eq(billing.calls.find(c => c[0] === 'purchase').slice(1), ['goi_6_thang', U5, 'goi-6-thang'], 'truyền id tài khoản + base plan');
  eq(f.verifyCalls[0].deviceId, 'android-id-777777'); ok(f.verifyCalls[0].purchaseToken.startsWith('real-goi_6_thang'));
  await License.refresh(true); eq(License.status().plan, 6); ok(License.status().daysLeft > 170, 'hạn ≈ 6 tháng'); eq(License.status().locked, false);
  // 2) mua lại đúng gói đang có → không thu thêm tiền
  const callsBefore = billing.calls.filter(c => c[0] === 'purchase').length;
  r = await Play.purchase('goi_6_thang'); eq(r.status, 'already'); eq(billing.calls.filter(c => c[0] === 'purchase').length, callsBefore, 'không gọi Google mua nữa');
  // 3) đang có gói 6 tháng, mua gói 12 tháng → hỏi lại (tính tiền cả hai)
  r = await Play.purchase('goi_12_thang'); eq(r.status, 'other'); eq(r.have, ['6 tháng']);
  // 4) người dùng huỷ hộp thoại mua
  billing.owned = []; billing.buyResult = new Error('User cancelled the purchase'); r = await Play.purchase('goi_1_thang'); eq(r.status, 'cancelled'); billing.buyResult = null;
  // 5) hộp thoại bị đóng mà plugin không trả lời → onResume coi là huỷ, nút không bị khoá mãi
  billing.buyDelay = new Promise(() => {}); const p5 = Play.purchase('goi_1_thang'); await new Promise(x => setTimeout(x, 20)); Play.onResume(10); r = await p5; eq(r.status, 'cancelled'); eq(Play.state().busy, false); billing.buyDelay = null;
  // 6) Google xác nhận trễ (chờ thanh toán)
  f.pending = true; r = await Play.purchase('goi_12_thang', { force: true }); eq(r.status, 'pending'); f.pending = false;
  // 7) ưu đãi dùng thử không còn với tài khoản Google này → dừng, không để bị tính giá gốc
  billing.owned = []; await Play.loadProducts(true); ok(Play.state().products[0].trial);
  billing.getProducts = async () => [row('goi_1_thang'), row('goi_6_thang'), row('goi_12_thang')];
  r = await Play.purchase('goi_1_thang'); eq(r.status, 'trial-gone');
  // 8) máy đã dùng thử → máy chủ trả TRIAL_USED
  f.trialDevices = true; await central.query("select public.claim_trial_use($1::uuid, 'android-id-777777', 'trial-other')", [U4]);
  billing.getProducts = async () => [trialRow('goi_1_thang'), row('goi_1_thang')]; await Play.loadProducts(true);
  billing.purchase = async (id) => ({ purchaseToken: 'real-goi_1_thang-trial', productIdentifier: id }); billing.owned = [];
  r = await Play.purchase('goi_1_thang'); eq(r.status, 'trial-used'); ok(/dùng thử/.test(r.message));
  // 9) khôi phục giao dịch: gửi mọi lượt mua đang có lên máy chủ
  f.trialDevices = false; f.verifyCalls.length = 0; billing.owned = [{ purchaseToken: 'real-goi_6_thang-old', productIdentifier: 'goi_6_thang', purchaseState: '1' }, { purchaseToken: 'x', productIdentifier: 'khong_ro', purchaseState: '1' }, { purchaseToken: 'y', productIdentifier: 'goi_1_thang', purchaseState: '0' }];
  eq((await Play.restore()).status, 'ok'); eq(f.verifyCalls.length, 1, 'chỉ gửi lượt mua hợp lệ (đúng mã gói, đã thanh toán)');
  Play.setDeps(null); Central.setFetch(null);
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
  // hàm provision-* chưa deploy: gateway trả 404 không CORS → "Failed to fetch" → app phải nói rõ nguyên nhân và tắt cách này (không báo nhầm "kiểm tra mạng")
  resetOauthProbe(); Central.setFetch(null); S.setMeta('central', { access: 'a', refresh: 'r', exp: Date.now() + 1e7, uid: 'u', email: 'e@x.vn' });
  ok(oauthAvailable(), 'đã đăng nhập tài khoản lưu trữ → cách OAuth khả dụng');
  const netErr = Object.assign(new Error('Không kết nối được máy chủ gói cước — kiểm tra mạng'), { code: 'net' });
  await rejects(() => oauthProvision({ deps: { callFn: async () => { throw netErr; }, reachable: async () => true, sleep: async () => {} } }), /chưa bật chức năng tạo kho tự động/, 'hàm chưa deploy');
  ok(!oauthAvailable(), 'đã tắt cách OAuth trong phiên');
  resetOauthProbe(); ok(oauthAvailable());
  await rejects(() => oauthProvision({ deps: { callFn: async () => { throw netErr; }, reachable: async () => false, sleep: async () => {} } }), /kiểm tra mạng/, 'thật sự mất mạng thì giữ nguyên thông báo mạng');
  ok(oauthAvailable(), 'mất mạng thật không tắt cách OAuth'); S.setMeta('central', null);
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
