/* Bán hàng: tính giỏ (giá sỉ/bậc, khuyến mãi, giảm giá, làm tròn), lưu hoá đơn, đơn treo, huỷ bill, trả hàng. */
import { S } from '../store.js';
import { fail, rnd, roundQty, roundTo, uid, ymd } from '../util.js';
import { need, can, log, settings, maxDiscountPct, currentUser } from './auth.js';
import { stockIn, stockOut } from './stockcore.js';
import { ledgerAdd, addPoints, pointsFor } from './people.js';
import { activePromos, lineDiscount, orderDiscounts } from './promos.js';
import { currentShift } from './cash.js';
import { nextCode } from './inventory.js';
import { unitOf } from './products.js';

/** Giá bán một đơn vị theo số lượng & nhóm khách: lẻ → bậc số lượng → giá sỉ (lấy giá thấp nhất hợp lệ). */
export function unitPrice(p, u, qty, customer) {
  let price = u.price;
  const tier = (u.tiers || []).filter(t => qty >= t.min).pop();
  if (tier && tier.price < price) price = tier.price;
  if (u.wholesale > 0 && ((customer && customer.group === 'wholesale') || (u.wholesaleMin > 0 && qty >= u.wholesaleMin)) && u.wholesale < price) price = u.wholesale;
  return price;
}

