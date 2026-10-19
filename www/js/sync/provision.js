/* Tự tạo dự án Supabase cho cửa hàng và liên kết luôn (tham khảo tính năng "Tự tạo Supabase" của app BEPO).
   BEPO đi qua máy chủ trung tâm + OAuth; app tạp hóa không có máy chủ trung tâm nên làm theo cách trực tiếp: chủ cửa hàng dán một MÃ TRUY CẬP CÁ NHÂN
   của Supabase (Account → Access Tokens), app gọi Management API của Supabase để:
     1) đọc tổ chức → 2) tạo dự án (mật khẩu CSDL sinh ngẫu nhiên, không lưu) → 3) chờ khởi động → 4) lấy khoá anon/publishable
     → 5) chạy script SQL đồng bộ → 6) kiểm tra hàm đồng bộ hoạt động → 7) liên kết máy này làm máy chủ cửa hàng và đẩy dữ liệu lên.
   Rút kinh nghiệm từ BEPO: thử nhiều kiểu khai báo vùng; chờ dự án ACTIVE_HEALTHY; chỉ lấy khoá anon/publishable (KHÔNG lấy service_role/secret); SQL thử lại khi CSDL chưa nhận kết nối;
   nhớ dự án đã tạo để bấm "Thử lại" KHÔNG tạo dự án thứ hai; đổi lỗi kỹ thuật sang câu tiếng Việt dễ hiểu.
   Mã truy cập chỉ nằm trong bộ nhớ trong lúc chạy, không lưu, không ghi nhật ký. */
import { S } from '../store.js';
import { sqlScript, connectOwner, draftKey, transport } from './engine.js';
import { nb } from '../native.js';
import * as Central from '../cloud/central.js';

export const STEPS = ['Kiểm tra tài khoản Supabase', 'Tạo dự án dữ liệu', 'Chờ dự án khởi động (1–2 phút)', 'Lấy khoá kết nối', 'Cài hàm đồng bộ', 'Kiểm tra kết nối', 'Liên kết & đồng bộ lần đầu'];
const API = 'https://api.supabase.com';
const sleepReal = ms => new Promise(r => setTimeout(r, ms));
const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const PASS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomPassword = (n = 28) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => PASS[b % PASS.length]).join('');

export class ProvisionError extends Error { constructor(msg, code, extra) { super(msg); this.name = 'ProvisionError'; this.code = code; Object.assign(this, extra || {}); } }

/** Gọi Supabase Management API. Trong app Android đi qua HTTP native (không bị chặn CORS); trên trình duyệt dùng fetch (có thể bị chặn). Không bao giờ ném lỗi mạng. */
export async function mgDefault(token, method, path, body) {
  const url = API + path, headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    if (nb() && nb().http) { const r = await nb().http({ url, method, headers, body }); return { ok: r.status >= 200 && r.status < 300, status: r.status, data: r.data }; }
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let data = text; try { data = JSON.parse(text); } catch (e) { /* giữ chuỗi */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) { return { ok: false, status: 0, data: { message: String(e && e.message || e) }, network: true }; }
}

/** Đổi lỗi kỹ thuật của Supabase sang câu tiếng Việt. */
export function viError(res, what) {
  const raw = typeof res.data === 'string' ? res.data : ((res.data && res.data.message) || JSON.stringify(res.data || ''));
  if (/limit|maximum|quota|exceed/i.test(raw) && /project/i.test(raw)) return 'Tài khoản Supabase của bạn đã đủ số dự án miễn phí. Hãy tạm dừng hoặc xoá một dự án cũ trên supabase.com (hoặc nâng cấp gói) rồi bấm "Thử lại".';
  if (res.status === 401 || res.status === 403) return `Supabase từ chối mã truy cập (${what}). Kiểm tra bạn đã sao chép ĐỦ mã (bắt đầu bằng sbp_), mã chưa hết hạn/bị thu hồi.`;
  if (res.status === 429) return 'Supabase đang giới hạn tốc độ yêu cầu — đợi một phút rồi bấm "Thử lại".';
  if (res.status === 0) return `Không gọi được Supabase (${what}). ${res.network && !(nb() && nb().http) ? 'Trình duyệt có thể chặn kết nối này — hãy dùng app Android, hoặc làm theo cách thủ công bên dưới. ' : ''}Kiểm tra kết nối mạng.`;
  return `${what} thất bại (${res.status}): ${String(raw).slice(0, 300)}`;
}

