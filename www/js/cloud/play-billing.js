/* ============================================================
   GÓI CƯỚC QUA GOOGLE PLAY — chỉ dùng ở bản app "Google Play" (APP_CONFIG.billingMode === 'play'), tham khảo app BEPO.
   App KHÔNG tự quyết định "đã mua thành công" — chỉ Edge Function verify-purchase (chạy trên máy chủ, tự hỏi lại Google) mới có quyền nói vậy.
   App chỉ đưa purchaseToken lên, chờ kết quả, rồi hỏi lại hạn gói (License.refresh).
   Bản Google Play là app RIÊNG (package name khác bản APK chuyển khoản): chính sách Google Play không cho trộn hai cách thu phí trong một app.
   ============================================================ */
import * as Central from './central.js';
import { nb } from '../native.js';

export const PRODUCT_IDS = ['goi_1_thang', 'goi_6_thang', 'goi_12_thang'];            // phải khớp đúng mã đã tạo trên Play Console (và bảng play_products)
export const PRODUCT_MONTHS = { goi_1_thang: 1, goi_6_thang: 6, goi_12_thang: 12 };
// ID base plan của từng gói trên Play Console (chỉ chữ thường, số, gạch ngang) — plugin bắt buộc truyền khi mua gói đăng ký.
export const BASE_PLANS = { goi_1_thang: 'goi-1-thang', goi_6_thang: 'goi-6-thang', goi_12_thang: 'goi-12-thang' };
export const labelOf = id => (PRODUCT_MONTHS[id] ? PRODUCT_MONTHS[id] + ' tháng' : id);

export const enabled = () => Central.cfg().billingMode === 'play';

/* ---------- Xử lý danh sách gói Google trả về (thuần, dễ kiểm thử) ---------- */
/** Mã sản phẩm thật của một dòng plugin trả về. Android gói đăng ký: plugin trả MỖI base plan/ưu đãi một dòng, trong đó `identifier` là mã base plan (goi-1-thang)
    còn `planIdentifier` mới là mã sản phẩm (goi_1_thang) — dùng nhầm sẽ không tra ra base plan. iOS/bản cũ không có planIdentifier thì dùng identifier. */
export const productIdOf = p => (p && (p.planIdentifier || p.identifier)) || '';

/** Chu kỳ ISO 8601 (P7D, P2W, P1M, P1Y, P1M2W…) → tiếng Việt: "7 ngày", "14 ngày", "1 tháng", "1 năm". Không đọc được → ''. */
export function periodVi(iso) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(String(iso || '').trim());
  if (!m) return '';
  const y = +m[1] || 0, mo = +m[2] || 0, days = (+m[3] || 0) * 7 + (+m[4] || 0);
  if (!y && !mo && !days) return '';
  const parts = [];
  if (y) parts.push(y + ' năm');
  if (mo) parts.push(mo + ' tháng');
  if (days) parts.push(days + ' ngày');
  return parts.join(' ');
}

/** Ưu đãi dùng thử miễn phí của một dòng ưu đãi (offerId != null) hoặc null. CHỈ khi có `pricingPhases` (bằng chứng plugin đã được vá bởi scripts/patch-plugins.mjs)
    và giai đoạn ĐẦU giá 0 mới là dùng thử. Plugin chưa vá thì KHÔNG đoán: lúc mua nó cũng không chọn đúng ưu đãi dùng thử, nên hiện "dùng thử" là sai. */
export function trialOf(row, baseRow) {
  if (!row || row.offerId == null) return null;
  const ph = Array.isArray(row.pricingPhases) ? row.pricingPhases : null;
  if (ph && ph.length) {
    if (Number(ph[0].price) !== 0) return null;
    const next = ph[1] || null;
    return { period: String(ph[0].billingPeriod || ''), thenPrice: String((next && next.priceString) || (baseRow && baseRow.priceString) || '') };
  }
  return null;
}
export const trialLabel = tr => { const d = periodVi(tr && tr.period); return d ? 'Dùng thử miễn phí ' + d : 'Dùng thử miễn phí'; };

