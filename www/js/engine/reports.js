/* Báo cáo & thống kê. Doanh thu/lợi nhuận tính theo NGÀY BÁN của hoá đơn (hàng trả được trừ vào hoá đơn gốc),
   trả hàng không hoá đơn được tính theo ngày trả. Mọi hàm đều thuần đọc – không ghi dữ liệu. */
import { S } from '../store.js';
import { rnd, roundQty, DAY, dayStart, ymd, fmtDate, norm } from '../util.js';
import { lastSoldMap, stockAlerts, inventoryValue } from './inventory.js';
import { debtDetail, debtAging } from './people.js';
import { categoryPath, categoryDescendants } from './products.js';
import { listShifts, shiftReport, cashFlows } from './cash.js';

const inRange = (ts, from, to) => ts >= from && ts <= to;
export function salesIn(from, to) { return S.list('sales').filter(s => s.status === 'done' && inRange(s.ts, from, to)); }
const anonReturns = (from, to) => S.list('returns').filter(r => !r.saleId && inRange(r.ts, from, to));

function saleNet(s) { return s.total - (s.returnedTotal || 0); }
function saleCogs(s) { return s.items.reduce((a, i) => a + i.costAmount - (i.returnedCost || 0), 0); }

export function summary(from, to) {
  const sales = salesIn(from, to), anon = anonReturns(from, to);
  const gross = sales.reduce((a, s) => a + s.total, 0);
  const returns = sales.reduce((a, s) => a + (s.returnedTotal || 0), 0) + anon.reduce((a, r) => a + r.total, 0);
  const revenue = gross - returns;
  const cogs = sales.reduce((a, s) => a + saleCogs(s), 0) - anon.filter(r => r.restock).reduce((a, r) => a + r.items.reduce((x, i) => x + i.costAmount, 0), 0);
  const discount = sales.reduce((a, s) => a + s.discountTotal, 0);
  const bills = sales.length;
  const pay = { cash: 0, bank: 0, debt: 0 };
  for (const s of sales) for (const p of s.payments) pay[p.method === 'cash' ? 'cash' : p.method === 'debt' ? 'debt' : 'bank'] += p.amount;
  const expenses = S.list('cashEntries').filter(e => e.kind === 'expense' && e.operating && inRange(e.ts, from, to)).reduce((a, e) => a + e.amount, 0);
  const otherIncome = S.list('cashEntries').filter(e => e.kind === 'income' && e.operating && inRange(e.ts, from, to)).reduce((a, e) => a + e.amount, 0);
  const wo = S.list('writeOffs').filter(w => inRange(w.ts, from, to)).reduce((a, w) => a + w.total, 0);
  let stocktakeLoss = 0;
  for (const st of S.list('stocktakes')) if (st.status === 'done' && inRange(st.completedAt, from, to)) stocktakeLoss += (st.summary.shortValue - st.summary.overValue);
  const gp = revenue - cogs;
  return {
    bills, gross, returns, revenue, cogs: rnd(cogs), grossProfit: rnd(gp), margin: revenue ? gp / revenue : 0, discount, avgBill: bills ? Math.round(gross / bills) : 0,
    pay, expenses, otherIncome, writeOff: wo, stocktakeLoss: rnd(stocktakeLoss), netProfit: rnd(gp - expenses + otherIncome - wo - stocktakeLoss),
    items: sales.reduce((a, s) => a + s.items.reduce((x, i) => x + i.qtyBase, 0), 0)
  };
}

/** Chuỗi theo ngày (hoặc theo tháng nếu khoảng > 62 ngày). */
export function series(from, to) {
  const days = Math.ceil((to - from) / DAY), monthly = days > 62;
  const key = ts => { const d = new Date(ts); return monthly ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : ymd(ts); };
  const map = new Map();
  const get = k => { if (!map.has(k)) map.set(k, { key: k, revenue: 0, bills: 0, profit: 0 }); return map.get(k); };
  if (!monthly) for (let t = dayStart(from); t <= to; t += DAY) get(key(t));
  for (const s of salesIn(from, to)) { const b = get(key(s.ts)); b.revenue += saleNet(s); b.bills++; b.profit += saleNet(s) - saleCogs(s); }
  return { monthly, points: Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key)) };
}
export function byHour(from, to) {
  const h = Array.from({ length: 24 }, (_, i) => ({ hour: i, bills: 0, revenue: 0 }));
  for (const s of salesIn(from, to)) { const b = h[new Date(s.ts).getHours()]; b.bills++; b.revenue += saleNet(s); }
  return h;
}
export function byStaff(from, to) {
  const m = new Map();
  for (const s of salesIn(from, to)) {
    const r = m.get(s.staffId) || { staffId: s.staffId, name: s.staffName, bills: 0, revenue: 0, profit: 0 };
    r.bills++; r.revenue += saleNet(s); r.profit += saleNet(s) - saleCogs(s); m.set(s.staffId, r);
  }
  return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
}

