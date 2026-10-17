/* Sổ quỹ: thu/chi khác, dòng tiền tổng hợp (tiền mặt & ngân hàng), ca làm việc. */
import { S } from '../store.js';
import { fail, rnd, norm } from '../util.js';
import { need, needWrite, log, currentUser } from './auth.js';

/* ---------- Danh mục thu chi ---------- */
export function saveCashCat(d) {
  need('cashbook');
  const name = String(d.name || '').trim(); if (!name) fail('Nhập tên danh mục');
  if (S.list('cashCats').some(c => c.id !== d.id && norm(c.name) === norm(name) && c.kind === d.kind)) fail('Danh mục đã tồn tại');
  return S.tx(() => d.id ? Object.assign(S.mut('cashCats', d.id), { name, operating: d.operating !== false })
    : S.add('cashCats', { name, kind: d.kind === 'income' ? 'income' : 'expense', operating: d.operating !== false }));
}
export function deleteCashCat(id) {
  need('cashbook');
  if (S.list('cashEntries').some(e => e.catId === id)) fail('Danh mục đã có phát sinh, không xoá được');
  S.tx(() => S.del('cashCats', id));
}

/* ---------- Thu / chi khác ---------- */
export function addCashEntry({ kind, catId, amount, fund = 'cash', note = '', ts }) {
  need('cashbook'); needWrite();
  amount = rnd(amount);
  if (!(amount > 0)) fail('Số tiền phải lớn hơn 0');
  if (!['income', 'expense'].includes(kind)) fail('Chọn thu hay chi');
  const cat = S.get('cashCats', catId); if (!cat || cat.kind !== kind) fail('Chọn danh mục phù hợp');
  if (!['cash', 'bank'].includes(fund)) fail('Chọn quỹ tiền mặt hoặc ngân hàng');
  return S.tx(() => {
    const sh = currentShift();
    const e = S.add('cashEntries', { kind, catId, catName: cat.name, operating: cat.operating !== false, amount, fund, note: String(note).trim(), ts: ts || Date.now(),
      staffId: S.session.staffId, shiftId: sh ? sh.id : null });
    log('cash', `${kind === 'income' ? 'Thu' : 'Chi'} ${amount}đ – ${cat.name}`, { ref: e.id });
    return e;
  });
}
export function deleteCashEntry(id) {
  need('cashbook'); need('deleteData');
  const e = S.get('cashEntries', id); if (!e) return;
  const sh = e.shiftId && S.get('shifts', e.shiftId);
  if (sh && sh.status === 'closed') fail('Khoản này thuộc ca đã chốt, không xoá được');
  S.tx(() => { S.del('cashEntries', id); log('cash', `Xoá khoản ${e.kind === 'income' ? 'thu' : 'chi'} ${e.amount}đ – ${e.catName}`); });
}

/* ---------- Dòng tiền tổng hợp ---------- */
/** Mọi biến động tiền trong khoảng [from, to]. amount > 0 là tiền vào. fund: cash | bank. */
export function cashFlows(from = 0, to = Infinity, filter = {}) {
  const out = [];
  const push = (ts, fund, amount, kind, desc, o = {}) => {
    if (!amount || ts < from || ts > to) return;
    if (filter.staffId && o.staffId !== filter.staffId) return;
    out.push(Object.assign({ ts, fund, amount, kind, desc }, o));
  };
  const f = m => m === 'cash' ? 'cash' : 'bank';
  for (const s of S.c.sales.values()) {
    if (s.status !== 'done') continue;
    for (const p of s.payments) if (p.method !== 'debt') push(s.ts, f(p.method), p.amount, 'sale', 'Bán hàng ' + s.code, { ref: s.id, staffId: s.staffId });
  }
  for (const r of S.c.returns.values()) {
    push(r.ts, 'cash', -(r.refund.cash || 0), 'return', 'Trả hàng ' + r.code, { ref: r.id, staffId: r.staffId });
    push(r.ts, 'bank', -(r.refund.transfer || 0), 'return', 'Trả hàng ' + r.code, { ref: r.id, staffId: r.staffId });
  }
  for (const l of S.c.ledger.values()) {
    if (l.type !== 'payment') continue;
    if (l.party === 'customer') push(l.ts, f(l.method), -l.amount, 'debt_in', 'Thu nợ khách', { ref: l.id, staffId: l.staffId });
    else push(l.ts, f(l.method), l.amount, 'debt_out', 'Trả nợ nhà cung cấp', { ref: l.id, staffId: l.staffId });
  }
  for (const p of S.c.purchases.values()) if (p.paid > 0) push(p.ts, f(p.method), -p.paid, 'purchase', 'Nhập hàng ' + p.code, { ref: p.id, staffId: p.staffId });
  for (const r of S.c.purchaseReturns.values()) if (r.refund !== 'debt') push(r.ts, f(r.refund), r.total, 'purchase_return', 'NCC hoàn tiền ' + r.code, { ref: r.id, staffId: r.staffId });
  for (const e of S.c.cashEntries.values()) push(e.ts, e.fund, e.kind === 'income' ? e.amount : -e.amount, 'entry', `${e.kind === 'income' ? 'Thu' : 'Chi'}: ${e.catName}${e.note ? ' – ' + e.note : ''}`, { ref: e.id, staffId: e.staffId, shiftId: e.shiftId });
  return out.sort((a, b) => a.ts - b.ts);
}
export function setOpeningBalance({ cash = 0, bank = 0 }) {
  need('cashbook');
  S.tx(() => S.setMeta('openingBalance', { cash: rnd(cash), bank: rnd(bank) }));
}
export function fundBalances(upTo = Infinity) {
  const ob = S.getMeta('openingBalance', { cash: 0, bank: 0 });
  const b = { cash: ob.cash, bank: ob.bank };
  for (const f of cashFlows(0, upTo)) b[f.fund] += f.amount;
  return b;
}

