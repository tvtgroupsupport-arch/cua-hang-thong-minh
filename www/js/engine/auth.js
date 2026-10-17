/* Cài đặt, nhân viên, đăng nhập, phân quyền, nhật ký. */
import { S } from '../store.js';
import { uid, fail, norm } from '../util.js';

/* ---------- Cài đặt ---------- */
export const DEFAULT_SETTINGS = {
  store: { name: 'Tạp hóa', address: '', phone: '', footer: 'Cảm ơn quý khách – hẹn gặp lại!' },
  bank: { bin: '', account: '', name: '' },
  sale: {
    allowNegative: true,      // cho bán khi tồn kho âm/không đủ
    rounding: 0,              // làm tròn tổng bill: 0 | 500 | 1000
    requireShift: false,      // bắt buộc mở ca mới được bán
    requireCustomerForDebt: true,
    debtOverLimit: 'block',   // 'block' | 'warn' khi vượt hạn mức nợ
    blockBelowCost: false,    // chặn bán dưới giá vốn
    costMethod: 'avg',        // 'avg' bình quân gia quyền | 'last' giá nhập gần nhất
    promoStack: 'best',       // 'best' lấy KM lợi nhất | 'stack' cộng dồn
    pointsPer: 0,             // bao nhiêu đồng = 1 điểm (0 = tắt tích điểm)
    pointValue: 1000,         // 1 điểm = bao nhiêu đồng khi đổi
    beep: true,
    weightBarcode: { enabled: true, prefix: '2', pluStart: 1, pluLen: 6, valueStart: 7, valueLen: 5, mode: 'weight' }
  },
  stock: { expiryWarnDays: 30, deadStockDays: 60, reorderCoverDays: 7 },
  print: { paper: 58, autoPrint: false, showQr: false }
};

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') ? deepMerge(base[k], v) : v;
  }
  return out;
}
let _setCache = null, _setVer = -1;
export function settings() {
  if (_setCache && _setVer === (S.ver._meta || 0)) return _setCache;
  _setCache = deepMerge(DEFAULT_SETTINGS, S.getMeta('settings', {}));
  _setVer = S.ver._meta || 0;
  return _setCache;
}
export function saveSettings(patch) {
  need('settings');
  S.tx(() => S.setMeta('settings', deepMerge(S.getMeta('settings', {}), patch)));
  log('settings', 'Đổi cài đặt: ' + Object.keys(patch).join(', '));
  return settings();
}

/* ---------- Phân quyền ---------- */
export const PERMS = {
  sell: 'Bán hàng',
  editPrice: 'Sửa giá khi bán',
  discountMax: 'Giảm giá tối đa (%) — 0 = không được giảm',
  voidSale: 'Huỷ hoá đơn',
  returns: 'Nhận trả hàng',
  viewCost: 'Xem giá vốn / lợi nhuận',
  viewReports: 'Xem báo cáo',
  manageProducts: 'Quản lý hàng hóa',
  manageStock: 'Nhập hàng / kiểm kho / xuất hủy',
  manageCustomers: 'Quản lý khách hàng & nợ',
  manageSuppliers: 'Quản lý nhà cung cấp & nợ',
  managePromos: 'Quản lý khuyến mãi',
  cashbook: 'Sổ quỹ / thu chi / ca',
  manageStaff: 'Quản lý nhân viên',
  settings: 'Cài đặt & sao lưu',
  deleteData: 'Xoá dữ liệu'
};
export const ROLE_PERMS = {
  owner: Object.fromEntries(Object.keys(PERMS).map(k => [k, k === 'discountMax' ? 100 : true])),
  cashier: { sell: true, returns: true, cashbook: true, manageCustomers: true, discountMax: 10 },
  stock: { manageProducts: true, manageStock: true, manageSuppliers: true, viewCost: true },
};
export const ROLE_NAMES = { owner: 'Chủ cửa hàng', cashier: 'Thu ngân', stock: 'Thủ kho', custom: 'Tuỳ chỉnh' };

export function currentUser() { return S.session.staffId ? S.get('staff', S.session.staffId) : null; }
export function can(perm) {
  const u = currentUser();
  if (!u || !u.active) return false;
  if (u.role === 'owner') return true;
  const v = (u.perms || {})[perm];
  return perm === 'discountMax' ? (Number(v) || 0) > 0 : !!v;
}
export function maxDiscountPct() {
  const u = currentUser();
  if (!u) return 0;
  return u.role === 'owner' ? 100 : (Number((u.perms || {}).discountMax) || 0);
}
export function need(perm) { if (!can(perm)) fail('Bạn không có quyền thực hiện thao tác này', 'perm'); }

/** Khoá mềm gói cước: license.js đăng ký hàm trả về lý do chặn (chuỗi) hoặc '' nếu được ghi. Chỉ chặn các thao tác phát sinh nghiệp vụ mới; xem/xuất báo cáo vẫn dùng được. */
let writeGuard = null;
export const setWriteGuard = f => { writeGuard = f || null; };
export function needWrite() { const m = writeGuard && writeGuard(); if (m) fail(m, 'locked'); }

/* ---------- Mật khẩu / PIN ---------- */
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derive(secret, saltB64, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}
export async function hashSecret(secret, iter = 60000) {
  const s = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { s, h: await derive(secret, s, iter), i: iter };
}
async function checkSecret(secret, rec) {
  if (!rec || !rec.h) return false;
  return (await derive(secret, rec.s, rec.i)) === rec.h;
}

/* ---------- Nhân viên ---------- */
export const publicStaff = s => s && ({ id: s.id, name: s.name, username: s.username, role: s.role, perms: s.perms, active: s.active, hasPin: !!s.pin });

