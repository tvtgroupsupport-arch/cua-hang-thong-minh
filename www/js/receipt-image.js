/* Hoá đơn dạng ẢNH — in máy in nhiệt Bluetooth, hoặc lưu/chia sẻ PNG khi chưa có máy in.
   Vì sao là ảnh: phần lớn máy in nhiệt giá rẻ không có bảng mã tiếng Việt, in chữ bằng lệnh ESC/POS sẽ vỡ dấu (bài học từ app BEPO).
   Ảnh vẽ bằng canvas với phông của điện thoại nên dấu luôn đúng. Bố cục (layoutReceipt) là hàm thuần nên kiểm thử được không cần canvas. */
import { fmtMoney, fmtNum, fmtDateTime } from './util.js';
import { settings } from './engine/index.js';

export const PAPER = {
  58: { dots: 384, mm: 48, font: 22 },   // giấy 58mm: vùng in ~48mm = 384 điểm (203dpi)
  80: { dots: 576, mm: 72, font: 24 }
};
const MARGIN = 6;
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const PAY = { cash: 'Tiền mặt', vietqr: 'VietQR', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };

/** Tách chữ thành các dòng vừa bề rộng maxW; từ quá dài thì cắt theo ký tự. */
export function wrap(measure, text, maxW) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    if (measure(w) > maxW) {
      if (cur) { lines.push(cur); cur = ''; }
      let piece = '';
      for (const ch of w) { if (measure(piece + ch) > maxW && piece) { lines.push(piece); piece = ch; } else piece += ch; }
      cur = piece; continue;
    }
    const next = cur ? cur + ' ' + w : w;
    if (measure(next) <= maxW) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Mô hình hoá đơn (chuỗi đã định dạng sẵn) từ một hoá đơn bán hàng. */
export function modelFromSale(sale) {
  const st = settings(), rows = [{ label: 'Tổng tiền hàng', value: fmtMoney(sale.subtotal) }];
  if (sale.discountTotal) rows.push({ label: 'Giảm giá', value: '−' + fmtMoney(sale.discountTotal) });
  if (sale.rounding) rows.push({ label: 'Làm tròn', value: (sale.rounding > 0 ? '+' : '−') + fmtMoney(Math.abs(sale.rounding)) });
  rows.push({ label: 'THANH TOÁN', value: fmtMoney(sale.total), big: true });
  for (const p of sale.payments) rows.push({ label: PAY[p.method] || p.method, value: fmtMoney(p.amount) });
  if (sale.change > 0) { rows.push({ label: 'Khách đưa', value: fmtMoney(sale.cashGiven) }, { label: 'Tiền thừa', value: fmtMoney(sale.change), bold: true }); }
  if (sale.debt > 0 && sale.customerName) rows.push({ label: 'Còn nợ', value: fmtMoney(sale.debt), bold: true });
  if (sale.pointsEarned) rows.push({ label: 'Điểm tích luỹ', value: '+' + sale.pointsEarned });
  return {
    shop: st.store.name, address: st.store.address, phone: st.store.phone ? 'ĐT: ' + st.store.phone : '', title: 'HOÁ ĐƠN BÁN HÀNG',
    meta: [['Mã HĐ', sale.code], ['Thời gian', fmtDateTime(sale.ts)], ['Thu ngân', sale.staffName], ...(sale.customerName ? [['Khách', sale.customerName]] : [])],
    items: sale.items.map(i => {
      const disc = i.manualDiscount + i.promoDiscount;
      return { name: i.name, qty: fmtNum(i.qty) + ' ' + i.unitName, unit: fmtNum(i.price), amount: fmtNum(i.amount), note: disc ? 'Giảm ' + fmtNum(disc) : '' };
    }),
    rows, footer: st.store.footer || ''
  };
}

/** Dựng danh sách lệnh vẽ + chiều cao. measure(text, px, weight) → bề rộng px. */
export function layoutReceipt(measure, model, paperKey) {
  const P = PAPER[paperKey] || PAPER[58], W = P.dots, F = P.font, inner = W - MARGIN * 2;
  const ops = []; let y = 6;
  const m = (px, wt) => t => measure(t, px, wt);
  const lh = px => Math.round(px * 1.28);
  const text = (t, px, wt, align, extra) => { ops.push(Object.assign({ t: 'text', text: t, px, wt, align: align || 'left', y }, extra || {})); };
  const para = (t, px, wt, align) => { for (const ln of wrap(m(px, wt), t, inner)) { text(ln, px, wt, align); y += lh(px); } };
  const sep = () => { y += 4; ops.push({ t: 'line', y }); y += 8; };

  if (model.shop) para(model.shop, Math.round(F * 1.3), 800, 'center');
  if (model.address) para(model.address, Math.round(F * 0.82), 400, 'center');
  if (model.phone) para(model.phone, Math.round(F * 0.82), 400, 'center');
  sep();
  para(model.title, Math.round(F * 1.12), 800, 'center'); y += 2;
  for (const [k, v] of (model.meta || [])) para(`${k}: ${v}`, F * 0.92, 400, 'left');
  sep();
  for (const it of model.items) {
    para(it.name, F, 700, 'left');
    if (it.note) para('  · ' + it.note, Math.round(F * 0.8), 400, 'left');
    const px = Math.round(F * 0.95);
    text(`${it.qty} x ${it.unit}`, px, 400, 'left', { x: MARGIN + Math.round(F * 0.6) });
    text(it.amount, px, 400, 'right');
    y += lh(px) + 3;
  }
  sep();
  for (const r of model.rows) {
    const px = r.big ? Math.round(F * 1.3) : F, wt = r.bold || r.big ? 800 : 400;
    if (measure(r.label, px, wt) + measure(r.value, px, wt) + 12 > inner) { para(r.label, px, wt, 'left'); text(r.value, px, wt, 'right'); y += lh(px); }
    else { text(r.label, px, wt, 'left'); text(r.value, px, wt, 'right'); y += lh(px) + (r.big ? 4 : 0); }
  }
  if (model.footer) { sep(); para(model.footer, Math.round(F * 0.9), 400, 'center'); }
  y += 18;
  return { ops, height: y, width: W, paper: P };
}

/** Vẽ lên canvas → { dataUrl (PNG), blob, width, height, mmH }. */
export async function renderModel(model, paperKey) {
  const P = PAPER[paperKey] || PAPER[58];
  const probe = document.createElement('canvas').getContext('2d');
  const fontOf = (px, wt) => `${wt} ${px}px ${FONT_STACK}`;
  const measure = (t, px, wt) => { probe.font = fontOf(px, wt); return probe.measureText(t).width; };
  const lay = layoutReceipt(measure, model, paperKey);
  const cv = document.createElement('canvas'); cv.width = lay.width; cv.height = lay.height;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  for (const op of lay.ops) {
    if (op.t === 'line') {
      ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(MARGIN, op.y + 0.5); ctx.lineTo(cv.width - MARGIN, op.y + 0.5); ctx.stroke(); ctx.restore();
    } else {
      ctx.font = fontOf(op.px, op.wt);
      ctx.textAlign = op.align === 'center' ? 'center' : op.align === 'right' ? 'right' : 'left';
      const x = op.align === 'center' ? cv.width / 2 : op.align === 'right' ? cv.width - MARGIN : (op.x != null ? op.x : MARGIN);
      ctx.fillText(op.text, x, op.y);
    }
  }
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  return { dataUrl: cv.toDataURL('image/png'), blob, width: cv.width, height: cv.height, mmH: cv.height * (P.mm / P.dots) };
}
export const renderSale = (sale, paperKey) => renderModel(modelFromSale(sale), paperKey);