/** Tính toàn bộ giỏ hàng — hàm thuần, KHÔNG ghi dữ liệu. */
export function calcCart(cart, { now = Date.now() } = {}) {
  const st = settings().sale;
  const customer = cart.customerId ? S.get('customers', cart.customerId) : null;
  const warnings = [];
  const lines = [];
  (cart.lines || []).forEach((cl, idx) => {
    const p = S.get('products', cl.productId);
    if (!p) fail(`Dòng ${idx + 1}: hàng không còn tồn tại`);
    const u = unitOf(p, cl.unitId);
    const qty = roundQty(Number(cl.qty));
    if (!(qty > 0)) fail(`${p.name}: số lượng phải lớn hơn 0`);
    if (p.kind === 'count' && Math.abs(qty - Math.round(qty)) > 1e-9) fail(`${p.name}: hàng đếm phải bán số lượng nguyên`);
    const listPrice = unitPrice(p, u, qty, customer);
    const overridden = cl.price != null && rnd(cl.price) !== listPrice;
    const price = overridden ? Math.max(0, rnd(cl.price)) : listPrice;
    const amount = rnd(qty * price);
    const manual = Math.min(Math.max(0, rnd(cl.discount || 0)), amount);
    lines.push({
      idx, productId: p.id, name: p.name, sku: p.sku, unitId: u.id, unitName: u.name, factor: u.factor, qty, qtyBase: roundQty(qty * u.factor),
      listPrice, price, overridden, amount, manualDiscount: manual, promoDiscount: 0, promoNames: [], note: cl.note || '', kind: p.kind
    });
  });

  /* --- KM cấp dòng --- */
  const promos = activePromos(now, customer, cart.voucher);
  const stack = st.promoStack === 'stack';
  const used = new Set();
  for (const l of lines) {
    const prod = S.get('products', l.productId);
    const hits = promos.map(p => ({ p, d: lineDiscount(p, { productId: l.productId, qty: l.qty, price: l.price, amount: l.amount - l.manualDiscount }, prod) })).filter(x => x.d > 0);
    if (!hits.length) continue;
    const chosen = stack ? hits : [hits.sort((a, b) => b.d - a.d)[0]];
    let room = l.amount - l.manualDiscount;
    for (const h of chosen) { const d = Math.min(h.d, room); room -= d; l.promoDiscount += d; l.promoNames.push(h.p.name); used.add(h.p.id); }
  }
  const afterLines = lines.reduce((s, l) => s + l.amount - l.manualDiscount - l.promoDiscount, 0);

  /* --- KM cấp đơn --- */
  const ord = orderDiscounts(promos, lines.map(l => Object.assign({}, l)), afterLines);
  let promoOrder = 0; const orderNames = [];
  if (ord.length) {
    const chosen = stack ? ord : [ord.sort((a, b) => b.amount - a.amount)[0]];
    for (const o of chosen) { const d = Math.min(o.amount, afterLines - promoOrder); promoOrder += d; orderNames.push(o.promo.name); used.add(o.promo.id); }
  }

  /* --- Giảm giá tay cả đơn --- */
  let remaining = afterLines - promoOrder, manualOrder = 0;
  const md = cart.discount;
  if (md && md.value > 0) manualOrder = md.type === 'percent' ? Math.min(100, md.value) * remaining / 100 : md.value;
  manualOrder = Math.min(rnd(manualOrder), remaining);
  remaining -= manualOrder;

  /* --- Đổi điểm --- */
  let pointsUsed = 0, pointsDiscount = 0;
  if (cart.pointsUse > 0) {
    if (!customer) fail('Cần chọn khách hàng để đổi điểm');
    if (!(st.pointsPer > 0)) fail('Chưa bật tích điểm trong cài đặt');
    pointsUsed = Math.floor(Math.min(cart.pointsUse, customer.points || 0, remaining / st.pointValue));
    pointsDiscount = pointsUsed * st.pointValue;
    remaining -= pointsDiscount;
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const rounded = roundTo(remaining, st.rounding);
  const rounding = rounded - remaining;
  const total = Math.max(0, rounded);

  /* --- Phân bổ giảm giá cấp đơn xuống từng dòng để biết "giá thực" (phục vụ trả hàng & lợi nhuận) --- */
  const lineNetBase = lines.map(l => l.amount - l.manualDiscount - l.promoDiscount);
  const D = afterLines - total;                        // tổng giảm cấp đơn cần phân bổ (gồm làm tròn, có thể âm)
  let cum = 0, prevCut = 0;
  lines.forEach((l, i) => {
    l.total = lineNetBase[i];
    cum += lineNetBase[i];
    const cut = i === lines.length - 1 ? D : (afterLines ? Math.round(D * cum / afterLines) : 0);   // phân bổ luỹ kế → tổng khớp tuyệt đối
    l.net = lineNetBase[i] - (cut - prevCut); prevCut = cut;
  });

  /* --- Cảnh báo --- */
  const qtyByProduct = new Map();
  for (const l of lines) qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) || 0) + l.qtyBase);
  for (const [pid, q] of qtyByProduct) { const p = S.get('products', pid); if (p.stock < q) warnings.push({ code: 'stock', productId: pid, text: `${p.name}: tồn kho ${p.stock} ${p.units[0].name}, đang bán ${q}` }); }
  for (const l of lines) {
    const p = S.get('products', l.productId);
    if (p.cost > 0 && l.net / l.qtyBase < p.cost - 0.5) warnings.push({ code: 'below_cost', productId: l.productId, text: `${l.name}: giá bán thấp hơn giá vốn` });
  }
  const today = ymd(now);
  for (const l of lines) {
    const p = S.get('products', l.productId); if (!p.trackBatch) continue;
    const b = S.list('batches').filter(x => x.productId === p.id && x.qty > 0 && x.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
    if (b && b.expiry < today) warnings.push({ code: 'expired', productId: p.id, text: `${p.name}: có lô đã hết hạn (${b.expiry})` });
    else if (b) { const d = Math.ceil((new Date(b.expiry + 'T23:59:59') - now) / 86400000); if (d <= 7) warnings.push({ code: 'expiring', productId: p.id, text: `${p.name}: lô gần hết hạn (còn ${d} ngày)` }); }
  }

  const lineManual = lines.reduce((s, l) => s + l.manualDiscount, 0);
  const promoLine = lines.reduce((s, l) => s + l.promoDiscount, 0);
  const manualTotal = lineManual + manualOrder;
  return {
    customer, lines, subtotal, lineDiscount: lineManual, promoLine, promoOrder, manualOrder, pointsUsed, pointsDiscount, rounding, total,
    discountTotal: subtotal - total, manualPct: subtotal ? manualTotal * 100 / subtotal : 0,
    promoIds: Array.from(used), promoNames: Array.from(new Set([...lines.flatMap(l => l.promoNames), ...orderNames])), warnings,
    itemCount: roundQty(lines.reduce((s, l) => s + l.qty, 0))
  };
}

export const PAY_METHODS = { cash: 'Tiền mặt', vietqr: 'VietQR', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };

