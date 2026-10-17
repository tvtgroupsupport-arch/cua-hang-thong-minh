/* Kho: nhập hàng, trả hàng NCC, xuất hủy, kiểm kho, cảnh báo, gợi ý đặt hàng, thẻ kho. */
import { S } from '../store.js';
import { fail, rnd, roundQty, ymd, DAY, dayStart, uid } from '../util.js';
import { need, needWrite, log, settings } from './auth.js';
import { stockIn, stockOut, adjustTo } from './stockcore.js';
import { ledgerAdd } from './people.js';
import { unitOf } from './products.js';

/** Mã máy (A, B, C…) khi đã bật đồng bộ: gắn vào mã chứng từ/SKU để hai máy cùng bán/nhập offline không bao giờ trùng mã. */
export const deviceTag = () => (S.meta.sync && S.meta.sync.enabled && S.meta.sync.tag) || '';
export const nextCode = (prefix, ts = Date.now()) => `${prefix}${ymd(ts).replace(/-/g, '').slice(2)}-${deviceTag()}${String(S.nextSeq(prefix + ymd(ts))).padStart(3, '0')}`;

/* ---------- Nhập hàng ---------- */
export function createPurchase(d) {
  need('manageStock'); needWrite();
  if (!d.items || !d.items.length) fail('Phiếu nhập chưa có hàng');
  const supplier = d.supplierId ? S.get('suppliers', d.supplierId) : null;
  if (d.supplierId && !supplier) fail('Nhà cung cấp không tồn tại');
  const ts = d.ts || Date.now();
  // tính tiền từng dòng
  const lines = d.items.map((it, i) => {
    const p = S.get('products', it.productId); if (!p) fail(`Dòng ${i + 1}: hàng không tồn tại`);
    const u = unitOf(p, it.unitId), qty = Number(it.qty), cost = Number(it.cost);
    if (!(qty > 0)) fail(`Dòng ${i + 1} (${p.name}): số lượng phải lớn hơn 0`);
    if (!(cost >= 0)) fail(`Dòng ${i + 1} (${p.name}): giá nhập không hợp lệ`);
    if (p.kind === 'count' && !Number.isInteger(qty * u.factor) && Math.abs(qty * u.factor - Math.round(qty * u.factor)) > 1e-9) fail(`${p.name}: số lượng phải là số nguyên`);
    const disc = Math.max(0, rnd(it.discount || 0));
    const gross = rnd(qty * cost);
    if (disc > gross) fail(`${p.name}: chiết khấu lớn hơn thành tiền`);
    return { p, u, qty, cost: rnd(cost), disc, total: gross - disc, lot: String(it.lot || '').trim(), expiry: it.expiry || null };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const orderDisc = Math.max(0, rnd(d.discount || 0));
  if (orderDisc > subtotal) fail('Chiết khấu cả phiếu lớn hơn tổng tiền');
  const total = subtotal - orderDisc;
  const paid = d.paid == null ? total : rnd(d.paid);
  if (paid < 0 || paid > total) fail('Số tiền đã trả không hợp lệ');
  const debt = total - paid;
  if (debt > 0 && !supplier) fail('Cần chọn nhà cung cấp để ghi công nợ');
  const method = d.method === 'transfer' ? 'transfer' : 'cash';
  const method_ = paid > 0 ? method : null;

  return S.tx(() => {
    const code = nextCode('PN', ts), purId = uid();
    const items = [];
    for (const l of lines) {
      const share = subtotal ? l.total - orderDisc * (l.total / subtotal) : l.total;
      const qtyBase = roundQty(l.qty * l.u.factor);
      const eff = share / qtyBase;                       // giá vốn thực / đơn vị cơ bản (đã trừ chiết khấu)
      const p = S.mut('products', l.p.id);
      const oldStock = p.stock, oldCost = p.cost || 0;
      if (settings().sale.costMethod === 'last' || oldStock <= 0) p.cost = rnd(eff * 100) / 100;
      else p.cost = rnd(((oldStock * oldCost + qtyBase * eff) / (oldStock + qtyBase)) * 100) / 100;
      p.lastCost = eff; if (supplier) p.lastSupplierId = supplier.id;
      stockIn(p.id, qtyBase, { type: 'purchase', cost: eff, lot: l.lot || ('NH-' + code), expiry: l.expiry, ref: purId, refType: 'purchase', reason: 'Nhập hàng ' + code });
      items.push({ productId: p.id, name: p.name, unitId: l.u.id, unitName: l.u.name, factor: l.u.factor, qty: l.qty, cost: l.cost, discount: l.disc, total: l.total, qtyBase, effCost: eff, lot: l.lot, expiry: l.expiry });
    }
    const pur = S.add('purchases', { id: purId, code, ts, supplierId: supplier ? supplier.id : null, supplierName: supplier ? supplier.name : '', items, subtotal, discount: orderDisc, total, paid, method: method_, debt,
      dueDate: d.dueDate || null, note: String(d.note || '').trim(), staffId: S.session.staffId });
    if (debt > 0) ledgerAdd('supplier', supplier.id, debt, { type: 'purchase', refId: pur.id, refType: 'purchase', ts, note: code });
    log('purchase', `Nhập hàng ${code}: ${total}đ${debt ? ` (nợ ${debt}đ)` : ''}`, { ref: pur.id });
    return pur;
  });
}

/** Trả hàng cho nhà cung cấp. refund: 'debt' (trừ công nợ) | 'cash' | 'transfer' (NCC hoàn tiền) */
export function createPurchaseReturn(d) {
  need('manageStock');
  if (!d.items || !d.items.length) fail('Chưa chọn hàng trả');
  const supplier = S.get('suppliers', d.supplierId); if (!supplier) fail('Chọn nhà cung cấp');
  const refund = ['debt', 'cash', 'transfer'].includes(d.refund) ? d.refund : 'debt';
  return S.tx(() => {
    const code = nextCode('TN');
    let total = 0; const items = [];
    for (const it of d.items) {
      const p = S.get('products', it.productId); if (!p) fail('Hàng không tồn tại');
      const u = unitOf(p, it.unitId), qty = Number(it.qty);
      if (!(qty > 0)) fail(`${p.name}: số lượng phải lớn hơn 0`);
      const qtyBase = roundQty(qty * u.factor);
      if (p.stock < qtyBase) fail(`${p.name}: tồn kho (${p.stock}) không đủ để trả`);
      const amount = rnd(qty * (Number(it.cost) || 0));
      stockOut(p.id, qtyBase, { type: 'return_out', refType: 'purchaseReturn', reason: 'Trả NCC ' + code, batchId: it.batchId });
      total += amount; items.push({ productId: p.id, name: p.name, unitName: u.name, qty, cost: rnd(it.cost || 0), total: amount, qtyBase });
    }
    const rec = S.add('purchaseReturns', { code, ts: Date.now(), supplierId: supplier.id, supplierName: supplier.name, items, total, refund, note: d.note || '', staffId: S.session.staffId });
    if (refund === 'debt') ledgerAdd('supplier', supplier.id, -total, { type: 'return', refId: rec.id, refType: 'purchaseReturn', note: code });
    log('purchase', `Trả hàng NCC ${code}: ${total}đ`, { ref: rec.id });
    return rec;
  });
}

/* ---------- Xuất hủy ---------- */
export const WRITEOFF_REASONS = { expired: 'Hết hạn', damaged: 'Hỏng / vỡ', lost: 'Thất thoát / mất', internal: 'Dùng nội bộ', other: 'Lý do khác' };
export function createWriteOff(d) {
  need('manageStock'); needWrite();
  if (!d.items || !d.items.length) fail('Chưa chọn hàng cần xuất hủy');
  const reason = WRITEOFF_REASONS[d.reason] ? d.reason : 'other';
  return S.tx(() => {
    const code = nextCode('XH');
    const items = []; let total = 0;
    for (const it of d.items) {
      const p = S.get('products', it.productId); if (!p) fail('Hàng không tồn tại');
      const u = unitOf(p, it.unitId), qty = Number(it.qty);
      if (!(qty > 0)) fail(`${p.name}: số lượng phải lớn hơn 0`);
      const qtyBase = roundQty(qty * u.factor);
      if (it.batchId) { const b = S.get('batches', it.batchId); if (!b || b.qty < qtyBase) fail(`${p.name}: lô được chọn không đủ số lượng`); }
      else if (p.stock < qtyBase) fail(`${p.name}: tồn kho (${p.stock}) nhỏ hơn số hủy`);
      const cost = p.cost || 0;
      stockOut(p.id, qtyBase, { type: 'writeoff', refType: 'writeoff', reason: 'Xuất hủy ' + code + ' – ' + WRITEOFF_REASONS[reason], batchId: it.batchId });
      const value = rnd(qtyBase * cost); total += value;
      items.push({ productId: p.id, name: p.name, unitName: u.name, qty, qtyBase, cost, value, batchId: it.batchId || null });
    }
    const rec = S.add('writeOffs', { code, ts: Date.now(), items, reason, note: String(d.note || '').trim(), total, staffId: S.session.staffId });
    log('writeoff', `Xuất hủy ${code} (${WRITEOFF_REASONS[reason]}): ${total}đ`, { ref: rec.id });
    return rec;
  });
}

/* ---------- Kiểm kho ---------- */
export function createStocktake({ name, categoryIds, productIds } = {}) {
  need('manageStock');
  let list = S.list('products').filter(p => p.active);
  if (productIds) list = list.filter(p => productIds.includes(p.id));
  else if (categoryIds && categoryIds.length) list = list.filter(p => categoryIds.includes(p.categoryId));
  if (!list.length) fail('Không có hàng nào để kiểm');
  return S.tx(() => {
    const code = nextCode('KK');
    return S.add('stocktakes', {
      code, name: name || ('Kiểm kho ' + code), status: 'draft', startedAt: Date.now(), staffId: S.session.staffId,
      items: list.sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(p => ({ productId: p.id, name: p.name, sku: p.sku, unitName: p.units[0].name, system: p.stock, counted: null, cost: p.cost || 0 }))
    });
  });
}
export function setCount(stocktakeId, productId, counted) {
  need('manageStock');
  const st = S.get('stocktakes', stocktakeId); if (!st || st.status !== 'draft') fail('Phiếu kiểm đã hoàn tất hoặc không tồn tại');
  if (counted !== null && !(Number(counted) >= 0)) fail('Số đếm không hợp lệ');
  S.tx(() => {
    const rec = S.mut('stocktakes', stocktakeId);
    const it = rec.items.find(i => i.productId === productId); if (!it) fail('Hàng không thuộc phiếu kiểm này');
    it.counted = counted === null ? null : roundQty(Number(counted));
  });
}
/** Cộng dồn khi quét liên tục: mỗi lần quét +1 (hoặc +qty). Hàng chưa thuộc phiếu sẽ được thêm vào. */
export function addCount(stocktakeId, productId, qty = 1) {
  need('manageStock');
  S.tx(() => {
    const st = S.get('stocktakes', stocktakeId); if (!st || st.status !== 'draft') fail('Phiếu kiểm đã hoàn tất hoặc không tồn tại');
    const rec = S.mut('stocktakes', stocktakeId);
    let it = rec.items.find(i => i.productId === productId);
    if (!it) { const p = S.get('products', productId); if (!p) fail('Hàng không tồn tại'); it = { productId, name: p.name, sku: p.sku, unitName: p.units[0].name, system: p.stock, counted: null, cost: p.cost || 0 }; rec.items.push(it); }
    it.counted = roundQty((it.counted || 0) + qty);
  });
}
export function stocktakeSummary(st) {
  let counted = 0, over = 0, short = 0, overV = 0, shortV = 0;
  for (const i of st.items) {
    if (i.counted === null || i.counted === undefined) continue;
    counted++; const d = roundQty(i.counted - i.system);
    if (d > 0) { over++; overV += d * i.cost; } else if (d < 0) { short++; shortV += -d * i.cost; }
  }
  return { total: st.items.length, counted, over, short, overValue: rnd(overV), shortValue: rnd(shortV) };
}
/** Cân bằng kho: chỉ hàng ĐÃ ĐẾM. Chênh lệch tính theo số lúc bắt đầu kiểm, nên hàng bán trong lúc kiểm không bị tính sai. */
export function completeStocktake(id) {
  need('manageStock');
  const st = S.get('stocktakes', id); if (!st || st.status !== 'draft') fail('Phiếu kiểm đã hoàn tất hoặc không tồn tại');
  return S.tx(() => {
    const rec = S.mut('stocktakes', id);
    for (const it of rec.items) {
      if (it.counted === null || it.counted === undefined) { it.diff = null; continue; }
      const diff = roundQty(it.counted - it.system); it.diff = diff;
      if (!diff) continue;
      if (diff > 0) stockIn(it.productId, diff, { type: 'stocktake', lot: 'KIEM-KHO', refType: 'stocktake', ref: id, reason: 'Kiểm kho ' + rec.code });
      else {
        const p = S.get('products', it.productId);
        stockOut(it.productId, -diff, { type: 'stocktake', refType: 'stocktake', ref: id, reason: 'Kiểm kho ' + rec.code });
        void p;
      }
    }
    rec.status = 'done'; rec.completedAt = Date.now(); rec.summary = stocktakeSummary(rec);
    log('stocktake', `Hoàn tất kiểm kho ${rec.code}: ${rec.summary.over} thừa, ${rec.summary.short} thiếu`, { ref: id });
    return rec;
  });
}
export function cancelStocktake(id) {
  need('manageStock');
  const st = S.get('stocktakes', id); if (!st) return;
  if (st.status !== 'draft') fail('Chỉ huỷ được phiếu đang kiểm');
  S.tx(() => S.del('stocktakes', id));
}

/* ---------- Truy vấn ---------- */
export function stockMovesOf(productId, limit = 200) {
  // đảo thứ tự chèn trước khi sắp xếp ổn định, để các biến động cùng mili-giây vẫn hiện đúng thứ tự mới nhất trước
  return S.list('stockMoves').filter(m => m.productId === productId).reverse().sort((a, b) => b.ts - a.ts).slice(0, limit);
}
export function inventoryValue() {
  let cost = 0, retail = 0, items = 0;
  for (const p of S.c.products.values()) if (p.stock > 0) { cost += p.stock * (p.cost || 0); retail += p.stock * p.units[0].price; items++; }
  return { cost: rnd(cost), retail: rnd(retail), items };
}
export function batchesOf(productId) {
  return S.list('batches').filter(b => b.productId === productId && b.qty > 0).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
}

let _lastSoldVer = -1, _lastSold = new Map();
export function lastSoldMap() {
  if (_lastSoldVer !== S.ver.sales) {
    _lastSold = new Map();
    for (const s of S.c.sales.values()) if (s.status === 'done') for (const i of s.items) { if ((_lastSold.get(i.productId) || 0) < s.ts) _lastSold.set(i.productId, s.ts); }
    _lastSoldVer = S.ver.sales;
  }
  return _lastSold;
}

/** Cảnh báo kho: sắp hết, hết hàng, sắp hết hạn, đã hết hạn, tồn lâu không bán. */
export function stockAlerts(now = Date.now()) {
  const cfg = settings().stock;
  const today = ymd(now), limit = ymd(now + cfg.expiryWarnDays * DAY);
  const low = [], out = [], dead = [];
  const last = lastSoldMap();
  for (const p of S.c.products.values()) {
    if (!p.active) continue;
    if (p.stock <= 0) out.push(p);
    else if (p.minStock > 0 && p.stock <= p.minStock) low.push(p);
    if (p.stock > 0) {
      const ls = last.get(p.id) || p.createdAt || 0;
      if (now - ls > cfg.deadStockDays * DAY) dead.push({ product: p, days: Math.floor((now - ls) / DAY), value: rnd(p.stock * (p.cost || 0)) });
    }
  }
  const expiring = [], expired = [];
  for (const b of S.c.batches.values()) {
    if (b.qty <= 0 || !b.expiry) continue;
    const p = S.get('products', b.productId); if (!p) continue;
    const item = { batch: b, product: p, daysLeft: Math.ceil((new Date(b.expiry + 'T23:59:59').getTime() - now) / DAY), value: rnd(b.qty * (b.cost || 0)) };
    if (b.expiry < today) expired.push(item); else if (b.expiry <= limit) expiring.push(item);
  }
  expiring.sort((a, b) => a.daysLeft - b.daysLeft); expired.sort((a, b) => a.daysLeft - b.daysLeft);
  dead.sort((a, b) => b.value - a.value);
  return { low, out, expiring, expired, dead };
}

/** Gợi ý đặt hàng theo tồn tối thiểu + tốc độ bán 30 ngày, gom theo nhà cung cấp. */
export function suggestOrders(now = Date.now()) {
  const cover = settings().stock.reorderCoverDays, from = now - 30 * DAY;
  const sold = new Map();
  for (const s of S.c.sales.values()) if (s.status === 'done' && s.ts >= from) for (const i of s.items) sold.set(i.productId, (sold.get(i.productId) || 0) + i.qtyBase);
  const groups = new Map();
  for (const p of S.c.products.values()) {
    if (!p.active) continue;
    const avg = (sold.get(p.id) || 0) / 30;
    if (!(p.stock <= (p.minStock || 0) || (avg > 0 && p.stock < avg * cover))) continue;
    if (!p.minStock && !avg) continue;
    const target = Math.max(p.maxStock || 0, (p.minStock || 0) + avg * cover);
    let need_ = target - p.stock; if (need_ <= 0) continue;
    need_ = p.kind === 'count' ? Math.ceil(need_) : Math.round(need_ * 10) / 10;
    const sid = p.lastSupplierId || '';
    if (!groups.has(sid)) groups.set(sid, { supplier: sid ? S.get('suppliers', sid) : null, items: [] });
    groups.get(sid).items.push({ product: p, need: need_, stock: p.stock, avgDaily: Math.round(avg * 100) / 100, unit: p.units[0].name });
  }
  return Array.from(groups.values()).sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1));
}
export function orderText(group, storeName) {
  const lines = [`ĐẶT HÀNG ${storeName || ''}`.trim(), group.supplier ? `Gửi: ${group.supplier.name}` : '', ''];
  group.items.forEach((x, i) => lines.push(`${i + 1}. ${x.product.name} – ${x.need} ${x.unit}`));
  return lines.filter((l, i) => l !== '' || i > 1).join('\n');
}

/** Điều chỉnh tồn về đúng một số (khi phát hiện lệch ngoài đợt kiểm kho). Trả về chênh lệch. */
export function adjustStock(productId, target, reason) {
  need('manageStock');
  const p = S.get('products', productId); if (!p) fail('Hàng không tồn tại');
  target = roundQty(Number(target));
  if (!(target >= 0)) fail('Tồn kho mới không hợp lệ');
  if (!String(reason || '').trim()) fail('Nhập lý do điều chỉnh');
  return S.tx(() => {
    const before = p.stock, delta = adjustTo(productId, target, { reason: 'Điều chỉnh: ' + String(reason).trim() });
    if (delta) log('adjust', `Điều chỉnh tồn "${p.name}": ${before} → ${target}`, { ref: productId });
    return delta;
  });
}