export function isSetUp() { return S.list('staff').some(s => s.role === 'owner'); }

/** Lần đầu dùng: tạo cửa hàng + tài khoản chủ. */
export async function setupStore({ store, owner }) {
  if (isSetUp()) fail('Cửa hàng đã được thiết lập');
  if (!owner || !owner.username || !owner.password) fail('Cần tên đăng nhập và mật khẩu của chủ cửa hàng');
  if (owner.password.length < 4) fail('Mật khẩu tối thiểu 4 ký tự');
  const pw = await hashSecret(owner.password);
  S.tx(() => {
    S.setMeta('settings', deepMerge(S.getMeta('settings', {}), { store: Object.assign({}, DEFAULT_SETTINGS.store, store || {}) }));
    const st = S.add('staff', { name: owner.name || 'Chủ cửa hàng', username: norm(owner.username).replace(/\s+/g, ''), role: 'owner', perms: {}, active: true, pw });
    S.session.staffId = st.id;
    defaultCashCats();
  });
  log('setup', 'Thiết lập cửa hàng');
  return currentUser();
}
function defaultCashCats() {
  if (S.count('cashCats')) return;
  [['Tiền điện nước', 'expense', true], ['Tiền mặt bằng', 'expense', true], ['Lương nhân viên', 'expense', true], ['Chi phí khác', 'expense', true],
   ['Rút tiền cá nhân', 'expense', false], ['Nạp thêm vốn', 'income', false], ['Thu khác', 'income', true]]
    .forEach(([name, kind, operating]) => S.add('cashCats', { name, kind, operating }));
}

export async function login(username, password) {
  const u = S.list('staff').find(s => s.username === norm(username).replace(/\s+/g, ''));
  if (!u || !u.active || !(await checkSecret(password, u.pw))) fail('Sai tên đăng nhập hoặc mật khẩu', 'auth');
  S.session.staffId = u.id; log('login', u.name + ' đăng nhập');
  return u;
}
export async function loginPin(staffId, pin) {
  const u = S.get('staff', staffId);
  if (!u || !u.active || !(await checkSecret(pin, u.pin))) fail('Sai mã PIN', 'auth');
  S.session.staffId = u.id; log('login', u.name + ' đăng nhập bằng PIN');
  return u;
}
export function logout() { const u = currentUser(); if (u) log('logout', u.name + ' đăng xuất'); S.session.staffId = null; S._emit(); }

export async function saveStaff(d) {
  need('manageStaff');
  if (!d.name || !String(d.name).trim()) fail('Nhập tên nhân viên');
  const username = norm(d.username || '').replace(/\s+/g, '');
  if (!username) fail('Nhập tên đăng nhập');
  if (S.list('staff').some(s => s.username === username && s.id !== d.id)) fail('Tên đăng nhập đã tồn tại');
  const role = ROLE_PERMS[d.role] ? d.role : 'custom';
  const perms = role === 'owner' ? {} : (d.perms || ROLE_PERMS[role] || {});
  let pw = null, pin = null;
  if (d.password) { if (d.password.length < 4) fail('Mật khẩu tối thiểu 4 ký tự'); pw = await hashSecret(d.password); }
  if (d.pin) { if (!/^\d{4,6}$/.test(d.pin)) fail('PIN gồm 4–6 chữ số'); pin = await hashSecret(d.pin); }
  return S.tx(() => {
    let st;
    if (d.id) {
      st = S.mut('staff', d.id);
      if (st.role === 'owner' && role !== 'owner' && S.list('staff').filter(s => s.role === 'owner' && s.active).length <= 1) fail('Phải còn ít nhất một chủ cửa hàng');
      if (st.role === 'owner' && d.active === false && S.list('staff').filter(s => s.role === 'owner' && s.active).length <= 1) fail('Không thể khoá chủ cửa hàng duy nhất');
      Object.assign(st, { name: d.name.trim(), username, role, perms, active: d.active !== false });
      if (pw) st.pw = pw; if (pin) st.pin = pin;
    } else {
      if (!pw) fail('Nhập mật khẩu cho nhân viên mới');
      st = S.add('staff', { name: d.name.trim(), username, role, perms, active: true, pw, pin });
    }
    log('staff', 'Lưu nhân viên ' + st.name);
    return st;
  });
}
export async function changeOwnPassword(oldPw, newPw) {
  const u = currentUser(); if (!u) fail('Chưa đăng nhập');
  if (!(await checkSecret(oldPw, u.pw))) fail('Mật khẩu cũ không đúng');
  if (!newPw || newPw.length < 4) fail('Mật khẩu mới tối thiểu 4 ký tự');
  const pw = await hashSecret(newPw);
  S.tx(() => { S.mut('staff', u.id).pw = pw; });
}

/* ---------- Nhật ký ---------- */
export function log(action, detail, extra) {
  const u = currentUser();
  const rec = { ts: Date.now(), who: u ? u.name : 'Hệ thống', whoId: u ? u.id : null, action, detail: detail || '' };
  if (extra) Object.assign(rec, extra);
  S.add('logs', rec);
  // chỉ giữ 5000 dòng gần nhất
  if (S.count('logs') > 6000) {
    const old = S.list('logs').sort((a, b) => a.ts - b.ts).slice(0, S.count('logs') - 5000);
    old.forEach(l => S.del('logs', l.id));
  }
  return rec;
}
export function listLogs({ limit = 200, action } = {}) {
  let r = S.list('logs');
  if (action) r = r.filter(l => l.action === action);
  return r.sort((a, b) => b.ts - a.ts).slice(0, limit);
}