/** Thống kê theo sản phẩm trong kỳ. */
export function productStats(from, to) {
  const m = new Map();
  for (const s of salesIn(from, to)) for (const i of s.items) {
    const r = m.get(i.productId) || { productId: i.productId, name: i.name, qtyBase: 0, revenue: 0, cost: 0, bills: 0 };
    const keep = i.qty ? (i.qty - i.returnedQty) / i.qty : 1;
    r.qtyBase += i.qtyBase * keep; r.revenue += i.net - i.returnedAmount; r.cost += i.costAmount - (i.returnedCost || 0); r.bills++;
    m.set(i.productId, r);
  }
  return Array.from(m.values()).map(r => Object.assign(r, { qtyBase: roundQty(r.qtyBase), profit: r.revenue - r.cost, unit: (S.get('products', r.productId) || { units: [{ name: '' }] }).units[0].name }));
}
export function topProducts(from, to, { by = 'revenue', limit = 20 } = {}) {
  const key = { qty: 'qtyBase', revenue: 'revenue', profit: 'profit' }[by] || 'revenue';
  return productStats(from, to).sort((a, b) => b[key] - a[key]).slice(0, limit);
}
/** Hàng đang bán nhưng bán được rất ít/không bán trong kỳ. */
export function slowProducts(from, to, limit = 30) {
  const sold = new Map(productStats(from, to).map(r => [r.productId, r]));
  const last = lastSoldMap();
  return S.list('products').filter(p => p.active && p.stock > 0 && p.createdAt < from).map(p => ({
    product: p, qtyBase: sold.has(p.id) ? sold.get(p.id).qtyBase : 0, lastSold: last.get(p.id) || 0, value: rnd(p.stock * (p.cost || 0))
  })).sort((a, b) => a.qtyBase - b.qtyBase || b.value - a.value).slice(0, limit);
}
/** Phân tích ABC theo doanh thu: A = nhóm tạo 80% đầu, B = 15% kế, C = phần còn lại. */
export function abc(from, to) {
  const rows = productStats(from, to).filter(r => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((s, r) => s + r.revenue, 0); let cum = 0;
  return rows.map(r => { const before = cum / (total || 1); cum += r.revenue; return Object.assign(r, { share: r.revenue / (total || 1), cumShare: cum / (total || 1), cls: before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C' }); });
}
export function categoryStats(from, to) {
  const m = new Map();
  for (const r of productStats(from, to)) {
    const p = S.get('products', r.productId); const cid = p ? p.categoryId : null;
    const x = m.get(cid) || { categoryId: cid, name: cid ? categoryPath(cid) : 'Chưa phân nhóm', revenue: 0, profit: 0 };
    x.revenue += r.revenue; x.profit += r.profit; m.set(cid, x);
  }
  return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue);
}

/** Nhập – xuất – tồn theo kỳ cho từng mặt hàng. */
export function stockInOut(from, to, { categoryId } = {}) {
  const moves = new Map();
  for (const m of S.c.stockMoves.values()) { if (!moves.has(m.productId)) moves.set(m.productId, []); moves.get(m.productId).push(m); }
  const cats = categoryId ? new Set(categoryDescendants(categoryId)) : null;
  const rows = [];
  for (const p of S.c.products.values()) {
    if (cats && !cats.has(p.categoryId)) continue;
    let inQ = 0, outQ = 0, after = 0;
    for (const m of (moves.get(p.id) || [])) {
      if (m.ts > to) { after += m.qty; continue; }
      if (m.ts >= from) { if (m.qty > 0) inQ += m.qty; else outQ += -m.qty; } else { /* trước kỳ: nằm trong tồn đầu */ }
    }
    const close = roundQty(p.stock - after);
    const open = roundQty(close - inQ + outQ);
    if (open || inQ || outQ || close) rows.push({ product: p, open, in: roundQty(inQ), out: roundQty(outQ), close, value: rnd(close * (p.cost || 0)) });
  }
  return rows.sort((a, b) => a.product.name.localeCompare(b.product.name, 'vi'));
}

export function debtReport(now = Date.now()) {
  const customers = S.list('customers').filter(c => c.debt > 0).map(c => ({ customer: c, aging: debtAging('customer', c.id, now), oldest: (debtDetail('customer', c.id)[0] || {}).ts || 0 })).sort((a, b) => b.customer.debt - a.customer.debt);
  const suppliers = S.list('suppliers').filter(s => s.debt !== 0).map(s => ({ supplier: s, aging: debtAging('supplier', s.id, now), oldest: (debtDetail('supplier', s.id)[0] || {}).ts || 0 })).sort((a, b) => b.supplier.debt - a.supplier.debt);
  return { customers, suppliers, receivable: customers.reduce((a, x) => a + x.customer.debt, 0), payable: suppliers.reduce((a, x) => a + x.supplier.debt, 0) };
}

export function lossReport(from, to) {
  const writeOffs = S.list('writeOffs').filter(w => inRange(w.ts, from, to)).sort((a, b) => b.ts - a.ts);
  const stocktakes = S.list('stocktakes').filter(s => s.status === 'done' && inRange(s.completedAt, from, to));
  const badReturns = S.list('returns').filter(r => !r.restock && inRange(r.ts, from, to));
  return {
    writeOffs, stocktakes, badReturns,
    writeOffTotal: writeOffs.reduce((a, w) => a + w.total, 0),
    stocktakeShort: stocktakes.reduce((a, s) => a + s.summary.shortValue, 0), stocktakeOver: stocktakes.reduce((a, s) => a + s.summary.overValue, 0),
    badReturnCost: badReturns.reduce((a, r) => a + r.items.reduce((x, i) => x + i.costAmount, 0), 0)
  };
}
export function shiftsReport(from, to) {
  return listShifts().filter(s => inRange(s.openAt, from, to)).map(s => Object.assign({}, s, { report: s.status === 'closed' ? s.report : shiftReport(s) }));
}

/** Số liệu cho màn hình tổng quan. */
export function dashboard(now = Date.now()) {
  const t = dayStart(now);
  const today = summary(t, t + DAY - 1), yesterday = summary(t - DAY, t - 1);
  const week = series(t - 6 * DAY, t + DAY - 1);
  const month = summary(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime(), t + DAY - 1);
  const al = stockAlerts(now), debts = debtReport(now), inv = inventoryValue();
  return {
    today, yesterday, week, month, inventory: inv,
    alerts: { low: al.low.length, out: al.out.length, expiring: al.expiring.length, expired: al.expired.length, dead: al.dead.length },
    receivable: debts.receivable, payable: debts.payable,
    top: topProducts(t, t + DAY - 1, { by: 'revenue', limit: 5 })
  };
}

/** Bảng dữ liệu phẳng cho xuất CSV: trả {title, head, rows}. */
export function tableFor(kind, from, to) {
  const money = rnd;
  switch (kind) {
    case 'sales': return { title: 'Danh sách hoá đơn', head: ['Mã HĐ', 'Thời gian', 'Thu ngân', 'Khách hàng', 'Tổng hàng', 'Giảm giá', 'Tổng tiền', 'Đã trả', 'Ghi nợ', 'Hoàn trả', 'Trạng thái'],
      rows: S.list('sales').filter(s => inRange(s.ts, from, to)).sort((a, b) => a.ts - b.ts).map(s => [s.code, new Date(s.ts).toLocaleString('vi-VN'), s.staffName, s.customerName, s.subtotal, s.discountTotal, s.total, s.paid, s.debt, s.returnedTotal || 0, s.status === 'done' ? 'Hoàn thành' : 'Đã huỷ']) };
    case 'products': return { title: 'Báo cáo bán hàng theo sản phẩm', head: ['Sản phẩm', 'Số lượng bán', 'Đơn vị', 'Doanh thu', 'Giá vốn', 'Lợi nhuận'],
      rows: productStats(from, to).sort((a, b) => b.revenue - a.revenue).map(r => [r.name, r.qtyBase, r.unit, money(r.revenue), money(r.cost), money(r.profit)]) };
    case 'inout': return { title: 'Nhập – xuất – tồn', head: ['Sản phẩm', 'SKU', 'Đơn vị', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối', 'Giá trị tồn'],
      rows: stockInOut(from, to).map(r => [r.product.name, r.product.sku, r.product.units[0].name, r.open, r.in, r.out, r.close, r.value]) };
    case 'inventory': return { title: 'Tồn kho hiện tại', head: ['Sản phẩm', 'SKU', 'Nhóm', 'Đơn vị', 'Tồn', 'Giá vốn', 'Giá bán', 'Giá trị tồn (vốn)'],
      rows: S.list('products').sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(p => [p.name, p.sku, categoryPath(p.categoryId), p.units[0].name, p.stock, rnd(p.cost || 0), p.units[0].price, rnd(p.stock * (p.cost || 0))]) };
    case 'debts': { const d = debtReport(); return { title: 'Công nợ', head: ['Loại', 'Tên', 'Điện thoại', 'Số nợ', 'Nợ lâu nhất từ'],
      rows: [...d.customers.map(x => ['Khách nợ', x.customer.name, x.customer.phone, x.customer.debt, x.oldest ? fmtDate(x.oldest) : '']), ...d.suppliers.map(x => ['Nợ NCC', x.supplier.name, x.supplier.phone, x.supplier.debt, x.oldest ? fmtDate(x.oldest) : ''])] }; }
    case 'cashbook': return { title: 'Sổ quỹ', head: ['Thời gian', 'Quỹ', 'Diễn giải', 'Thu', 'Chi'],
      rows: cashFlows(from, to).map(f => [new Date(f.ts).toLocaleString('vi-VN'), f.fund === 'cash' ? 'Tiền mặt' : 'Ngân hàng', f.desc, f.amount > 0 ? f.amount : '', f.amount < 0 ? -f.amount : '']) };
    default: return { title: '', head: [], rows: [] };
  }
}
