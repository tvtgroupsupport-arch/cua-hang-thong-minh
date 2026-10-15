/* Dựng và lưu tệp Excel (.xlsx) có trình bày đẹp từ các "sheet" của engine/exporter.js. Dùng ExcelJS (đóng kèm www/vendor, có phương án CDN),
   mất thư viện thì rơi về CSV để người dùng vẫn có dữ liệu. Tham khảo cách trình bày của app BEPO (tiêu đề, hàng tiêu đề tô màu, zebra, dòng tổng). */
import * as E from './engine/index.js';
import { fmtDate, fmtDateTime, ymd, toCsv } from './util.js';
import { saveFile } from './native.js';
import { ACCENTS, getAccent } from './theme.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let _loading = null;
/** Nạp ExcelJS một lần: ưu tiên bản đóng kèm (chạy offline), không có thì tải từ CDN. */
export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (_loading) return _loading;
  const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('không tải được ' + src)); document.head.appendChild(s); });
  _loading = load('vendor/exceljs.min.js').catch(() => load('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js')).then(() => window.ExcelJS).catch(e => { _loading = null; throw e; });
  return _loading;
}

const argb = hex => 'FF' + hex.replace('#', '').toUpperCase();
const mix = (hex, pct) => { // trộn với trắng: pct = tỷ lệ màu gốc (0..1)
  const n = parseInt(hex.replace('#', ''), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(255 - (255 - v) * pct));
  return 'FF' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
};
const NUMFMT = { money: '#,##0;[Red]-#,##0', int: '#,##0', num: '#,##0.###', pct: '0.0%', date: 'dd/mm/yyyy', datetime: 'dd/mm/yyyy hh:mm', text: '@' };
const isNum = t => ['money', 'int', 'num', 'pct'].includes(t);
const colLetter = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

/** Giá trị ô theo kiểu cột: ngày/giờ → Date, số → Number, còn lại chuỗi. Rỗng → null. */
function cellValue(v, t) {
  if (v === '' || v == null) return null;
  // ExcelJS ghi ngày giờ theo UTC còn Excel hiển thị y nguyên số đó → phải đổi giờ ĐỊA PHƯƠNG thành "giờ UTC giả" (cùng giờ-phút trên đồng hồ), nếu không hoá đơn lúc 02:44 sáng 14/9 sẽ hiện thành 13/09 19:44 ở múi giờ +7.
  if (t === 'date' || t === 'datetime') { if (typeof v !== 'number') return v; const d = new Date(v); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())); }
  if (isNum(t)) return typeof v === 'number' ? v : (Number(v) || 0);
  return String(v);
}

