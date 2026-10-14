/* Khách hàng, nhà cung cấp và sổ công nợ (phải thu / phải trả). */
import { S } from '../store.js';
import { fail, norm, rnd } from '../util.js';
import { need, log, settings } from './auth.js';

export const CUSTOMER_GROUPS = { retail: 'Khách lẻ', wholesale: 'Khách sỉ', vip: 'Thân thiết' };

function dupPhone(coll, phone, id) {
  return phone && S.list(coll).some(x => x.id !== id && x.phone === phone && x.active !== false);
}

export function saveCustomer(d) {
  need('manageCustomers');
  const name = String(d.name || '').trim(); if (!name) fail('Nhập tên khách hàng');
  const phone = String(d.phone || '').replace(/[\s.\-]/g, '');
  if (phone && !/^\+?\d{8,12}$/.test(phone)) fail('Số điện thoại không hợp lệ');
  if (dupPhone('customers', phone, d.id)) fail('Số điện thoại này đã có khách hàng khác');
  const f = { name, nameNorm: norm(name), phone, address: String(d.address || '').trim(), note: String(d.note || '').trim(),
    group: CUSTOMER_GROUPS[d.group] ? d.group : 'retail', debtLimit: Math.max(0, rnd(Number(d.debtLimit) || 0)), active: d.active !== false };
  return S.tx(() => {
    if (d.id) return Object.assign(S.mut('customers', d.id), f);
    return S.add('customers', Object.assign(f, { debt: 0, points: 0, totalSpent: 0 }));
  });
}
export function deleteCustomer(id) {
  need('manageCustomers');
  const c = S.get('customers', id); if (!c) return;
  if (c.debt) fail('Khách còn nợ, hãy thu hết nợ trước');
  const used = S.list('sales').some(s => s.customerId === id);
  S.tx(() => { if (used) S.mut('customers', id).active = false; else S.del('customers', id); log('customer', `Xoá khách "${c.name}"`); });
}
export function searchCustomers(q, { limit = 30, onlyDebt = false } = {}) {
  const t = norm(q).split(/\s+/).filter(Boolean);
  return S.list('customers').filter(c => c.active !== false && (!onlyDebt || c.debt > 0) &&
    t.every(x => c.nameNorm.includes(x) || (c.phone || '').includes(x))).sort((a, b) => a.name.localeCompare(b.name, 'vi')).slice(0, limit);
}

export function saveSupplier(d) {
  need('manageSuppliers');
  const name = String(d.name || '').trim(); if (!name) fail('Nhập tên nhà cung cấp');
  if (S.list('suppliers').some(s => s.id !== d.id && norm(s.name) === norm(name))) fail('Nhà cung cấp đã tồn tại');
  const f = { name, nameNorm: norm(name), contact: String(d.contact || '').trim(), phone: String(d.phone || '').trim(), address: String(d.address || '').trim(),
    note: String(d.note || '').trim(), payTermDays: Math.max(0, Number(d.payTermDays) || 0), active: d.active !== false };
  return S.tx(() => d.id ? Object.assign(S.mut('suppliers', d.id), f) : S.add('suppliers', Object.assign(f, { debt: 0 })));
}
export function deleteSupplier(id) {
  need('manageSuppliers');
  const s = S.get('suppliers', id); if (!s) return;
  if (s.debt) fail('Còn công nợ với nhà cung cấp này');
  const used = S.list('purchases').some(p => p.supplierId === id);
  S.tx(() => { if (used) S.mut('suppliers', id).active = false; else S.del('suppliers', id); });
}

/* ---------- Sổ công nợ ----------
   amount > 0: nợ tăng (khách mua nợ / ta nhập chịu); amount < 0: nợ giảm (thanh toán, trả hàng...).
   Số dư lưu sẵn ở customer.debt / supplier.debt, luôn bằng tổng sổ. */