const draftProv = () => (S.meta.syncDraft && S.meta.syncDraft.prov) || {};
const saveProv = patch => S.setMeta('syncDraft', Object.assign({}, S.meta.syncDraft, { prov: Object.assign({}, draftProv(), patch) }));
export const clearProv = () => { const d = Object.assign({}, S.meta.syncDraft); delete d.prov; S.setMeta('syncDraft', d); };
export const hasPendingProvision = () => !!draftProv().ref;

/** Tạo dự án + cài script + kiểm tra. Trả {url, anon, ref} hoặc {needOrg:[{slug,name}]} nếu tài khoản có nhiều tổ chức mà chưa chọn.
    deps (cho kiểm thử): mg, sleep, makeRpc, region, waitMs, sqlRetries. */
export async function provisionProject({ token, orgSlug, onProgress = () => {}, deps = {} }) {
  const mg = deps.mg || mgDefault, sleep = deps.sleep || sleepReal, region = deps.region || 'ap-southeast-1';
  const makeRpc = deps.makeRpc || transport;
  const total = STEPS.length, step = i => onProgress(i, total, STEPS[i - 1]);
  token = String(token || '').trim();
  if (!token) throw new ProvisionError('Dán mã truy cập Supabase', 'input');
  if (!/^sbp_[A-Za-z0-9]{20,}$/.test(token)) throw new ProvisionError('Mã truy cập không đúng dạng — mã của Supabase bắt đầu bằng sbp_ (tạo ở Account → Access Tokens).', 'input');
  let prov = draftProv();

  /* 1) Tổ chức */
  step(1);
  if (!prov.ref) {
    const orgs = await mg(token, 'GET', '/v1/organizations');
    if (!orgs.ok) throw new ProvisionError(viError(orgs, 'Đọc tổ chức Supabase'), 'orgs');
    const list = (Array.isArray(orgs.data) ? orgs.data : []).map(o => ({ slug: o.slug || o.id, name: o.name || o.slug || o.id }));
    if (!list.length) throw new ProvisionError('Tài khoản Supabase của bạn chưa có tổ chức nào. Hãy tạo một tổ chức trên supabase.com rồi bấm "Thử lại".', 'noorg');
    if (!orgSlug) { if (list.length === 1) orgSlug = list[0].slug; else return { needOrg: list }; }
    if (!list.some(o => o.slug === orgSlug)) throw new ProvisionError('Tổ chức đã chọn không thuộc tài khoản này', 'noorg');

    /* 2) Tạo dự án — chỉ khi chưa có dự án dở dang (tránh tạo trùng khi bấm "Thử lại") */
    step(2);
    const base = { name: `taphoa-${hex(3)}`, organization_slug: orgSlug, db_pass: randomPassword() };
    const attempts = [Object.assign({}, base, { region_selection: { type: 'specific', code: region } }), Object.assign({}, base, { region }), base];
    let res = null;
    for (const b of attempts) { res = await mg(token, 'POST', '/v1/projects', b); if (res.ok || res.status !== 400) break; }
    if (!res.ok) throw new ProvisionError(viError(res, 'Tạo dự án Supabase'), 'create');
    const ref = res.data && (res.data.ref || res.data.id);
    if (!ref) throw new ProvisionError('Supabase không trả về mã dự án vừa tạo', 'create');
    saveProv({ ref, org: orgSlug, name: base.name }); prov = draftProv();
  }
  const ref = prov.ref;

  /* 3) Chờ ACTIVE_HEALTHY */
  step(3);
  const deadline = Date.now() + (deps.waitMs || 6 * 60 * 1000);
  for (;;) {
    const p = await mg(token, 'GET', `/v1/projects/${ref}`);
    if (p.status === 404) { clearProv(); throw new ProvisionError('Dự án đã tạo trước đó không còn tồn tại (có thể đã bị xoá). Bấm "Thử lại" để tạo dự án mới.', 'gone'); }
    if (p.status === 401 || p.status === 403) throw new ProvisionError(viError(p, 'Đọc trạng thái dự án'), 'auth');
    const st = p.ok ? String(p.data && p.data.status || '') : '';
    if (st === 'ACTIVE_HEALTHY') break;
    if (/FAILED|REMOVED|GOING_DOWN/.test(st)) throw new ProvisionError(`Dự án khởi động không thành công (${st}). Hãy xoá dự án đó trên supabase.com rồi bấm "Thử lại".`, 'failed');
    if (Date.now() > deadline) throw new ProvisionError('Dự án khởi động quá lâu. Bấm "Thử lại" để tiếp tục chờ (sẽ không tạo dự án mới).', 'timeout');
    await sleep(5000);
  }

  /* 4) Khoá anon / publishable — KHÔNG lấy service_role / secret */
  step(4);
  let anon = prov.anon;
  for (let i = 0; !anon; i++) {
    const k = await mg(token, 'GET', `/v1/projects/${ref}/api-keys?reveal=true`);
    if (k.status === 401 || k.status === 403) throw new ProvisionError(viError(k, 'Đọc khoá API'), 'auth');
    const keys = k.ok && Array.isArray(k.data) ? k.data : [];
    const a = keys.find(x => x && x.name === 'anon' && x.api_key) || keys.find(x => x && x.type === 'publishable' && x.api_key);
    if (a) { anon = a.api_key; saveProv({ anon }); break; }
    if (i >= 12) throw new ProvisionError('Khoá API chưa sẵn sàng. Bấm "Thử lại" sau ít phút.', 'keys');
    await sleep(5000);
  }
  const url = `https://${ref}.supabase.co`;

  /* 5) Script SQL (chạy lại nhiều lần an toàn) — CSDL vừa khởi động có thể chưa nhận kết nối nên thử lại */
  step(5);
  if (!prov.sqlDone) {
    const sql = sqlScript(); let q = null;
    for (let i = 0; i < (deps.sqlRetries || 10); i++) {
      q = await mg(token, 'POST', `/v1/projects/${ref}/database/query`, { query: sql });
      if (q.ok) break;
      if (q.status === 401 || q.status === 403) throw new ProvisionError(viError(q, 'Cài hàm đồng bộ'), 'auth');
      if (!(q.status === 0 || q.status >= 500 || q.status === 429)) throw new ProvisionError(viError(q, 'Cài hàm đồng bộ'), 'sql');
      await sleep(6000);
    }
    if (!q || !q.ok) throw new ProvisionError('CSDL của dự án chưa sẵn sàng nhận script. Bấm "Thử lại" sau 1–2 phút.', 'sql');
    saveProv({ sqlDone: true });
  }

  /* 6) Hàm đồng bộ phải gọi được qua REST bằng khoá anon (API cần vài giây nạp lại lược đồ) */
  step(6);
  const rpc = makeRpc({ url, anon }); let ok = false, lastErr = '';
  for (let i = 0; i < 15 && !ok; i++) {
    try { const r = await rpc('pos_ping', { p_key: draftKey() }); ok = !!(r && r.ok); lastErr = ok ? '' : 'Khoá chủ cửa hàng chưa có trên máy chủ'; }
    catch (e) { lastErr = e.message; }
    if (!ok) await sleep(4000);
  }
  if (!ok) throw new ProvisionError('Đã cài xong nhưng chưa gọi được hàm đồng bộ: ' + lastErr + '. Bấm "Thử lại" sau ít phút.', 'ping');
  return { url, anon, ref };
}