/** Lưu hoá đơn. payments: [{method, amount}] (số tiền ĐÃ trừ tiền thừa). opts: {cashGiven, note, holdId, confirmOverLimit} */
export function createSale(cart, payments, opts = {}) {
  need('sell');
  const st = settings().sale;
  const c = calcCart(cart, { now: opts.ts || Date.now() });
  if (!c.lines.length) fail('Giỏ hàng trống');
  if (c.lines.some(l => l.overridden)) need('editPrice');
  if (c.manualPct > 0.0001 && c.manualPct > maxDiscountPct() + 1e-9) fail(`Giảm giá ${Math.round(c.manualPct * 10) / 10}% vượt mức cho phép (${maxDiscountPct()}%)`, 'perm');
  if (c.lines.some(l => l.price < 0)) fail('Giá bán không hợp lệ');
  if (!st.allowNegative) { const w = c.warnings.find(x => x.code === 'stock'); if (w) fail('Không đủ hàng – ' + w.text); }
  if (st.blockBelowCost && !opts.allowBelowCost) { const w = c.warnings.find(x => x.code === 'below_cost'); if (w) fail('Bán dưới giá vốn bị chặn – ' + w.text); }
  const shift = currentShift();
  if (st.requireShift && !shift) fail('Hãy mở ca làm việc trước khi bán hàng');

  payments = (payments || []).map(p => ({ method: p.method, amount: rnd(p.amount) })).filter(p => p.amount !== 0);
  for (const p of payments) { if (!PAY_METHODS[p.method]) fail('Hình thức thanh toán không hợp lệ'); if (p.amount < 0) fail('Số tiền thanh toán không hợp lệ'); }
  const payTotal = payments.reduce((s, p) => s + p.amount, 0);
  if (payTotal !== c.total) fail(`Thanh toán (${payTotal}đ) chưa khớp tổng tiền (${c.total}đ)`);
  const debt = payments.filter(p => p.method === 'debt').reduce((s, p) => s + p.amount, 0);
  const customer = c.customer;
  if (debt > 0) {
    if (!customer) fail('Chọn khách hàng để ghi nợ');
    if (customer.debtLimit > 0 && customer.debt + debt > customer.debtLimit && !(st.debtOverLimit === 'warn' && opts.confirmOverLimit))
      fail(`Vượt hạn mức nợ của ${customer.name} (${customer.debt + debt}đ / ${customer.debtLimit}đ)`, 'debt_limit');
  }
  const cashPaid = payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
  const cashGiven = opts.cashGiven != null ? rnd(opts.cashGiven) : cashPaid;
  if (cashGiven < cashPaid) fail('Tiền khách đưa chưa đủ');

  const u = currentUser(), ts = opts.ts || Date.now();
  return S.tx(() => {
    const id = uid(), code = nextCode('HD', ts);
    const items = c.lines.map(l => {
      const alloc = stockOut(l.productId, l.qtyBase, { type: 'sale', ref: id, refType: 'sale', reason: 'Bán hàng ' + code, ts });
      const p = S.get('products', l.productId);
      const covered = alloc.reduce((s, a) => s + a.qty, 0);
      const costAmount = rnd(alloc.reduce((s, a) => s + a.qty * (a.cost == null ? p.cost : a.cost), 0) + (l.qtyBase - covered) * (p.cost || 0));
      return { productId: l.productId, name: l.name, sku: l.sku, unitId: l.unitId, unitName: l.unitName, factor: l.factor, qty: l.qty, qtyBase: l.qtyBase, price: l.price, listPrice: l.listPrice,
        amount: l.amount, manualDiscount: l.manualDiscount, promoDiscount: l.promoDiscount, promoNames: l.promoNames, total: l.total, net: l.net, costAmount,
        alloc: alloc.map(a => ({ batchId: a.batchId, qty: a.qty })), note: l.note, returnedQty: 0, returnedAmount: 0 };
    });
    const earned = customer ? pointsFor(c.total - debt) : 0;
    const sale = S.add('sales', {
      id, code, ts, staffId: u.id, staffName: u.name, shiftId: shift ? shift.id : null,
      customerId: customer ? customer.id : null, customerName: customer ? customer.name : '', customerPhone: customer ? customer.phone : '',
      items, subtotal: c.subtotal, lineDiscount: c.lineDiscount, promoDiscount: c.promoLine + c.promoOrder, manualOrderDiscount: c.manualOrder, pointsDiscount: c.pointsDiscount,
      rounding: c.rounding, discountTotal: c.subtotal - c.total, total: c.total, payments, cashGiven, change: cashGiven - cashPaid, paid: c.total - debt, debt,
      status: 'done', note: String(opts.note || cart.note || '').trim(), pointsEarned: earned, pointsUsed: c.pointsUsed, promoNames: c.promoNames, promoIds: c.promoIds, returnedTotal: 0
    });
    for (const pid of c.promoIds) { const pr = S.mutD('promos', pid); pr.used = (pr.used || 0) + 1; }
    if (customer) {
      const cu = S.mutD('customers', customer.id);
      cu.totalSpent = (cu.totalSpent || 0) + c.total; cu.lastBuyAt = ts;
      if (earned) addPoints(customer.id, earned);
      if (c.pointsUsed) addPoints(customer.id, -c.pointsUsed);
      if (debt > 0) ledgerAdd('customer', customer.id, debt, { type: 'sale', refId: id, refType: 'sale', ts, note: code });
    }
    if (opts.holdId && S.get('holds', opts.holdId)) S.del('holds', opts.holdId);
    log('sale', `Bán ${code}: ${c.total}đ`, { ref: id });
    return sale;
  });
}