export function ledgerAdd(party, partyId, amount, o = {}) {
  amount = rnd(amount); if (!amount) return null;
  const coll = party === 'customer' ? 'customers' : 'suppliers';
  const p = S.mutD(coll, partyId);
  p.debt = rnd((p.debt || 0) + amount);
  return S.add('ledger', { party, partyId, ts: o.ts || Date.now(), amount, balance: p.debt, type: o.type || 'adjust', refId: o.refId || null, refType: o.refType || null,
    method: o.method || null, note: o.note || '', staffId: S.session.staffId });
}
export function ledgerOf(party, partyId) {
  return S.list('ledger').filter(l => l.party === party && l.partyId === partyId).sort((a, b) => a.ts - b.ts || a.createdAt - b.createdAt);
}
/** Kiểm tra số dư cache khớp tổng sổ (dùng cho kiểm thử/chẩn đoán). */
export function ledgerSum(party, partyId) { return ledgerOf(party, partyId).reduce((s, l) => s + l.amount, 0); }

/** Thu nợ khách: trả bớt hoặc hết. method: cash | transfer */
export function payCustomerDebt({ customerId, amount, method = 'cash', note = '' }) {
  need('manageCustomers');
  amount = rnd(amount);
  const c = S.get('customers', customerId); if (!c) fail('Không tìm thấy khách hàng');
  if (!(amount > 0)) fail('Số tiền thu phải lớn hơn 0');
  if (amount > c.debt) fail('Số tiền thu lớn hơn số khách đang nợ');
  if (!['cash', 'transfer'].includes(method)) fail('Hình thức không hợp lệ');
  return S.tx(() => {
    const e = ledgerAdd('customer', customerId, -amount, { type: 'payment', method, note });
    log('debt', `Thu nợ ${c.name}: ${amount}`, { ref: customerId });
    return e;
  });
}
export function paySupplierDebt({ supplierId, amount, method = 'cash', note = '' }) {
  need('manageSuppliers');
  amount = rnd(amount);
  const s = S.get('suppliers', supplierId); if (!s) fail('Không tìm thấy nhà cung cấp');
  if (!(amount > 0)) fail('Số tiền trả phải lớn hơn 0');
  if (amount > s.debt) fail('Số tiền trả lớn hơn số đang nợ');
  if (!['cash', 'transfer'].includes(method)) fail('Hình thức không hợp lệ');
  return S.tx(() => {
    const e = ledgerAdd('supplier', supplierId, -amount, { type: 'payment', method, note });
    log('debt', `Trả nợ NCC ${s.name}: ${amount}`, { ref: supplierId });
    return e;
  });
}

/** Các khoản nợ còn lại của một bên, tính theo nguyên tắc tiền thu/trả được trừ vào khoản CŨ NHẤT trước.
    Trả về [{refId, ts, amount, outstanding, type, note}] — chỉ các khoản còn nợ. */
export function debtDetail(party, partyId) {
  const entries = ledgerOf(party, partyId).filter(l => !l.void);
  let credit = entries.filter(l => l.amount < 0).reduce((s, l) => s - l.amount, 0);
  const out = [];
  for (const l of entries.filter(l => l.amount > 0)) {
    const used = Math.min(credit, l.amount); credit -= used;
    if (l.amount - used > 0) out.push({ refId: l.refId, ts: l.ts, amount: l.amount, outstanding: l.amount - used, type: l.type, note: l.note });
  }
  return out;
}
/** Tuổi nợ: tổng nợ theo nhóm số ngày kể từ lúc phát sinh. */
export function debtAging(party, partyId, now = Date.now()) {
  const b = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  for (const x of debtDetail(party, partyId)) {
    const days = Math.floor((now - x.ts) / 86400000);
    b[days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90'] += x.outstanding;
  }
  return b;
}
export function oldestDebtAge(party, partyId, now = Date.now()) {
  const d = debtDetail(party, partyId)[0];
  return d ? Math.floor((now - d.ts) / 86400000) : 0;
}

/* ---------- Điểm thưởng ---------- */
export function addPoints(customerId, pts) {
  const c = S.mutD('customers', customerId);
  c.points = Math.max(0, Math.round((c.points || 0) + pts));
  return c.points;
}
export function pointsFor(total) {
  const per = settings().sale.pointsPer;
  return per > 0 ? Math.floor(total / per) : 0;
}
