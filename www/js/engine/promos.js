/* Khuyến mãi: định nghĩa, kiểm tra hiệu lực, tính giảm giá cho giỏ hàng (không ghi dữ liệu). */
import { S } from '../store.js';
import { fail, rnd, ymd, norm } from '../util.js';
import { need, log } from './auth.js';

export const PROMO_TYPES = {
  percent: 'Giảm theo %',
  amount: 'Giảm số tiền',
  buyxgety: 'Mua X tặng Y',
  combo: 'Combo giá cố định'
};
export const PROMO_SCOPES = { all: 'Cả đơn hàng', product: 'Sản phẩm chọn', category: 'Nhóm hàng chọn' };

export function savePromo(d) {
  need('managePromos');
  const name = String(d.name || '').trim(); if (!name) fail('Nhập tên chương trình khuyến mãi');
  if (!PROMO_TYPES[d.type]) fail('Chọn loại khuyến mãi');
  const p = {
    name, type: d.type, scope: d.type === 'combo' ? 'product' : (PROMO_SCOPES[d.scope] ? d.scope : 'all'),
    productIds: d.productIds || [], categoryIds: d.categoryIds || [], value: Number(d.value) || 0,
    minTotal: Math.max(0, rnd(d.minTotal || 0)), minQty: Math.max(0, Number(d.minQty) || 0),
    buyQty: Math.max(0, Math.floor(d.buyQty || 0)), getQty: Math.max(0, Math.floor(d.getQty || 0)),
    comboItems: (d.comboItems || []).filter(c => c.productId && c.qty > 0), comboPrice: Math.max(0, rnd(d.comboPrice || 0)),
    code: String(d.code || '').trim().toUpperCase(), from: d.from || '', to: d.to || '', days: d.days || [],
    hourFrom: d.hourFrom || '', hourTo: d.hourTo || '', groups: d.groups || [], limit: Math.max(0, Math.floor(d.limit || 0)), active: d.active !== false
  };
  if (p.from && p.to && p.from > p.to) fail('Ngày kết thúc phải sau ngày bắt đầu');
  if (p.type === 'percent' && !(p.value > 0 && p.value <= 100)) fail('Phần trăm giảm phải từ 0 đến 100');
  if (p.type === 'amount' && !(p.value > 0)) fail('Số tiền giảm phải lớn hơn 0');
  if (p.type === 'buyxgety' && !(p.buyQty > 0 && p.getQty > 0)) fail('Nhập số lượng mua và số lượng tặng');
  if (p.type === 'combo') {
    if (p.comboItems.length < 2) fail('Combo cần ít nhất 2 mặt hàng');
    if (!p.comboPrice) fail('Nhập giá combo');
  } else if (p.scope === 'product' && !p.productIds.length) fail('Chọn sản phẩm áp dụng');
  else if (p.scope === 'category' && !p.categoryIds.length) fail('Chọn nhóm hàng áp dụng');
  if (p.type !== 'percent' && p.type !== 'amount' && p.scope === 'all') p.scope = 'product';
  return S.tx(() => {
    const r = d.id ? Object.assign(S.mut('promos', d.id), p) : S.add('promos', Object.assign(p, { used: 0 }));
    log('promo', `Lưu khuyến mãi "${p.name}"`);
    return r;
  });
}
export function deletePromo(id) { need('managePromos'); S.tx(() => S.del('promos', id)); }

/** KM đang hiệu lực tại `now` cho khách (nhóm) này. */
export function activePromos(now = Date.now(), customer = null, voucher = '') {
  const d = new Date(now), today = ymd(now), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const code = String(voucher || '').trim().toUpperCase();
  return S.list('promos').filter(p => {
    if (!p.active) return false;
    if (p.from && today < p.from) return false;
    if (p.to && today > p.to) return false;
    if (p.days && p.days.length && !p.days.includes(d.getDay())) return false;
    if (p.hourFrom && hm < p.hourFrom) return false;
    if (p.hourTo && hm > p.hourTo) return false;
    if (p.groups && p.groups.length && !(customer && p.groups.includes(customer.group))) return false;
    if (p.limit > 0 && (p.used || 0) >= p.limit) return false;
    if (p.code && p.code !== code) return false;
    return true;
  });
}
export function promoStatus(p, now = Date.now()) {
  const today = ymd(now);
  if (!p.active) return 'Tạm tắt';
  if (p.to && today > p.to) return 'Đã hết hạn';
  if (p.from && today < p.from) return 'Chưa bắt đầu';
  if (p.limit > 0 && (p.used || 0) >= p.limit) return 'Hết lượt';
  return 'Đang chạy';
}

function lineMatches(p, line, prod) {
  if (p.scope === 'product') return p.productIds.includes(line.productId);
  if (p.scope === 'category') {
    if (!prod) return false;
    let c = prod.categoryId;
    while (c) { if (p.categoryIds.includes(c)) return true; const cat = S.get('categories', c); c = cat && cat.parentId; }
    return false;
  }
  return false;
}

/** Giảm giá cho MỘT dòng bởi một KM cấp dòng. line: {productId, qty, price, amount} (qty theo đơn vị đang bán). */
export function lineDiscount(p, line, prod) {
  if (p.scope === 'all' || p.type === 'combo' || !lineMatches(p, line, prod)) return 0;
  if (p.minQty && line.qty < p.minQty) return 0;
  let d = 0;
  if (p.type === 'percent') d = line.amount * p.value / 100;
  else if (p.type === 'amount') d = p.value * line.qty;
  else if (p.type === 'buyxgety') {
    const set = p.buyQty + p.getQty, sets = Math.floor(line.qty / set + 1e-9);
    d = sets * p.getQty * line.price;
  }
  return Math.min(rnd(d), line.amount);
}

/** Giảm giá cấp đơn (KM theo cả đơn + combo). lines: dòng đã tính; base: tổng sau khi trừ KM cấp dòng. */
export function orderDiscounts(promos, lines, base) {
  const out = [];
  for (const p of promos) {
    if (p.type === 'combo') {
      const need = p.comboItems; if (!need.length) continue;
      const have = id => lines.filter(l => l.productId === id).reduce((s, l) => s + l.qtyBase, 0);
      const n = Math.min(...need.map(c => Math.floor(have(c.productId) / c.qty + 1e-9)));
      if (!(n > 0)) continue;
      const listSum = need.reduce((s, c) => { const pr = S.get('products', c.productId); return s + (pr ? pr.units[0].price : 0) * c.qty; }, 0);
      const d = (listSum - p.comboPrice) * n;
      if (d > 0) out.push({ promo: p, amount: rnd(d) });
    } else if ((p.type === 'percent' || p.type === 'amount') && p.scope === 'all') {
      if (p.minTotal && base < p.minTotal) continue;
      const d = p.type === 'percent' ? base * p.value / 100 : p.value;
      if (d > 0) out.push({ promo: p, amount: Math.min(rnd(d), base) });
    }
  }
  return out;
}
export const promoSummary = p => {
  const scope = p.type === 'combo' ? 'Combo' : (p.scope === 'all' ? 'Cả đơn' : p.scope === 'product' ? `${p.productIds.length} sản phẩm` : `${p.categoryIds.length} nhóm`);
  const val = p.type === 'percent' ? `-${p.value}%` : p.type === 'amount' ? `-${p.value.toLocaleString('vi-VN')}đ` : p.type === 'buyxgety' ? `Mua ${p.buyQty} tặng ${p.getQty}` : `Giá ${p.comboPrice.toLocaleString('vi-VN')}đ`;
  return `${scope} · ${val}${p.code ? ' · Mã ' + p.code : ''}`;
};
