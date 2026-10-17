/* Đồng bộ nhiều máy qua Supabase (miễn phí). Xem sql.js để biết phía máy chủ.
   Nguyên tắc (rút kinh nghiệm từ app BEPO):
   • Chạy nền, không bao giờ chặn bán hàng: mọi thay đổi vào hàng đợi (lưu bền), có mạng thì đẩy lên; mất mạng thì để dành.
   • Theo từng bản ghi, bản có mốc updatedAt MỚI HƠN thắng; xoá được truyền đi bằng "bia mộ".
   • KHÔNG đồng bộ trực tiếp các số suy ra (tồn kho, tồn theo lô, số dư nợ, điểm, lượt dùng khuyến mãi). Máy nào cũng tự tính lại từ sổ biến động kho / sổ nợ / hoá đơn
     (đều là bản ghi chỉ thêm, không sửa) → hai máy cùng bán một mặt hàng khi mất mạng vẫn ra đúng tồn, không ghi đè nhau.
   • Mã hoá đơn/phiếu/SKU gắn mã máy (A, B…) để không trùng giữa các máy. */
import { S, SYNC_COLLS, SYNC_META } from '../store.js';
import { roundQty } from '../util.js';
import { httpTransport, SyncError, normalizeUrl } from './transport.js';
import { storeSql } from './sql.js';
import { log } from '../engine/auth.js';
import * as Central from '../cloud/central.js';

/** Đã đăng nhập tài khoản lưu trữ: ghi địa chỉ kho lên trung tâm (nhà cung cấp biết đã liên kết, workflow giữ-không-ngủ đánh thức được). Lỗi thì bỏ qua. */
function saveLinkToCentral(url, anon) { try { if (Central.configured() && Central.isSignedIn()) Central.rpc('save_store_link', { p_url: url, p_anon: anon }).catch(() => {}); } catch (e) { /* không ảnh hưởng đồng bộ */ } }

/** Trường suy ra, không đồng bộ — mỗi máy tự tính lại. */
export const DERIVED = { products: ['stock'], batches: ['qty'], customers: ['debt', 'points', 'totalSpent', 'lastBuyAt'], suppliers: ['debt'], promos: ['used'] };
const RECOMPUTE_TRIGGER = new Set(['stockMoves', 'batches', 'ledger', 'sales', 'products', 'customers', 'suppliers', 'promos']);

let makeTransport = cfg => httpTransport({ url: cfg.url, anon: cfg.anon });
export const setTransportFactory = f => { makeTransport = f || (cfg => httpTransport({ url: cfg.url, anon: cfg.anon })); };

/* ---------- Cấu hình & trạng thái ---------- */
export const transport = cfg => makeTransport(cfg);
export const config = () => S.meta.sync || null;
export const isEnabled = () => !!(S.meta.sync && S.meta.sync.enabled);
function saveConfig(patch) { S.setMeta('sync', Object.assign({}, S.meta.sync || {}, patch)); }
const status = { running: false, error: '', phase: '' };
const statusListeners = new Set(), changeListeners = new Set();
export const onStatus = fn => { statusListeners.add(fn); return () => statusListeners.delete(fn); };
export const onDataChanged = fn => { changeListeners.add(fn); return () => changeListeners.delete(fn); };
const emitStatus = () => statusListeners.forEach(fn => { try { fn(getStatus()); } catch (e) { console.error(e); } });
export function getStatus() {
  const c = config() || {};
  return { enabled: !!c.enabled, running: status.running, phase: status.phase, error: status.error || c.error || '', pending: S.syncQ.size, lastSyncAt: c.lastSyncAt || 0, role: c.role || '', tag: c.tag || '', url: c.url || '', name: c.name || '' };
}