/** Mỗi gói chỉ giữ MỘT dòng = dòng giá gốc, đúng thứ tự 1 → 6 → 12 tháng; ưu đãi dùng thử cùng mã gói được gắn vào dòng giá gốc dưới thuộc tính `trial`. */
export function normalizeProducts(list) {
  const byId = new Map(), trials = new Map();
  const rows = (list || []).filter(p => PRODUCT_IDS.includes(productIdOf(p)));
  for (const p of rows) {
    const id = productIdOf(p), cur = byId.get(id);
    if (!cur || (p.offerId == null && cur.offerId != null)) byId.set(id, p);
  }
  for (const p of rows) {
    const id = productIdOf(p); if (trials.has(id)) continue;
    const tr = trialOf(p, byId.get(id)); if (tr) trials.set(id, tr);
  }
  return PRODUCT_IDS.filter(id => byId.has(id)).map(id => trials.has(id) ? Object.assign({}, byId.get(id), { trial: trials.get(id) }) : byId.get(id));
}

/* ---------- Trạng thái + luồng mua ---------- */
const PRODUCTS_TTL = 5 * 60000, SYNC_MIN_GAP = 10 * 60000, RESUME_GRACE = 8000;
let deps = {};                                       // kiểm thử: { billing, sleep, deviceId }
export const setDeps = d => { deps = d || {}; reset(); };
const bill = () => deps.billing || (nb() && nb().billing) || null;
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const f of [...listeners]) { try { f(); } catch (e) { /* người nghe lỗi không được làm hỏng luồng mua */ } } };

const st = { products: null, loading: false, error: '', tries: 0, loadedAt: 0, busy: false, syncAt: 0, syncing: null, quiet: false, quietTok: 0, gen: 0, pending: null };
function reset() { Object.assign(st, { products: null, loading: false, error: '', tries: 0, loadedAt: 0, busy: false, syncAt: 0, syncing: null, quiet: false, quietTok: 0, gen: 0, pending: null }); }
export const state = () => ({ products: st.products, loading: st.loading, error: st.error, busy: st.busy });

/** Tải danh sách gói từ Google Play. Lỗi/rỗng KHÔNG bị nhớ mãi: tự thử lại tối đa 3 lần (cách nhau 4 giây — dịch vụ thanh toán đôi khi chưa kịp kết nối lúc mở màn). */
export async function loadProducts(force) {
  if (st.loading) return;
  if (force) { st.products = null; st.tries = 0; }
  if (st.products) return;
  st.loading = true; st.error = ''; st.gen++; emit();
  try {
    const b = bill();
    if (!b || !(await b.isSupported())) { st.products = []; st.error = 'Google Play Billing không khả dụng — hãy cài app từ Google Play (kênh thử nghiệm), không cài tệp APK trực tiếp.'; return; }
    const raw = await b.getProducts(PRODUCT_IDS);
    st.products = normalizeProducts(raw); st.loadedAt = Date.now();
    if (!st.products.length) st.error = `Google Play trả về ${(raw || []).length} gói nhưng không khớp mã gói cước của app (kiểm tra gói đã được kích hoạt trên Play Console và tài khoản Google là người thử nghiệm).`;
  } catch (e) { st.products = []; st.error = String((e && e.message) || e || ''); }
  finally {
    st.loading = false;
    if (st.products && !st.products.length && st.tries < 3) { st.tries++; setTimeout(() => { if (st.products && !st.products.length) { st.products = null; loadProducts(); } }, deps.retryMs == null ? 4000 : deps.retryMs); }
    emit();
  }
}