/* ---------- Huỷ hoá đơn ---------- */
export function voidSale(id, reason) {
  need('voidSale');
  const s = S.get('sales', id); if (!s) fail('Không tìm thấy hoá đơn');
  if (s.status !== 'done') fail('Hoá đơn đã bị huỷ trước đó');
  if (s.returnedTotal > 0) fail('Hoá đơn đã có trả hàng, không thể huỷ');
  if (!String(reason || '').trim()) fail('Nhập lý do huỷ hoá đơn');
  return S.tx(() => {
    const sale = S.mut('sales', id);
    for (const it of sale.items) stockIn(it.productId, it.qtyBase, { type: 'cancel', retAlloc: it.alloc, refType: 'sale', ref: id, reason: 'Huỷ hoá đơn ' + sale.code, lot: 'HUY-' + sale.code });
    if (sale.customerId) {
      const cu = S.mutD('customers', sale.customerId);
      cu.totalSpent = Math.max(0, (cu.totalSpent || 0) - sale.total);
      if (sale.pointsEarned) addPoints(cu.id, -sale.pointsEarned);
      if (sale.pointsUsed) addPoints(cu.id, sale.pointsUsed);
      if (sale.debt > 0) {
        S.list('ledger').filter(l => l.refId === id && l.type === 'sale').forEach(l => { S.mut('ledger', l.id).void = true; });
        const e = ledgerAdd('customer', cu.id, -sale.debt, { type: 'void', refId: id, refType: 'sale', note: 'Huỷ ' + sale.code });
        if (e) S.mut('ledger', e.id).void = true;
      }
    }
    for (const pid of (sale.promoIds || [])) { const pr = S.get('promos', pid); if (pr && pr.used > 0) S.mutD('promos', pid).used--; }
    Object.assign(sale, { status: 'void', voidReason: String(reason).trim(), voidAt: Date.now(), voidBy: currentUser().name });
    log('void', `Huỷ hoá đơn ${sale.code}: ${sale.voidReason}`, { ref: id });
    return sale;
  });
}

