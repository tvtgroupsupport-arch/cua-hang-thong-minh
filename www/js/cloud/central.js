/* Tài khoản lưu trữ trên Supabase TRUNG TÂM của nhà cung cấp (tham khảo app BEPO): đăng ký/đăng nhập chủ cửa hàng, gói cước, gọi Edge Function.
   Chỉ dùng REST của Supabase (không cần thư viện). Chỉ chứa tài khoản + gói cước + địa chỉ kho — KHÔNG chứa dữ liệu bán hàng. */
import { S } from '../store.js';

let fetchImpl = (...a) => fetch(...a);
export const setFetch = f => { fetchImpl = f || ((...a) => fetch(...a)); };
let cfgOverride = null;
export const setConfig = c => { cfgOverride = c; };
export const cfg = () => cfgOverride || (typeof window !== 'undefined' && window.APP_CONFIG) || {};
export const configured = () => /^https:\/\//.test(cfg().centralUrl || '') && (cfg().centralAnonKey || '').length > 20;
const base = () => String(cfg().centralUrl).replace(/\/+$/, '');

export class CentralError extends Error { constructor(msg, code, status) { super(msg); this.name = 'CentralError'; this.code = code; this.status = status; } }

/** Đổi lỗi của Supabase Auth / PostgREST sang tiếng Việt. */
export function viMsg(j, status) {
  const m = String(j && (j.msg || j.error_description || j.message || j.error) || '');
  if (/invalid login|invalid_credentials/i.test(m)) return 'Sai email hoặc mật khẩu';
  if (/email not confirmed/i.test(m)) return 'Email chưa được xác nhận — mở email, bấm liên kết xác nhận rồi đăng nhập lại';
  if (/already registered|already exists|user_already_exists/i.test(m)) return 'Email này đã có tài khoản — hãy chọn "Đăng nhập"';
  if (/at least \d+ char|weak_password|password should/i.test(m)) return 'Mật khẩu cần tối thiểu 6 ký tự';
  if (/rate limit|too many|over_email_send_rate/i.test(m) || status === 429) return 'Thao tác quá nhanh — đợi một lúc rồi thử lại';
  if (/invalid.*email|email.*invalid/i.test(m)) return 'Email không hợp lệ';
  if (/signup.*disabled/i.test(m)) return 'Máy chủ đang tắt đăng ký tài khoản mới';
  return m || `Máy chủ báo lỗi (${status})`;
}

async function http(method, path, { body, token, headers } = {}) {
  let r;
  try {
    r = await fetchImpl(base() + path, { method, headers: Object.assign({ apikey: cfg().centralAnonKey, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) { throw new CentralError('Không kết nối được máy chủ gói cước — kiểm tra mạng', 'net', 0); }
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) { j = { message: text }; }
  if (!r.ok) throw new CentralError(viMsg(j, r.status), (j && (j.error_code || j.code)) || 'http', r.status);
  return j;
}

/* ---------- Phiên đăng nhập (lưu trên máy này, không đưa vào sao lưu) ---------- */
const session = () => S.meta.central || null;
const saveSession = tok => {
  const exp = Date.now() + (Number(tok.expires_in) || 3600) * 1000;
  S.setMeta('central', { access: tok.access_token, refresh: tok.refresh_token, exp, uid: tok.user && tok.user.id, email: tok.user && tok.user.email });
  return S.meta.central;
};
export const isSignedIn = () => !!(session() && session().refresh);
export const accountEmail = () => (session() && session().email) || '';
export const accountId = () => (session() && session().uid) || '';

export async function signUp({ email, password, shopName }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new CentralError('Email không hợp lệ', 'input');
  if (String(password || '').length < 6) throw new CentralError('Mật khẩu cần tối thiểu 6 ký tự', 'input');
  const j = await http('POST', '/auth/v1/signup', { body: { email, password, data: { shop_name: String(shopName || '').slice(0, 120) } } });
  if (j && j.access_token) return { signedIn: !!saveSession(j) };
  return { signedIn: false, needConfirm: true };       // máy chủ bật "Confirm email": phải xác nhận qua email rồi đăng nhập
}
export async function signIn({ email, password }) {
  const j = await http('POST', '/auth/v1/token?grant_type=password', { body: { email: String(email || '').trim().toLowerCase(), password } });
  saveSession(j); return true;
}
export function signOut() { if (S.meta.central) S.setMeta('central', null); }

/** Access token còn hạn (tự làm mới bằng refresh token). */
export async function accessToken() {
  const s = session(); if (!s || !s.refresh) throw new CentralError('Chưa đăng nhập tài khoản lưu trữ', 'noauth', 401);
  if (s.exp - Date.now() > 60000) return s.access;
  try {
    const j = await http('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh } });
    return saveSession(j).access;
  } catch (e) {
    if (e.status === 400 || e.status === 401) { signOut(); throw new CentralError('Phiên đăng nhập đã hết — hãy đăng nhập lại', 'noauth', 401); }
    throw e;
  }
}

export async function rpc(fn, args = {}) {
  const token = await accessToken();
  return http('POST', '/rest/v1/rpc/' + fn, { body: args, token });
}
/** Gọi Edge Function (vd. provision-start) bằng phiên đăng nhập hiện tại. */
export async function callFn(name, body = {}) {
  const token = await accessToken();
  return http('POST', '/functions/v1/' + name, { body, token });
}