async function fetchProducts() {
  try { const b = bill(); if (!b || !(await b.isSupported())) return null; return normalizeProducts(await b.getProducts(PRODUCT_IDS)); } catch (e) { return null; }
}
/** Làm mới ngầm danh sách gói (không xoá danh sách đang hiện): ưu đãi dùng thử có thể đã hết điều kiện. force = bỏ qua hạn 5 phút (sau khi mua/khôi phục). */
export async function refreshQuiet(force) {
  if (st.loading) return;
  if (st.quiet && !force) return;
  if (!force && Date.now() - st.loadedAt < PRODUCTS_TTL) return;
  const tok = ++st.quietTok; st.quiet = true; st.loadedAt = Date.now();
  const gen = st.gen;
  try {
    const fresh = await fetchProducts();
    if (fresh && fresh.length && gen === st.gen && tok === st.quietTok && !st.loading) {
      const changed = JSON.stringify(fresh) !== JSON.stringify(st.products);
      st.products = fresh; if (changed) emit();
    }
  } finally { if (tok === st.quietTok) st.quiet = false; }
}

/** Gọi Edge Function verify-purchase bằng chính phiên đăng nhập tài khoản lưu trữ. */
export async function verify(purchaseToken, productId) {
  let deviceId = '';
  try { deviceId = deps.deviceId != null ? deps.deviceId : ((nb() && nb().device && await nb().device.androidId()) || ''); } catch (e) { deviceId = ''; }
  return Central.callFn('verify-purchase', { purchaseToken, productId, deviceId });
}

/** Các lượt mua gói còn hiệu lực trên tài khoản Google của máy này — KHÔNG lọc theo tài khoản app, vì giao dịch tạo thẳng trên Google Play
    (nút "Đăng ký lại"…) không mang mã tài khoản của app nhưng vẫn là tiền thật khách đã trả. */
export async function ownedPurchases() {
  let owned = [];
  try { const b = bill(); owned = b ? await b.getPurchases() : []; } catch (e) { owned = []; }
  return (owned || []).filter(p => p && p.purchaseToken && PRODUCT_IDS.includes(p.productIdentifier) && String(p.purchaseState) === '1');
}

/** Gửi mọi lượt mua đang có trên máy lên máy chủ xác minh (máy chủ hỏi lại Google rồi mới ghi nhận). Trả về số lượt được ghi nhận. Chặn gọi dồn 10 phút trừ khi force. */
export async function syncPurchases(force) {
  if (!enabled() || !Central.isSignedIn()) return 0;
  if (st.syncing) { if (!force) return 0; try { await st.syncing; } catch (e) { /* lượt trước lỗi: chạy lượt mới */ } }   // force: chờ lượt đang chạy xong rồi gửi lại danh sách mới nhất
  if (!force && Date.now() - st.syncAt < SYNC_MIN_GAP) return 0;
  let done; st.syncing = new Promise(r => { done = r; }); let ok = 0;
  try {
    const b = bill(); if (!b || !(await b.isSupported())) return 0;
    for (const p of await ownedPurchases()) {
      try { await verify(p.purchaseToken, p.productIdentifier); ok++; }
      catch (e) { /* giao dịch của tài khoản app khác / đang chờ thanh toán / mạng lỗi: bỏ qua, lần sau thử lại */ }
    }
    st.syncAt = Date.now();
  } catch (e) { /* không đồng bộ được — để lần sau */ }
  finally { st.syncing = null; done(); }
  return ok;
}

/** Hộp thoại mua của Google: nếu người dùng đóng mà KHÔNG trả lời (bấm ra ngoài / nút Back) thì lời hứa của plugin có thể không bao giờ kết thúc → nút gói bị khoá mãi.
    Khi app được mở lại (onResume) mà vẫn chưa có kết quả sau RESUME_GRACE thì coi là đã huỷ. */
export function onResume(graceMs) {
  const p = st.pending; if (!p || p.armed) return;
  p.armed = true;
  setTimeout(() => { if (st.pending === p) p.reject(new Error('user cancelled')); }, graceMs == null ? RESUME_GRACE : graceMs);
}
/** Lối thoát thủ công: hộp thoại mua đã đóng nhưng nút vẫn bị khoá (plugin không trả lời) → coi như đã huỷ để mua lại được. */
export function cancelPending() { const p = st.pending; if (p) p.reject(new Error('user cancelled')); }
function purchaseWithEscape(productId, ownerId, basePlan) {
  return new Promise((resolve, reject) => {
    st.pending = { reject, armed: false };
    bill().purchase(productId, ownerId, basePlan).then(resolve, reject);
  });
}

