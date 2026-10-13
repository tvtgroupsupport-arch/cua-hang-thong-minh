/* Tiện ích dùng chung: định dạng, ngày giờ, chuẩn hoá chữ, CSV. Không phụ thuộc DOM. */

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const rnd = n => Math.round(n);
export const roundQty = n => Math.round(n * 1000) / 1000;
/** Làm tròn tới bội số `step` (0/1 = không làm tròn). */
export const roundTo = (x, step) => (!step || step <= 1) ? Math.round(x) : Math.round(x / step) * step;

export function fmtMoney(n) {
  n = Math.round(Number(n) || 0);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + s + 'đ';
}
export function fmtNum(n) {
  n = roundQty(Number(n) || 0);
  const [i, d] = Math.abs(n).toString().split('.');
  return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : '');
}
/** "1.500.000", "1500000đ", "1,5tr"... -> số. Chỉ hiểu chữ số; dấu chấm/phẩy phân cách nghìn bị bỏ. */
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').toLowerCase().trim();
  let mult = 1;
  if (/(tr|triệu)$/.test(s)) { mult = 1e6; s = s.replace(/(tr|triệu)$/, ''); }
  else if (/k$/.test(s)) { mult = 1e3; s = s.slice(0, -1); }
  if (mult > 1) s = s.replace(',', '.'); else s = s.replace(/[.,\s]/g, '');
  const v = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return isNaN(v) ? 0 : Math.round(v * mult);
}
/** Số lượng: chấp nhận dấu phẩy thập phân kiểu Việt. */
export function parseQty(s) {
  if (typeof s === 'number') return s;
  const v = parseFloat(String(s || '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isNaN(v) ? 0 : v;
}

/** Bỏ dấu tiếng Việt, chữ thường — để tìm kiếm không dấu. */
export const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim();

/* ---------- Ngày giờ (giờ địa phương) ---------- */
export const DAY = 86400000;
export const dayStart = (ts = Date.now()) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const dayEnd = ts => dayStart(ts) + DAY - 1;
export const monthStart = (ts = Date.now()) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
export const addMonths = (ts, n) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime(); };
const p2 = n => String(n).padStart(2, '0');
export const ymd = ts => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const fmtDate = ts => { if (!ts) return ''; const d = new Date(ts); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const fmtTime = ts => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fmtDateTime = ts => ts ? `${fmtTime(ts)} ${fmtDate(ts)}` : '';
/** "2025-03-08" (từ <input type=date>) -> mốc đầu ngày địa phương. */
export const parseYmd = s => { if (!s) return 0; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

/** Khoảng thời gian theo tên kỳ. */
export function periodRange(kind, now = Date.now()) {
  const t = dayStart(now);
  switch (kind) {
    case 'today': return { from: t, to: t + DAY - 1, label: 'Hôm nay' };
    case 'yesterday': return { from: t - DAY, to: t - 1, label: 'Hôm qua' };
    case '7d': return { from: t - 6 * DAY, to: t + DAY - 1, label: '7 ngày qua' };
    case '30d': return { from: t - 29 * DAY, to: t + DAY - 1, label: '30 ngày qua' };
    case 'month': return { from: monthStart(now), to: addMonths(now, 1) - 1, label: 'Tháng này' };
    case 'lastmonth': return { from: addMonths(now, -1), to: monthStart(now) - 1, label: 'Tháng trước' };
    case 'year': { const y = new Date(now).getFullYear(); return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime() - 1, label: 'Năm nay' }; }
    default: return { from: t, to: t + DAY - 1, label: 'Hôm nay' };
  }
}

/* ---------- CSV ---------- */
export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** Dựng CSV có BOM để Excel đọc đúng tiếng Việt. */
export function toCsv(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }
/** Đọc CSV (hỗ trợ ngoặc kép, tự nhận dấu , hoặc ; hoặc tab). */
export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

export class AppError extends Error { constructor(msg, code) { super(msg); this.name = 'AppError'; this.code = code; } }
export const fail = (msg, code) => { throw new AppError(msg, code); };

/** Mã vạch EAN-13: kiểm tra chữ số cuối. */
export function ean13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let s = 0; for (let i = 0; i < 12; i++) s += +code[i] * (i % 2 ? 3 : 1);
  return (10 - s % 10) % 10 === +code[12];
}
export function ean13Check(code12) {
  let s = 0; for (let i = 0; i < 12; i++) s += +code12[i] * (i % 2 ? 3 : 1);
  return code12 + ((10 - s % 10) % 10);
}