/* ---------- Khoá & mã kết nối ---------- */
export function genKey() { const b = crypto.getRandomValues(new Uint8Array(32)); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
/** Khoá chủ cửa hàng nháp (chưa kết nối): giữ nguyên giữa các lần mở app để script SQL không đổi. */
export function draftKey() {
  if (!S.meta.syncDraft || !S.meta.syncDraft.key) S.setMeta('syncDraft', { key: genKey() });
  return S.meta.syncDraft.key;
}
export const sqlScript = () => storeSql(draftKey());

const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export function encodeJoinCode(o) { return 'TH1.' + b64u(JSON.stringify(o)); }
export function parseJoinCode(code) {
  const m = /^TH1\.([A-Za-z0-9_-]+)$/.exec(String(code || '').trim().replace(/\s+/g, ''));
  if (!m) throw new SyncError('Mã kết nối không đúng định dạng (phải bắt đầu bằng TH1.)', 'code');
  let o; try { o = JSON.parse(unb64u(m[1])); } catch (e) { throw new SyncError('Mã kết nối bị lỗi, hãy sao chép lại đầy đủ', 'code'); }
  if (!o || !o.u || !o.a || !o.k || !['owner', 'staff'].includes(o.r)) throw new SyncError('Mã kết nối thiếu thông tin', 'code');
  return o;
}
const tagFromIndex = n => String.fromCharCode(64 + Math.max(1, Math.min(26, Number(n) || 1)));

/* ---------- Kết nối ---------- */
/** Chủ cửa hàng: nối với dự án Supabase đã chạy script SQL, rồi đẩy toàn bộ dữ liệu lên lần đầu. */
export async function connectOwner({ url, anon }) {
  url = normalizeUrl(url); anon = String(anon || '').trim();
  if (!url || !anon) throw new SyncError('Nhập địa chỉ dự án và khoá anon/publishable', 'input');
  const key = draftKey();
  const rpc = makeTransport({ url, anon });
  const p = await rpc('pos_ping', { p_key: key });
  if (!p || !p.ok) throw new SyncError('Kết nối được dự án nhưng khoá chủ cửa hàng chưa có trên máy chủ — hãy dán và chạy ĐÚNG script SQL do app tạo (Supabase → SQL Editor → Run).', 'auth');
  if (p.records > 0) throw new SyncError(`Dự án này đã có sẵn ${p.records} bản ghi dữ liệu. Hãy dùng dự án Supabase trống cho cửa hàng mới, hoặc dùng mã kết nối từ máy chủ hiện có để lấy dữ liệu về máy này.`, 'nonempty');
  saveConfig({ enabled: true, url, anon, key, role: 'owner', name: 'Máy chủ cửa hàng', tag: 'A', lastSeq: 0, lastSyncAt: 0, error: '' });
  S.setSyncOn(true); S.queueAll();
  log('sync', 'Bật đồng bộ Supabase (máy chủ cửa hàng)');
  saveLinkToCentral(url, anon);
  return syncNow();
}

/** Chủ cửa hàng: tạo mã kết nối cho máy mới. role: 'staff' | 'owner'. */
export async function createJoinCode({ name, role = 'staff' }) {
  const c = config(); if (!c || !c.enabled || c.role !== 'owner') throw new SyncError('Chỉ máy chủ cửa hàng mới tạo được mã kết nối', 'perm');
  const rpc = makeTransport(c);
  const r = await rpc('pos_register_device', { p_key: c.key, p_name: name || 'Thiết bị', p_role: role });
  if (!r || !r.ok) throw new SyncError(r && r.error === 'auth' ? 'Khoá của máy này không còn quyền chủ cửa hàng' : 'Không tạo được mã kết nối', 'server');
  log('sync', `Tạo mã kết nối cho máy "${name}" (${role === 'owner' ? 'chủ' : 'nhân viên'})`);
  return encodeJoinCode({ u: c.url, a: c.anon, k: r.key, r: role, t: tagFromIndex(r.index), n: name || '' });
}
export async function listDevices() {
  const c = config(); const r = await makeTransport(c)('pos_list_devices', { p_key: c.key });
  if (!r || !r.ok) throw new SyncError('Chỉ chủ cửa hàng xem được danh sách thiết bị', 'perm');
  return r;
}
export async function revokeDevice(hash, revoked = true) {
  const c = config(); const r = await makeTransport(c)('pos_revoke_device', { p_key: c.key, p_hash: hash, p_revoked: revoked });
  if (!r || !r.ok) throw new SyncError(r && r.error === 'self' ? 'Không thể thu hồi chính máy này' : 'Không thực hiện được', 'server');
  log('sync', (revoked ? 'Thu hồi' : 'Cấp lại') + ' một thiết bị');
}

/** Máy phụ: dùng mã kết nối. XOÁ dữ liệu cục bộ rồi kéo toàn bộ dữ liệu cửa hàng về. */
export async function joinWithCode(code) {
  const o = parseJoinCode(code);
  const url = normalizeUrl(o.u), rpc = makeTransport({ url, anon: o.a });
  const p = await rpc('pos_ping', { p_key: o.k });
  if (!p || !p.ok) throw new SyncError('Mã kết nối không còn hiệu lực (thiết bị đã bị thu hồi hoặc mã sai)', 'auth');
  await S.wipe();
  saveConfig({ enabled: true, url, anon: o.a, key: o.k, role: p.role, name: o.n || '', tag: o.t || 'B', lastSeq: 0, lastSyncAt: 0, error: '' });
  S.setSyncOn(true);
  return syncNow();
}

export async function disconnect() {
  const c = config(); if (!c) return;
  stop(); S.setSyncOn(false); S.syncQ = new Map(); S.qDirty = true;
  saveConfig({ enabled: false, error: '' });
  log('sync', 'Ngắt đồng bộ');
  await S.flush(); emitStatus();
}
/** Đẩy lại toàn bộ dữ liệu (sửa chữa khi nghi máy chủ thiếu dữ liệu). */
export async function resyncAll() { if (!isEnabled()) return; S.queueAll(); return syncNow(); }

/* ---------- Lõi đồng bộ ---------- */
const clone = v => JSON.parse(JSON.stringify(v));
function stripDerived(coll, rec) {
  const d = clone(rec); for (const f of (DERIVED[coll] || [])) delete d[f]; return d;
}
function buildItem(q) {
  if (q.x) return { c: q.c, i: q.i, x: true, u: q.u || Date.now() };
  if (q.c === '_meta') return S.meta[q.i] === undefined ? null : { c: '_meta', i: q.i, d: S.meta[q.i], u: (S.meta._ts && S.meta._ts[q.i]) || Date.now() };
  const rec = S.get(q.c, q.i);
  return rec ? { c: q.c, i: q.i, d: stripDerived(q.c, rec), u: rec.updatedAt || rec.createdAt || Date.now() } : null;
}

/** Áp một bản ghi nhận từ máy chủ. Trả true nếu dữ liệu cục bộ thay đổi. */
function applyRow(row) {
  const { c, i, d, u, x } = row;
  if (c === '_meta') {
    if (!SYNC_META.includes(i) || x || d === undefined || d === null) return false;
    if (((S.meta._ts && S.meta._ts[i]) || 0) >= u) return false;
    S.applyRemoteMeta(i, d, u); return true;
  }
  const m = S.c[c]; if (!m) return false;           // bộ sưu tập lạ (phiên bản app mới hơn): bỏ qua
  const key = c + '/' + i, local = m.get(i), pend = S.syncQ.get(key);
  if (x) {
    if (local && (local.updatedAt || 0) <= u) { S.applyRemote(c, i, null); return true; }
    return false;
  }
  if (local && (local.updatedAt || 0) >= u) return false;                   // bản cục bộ mới hơn hoặc bằng: giữ
  if (pend && pend.x && (pend.u || 0) >= u) return false;                   // máy này đã xoá SAU bản đó: đừng "sống lại"
  const rec = Object.assign({}, d);
  for (const f of (DERIVED[c] || [])) rec[f] = local && local[f] !== undefined ? local[f] : 0;      // giữ số suy ra của máy này; máy chủ không có các trường đó
  rec.id = rec.id || i;
  if (pend && !pend.x) { S.syncQ.delete(key); S.qDirty = true; }            // bản mới nhận thay bản đang chờ đẩy (cũ hơn)
  S.applyRemote(c, i, rec); return true;
}

/** Máy chủ từ chối một thay đổi của máy này (VD máy nhân viên sửa cài đặt/xoá dữ liệu): đưa bản cục bộ về ĐÚNG bản trên máy chủ để hai bên không lệch nhau. */
function forceRestore(rj) {
  const { c, i, row } = rj;
  if (c === '_meta') { if (row && row.d !== null && row.d !== undefined) { S.applyRemoteMeta(i, row.d, row.u); return true; } return false; }
  const m = S.c[c]; if (!m) return false;
  const key = c + '/' + i, local = m.get(i);
  if (S.syncQ.has(key)) { S.syncQ.delete(key); S.qDirty = true; }
  if (!row || row.x || !row.d) { if (local) { S.applyRemote(c, i, null); return true; } return false; }
  const rec = Object.assign({}, row.d);
  for (const f of (DERIVED[c] || [])) rec[f] = local && local[f] !== undefined ? local[f] : 0;
  rec.id = rec.id || i; S.applyRemote(c, i, rec); return true;
}

/** Tính lại mọi trường suy ra từ các sổ chỉ-thêm. Không đổi updatedAt, không vào hàng đợi. Trả số bản ghi đã chỉnh. */
export function recomputeDerived() {
  let changed = 0;
  const psum = new Map(), bsum = new Map();
  for (const m of S.c.stockMoves.values()) {
    psum.set(m.productId, (psum.get(m.productId) || 0) + m.qty);
    const sign = m.qty < 0 ? -1 : 1;
    for (const a of (m.alloc || [])) bsum.set(a.batchId, (bsum.get(a.batchId) || 0) + sign * a.qty);
  }
  for (const p of S.c.products.values()) { const v = roundQty(psum.get(p.id) || 0); if (p.stock !== v) { S.mutD('products', p.id).stock = v; changed++; } }
  for (const b of S.c.batches.values()) { const v = Math.max(0, roundQty(bsum.get(b.id) || 0)); if (b.qty !== v) { S.mutD('batches', b.id).qty = v; changed++; } }
  const debt = { customer: new Map(), supplier: new Map() };
  for (const l of S.c.ledger.values()) { const m = debt[l.party]; if (m) m.set(l.partyId, (m.get(l.partyId) || 0) + l.amount); }
  const spent = new Map(), pts = new Map(), last = new Map(), used = new Map();
  for (const s of S.c.sales.values()) {
    if (s.status !== 'done') continue;
    if (s.customerId) {
      spent.set(s.customerId, (spent.get(s.customerId) || 0) + s.total - (s.returnedTotal || 0));
      pts.set(s.customerId, (pts.get(s.customerId) || 0) + (s.pointsEarned || 0) - (s.pointsUsed || 0));
      if ((last.get(s.customerId) || 0) < s.ts) last.set(s.customerId, s.ts);
    }
    for (const pid of (s.promoIds || [])) used.set(pid, (used.get(pid) || 0) + 1);
  }
  for (const cu of S.c.customers.values()) {
    const d = Math.round(debt.customer.get(cu.id) || 0), t = Math.max(0, Math.round(spent.get(cu.id) || 0)), p = Math.max(0, Math.round(pts.get(cu.id) || 0)), l = last.get(cu.id) || 0;
    if (cu.debt !== d || (cu.totalSpent || 0) !== t || (cu.points || 0) !== p || (cu.lastBuyAt || 0) !== l) { const r = S.mutD('customers', cu.id); r.debt = d; r.totalSpent = t; r.points = p; r.lastBuyAt = l; changed++; }
  }
  for (const su of S.c.suppliers.values()) { const d = Math.round(debt.supplier.get(su.id) || 0); if (su.debt !== d) { S.mutD('suppliers', su.id).debt = d; changed++; } }
  for (const pr of S.c.promos.values()) { const v = used.get(pr.id) || 0; if ((pr.used || 0) !== v) { S.mutD('promos', pr.id).used = v; changed++; } }
  return changed;
}

let running = null;
/** Một lượt đồng bộ: kéo về → tính lại số suy ra → đẩy lên. Không chạy chồng; trả kết quả {pulled, pushed}. */
export function syncNow() {
  if (!isEnabled()) return Promise.resolve({ pulled: 0, pushed: 0, skipped: true });
  if (running) return running;
  running = (async () => {
    const c = config(), rpc = makeTransport(c);
    status.running = true; status.error = ''; status.phase = 'ping'; emitStatus();
    let pulled = 0, pushed = 0, touched = false;
    try {
      const p = await rpc('pos_ping', { p_key: c.key });
      if (!p || !p.ok) throw new SyncError('Thiết bị này không còn quyền truy cập (đã bị thu hồi hoặc khoá không đúng)', 'auth');
      if (p.role !== c.role) saveConfig({ role: p.role });

      status.phase = 'pull'; emitStatus();
      let since = (config() || c).lastSeq || 0, more = true, relevant = false;
      while (more) {
        const r = await rpc('pos_pull', { p_key: c.key, p_since: since, p_limit: 200 });
        if (!r || !r.ok) throw new SyncError('Máy chủ từ chối yêu cầu kéo dữ liệu', 'auth');
        for (const row of r.rows) { if (applyRow(row)) { pulled++; touched = true; if (RECOMPUTE_TRIGGER.has(row.c)) relevant = true; } }
        since = r.max_seq; more = !!r.more && r.rows.length > 0;
        saveConfig({ lastSeq: since });
      }
      if (relevant) recomputeDerived();

      status.phase = 'push'; emitStatus();
      for (;;) {
        const batch = Array.from(S.syncQ.values()).slice(0, 100); if (!batch.length) break;
        const items = [], sent = [];
        for (const q of batch) { const it = buildItem(q); if (it) { items.push(it); } sent.push(q); }
        if (items.length) {
          const r = await rpc('pos_push', { p_key: c.key, p_items: items, p_device: c.tag || null });
          if (!r || !r.ok) throw new SyncError('Máy chủ từ chối yêu cầu đẩy dữ liệu', 'auth');
          pushed += items.length - (r.skipped || 0);
          for (const rj of (r.rejected || [])) { if (forceRestore(rj)) { touched = true; if (RECOMPUTE_TRIGGER.has(rj.c)) recomputeDerived(); } }
        }
        for (const q of sent) if (S.syncQ.get(q.c + '/' + q.i) === q) S.syncQ.delete(q.c + '/' + q.i);      // chỉ xoá nếu chưa bị sửa tiếp trong lúc đẩy
        S.qDirty = true; S._schedule();
      }
      saveConfig({ lastSyncAt: Date.now(), error: '' });
      status.error = '';
    } catch (e) {
      const msg = e instanceof SyncError ? e.message : 'Lỗi đồng bộ: ' + (e && e.message || e);
      status.error = msg; saveConfig({ error: msg });
      if (!(e instanceof SyncError)) console.error(e);
      return { pulled, pushed, error: msg, code: e && e.code };
    } finally {
      status.running = false; status.phase = ''; running = null; emitStatus();
      if (touched) { S._emit(); changeListeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
    }
    return { pulled, pushed };
  })();
  return running;
}

/* ---------- Chạy nền ---------- */
let timers = [], unsub = null, debounceT = null;
export function start() {
  stop();
  if (!isEnabled()) return;
  const kick = () => { if (!isEnabled()) return; syncNow(); };
  setTimeout(kick, 800);
  timers.push(setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') kick(); }, 30000));
  if (typeof document !== 'undefined') { const vis = () => { if (document.visibilityState === 'visible') kick(); }; document.addEventListener('visibilitychange', vis); timers.push({ off: () => document.removeEventListener('visibilitychange', vis) }); }
  if (typeof window !== 'undefined') { window.addEventListener('online', kick); timers.push({ off: () => window.removeEventListener('online', kick) }); }
  unsub = S.subscribe(() => { if (S.syncQ.size && !running) { clearTimeout(debounceT); debounceT = setTimeout(kick, 4000); } });      // có thay đổi cục bộ → đẩy sau 4 giây
}
export function stop() {
  for (const t of timers) { if (t && t.off) t.off(); else clearInterval(t); }
  timers = []; clearTimeout(debounceT); if (unsub) { unsub(); unsub = null; }
}
export { SyncError };