/** Toàn bộ: tạo dự án rồi liên kết máy này làm máy chủ cửa hàng + đẩy dữ liệu lên. */
export async function autoConnect({ token, orgSlug, onProgress = () => {}, deps = {} }) {
  const r = await provisionProject({ token, orgSlug, onProgress, deps });
  if (r.needOrg) return r;
  onProgress(7, STEPS.length, STEPS[6]);
  const res = await connectOwner({ url: r.url, anon: r.anon });
  if (res && res.error) throw new ProvisionError('Đã tạo dự án nhưng liên kết thất bại: ' + res.error + ' Bấm "Thử lại" để liên kết lại (không tạo dự án mới).', 'connect');
  clearProv();
  return Object.assign({ sync: res }, r);
}

/* =====================================================================================================
   CÁCH 2 — tự tạo qua OAuth + Edge Function trên Supabase TRUNG TÂM (đúng phương pháp của app BEPO).
   Chủ cửa hàng chỉ cần bấm "Authorize" MỘT lần trên trang Supabase; token uỷ quyền chỉ nằm trên máy chủ trung tâm và bị xoá khi xong (app không bao giờ cầm token).
   Luồng: provision-start (gửi kèm script SQL) → mở authorize_url → vòng lặp gọi provision-step tới khi 'done' → connectOwner.
   ===================================================================================================== */