/** Mua một gói. Trả về { status } — UI quyết định hiển thị:
      'ok' (đã kích hoạt) · 'pending' (chờ Google xác nhận thanh toán) · 'cancelled' · 'already' (đã có đúng gói này, đã cập nhật lại) ·
      'other' (đang có gói KHÁC — cần hỏi lại, kèm have[]) · 'trial-gone' (ưu đãi dùng thử không còn) · 'trial-used' (máy đã dùng thử, kèm message) · 'error' (kèm message). */
export async function purchase(productId, { force = false } = {}) {
  if (st.busy) return { status: 'busy' };
  st.busy = true; emit();
  try {
    if (!bill()) throw new Error('Google Play Billing không khả dụng trên thiết bị này');
    const ownerId = Central.accountId();
    if (!ownerId || !Central.isSignedIn()) throw new Error('Chưa đăng nhập tài khoản lưu trữ');

    // Chặn mua trùng: Google Play cho phép giữ NHIỀU gói đăng ký cùng lúc và tính tiền cả hai; plugin không hỗ trợ "đổi gói".
    if (!force) {
      const owned = await ownedPurchases();
      if (owned.length) {
        if (owned.some(p => p.productIdentifier === productId)) { await syncPurchases(true); return { status: 'already' }; }
        return { status: 'other', have: [...new Set(owned.map(p => labelOf(p.productIdentifier)))] };
      }
    }
    // Trước khi gọi Google: hỏi lại danh sách gói. Màn đang hiện "Dùng thử miễn phí" mà Google không còn ưu đãi đó cho tài khoản này → DỪNG (khỏi bị tính giá gốc).
    {
      const shown = (st.products || []).find(p => productIdOf(p) === productId);
      const fresh = await fetchProducts();
      if (fresh && fresh.length) {
        const now = fresh.find(p => productIdOf(p) === productId);
        st.products = fresh; st.loadedAt = Date.now();
        if (shown && shown.trial && !(now && now.trial)) return { status: 'trial-gone' };
      }
    }
    // Ưu tiên base plan do chính Google trả về cho gói này; không có thì dùng bảng quy ước BASE_PLANS.
    const prod = (st.products || []).find(p => productIdOf(p) === productId);
    const basePlan = (prod && prod.planIdentifier && prod.identifier) || BASE_PLANS[productId];
    if (!basePlan) throw new Error('Không xác định được gói cơ bản của gói này — kiểm tra lại cấu hình gói trên Play Console');
    const tx = await purchaseWithEscape(productId, ownerId, basePlan);
    const token = tx && (tx.purchaseToken || tx.transactionId || tx.id);
    if (!token) throw new Error('Không nhận được mã giao dịch từ Google — thử lại');
    const res = await verify(token, productId);
    refreshQuiet(true);
    return { status: res && res.pending ? 'pending' : 'ok', expiresAt: res && res.expires_at };
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    if (e && e.code === 'TRIAL_USED') return { status: 'trial-used', message: msg };
    if (/user.*cancel|cancelled|canceled/i.test(msg)) return { status: 'cancelled' };
    return { status: 'error', message: msg || 'Mua gói không thành công, thử lại' };
  } finally {
    st.pending = null; st.busy = false; emit();
    syncPurchases(true).catch(() => {});     // lỡ giao dịch đã xong mà plugin không báo: gửi lên máy chủ xác minh
  }
}

export async function restore() {
  if (st.busy) return { status: 'busy' };
  st.busy = true; emit();
  try {
    await bill().restore();
    await syncPurchases(true); refreshQuiet(true);
    return { status: 'ok' };
  } catch (e) { return { status: 'error', message: 'Khôi phục giao dịch không thành công' }; }
  finally { st.busy = false; emit(); }
}
export async function manage() { const b = bill(); if (b) await b.manage(); }
