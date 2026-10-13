/* In tem mã vạch / tem giá: vẽ thành ảnh (canvas) rồi gửi máy in nhiệt (cuộn giấy/tem) hoặc lưu PNG để in bằng app khác. */
import { S } from './store.js';
import { h, modal, toast, field, qtyInput, select, guard } from './ui.js';
import { fmtMoney, fmtNum } from './util.js';
import { encodeAuto } from './lib/barcode.js';
import { PAPER, wrap } from './receipt-image.js';
import { settings } from './engine/index.js';
import { isNative, nb, saveFile, printHtml } from './native.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const MARGIN = 8;

/** Bố cục một tem. measure(text, px, weight) → độ rộng. Trả {ops, height}. Hàm thuần — kiểm thử được. */
export function layoutLabel(measure, { name, price, unitName, code }, W, y0 = 0) {
  const inner = W - MARGIN * 2, ops = []; let y = y0 + 6;
  const lines = wrap(t => measure(t, 22, 700), name, inner).slice(0, 2);
  for (const ln of lines) { ops.push({ t: 'text', text: ln, px: 22, wt: 700, align: 'center', x: W / 2, y }); y += 28; }
  if (price != null) { ops.push({ t: 'text', text: fmtMoney(price) + (unitName ? ' / ' + unitName : ''), px: 30, wt: 800, align: 'center', x: W / 2, y }); y += 38; }
  let enc = null;
  try { enc = encodeAuto(code); } catch (e) { enc = null; }
  if (enc) {
    const mod = Math.max(1, Math.min(3, Math.floor(inner / (enc.bits.length + 20)))), bw = enc.bits.length * mod, x0 = Math.round((W - bw) / 2);
    ops.push({ t: 'bars', bits: enc.bits, mod, x: x0, y, h: 72 }); y += 76;
    ops.push({ t: 'text', text: enc.text, px: 18, wt: 400, align: 'center', x: W / 2, y }); y += 24;
  } else { ops.push({ t: 'text', text: '(chưa có mã vạch)', px: 18, wt: 400, align: 'center', x: W / 2, y }); y += 24; }
  y += 6; ops.push({ t: 'cut', y }); y += 8;
  return { ops, height: y - y0 };
}

export async function renderLabels(items, paperKey) {
  const W = (PAPER[paperKey] || PAPER[58]).dots;
  const probe = document.createElement('canvas').getContext('2d');
  const measure = (t, px, wt) => { probe.font = `${wt} ${px}px ${FONT}`; return probe.measureText(t).width; };
  const all = []; let y = 0;
  for (const it of items) { const l = layoutLabel(measure, it, W, y); all.push(...l.ops); y += l.height; }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.max(40, y + 10);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.fillStyle = '#000'; ctx.textBaseline = 'top';
  for (const op of all) {
    if (op.t === 'text') { ctx.font = `${op.wt} ${op.px}px ${FONT}`; ctx.textAlign = op.align; ctx.fillText(op.text, op.x, op.y); }
    else if (op.t === 'bars') { for (let i = 0; i < op.bits.length; i++) if (op.bits[i] === '1') ctx.fillRect(op.x + i * op.mod, op.y, op.mod, op.h); }
    else if (op.t === 'cut') { ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(MARGIN, op.y + .5); ctx.lineTo(W - MARGIN, op.y + .5); ctx.stroke(); ctx.restore(); }
  }
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  return { dataUrl: cv.toDataURL('image/png'), blob, width: cv.width, height: cv.height };
}

/** Hộp thoại in tem cho một sản phẩm. */
export function labelDialog(product) {
  const units = product.units.filter(u => (u.barcodes || []).length);
  if (!units.length) return toast('Hàng này chưa có mã vạch. Hãy thêm hoặc bấm "Tạo mã" trong màn hình sửa hàng.', 'error', 4000);
  const unit = select(units.map(u => [u.id, `${u.name} — ${u.barcodes[0]}`]), units[0].id), copies = qtyInput(1), withPrice = select([['1', 'Có giá bán'], ['0', 'Chỉ mã vạch']], '1');
  modal({ title: 'In tem – ' + product.name, body: h('div', null, field('Đơn vị / mã vạch', unit), field('Số tem', copies), field('Nội dung', withPrice),
    h('div', { class: 'small muted' }, isNative() ? 'Tem được in qua máy in nhiệt Bluetooth đã chọn trong Cài đặt; chưa có máy in thì lưu ảnh để gửi/in bằng app khác.' : 'Sẽ mở hộp thoại in của trình duyệt.')),
    actions: [{ label: 'Huỷ' }, { label: 'In tem', kind: 'primary', onClick: async () => {
      const n = Math.max(1, Math.min(200, Math.floor(copies.num || 1))), u = product.units.find(x => x.id === unit.value);
      const item = { name: product.name, price: withPrice.value === '1' ? u.price : null, unitName: u.factor === 1 ? '' : u.name, code: u.barcodes[0] };
      const r = await guard(() => printLabels(Array.from({ length: n }, () => item), product.name)); if (r === undefined) return false;
    } }] });
}
export async function printLabels(items, title = 'tem') {
  const cfg = settings().print, img = await renderLabels(items, cfg.paper);
  if (isNative()) {
    if (cfg.printerAddress && nb().printer) {
      try { toast('Đang in tem…'); await nb().printer.printImage(img.dataUrl, (PAPER[cfg.paper] || PAPER[58]).mm, cfg.printerAddress); toast('Đã gửi tem tới máy in', 'ok'); return true; }
      catch (e) { toast('Không in được (' + (e.message || e) + '). Đang lưu ảnh…', 'error', 5000); }
    }
    return saveFile('tem-' + String(title).replace(/[^\w-]+/g, '_').slice(0, 30) + '.png', img.blob, 'image/png');
  }
  printHtml(`<!doctype html><html><body style="margin:0"><img src="${img.dataUrl}" style="width:${cfg.paper - 6}mm"></body></html>`);
  return true;
}
