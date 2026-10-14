/* Lõi biến động kho. Mọi thay đổi tồn đều đi qua đây để luôn có "thẻ kho" (stockMoves) và lô (batches) khớp nhau.
   Số lượng ở đây luôn tính theo ĐƠN VỊ CƠ BẢN. Phải gọi bên trong S.tx(). */
import { S } from '../store.js';
import { roundQty, fail } from '../util.js';

function sortedBatches(productId) {
  return S.list('batches').filter(b => b.productId === productId && b.qty > 0)
    .sort((a, b) => ((a.expiry || '9999') < (b.expiry || '9999') ? -1 : (a.expiry || '9999') > (b.expiry || '9999') ? 1 : a.createdAt - b.createdAt));
}

/** Nhập kho. type: opening|purchase|return_in|adjust|stocktake|cancel. retAlloc: trả lại đúng các lô đã xuất. */
export function stockIn(productId, qty, o = {}) {
  if (!(qty > 0)) fail('Số lượng nhập phải lớn hơn 0');
  const p = S.mutD('products', productId);
  p.stock = roundQty(p.stock + qty);
  const batchIds = [];
  if (p.trackBatch) {
    if (o.retAlloc && o.retAlloc.length) {
      let left = qty;
      for (const a of o.retAlloc) {
        const b = S.get('batches', a.batchId); const q = Math.min(left, a.qty);
        if (b && q > 0) { S.mutD('batches', b.id).qty = roundQty(b.qty + q); batchIds.push({ batchId: b.id, qty: q }); left = roundQty(left - q); }
      }
      if (left > 0) batchIds.push(...addToBatch(p, left, o));
    } else batchIds.push(...addToBatch(p, qty, o));
  }
  const m = S.add('stockMoves', {
    productId, ts: o.ts || Date.now(), type: o.type || 'adjust', qty, after: p.stock, cost: o.cost == null ? p.cost : o.cost,
    alloc: batchIds, ref: o.ref || null, refType: o.refType || null, reason: o.reason || '', staffId: S.session.staffId
  });
  return m;
}
function addToBatch(p, qty, o) {
  const lot = o.lot || '', expiry = o.expiry || null;
  let b = S.list('batches').find(x => x.productId === p.id && x.lot === lot && (x.expiry || null) === expiry);
  if (b) { b = S.mutD('batches', b.id); b.qty = roundQty(b.qty + qty); b.qtyIn = roundQty((b.qtyIn || 0) + qty); }
  else b = S.add('batches', { productId: p.id, lot, expiry, qty, qtyIn: qty, cost: o.cost == null ? p.cost : o.cost, source: o.type || 'adjust', ref: o.ref || null });
  return [{ batchId: b.id, qty }];
}

/** Xuất kho. Trả về mảng phân bổ lô [{batchId, qty}] (rỗng nếu không theo dõi lô).
    batchId: bắt buộc lấy đúng lô đó. Tồn có thể âm (kiểm tra cho phép/không do nơi gọi). */
export function stockOut(productId, qty, o = {}) {
  if (!(qty > 0)) fail('Số lượng xuất phải lớn hơn 0');
  const p = S.mutD('products', productId);
  p.stock = roundQty(p.stock - qty);
  const alloc = [];
  if (p.trackBatch) {
    let left = qty;
    const pool = o.batchId ? [S.get('batches', o.batchId)].filter(b => b && b.productId === productId && b.qty > 0) : sortedBatches(productId);
    for (const b of pool) {
      if (left <= 0) break;
      const q = Math.min(left, b.qty);
      S.mutD('batches', b.id).qty = roundQty(b.qty - q);
      alloc.push({ batchId: b.id, qty: q, cost: b.cost }); left = roundQty(left - q);
    }
  }
  S.add('stockMoves', {
    productId, ts: o.ts || Date.now(), type: o.type || 'adjust', qty: -qty, after: p.stock, cost: p.cost, alloc: alloc.map(a => ({ batchId: a.batchId, qty: a.qty })),
    ref: o.ref || null, refType: o.refType || null, reason: o.reason || '', staffId: S.session.staffId
  });
  return alloc;
}

/** Đặt tồn về đúng `target` (kiểm kho/điều chỉnh). Trả về chênh lệch (có dấu). */
export function adjustTo(productId, target, o = {}) {
  const p = S.get('products', productId);
  const delta = roundQty(target - p.stock);
  if (delta > 0) stockIn(productId, delta, Object.assign({ type: 'adjust' }, o, { lot: o.lot || 'DIEU-CHINH' }));
  else if (delta < 0) stockOut(productId, -delta, Object.assign({ type: 'adjust' }, o));
  return delta;
}
