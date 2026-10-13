/* Dựng nội dung hoá đơn: văn bản (máy in nhiệt / chia sẻ) và HTML (in qua trình duyệt). */
import { fmtMoney, fmtNum, fmtDateTime } from './util.js';
import { settings } from './engine/index.js';
import { esc } from './ui.js';

export const stripAccents = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const PAY = { cash: 'Tiền mặt', vietqr: 'VietQR', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };

function wrap(text, width) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > width) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
const two = (l, r, w) => { l = String(l); r = String(r); const sp = Math.max(1, w - l.length - r.length); return l + ' '.repeat(sp) + r; };
const center = (t, w) => ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;

/** Mảng dòng chữ cho hoá đơn bán hàng. width: 32 (58mm) | 48 (80mm). */
export function receiptLines(sale, width = 32) {
  const st = settings(), L = [];
  const rule = '-'.repeat(width);
  wrap(st.store.name.toUpperCase(), width).forEach(l => L.push(center(l, width)));
  if (st.store.address) wrap(st.store.address, width).forEach(l => L.push(center(l, width)));
  if (st.store.phone) L.push(center('ĐT: ' + st.store.phone, width));
  L.push(rule, center('HOÁ ĐƠN BÁN HÀNG', width), center(sale.code, width), rule);
  L.push(two('Ngày:', fmtDateTime(sale.ts), width), two('Thu ngân:', sale.staffName, width));
  if (sale.customerName) L.push(two('Khách:', sale.customerName, width));
  L.push(rule);
  for (const i of sale.items) {
    wrap(i.name, width).forEach(l => L.push(l));
    L.push(two(`  ${fmtNum(i.qty)} ${i.unitName} x ${fmtNum(i.price)}`, fmtNum(i.amount), width));
    const disc = i.manualDiscount + i.promoDiscount;
    if (disc) L.push(two('  Giảm giá', '-' + fmtNum(disc), width));
  }
  L.push(rule);
  L.push(two('Tổng tiền hàng:', fmtNum(sale.subtotal), width));
  if (sale.discountTotal) L.push(two('Giảm giá:', '-' + fmtNum(sale.discountTotal), width));
  if (sale.rounding) L.push(two('Làm tròn:', (sale.rounding > 0 ? '+' : '') + fmtNum(sale.rounding), width));
  L.push(two('THANH TOÁN:', fmtNum(sale.total) + 'đ', width), rule);
  for (const p of sale.payments) L.push(two(PAY[p.method] || p.method, fmtNum(p.amount), width));
  if (sale.change > 0) L.push(two('Tiền khách đưa:', fmtNum(sale.cashGiven), width), two('Tiền thừa:', fmtNum(sale.change), width));
  if (sale.debt > 0 && sale.customerName) L.push(two('Còn nợ:', fmtNum(sale.debt), width));
  if (sale.pointsEarned) L.push(two('Điểm tích luỹ:', '+' + sale.pointsEarned, width));
  L.push(rule);
  wrap(st.store.footer || '', width).forEach(l => L.push(center(l, width)));
  return L;
}
export function receiptText(sale, width = 32) { return receiptLines(sale, width).join('\n'); }
/** Dạng không dấu cho máy in nhiệt đời cũ (không có bảng mã tiếng Việt). */
export function receiptThermal(sale, width = 32) { return stripAccents(receiptText(sale, width)); }