/* ---------- Trả hàng ---------- */
/** d: {saleId?, items:[{lineIndex, qty}] (khi có hoá đơn) | [{productId, unitId, qty, price}] (không hoá đơn), refund:'cash'|'transfer'|'debt', restock:boolean, reason} */
export function createReturn(d) {
  need('returns');
  if (!d.items || !d.items.length) fail('Chưa chọn hàng trả');
  const sale = d.saleId ? S.get('sales', d.saleId) : null;
  if (d.saleId && !sale) fail('Không tìm thấy hoá đơn gốc');
  if (sale && sale.status !== 'done') fail('Hoá đơn đã bị huỷ');
  const refundMethod = ['cash', 'transfer', 'debt'].includes(d.refund) ? d.refund : 'cash';
  const restock = d.restock !== false;
  return S.tx(() => {
    const code = nextCode('TH');
    const rid = uid();
    const items = []; let total = 0;
    const saleRec = sale ? S.mut('sales', sale.id) : null;
    for (const it of d.items) {
      const qty = roundQty(Number(it.qty));
      if (!(qty > 0)) fail('Số lượng trả phải lớn hơn 0');
      let p, unitName, factor, amount, costAmount, alloc = null, productId, lineIndex = null;
      if (saleRec) {
        const line = saleRec.items[it.lineIndex]; if (!line) fail('Dòng hàng không thuộc hoá đơn này');
        const remain = roundQty(line.qty - line.returnedQty);
        if (qty > remain + 1e-9) fail(`${line.name}: chỉ còn ${remain} có thể trả`);
        productId = line.productId; unitName = line.unitName; factor = line.factor; lineIndex = it.lineIndex;
        amount = qty >= remain - 1e-9 ? line.net - line.returnedAmount : rnd(line.net * qty / line.qty);
        costAmount = qty >= remain - 1e-9 ? line.costAmount - (line.costReturnedAll || 0) : rnd(line.costAmount * qty / line.qty);
        line.returnedQty = roundQty(line.returnedQty + qty); line.returnedAmount += amount; line.costReturnedAll = (line.costReturnedAll || 0) + costAmount;
        if (restock) line.returnedCost = (line.returnedCost || 0) + costAmount;     // chỉ hàng nhập lại kho mới được trừ giá vốn
        alloc = line.alloc;
      } else {
        p = S.get('products', it.productId); if (!p) fail('Hàng không tồn tại');
        const u = unitOf(p, it.unitId);
        productId = p.id; unitName = u.name; factor = u.factor;
        amount = rnd(qty * (it.price != null ? it.price : u.price)); costAmount = rnd(qty * factor * (p.cost || 0));
      }
      p = S.get('products', productId);
      const qtyBase = roundQty(qty * factor);
      const picked = alloc ? pickAlloc(alloc, qtyBase) : null;      // luôn ghi nhận phần đã trả theo thứ tự lô, để lần trả sau không dồn hết về lô đầu
      if (restock) stockIn(productId, qtyBase, { type: 'return_in', retAlloc: picked, refType: 'return', ref: rid, reason: 'Khách trả hàng ' + code, lot: 'TRA-LAI', cost: costAmount / qtyBase });
      items.push({ lineIndex, productId, name: p.name, unitName, qty, qtyBase, amount, costAmount });
      total += amount;
    }
    // chia tiền hoàn
    const customer = sale && sale.customerId ? S.get('customers', sale.customerId) : (d.customerId ? S.get('customers', d.customerId) : null);
    let toDebt = 0;
    if (refundMethod === 'debt') {
      if (!customer) fail('Cần có khách hàng để trừ vào công nợ');
      toDebt = Math.min(total, Math.max(0, customer.debt));
    }
    const rest = total - toDebt;
    const refund = { cash: refundMethod === 'transfer' ? 0 : rest, transfer: refundMethod === 'transfer' ? rest : 0, debt: toDebt };
    const shift = currentShift();
    const rec = S.add('returns', { id: rid, code, ts: Date.now(), saleId: sale ? sale.id : null, saleCode: sale ? sale.code : '', customerId: customer ? customer.id : null,
      customerName: customer ? customer.name : '', items, total, refund, restock, reason: String(d.reason || '').trim(), staffId: S.session.staffId, shiftId: shift ? shift.id : null });
    if (saleRec) saleRec.returnedTotal = (saleRec.returnedTotal || 0) + total;
    if (customer) {
      const cu = S.mutD('customers', customer.id); cu.totalSpent = Math.max(0, (cu.totalSpent || 0) - total);
      if (toDebt) ledgerAdd('customer', customer.id, -toDebt, { type: 'return', refId: rid, refType: 'return', note: code });
    }
    log('return', `Trả hàng ${code}: ${total}đ${restock ? '' : ' (không nhập lại kho)'}`, { ref: rid });
    return rec;
  });
}
function pickAlloc(alloc, qtyBase) {
  const out = []; let left = qtyBase;
  for (const a of alloc) { if (left <= 0) break; const q = Math.min(roundQty(a.qty - (a.ret || 0)), left); if (q <= 0) continue; a.ret = roundQty((a.ret || 0) + q); out.push({ batchId: a.batchId, qty: q }); left = roundQty(left - q); }
  return out;
}

/* ---------- Đơn treo ---------- */
export function saveHold({ id, name, cart }) {
  need('sell');
  if (!cart || !cart.lines || !cart.lines.length) fail('Giỏ hàng trống, không cần treo');
  return S.tx(() => {
    const data = { name: name || '', cart: JSON.parse(JSON.stringify(cart)), staffId: S.session.staffId, ts: Date.now() };
    if (id && S.get('holds', id)) return Object.assign(S.mut('holds', id), data);
    return S.add('holds', data);
  });
}
export const listHolds = () => S.list('holds').sort((a, b) => a.ts - b.ts);
export function deleteHold(id) { S.tx(() => S.del('holds', id)); }

/* ---------- Truy vấn hoá đơn ---------- */
export function listSales({ from = 0, to = Infinity, status, customerId, staffId, q, limit = 300 } = {}) {
  const t = String(q || '').trim().toLowerCase();
  return S.list('sales').filter(s => s.ts >= from && s.ts <= to && (!status || s.status === status) && (!customerId || s.customerId === customerId) && (!staffId || s.staffId === staffId) &&
    (!t || s.code.toLowerCase().includes(t) || (s.customerName || '').toLowerCase().includes(t) || (s.customerPhone || '').includes(t))).sort((a, b) => b.ts - a.ts).slice(0, limit);
}
export const getSale = id => S.get('sales', id);
export const returnsOfSale = id => S.list('returns').filter(r => r.saleId === id);
export function saleProfit(s) {
  if (s.status !== 'done') return 0;
  return s.items.reduce((sum, i) => sum + (i.net - i.returnedAmount) - (i.costAmount - (i.returnedCost || 0)), 0);
}