/** Máy chủ gói cước chưa deploy hàm provision-* (hoặc chưa đặt OAuth App): phát hiện lúc chạy thì tắt cách này trong phiên hiện tại để người dùng không bấm lại vô ích. */
let oauthOff = false;
export const resetOauthProbe = () => { oauthOff = false; };
export const oauthAvailable = () => Central.configured() && Central.isSignedIn() && !oauthOff;
/** Máy chủ trung tâm có trả lời được không (đường /auth/v1/settings luôn có CORS)? Dùng để phân biệt "mất mạng" với "hàm chưa được deploy" (hàm không tồn tại trả 404 không kèm CORS → trình duyệt báo "Failed to fetch"). */
async function centralReachable(deps) {
  if (deps && deps.reachable) return deps.reachable();
  try { const c = Central.cfg(); const r = await fetch(c.centralUrl + '/auth/v1/settings', { headers: { apikey: c.centralAnonKey } }); return r.ok || r.status < 500; } catch (e) { return false; }
}

export async function oauthProvision({ onProgress = () => {}, openUrl, deps = {} } = {}) {
  const call = deps.callFn || Central.callFn, sleep = deps.sleep || sleepReal, wait = deps.waitMs == null ? 3000 : deps.waitMs, work = deps.workMs == null ? 5000 : deps.workMs;
  const maxMs = deps.maxMs || 15 * 60 * 1000;
  if (!deps.callFn && !Central.isSignedIn()) throw new ProvisionError('Đăng nhập tài khoản lưu trữ (Thêm → Gói cước & tài khoản) trước', 'noauth');
  onProgress(1, 8, 'Chuẩn bị');
  let s;
  try { s = await call('provision-start', { sql: sqlScript() }); }
  catch (e) {
    if (e && e.code === 'net' && await centralReachable(deps)) {
      oauthOff = true;
      throw new ProvisionError('Máy chủ gói cước chưa bật chức năng tạo kho tự động (chưa triển khai hàm provision-start / chưa tạo OAuth App — xem HUONG-DAN-TU-DONG-SUPABASE.md mục C). Hãy dùng cách "mã truy cập cá nhân" hoặc làm thủ công 3 bước ở màn Đồng bộ.', 'nofn');
    }
    throw e;
  }
  if (s.authorize_url) {
    onProgress(1, 8, 'Chờ bạn bấm "Authorize" trên trang Supabase');
    if (openUrl) await openUrl(s.authorize_url);
  }
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const r = await call('provision-step', {});
    if (r.state === 'error') throw new ProvisionError(r.message || 'Có lỗi xảy ra', 'oauth');
    if (r.state === 'done') {
      onProgress(8, 8, 'Liên kết & đồng bộ lần đầu');
      for (let attempt = 0; ; attempt++) {          // tên miền của dự án vừa tạo có thể chưa kịp lan ra mạng
        try { const res = await connectOwner({ url: r.url, anon: r.anon_key }); return Object.assign({ url: r.url, anon: r.anon_key, sync: res }); }
        catch (err) {
          const net = /Không kết nối được|Failed to fetch|NetworkError|Load failed/i.test(String(err && err.message || err));
          if (!net || attempt >= 8) throw err;
          onProgress(8, 8, 'Kho dữ liệu vừa tạo đang được công bố trên mạng, thử nối lại');
          await sleep(work);
        }
      }
    }
    onProgress(r.step || 1, r.total || 8, r.message || '');
    await sleep(r.state === 'awaiting_auth' ? wait : work);
  }
  throw new ProvisionError('Quá thời gian chờ. Bấm "Tiếp tục" để kiểm tra lại (không tạo dự án mới).', 'timeout');
}