/* ---------- Ca làm việc ---------- */
export function currentShift(staffId = S.session.staffId) {
  return S.list('shifts').find(s => s.status === 'open' && s.staffId === staffId) || null;
}
export function openShift({ openingCash = 0 } = {}) {
  need('cashbook'); needWrite();
  if (currentShift()) fail('Bạn đang có một ca chưa chốt');
  openingCash = rnd(openingCash); if (openingCash < 0) fail('Tiền đầu ca không hợp lệ');
  const u = currentUser();
  return S.tx(() => {
    const sh = S.add('shifts', { staffId: u.id, staffName: u.name, openAt: Date.now(), openingCash, status: 'open', closeAt: null });
    log('shift', `Mở ca, tiền đầu ca ${openingCash}đ`, { ref: sh.id });
    return sh;
  });
}
export function shiftReport(sh, until = Date.now()) {
  const end = sh.closeAt || until;
  const flows = cashFlows(sh.openAt, end, { staffId: sh.staffId });
  const sum = pred => flows.filter(pred).reduce((s, x) => s + x.amount, 0);
  const sales = S.list('sales').filter(s => s.status === 'done' && s.staffId === sh.staffId && s.ts >= sh.openAt && s.ts <= end);
  const cashIn = sum(f => f.fund === 'cash' && f.amount > 0), cashOut = -sum(f => f.fund === 'cash' && f.amount < 0);
  return {
    bills: sales.length, revenue: sales.reduce((s, x) => s + x.total, 0), debtSold: sales.reduce((s, x) => s + x.debt, 0),
    saleCash: sum(f => f.fund === 'cash' && f.kind === 'sale'), saleBank: sum(f => f.fund === 'bank' && f.kind === 'sale'),
    debtCollectedCash: sum(f => f.fund === 'cash' && f.kind === 'debt_in'),
    refundsCash: -sum(f => f.fund === 'cash' && f.kind === 'return'),
    entriesIn: sum(f => f.fund === 'cash' && f.kind === 'entry' && f.amount > 0), entriesOut: -sum(f => f.fund === 'cash' && f.kind === 'entry' && f.amount < 0),
    otherCashOut: -sum(f => f.fund === 'cash' && ['purchase', 'debt_out'].includes(f.kind)),
    cashIn, cashOut, expectedCash: sh.openingCash + cashIn - cashOut
  };
}
export function closeShift(id, { countedCash, note = '' }) {
  need('cashbook');
  const sh = S.get('shifts', id); if (!sh) fail('Không tìm thấy ca');
  if (sh.status !== 'open') fail('Ca đã được chốt');
  if (sh.staffId !== S.session.staffId && currentUser().role !== 'owner') fail('Chỉ người mở ca (hoặc chủ) mới chốt được');
  countedCash = rnd(countedCash);
  if (!(countedCash >= 0)) fail('Nhập số tiền đếm thực tế');
  return S.tx(() => {
    const rec = S.mut('shifts', id);
    rec.closeAt = Date.now();
    const rep = shiftReport(rec);
    Object.assign(rec, { status: 'closed', expectedCash: rep.expectedCash, countedCash, diff: countedCash - rep.expectedCash, note: String(note).trim(), report: rep });
    log('shift', `Chốt ca: chênh lệch ${rec.diff}đ`, { ref: id });
    return rec;
  });
}
export const listShifts = () => S.list('shifts').sort((a, b) => b.openAt - a.openAt);