/** Dựng workbook. specs: mảng sheet từ buildReport(). ctx: {store, user, at, rangeLabel, title}. */
export function buildWorkbook(ExcelJS, specs, ctx) {
  const brand = ACCENTS[getAccent()].a1, BRAND = argb(brand), TINT = mix(brand, 0.10), TINT2 = mix(brand, 0.20);
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.store || 'Tạp Hóa'; wb.created = new Date(ctx.at || Date.now()); wb.title = ctx.title || 'Báo cáo';
  const thin = { style: 'thin', color: { argb: 'FFE3E5F6' } }, border = { top: thin, bottom: thin, left: thin, right: thin };
  const used = new Set();

  for (const spec of specs) {
    let name = String(spec.name).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 28), k = 2;
    while (used.has(name.toLowerCase())) name = spec.name.slice(0, 25) + ' ' + k++;
    used.add(name.toLowerCase());
    const cols = spec.columns, n = cols.length;
    const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: BRAND } }, views: [{ showGridLines: false }],
      pageSetup: { orientation: n > 7 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: .4, right: .4, top: .5, bottom: .5, header: .3, footer: .3 } } });
    ws.columns = cols.map(c => ({ width: c.w || 14 }));
    const banner = (row, text, font, h) => { ws.mergeCells(row, 1, row, Math.max(2, n)); const c = ws.getCell(row, 1); c.value = text; c.font = font; c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }; if (h) ws.getRow(row).height = h; return c; };
    // băng tiêu đề: tên cửa hàng + tên báo cáo + kỳ
    banner(1, ctx.store || 'Tạp Hóa', { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } }, 30);
    banner(2, spec.title, { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } }, 22);
    banner(3, `${ctx.rangeLabel || ''}${ctx.rangeLabel ? '   ·   ' : ''}Xuất lúc ${fmtDateTime(ctx.at || Date.now())}${ctx.user ? ' bởi ' + ctx.user : ''}`, { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FFFFFFFF' } }, 18);
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= Math.max(2, n); c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    ws.getRow(4).height = 6;
    let r = 5;
    if (spec.notes && spec.notes.length) { for (const t of spec.notes) { ws.mergeCells(r, 1, r, Math.max(2, n)); const c = ws.getCell(r, 1); c.value = 'ℹ ' + t; c.font = { size: 9.5, italic: true, color: { argb: 'FF6A6E93' } }; c.alignment = { indent: 1, wrapText: true }; r++; } }
    r++;                                                          // dòng trống rồi mới tới bảng

    if (spec.kpi) {
      for (const [label, val, type, bold] of spec.rows) {
        if (type === 'head') {
          ws.mergeCells(r, 1, r, 2); const c = ws.getCell(r, 1); c.value = label; c.font = { bold: true, size: 11, color: { argb: BRAND } };
          for (let i = 1; i <= 2; i++) { ws.getCell(r, i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT2 } }; ws.getCell(r, i).border = border; }
          ws.getRow(r).height = 20; r++; continue;
        }
        const a = ws.getCell(r, 1), b = ws.getCell(r, 2);
        a.value = label; b.value = cellValue(val, type); b.numFmt = NUMFMT[type] || '@'; b.alignment = { horizontal: 'right' };
        a.font = { bold: !!bold, size: bold ? 12 : 11 }; b.font = { bold: !!bold, size: bold ? 12 : 11, color: { argb: typeof val === 'number' && val < 0 ? 'FFD63E5C' : 'FF1C1B3A' } };
        for (const c of [a, b]) { c.border = border; if (bold) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT } }; }
        r++;
      }
      ws.getColumn(1).width = 40; ws.getColumn(2).width = 24;
      continue;
    }

    /* hàng tiêu đề cột */
    const headRow = r;
    ws.views = [{ state: 'frozen', ySplit: headRow, showGridLines: false }];
    cols.forEach((c, i) => {
      const cell = ws.getCell(headRow, i + 1);
      cell.value = c.h; cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: mix(brand, 0.82) } };
      cell.alignment = { horizontal: isNum(c.t) ? 'right' : 'center', vertical: 'middle', wrapText: true }; cell.border = border;
    });
    ws.getRow(headRow).height = 30;
    r++;
    const first = r;
    spec.rows.forEach((row, ri) => {
      const flag = spec.flags[ri], zebra = ri % 2 === 1;
      cols.forEach((c, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = cellValue(row[i], c.t); cell.numFmt = NUMFMT[c.t] || '@'; cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: isNum(c.t) ? 'right' : (c.t === 'date' || c.t === 'datetime') ? 'center' : 'left', wrapText: c.t === 'text' && String(row[i] || '').length > 48 };
        if (flag === 'red') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE3E8' } }; cell.font = { color: { argb: 'FFB4233F' } }; }
        else if (flag === 'amber') { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1CC' } }; cell.font = { color: { argb: 'FF8A5A00' } }; }
        else if (flag === 'void') cell.font = { color: { argb: 'FF9A9DB8' }, strike: true, italic: true };
        else if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT } };
      });
      r++;
    });
    const last = r - 1;
    if (spec.rows.length) ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: n } };
    /* dòng tổng cộng: công thức SUBTOTAL (chạy lại được khi lọc) — hàng đã huỷ không tính */
    const sums = cols.map((c, i) => c.sum ? i : -1).filter(i => i >= 0);
    if (spec.rows.length && sums.length) {
      const tl = ws.getCell(r, 1); tl.value = `TỔNG CỘNG (${spec.rows.filter((_, i) => spec.flags[i] !== 'void').length} dòng)`; tl.font = { bold: true, size: 12, color: { argb: BRAND } };
      for (let i = 0; i < n; i++) { const c = ws.getCell(r, i + 1); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT2 } }; c.border = { top: { style: 'medium', color: { argb: BRAND } }, bottom: { style: 'double', color: { argb: BRAND } } }; }
      for (const i of sums) {
        const L = colLetter(i + 1), c = ws.getCell(r, i + 1);
        const total = spec.rows.reduce((a, row, ri) => a + (spec.flags[ri] === 'void' ? 0 : (Number(row[i]) || 0)), 0);
        const voids = spec.flags.some(f => f === 'void');
        c.value = voids ? total : { formula: `SUBTOTAL(9,${L}${first}:${L}${last})`, result: total };      // có dòng huỷ → giá trị cố định đã loại trừ
        c.numFmt = NUMFMT[cols[i].t]; c.font = { bold: true, size: 12 }; c.alignment = { horizontal: 'right' };
      }
      ws.getRow(r).height = 22; r++;
    }
    if (!spec.rows.length) { ws.mergeCells(r, 1, r, n); const c = ws.getCell(r, 1); c.value = 'Không có dữ liệu trong khoảng đã chọn'; c.font = { italic: true, color: { argb: 'FF9A9DB8' } }; c.alignment = { horizontal: 'center' }; }
    /* độ rộng cột theo nội dung */
    cols.forEach((c, i) => {
      let len = String(c.h).length * 0.9;
      for (const row of spec.rows.slice(0, 400)) { const v = row[i]; const s = c.t === 'money' || c.t === 'int' || c.t === 'num' ? String(Math.round(Math.abs(Number(v) || 0))).length * 1.25 + 2 : (c.t === 'datetime' ? 17 : c.t === 'date' ? 12 : String(v == null ? '' : v).length); if (s > len) len = s; }
      ws.getColumn(i + 1).width = Math.min(48, Math.max(c.w ? Math.min(c.w, 14) : 9, Math.ceil(len) + 2, c.w || 0));
    });
    ws.headerFooter.oddFooter = '&L&8Tạp Hóa&C&8Trang &P / &N&R&8' + ymd(ctx.at || Date.now());
    ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`;
  }
  return wb;
}

/** CSV dự phòng: mỗi sheet một khối, cách nhau một dòng trống. */
export function buildCsv(specs, ctx) {
  const rows = [[ctx.store || 'Tạp Hóa'], [ctx.title || ''], [(ctx.rangeLabel || '') + ' · xuất lúc ' + fmtDateTime(ctx.at || Date.now())]];
  for (const s of specs) {
    rows.push([], [s.title], s.kpi ? ['Chỉ tiêu', 'Giá trị'] : s.columns.map(c => c.h));
    const fmt = (v, t) => (t === 'datetime' && typeof v === 'number') ? fmtDateTime(v) : (t === 'date' && typeof v === 'number') ? fmtDate(v) : (t === 'pct' && typeof v === 'number') ? Math.round(v * 1000) / 10 + '%' : v;
    for (const row of s.rows) rows.push(s.kpi ? (row[2] === 'head' ? [row[0]] : [row[0], fmt(row[1], row[2])]) : row.map((v, i) => fmt(v, s.columns[i].t)));
  }
  return toCsv(rows);
}

const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
export function stampName(base, from, to) {
  const t = new Date(), hm = String(t.getHours()).padStart(2, '0') + String(t.getMinutes()).padStart(2, '0');
  const range = from > 0 && to < Date.now() + 366 * 864e5 ? `${ymd(from)}_${ymd(to)}-` : '';
  return `${slug(base)}-${range}${ymd(Date.now()).replace(/-/g, '')}-${hm}`;
}

/** Xuất các báo cáo đã chọn. opts: {format:'xlsx'|'csv', mode:'share'|'save', from, to, rangeLabel}. Trả {filename, rows, format} hoặc null. */
export async function exportReports(ids, opts = {}) {
  const from = opts.from ?? 0, to = opts.to ?? Date.now();
  const specs = ids.flatMap(id => E.buildReport(id, from, to));
  if (!specs.some(s => s.kpi || s.rows.length)) return { empty: true };
  const meta = E.exportMeta(), titles = ids.map(id => E.REPORTS.find(r => r.id === id).title);
  const ctx = Object.assign({}, meta, { rangeLabel: opts.rangeLabel || '', title: titles.length === 1 ? titles[0] : 'Báo cáo tổng hợp' });
  const base = ids.length === 1 ? E.REPORTS.find(r => r.id === ids[0]).title : 'bao-cao-tong-hop';
  const rowCount = specs.reduce((a, s) => a + (s.kpi ? 0 : s.rows.length), 0);
  let blob, filename, format = opts.format || 'xlsx', fellBack = false;
  if (format === 'xlsx') {
    try {
      const X = await loadExcelJS(), wb = buildWorkbook(X, specs, ctx), buf = await wb.xlsx.writeBuffer();
      blob = new Blob([buf], { type: XLSX_MIME }); filename = stampName(base, from, to) + '.xlsx';
    } catch (e) { console.warn('Dựng Excel thất bại, dùng CSV thay thế:', e); format = 'csv'; fellBack = true; }
  }
  if (format === 'csv') { blob = new Blob([buildCsv(specs, ctx)], { type: 'text/csv;charset=utf-8' }); filename = stampName(base, from, to) + '.csv'; }
  const ok = await saveFile(filename, blob, format === 'xlsx' ? XLSX_MIME : 'text/csv', opts.mode || 'share');
  if (ok === false) return null;
  E.log('export', `Xuất báo cáo ${ids.join(', ')} · ${rowCount} dòng · ${filename}`);
  return { filename, rows: rowCount, format, fellBack, sheets: specs.length };
}