export function receiptHtml(sale, paperMm = 58) {
  const st = settings();
  const rows = sale.items.map(i => `<tr><td colspan="2"><b>${esc(i.name)}</b></td></tr><tr><td>${esc(fmtNum(i.qty))} ${esc(i.unitName)} × ${esc(fmtNum(i.price))}</td><td class="r">${esc(fmtNum(i.amount))}</td></tr>` +
    (i.manualDiscount + i.promoDiscount ? `<tr><td>&nbsp;&nbsp;Giảm giá</td><td class="r">-${esc(fmtNum(i.manualDiscount + i.promoDiscount))}</td></tr>` : '')).join('');
  const pays = sale.payments.map(p => `<tr><td>${esc(PAY[p.method] || p.method)}</td><td class="r">${esc(fmtNum(p.amount))}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sale.code)}</title><style>
@page { size: ${paperMm}mm auto; margin: 2mm; }
body { font: 12px/1.35 "Courier New", monospace; width: ${paperMm - 6}mm; margin: 0 auto; color: #000; }
h1 { font-size: 14px; text-align: center; margin: 0 0 2px; } .c { text-align: center; } table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; } .r { text-align: right; white-space: nowrap; }
hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; } .tot td { font-size: 14px; font-weight: bold; }
</style></head><body>
<h1>${esc(st.store.name)}</h1>
<div class="c">${esc(st.store.address)}${st.store.phone ? '<br>ĐT: ' + esc(st.store.phone) : ''}</div><hr>
<div class="c"><b>HOÁ ĐƠN BÁN HÀNG</b><br>${esc(sale.code)}</div>
<table><tr><td>Ngày</td><td class="r">${esc(fmtDateTime(sale.ts))}</td></tr><tr><td>Thu ngân</td><td class="r">${esc(sale.staffName)}</td></tr>${sale.customerName ? `<tr><td>Khách</td><td class="r">${esc(sale.customerName)}</td></tr>` : ''}</table><hr>
<table>${rows}</table><hr>
<table><tr><td>Tổng tiền hàng</td><td class="r">${esc(fmtNum(sale.subtotal))}</td></tr>
${sale.discountTotal ? `<tr><td>Giảm giá</td><td class="r">-${esc(fmtNum(sale.discountTotal))}</td></tr>` : ''}
${sale.rounding ? `<tr><td>Làm tròn</td><td class="r">${esc(fmtNum(sale.rounding))}</td></tr>` : ''}
<tr class="tot"><td>THANH TOÁN</td><td class="r">${esc(fmtMoney(sale.total))}</td></tr></table><hr>
<table>${pays}${sale.change > 0 ? `<tr><td>Khách đưa</td><td class="r">${esc(fmtNum(sale.cashGiven))}</td></tr><tr><td>Tiền thừa</td><td class="r">${esc(fmtNum(sale.change))}</td></tr>` : ''}
${sale.debt > 0 && sale.customerName ? `<tr><td>Còn nợ</td><td class="r">${esc(fmtNum(sale.debt))}</td></tr>` : ''}</table><hr>
<div class="c">${esc(st.store.footer || '')}</div></body></html>`;
}

/** Biên bản chốt ca dạng văn bản. */
export function shiftText(sh) {
  const r = sh.report, st = settings();
  return [`${st.store.name} – BIÊN BẢN CHỐT CA`, `Thu ngân: ${sh.staffName}`, `Mở: ${fmtDateTime(sh.openAt)}  Chốt: ${fmtDateTime(sh.closeAt)}`, '',
    `Số hoá đơn: ${r.bills}`, `Doanh thu: ${fmtMoney(r.revenue)}`, `  - Tiền mặt: ${fmtMoney(r.saleCash)}`, `  - Chuyển khoản: ${fmtMoney(r.saleBank)}`, `  - Ghi nợ: ${fmtMoney(r.debtSold)}`, '',
    `Tiền đầu ca: ${fmtMoney(sh.openingCash)}`, `Thu nợ khách (tiền mặt): ${fmtMoney(r.debtCollectedCash)}`, `Hoàn trả khách: ${fmtMoney(r.refundsCash)}`,
    `Thu khác: ${fmtMoney(r.entriesIn)}  Chi: ${fmtMoney(r.entriesOut + r.otherCashOut)}`, `Tiền mặt phải có: ${fmtMoney(sh.expectedCash)}`,
    `Tiền đếm thực tế: ${fmtMoney(sh.countedCash)}`, `Chênh lệch: ${fmtMoney(sh.diff)}`, sh.note ? `Ghi chú: ${sh.note}` : ''].filter(x => x !== undefined).join('\n');
}
