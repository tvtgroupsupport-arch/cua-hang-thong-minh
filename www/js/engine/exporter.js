/* Dữ liệu xuất báo cáo: mỗi báo cáo trả về một hoặc nhiều "sheet" mô tả bằng dữ liệu thuần (không dính ExcelJS/DOM) để kiểm thử được.
   Sheet = { name, title, columns:[{h, t, w?, sum?}], rows:[[...]], flags?:[null|'void'|'red'|'amber'], notes?:[], kpi?:true }
   Kiểu cột t: text | int | num | money | pct | date | datetime. Ngày/giờ là mốc ms; pct là số 0..1.
   Với sheet kpi (bảng chỉ tiêu 2 cột) mỗi dòng là [nhãn, giá trị, kiểu, đậm?]. */
import { S } from '../store.js';
import { rnd, fmtDate } from '../util.js';
import { can, currentUser, settings } from './auth.js';
import { summary, series, byStaff, byHour, productStats, categoryStats, stockInOut, debtReport, lossReport } from './reports.js';
import { cashFlows } from './cash.js';
import { categoryPath } from './products.js';
import { WRITEOFF_REASONS } from './inventory.js';

const PAY = { cash: 'Tiền mặt', vietqr: 'VietQR', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };
const inR = (ts, f, t) => ts >= f && ts <= t;
const cost = () => can('viewCost');

/** Danh sách báo cáo cho màn hình xuất: id, tên, mô tả, biểu tượng, màu (class t0..t7), có theo kỳ không, quyền. */
export const REPORTS = [
  { id: 'overview', title: 'Tổng hợp kinh doanh', desc: 'Doanh thu, lợi nhuận, chi phí, theo ngày & thu ngân', icon: 'chart', tint: 't0', ranged: true, perm: () => can('viewReports') },
  { id: 'sales', title: 'Danh sách hoá đơn', desc: 'Từng hoá đơn: khách, thu ngân, hình thức thanh toán', icon: 'receipt', tint: 't3', ranged: true, perm: () => can('viewReports') || can('sell') },
  { id: 'saleLines', title: 'Chi tiết hàng đã bán', desc: 'Từng dòng hàng trong hoá đơn, giá vốn & lãi', icon: 'list', tint: 't6', ranged: true, perm: () => can('viewReports') },
  { id: 'products', title: 'Bán theo sản phẩm', desc: 'Số lượng, doanh thu, lợi nhuận từng mặt hàng & nhóm hàng', icon: 'trend', tint: 't2', ranged: true, perm: () => can('viewReports') },
  { id: 'inventory', title: 'Tồn kho hiện tại', desc: 'Số dư, giá trị tồn, cảnh báo sắp hết', icon: 'warehouse', tint: 't1', ranged: false, perm: () => can('viewReports') || can('manageStock') },
  { id: 'inout', title: 'Nhập – xuất – tồn', desc: 'Tồn đầu, nhập, xuất, tồn cuối theo kỳ', icon: 'box', tint: 't4', ranged: true, perm: () => can('viewReports') || can('manageStock') },
  { id: 'purchases', title: 'Phiếu nhập hàng', desc: 'Nhập từ nhà cung cấp, đã trả & còn nợ', icon: 'truck', tint: 't7', ranged: true, perm: () => can('manageStock') || can('viewReports') },
  { id: 'debts', title: 'Công nợ', desc: 'Khách đang nợ & nợ nhà cung cấp, tuổi nợ', icon: 'users', tint: 't5', ranged: false, perm: () => can('viewReports') || can('manageCustomers') },
  { id: 'cashbook', title: 'Sổ quỹ', desc: 'Dòng tiền mặt & ngân hàng', icon: 'wallet', tint: 't3', ranged: true, perm: () => can('cashbook') || can('viewReports') },
  { id: 'loss', title: 'Hao hụt & xuất hủy', desc: 'Hàng hủy, chênh lệch kiểm kho, trả hàng hỏng', icon: 'trash', tint: 't2', ranged: true, perm: () => can('viewReports') || can('manageStock') },
  { id: 'catalog', title: 'Danh mục hàng hóa', desc: 'Toàn bộ sản phẩm, mã vạch, giá bán — nhập lại được bằng CSV', icon: 'tag', tint: 't6', ranged: false, perm: () => can('manageProducts') || can('viewReports') },
  { id: 'logs', title: 'Nhật ký hoạt động', desc: 'Ai làm gì, lúc nào', icon: 'clock', tint: 't4', ranged: true, perm: () => can('settings') || can('manageStaff') }
];
export const availableReports = () => REPORTS.filter(r => r.perm());

/* ---------------- Dựng sheet ---------------- */
function salesRows(from, to) {
  return S.list('sales').filter(s => inR(s.ts, from, to)).sort((a, b) => a.ts - b.ts);
}
const payOf = (s, m) => s.payments.filter(p => (m === 'bank' ? ['vietqr', 'transfer'].includes(p.method) : p.method === m)).reduce((a, p) => a + p.amount, 0);

const BUILD = {
  overview(from, to) {
    const m = summary(from, to), prev = summary(from - (to - from + 1), from - 1), sheets = [];
    const k = [
      ['KẾT QUẢ KINH DOANH', '', 'head'],
      ['Số hoá đơn', m.bills, 'int'], ['Giá trị trung bình / hoá đơn', m.avgBill, 'money'], ['Tổng tiền hàng (trước trả hàng)', m.gross, 'money'], ['Hàng khách trả lại', -m.returns, 'money'],
      ['Doanh thu thuần', m.revenue, 'money', true], ['Doanh thu kỳ trước (cùng độ dài)', prev.revenue, 'money'], ['Tăng/giảm so với kỳ trước', prev.revenue ? (m.revenue - prev.revenue) / prev.revenue : 0, 'pct'],
      ['Tổng giảm giá đã cho', m.discount, 'money']
    ];
    if (cost()) k.push(['LỢI NHUẬN', '', 'head'], ['Giá vốn hàng bán', m.cogs, 'money'], ['Lợi nhuận gộp', m.grossProfit, 'money', true], ['Biên lợi nhuận gộp', m.margin, 'pct'],
      ['Chi phí hoạt động (sổ quỹ)', -m.expenses, 'money'], ['Thu nhập khác', m.otherIncome, 'money'], ['Hàng hủy', -m.writeOff, 'money'], ['Hao hụt kiểm kho', -m.stocktakeLoss, 'money'], ['Lãi ròng ước tính', m.netProfit, 'money', true]);
    k.push(['THU TIỀN THEO HÌNH THỨC', '', 'head'], ['Tiền mặt', m.pay.cash, 'money'], ['Chuyển khoản / VietQR', m.pay.bank, 'money'], ['Ghi nợ (chưa thu)', m.pay.debt, 'money']);
    sheets.push({ name: 'Tổng quan', title: 'Tổng hợp kinh doanh', kpi: true, columns: [{ h: 'Chỉ tiêu', t: 'text', w: 38 }, { h: 'Giá trị', t: 'money', w: 22 }], rows: k });
    const s = series(from, to);
    sheets.push({ name: 'Theo ngày', title: s.monthly ? 'Doanh thu theo tháng' : 'Doanh thu theo ngày', columns: [{ h: s.monthly ? 'Tháng' : 'Ngày', t: 'text', w: 14 }, { h: 'Số hoá đơn', t: 'int', sum: true }, { h: 'Doanh thu (đ)', t: 'money', sum: true }, ...(cost() ? [{ h: 'Lợi nhuận gộp (đ)', t: 'money', sum: true }] : [])],
      rows: s.points.map(p => [p.key, p.bills, p.revenue, ...(cost() ? [p.profit] : [])]) });
    const st = byStaff(from, to);
    sheets.push({ name: 'Theo thu ngân', title: 'Doanh thu theo thu ngân', columns: [{ h: 'Thu ngân', t: 'text', w: 24 }, { h: 'Số hoá đơn', t: 'int', sum: true }, { h: 'Doanh thu (đ)', t: 'money', sum: true }, ...(cost() ? [{ h: 'Lợi nhuận gộp (đ)', t: 'money', sum: true }] : [])], rows: st.map(r => [r.name, r.bills, r.revenue, ...(cost() ? [r.profit] : [])]) });
    sheets.push({ name: 'Theo giờ', title: 'Giờ cao điểm', columns: [{ h: 'Khung giờ', t: 'text', w: 14 }, { h: 'Số hoá đơn', t: 'int', sum: true }, { h: 'Doanh thu (đ)', t: 'money', sum: true }], rows: byHour(from, to).filter(h => h.bills).map(h => [`${String(h.hour).padStart(2, '0')}:00 – ${String(h.hour + 1).padStart(2, '0')}:00`, h.bills, h.revenue]) });
    return sheets;
  },
  sales(from, to) {
    const list = salesRows(from, to);
    return [{
      name: 'Hoá đơn', title: 'Danh sách hoá đơn bán hàng', notes: ['Hoá đơn đã huỷ hiển thị mờ và không tính vào tổng.'],
      columns: [{ h: 'Mã HĐ', t: 'text', w: 16 }, { h: 'Thời gian', t: 'datetime' }, { h: 'Thu ngân', t: 'text' }, { h: 'Khách hàng', t: 'text', w: 22 }, { h: 'Số mặt hàng', t: 'int', sum: true }, { h: 'Tổng tiền hàng (đ)', t: 'money', sum: true }, { h: 'Giảm giá (đ)', t: 'money', sum: true },
        { h: 'Tổng tiền (đ)', t: 'money', sum: true }, { h: 'Tiền mặt (đ)', t: 'money', sum: true }, { h: 'Chuyển khoản (đ)', t: 'money', sum: true }, { h: 'Ghi nợ (đ)', t: 'money', sum: true }, { h: 'Hoàn trả (đ)', t: 'money', sum: true }, { h: 'Trạng thái', t: 'text' }],
      rows: list.map(s => [s.code, s.ts, s.staffName, s.customerName || 'Khách lẻ', s.items.length, s.subtotal, s.discountTotal, s.total, payOf(s, 'cash'), payOf(s, 'bank'), payOf(s, 'debt'), s.returnedTotal || 0, s.status === 'done' ? 'Hoàn thành' : 'Đã huỷ']),
      flags: list.map(s => s.status === 'done' ? null : 'void')
    }];
  },
  saleLines(from, to) {
    const rows = [], flags = [];
    for (const s of salesRows(from, to)) for (const i of s.items) {
      const net = i.net - i.returnedAmount, c = i.costAmount - (i.returnedCost || 0);
      rows.push([s.code, s.ts, s.customerName || 'Khách lẻ', i.name, i.sku, i.unitName, i.qty - i.returnedQty, i.price, i.amount, i.manualDiscount + i.promoDiscount, net, ...(cost() ? [c, net - c] : [])]);
      flags.push(s.status === 'done' ? null : 'void');
    }
    return [{
      name: 'Chi tiết bán hàng', title: 'Chi tiết hàng đã bán', notes: ['Số lượng và thực thu đã trừ phần khách trả lại; dòng của hoá đơn đã huỷ mờ đi và không tính tổng.'],
      columns: [{ h: 'Mã HĐ', t: 'text', w: 16 }, { h: 'Thời gian', t: 'datetime' }, { h: 'Khách hàng', t: 'text', w: 20 }, { h: 'Sản phẩm', t: 'text', w: 34 }, { h: 'SKU', t: 'text' }, { h: 'Đơn vị', t: 'text', w: 10 }, { h: 'Số lượng', t: 'num', sum: true }, { h: 'Đơn giá (đ)', t: 'money' },
        { h: 'Thành tiền (đ)', t: 'money', sum: true }, { h: 'Giảm giá (đ)', t: 'money', sum: true }, { h: 'Thực thu (đ)', t: 'money', sum: true }, ...(cost() ? [{ h: 'Giá vốn (đ)', t: 'money', sum: true }, { h: 'Lợi nhuận (đ)', t: 'money', sum: true }] : [])], rows, flags
    }];
  },
  products(from, to) {
    const ps = productStats(from, to).sort((a, b) => b.revenue - a.revenue), cs = categoryStats(from, to);
    return [
      { name: 'Theo sản phẩm', title: 'Bán hàng theo sản phẩm', columns: [{ h: 'Sản phẩm', t: 'text', w: 38 }, { h: 'Đơn vị', t: 'text', w: 10 }, { h: 'Số lượng bán', t: 'num', sum: true }, { h: 'Doanh thu (đ)', t: 'money', sum: true }, ...(cost() ? [{ h: 'Giá vốn (đ)', t: 'money', sum: true }, { h: 'Lợi nhuận (đ)', t: 'money', sum: true }, { h: 'Biên LN', t: 'pct' }] : [])],
        rows: ps.map(r => [r.name, r.unit, r.qtyBase, r.revenue, ...(cost() ? [r.cost, r.profit, r.revenue ? r.profit / r.revenue : 0] : [])]) },
      { name: 'Theo nhóm hàng', title: 'Bán hàng theo nhóm hàng', columns: [{ h: 'Nhóm hàng', t: 'text', w: 34 }, { h: 'Doanh thu (đ)', t: 'money', sum: true }, ...(cost() ? [{ h: 'Lợi nhuận (đ)', t: 'money', sum: true }] : [])], rows: cs.map(c => [c.name, c.revenue, ...(cost() ? [c.profit] : [])]) }
    ];
  },
  inventory() {
    const list = S.list('products').sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return [{
      name: 'Tồn kho', title: 'Tồn kho hiện tại', notes: ['Dòng đỏ: hết hàng hoặc tồn âm. Dòng vàng: tồn ≤ mức tối thiểu.'],
      columns: [{ h: 'Sản phẩm', t: 'text', w: 38 }, { h: 'SKU', t: 'text' }, { h: 'Nhóm hàng', t: 'text', w: 24 }, { h: 'Đơn vị', t: 'text', w: 10 }, { h: 'Tồn kho', t: 'num', sum: true }, { h: 'Tối thiểu', t: 'num' }, ...(cost() ? [{ h: 'Giá vốn (đ)', t: 'money' }] : []), { h: 'Giá bán (đ)', t: 'money' }, ...(cost() ? [{ h: 'Giá trị tồn - vốn (đ)', t: 'money', sum: true }] : []), { h: 'Giá trị tồn - bán lẻ (đ)', t: 'money', sum: true }, { h: 'Trạng thái', t: 'text' }],
      rows: list.map(p => [p.name, p.sku, categoryPath(p.categoryId), p.units[0].name, p.stock, p.minStock || 0, ...(cost() ? [rnd(p.cost || 0)] : []), p.units[0].price, ...(cost() ? [rnd(Math.max(0, p.stock) * (p.cost || 0))] : []), rnd(Math.max(0, p.stock) * p.units[0].price), !p.active ? 'Ngừng bán' : p.stock <= 0 ? 'Hết hàng' : p.minStock && p.stock <= p.minStock ? 'Sắp hết' : 'Còn hàng']),
      flags: list.map(p => !p.active ? 'void' : p.stock <= 0 ? 'red' : p.minStock && p.stock <= p.minStock ? 'amber' : null)
    }];
  },
  inout(from, to) {
    return [{ name: 'Nhập xuất tồn', title: 'Nhập – xuất – tồn', columns: [{ h: 'Sản phẩm', t: 'text', w: 38 }, { h: 'SKU', t: 'text' }, { h: 'Đơn vị', t: 'text', w: 10 }, { h: 'Tồn đầu', t: 'num', sum: true }, { h: 'Nhập', t: 'num', sum: true }, { h: 'Xuất', t: 'num', sum: true }, { h: 'Tồn cuối', t: 'num', sum: true }, ...(cost() ? [{ h: 'Giá trị tồn cuối (đ)', t: 'money', sum: true }] : [])],
      rows: stockInOut(from, to).map(r => [r.product.name, r.product.sku, r.product.units[0].name, r.open, r.in, r.out, r.close, ...(cost() ? [r.value] : [])]) }];
  },
  purchases(from, to) {
    const list = S.list('purchases').filter(p => inR(p.ts, from, to)).sort((a, b) => a.ts - b.ts);
    const lines = [];
    for (const p of list) for (const i of p.items) lines.push([p.code, p.ts, p.supplierName || 'Mua lẻ', i.name, i.unitName, i.qty, i.cost, i.discount, i.total, i.lot || '', i.expiry ? Date.parse(i.expiry + 'T00:00:00') : '']);
    return [
      { name: 'Phiếu nhập', title: 'Phiếu nhập hàng', columns: [{ h: 'Mã phiếu', t: 'text', w: 16 }, { h: 'Ngày nhập', t: 'datetime' }, { h: 'Nhà cung cấp', t: 'text', w: 26 }, { h: 'Số mặt hàng', t: 'int', sum: true }, { h: 'Tổng tiền (đ)', t: 'money', sum: true }, { h: 'Đã trả (đ)', t: 'money', sum: true }, { h: 'Còn nợ (đ)', t: 'money', sum: true }, { h: 'Ghi chú', t: 'text', w: 28 }],
        rows: list.map(p => [p.code, p.ts, p.supplierName || 'Mua lẻ', p.items.length, p.total, p.paid, p.debt, p.note || '']) },
      { name: 'Chi tiết nhập', title: 'Chi tiết hàng đã nhập', columns: [{ h: 'Mã phiếu', t: 'text', w: 16 }, { h: 'Ngày nhập', t: 'datetime' }, { h: 'Nhà cung cấp', t: 'text', w: 24 }, { h: 'Sản phẩm', t: 'text', w: 34 }, { h: 'Đơn vị', t: 'text', w: 10 }, { h: 'Số lượng', t: 'num', sum: true }, { h: 'Giá nhập (đ)', t: 'money' }, { h: 'Chiết khấu (đ)', t: 'money', sum: true }, { h: 'Thành tiền (đ)', t: 'money', sum: true }, { h: 'Số lô', t: 'text' }, { h: 'Hạn dùng', t: 'date' }], rows: lines }
    ];
  },
  debts() {
    const d = debtReport(), now = Date.now();
    const age = a => [a.d0_30, a.d31_60, a.d61_90, a.d90];
    const cols = (who) => [{ h: who, t: 'text', w: 28 }, { h: 'Điện thoại', t: 'text' }, { h: 'Số nợ (đ)', t: 'money', sum: true }, { h: '0–30 ngày (đ)', t: 'money', sum: true }, { h: '31–60 ngày (đ)', t: 'money', sum: true }, { h: '61–90 ngày (đ)', t: 'money', sum: true }, { h: 'Trên 90 ngày (đ)', t: 'money', sum: true }, { h: 'Nợ lâu nhất từ', t: 'date' }];
    return [
      { name: 'Khách nợ', title: 'Khách hàng đang nợ (số liệu đến ' + fmtDate(now) + ')', columns: cols('Khách hàng'), rows: d.customers.map(x => [x.customer.name, x.customer.phone || '', x.customer.debt, ...age(x.aging), x.oldest || '']), flags: d.customers.map(x => x.aging.d90 ? 'red' : x.aging.d61_90 ? 'amber' : null) },
      { name: 'Nợ nhà cung cấp', title: 'Nợ nhà cung cấp (số liệu đến ' + fmtDate(now) + ')', columns: cols('Nhà cung cấp'), rows: d.suppliers.map(x => [x.supplier.name, x.supplier.phone || '', x.supplier.debt, ...age(x.aging), x.oldest || '']) }
    ];
  },
  cashbook(from, to) {
    const fl = cashFlows(from, to);
    return [{ name: 'Sổ quỹ', title: 'Sổ quỹ — tiền mặt & ngân hàng', columns: [{ h: 'Thời gian', t: 'datetime' }, { h: 'Quỹ', t: 'text', w: 14 }, { h: 'Diễn giải', t: 'text', w: 46 }, { h: 'Thu (đ)', t: 'money', sum: true }, { h: 'Chi (đ)', t: 'money', sum: true }],
      rows: fl.map(f => [f.ts, f.fund === 'cash' ? 'Tiền mặt' : 'Ngân hàng', f.desc, f.amount > 0 ? f.amount : '', f.amount < 0 ? -f.amount : '']) }];
  },
  loss(from, to) {
    const l = lossReport(from, to);
    return [
      { name: 'Hàng hủy', title: 'Phiếu xuất hủy', columns: [{ h: 'Mã phiếu', t: 'text', w: 16 }, { h: 'Thời gian', t: 'datetime' }, { h: 'Lý do', t: 'text', w: 18 }, { h: 'Hàng hủy', t: 'text', w: 50 }, { h: 'Giá trị (đ)', t: 'money', sum: true }],
        rows: l.writeOffs.map(w => [w.code, w.ts, WRITEOFF_REASONS[w.reason] || w.reason, w.items.map(i => `${i.name} ×${i.qty}`).join(', '), w.total]) },
      { name: 'Kiểm kho', title: 'Chênh lệch kiểm kho', columns: [{ h: 'Phiếu kiểm', t: 'text', w: 30 }, { h: 'Hoàn tất', t: 'datetime' }, { h: 'Số mặt hàng thiếu', t: 'int', sum: true }, { h: 'Giá trị thiếu (đ)', t: 'money', sum: true }, { h: 'Số mặt hàng thừa', t: 'int', sum: true }, { h: 'Giá trị thừa (đ)', t: 'money', sum: true }],
        rows: l.stocktakes.map(s => [s.name, s.completedAt, s.summary.short, s.summary.shortValue, s.summary.over, s.summary.overValue]) }
    ];
  },
  catalog() {
    const list = S.list('products').sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return [{ name: 'Hàng hóa', title: 'Danh mục hàng hóa', notes: ['Các cột đầu có cùng tên với tệp CSV nhập hàng hóa.'],
      columns: [{ h: 'Tên hàng', t: 'text', w: 38 }, { h: 'Mã vạch', t: 'text', w: 20 }, { h: 'SKU', t: 'text' }, { h: 'Nhóm hàng', t: 'text', w: 24 }, { h: 'Đơn vị', t: 'text', w: 10 }, ...(cost() ? [{ h: 'Giá vốn', t: 'money' }] : []), { h: 'Giá bán', t: 'money' }, { h: 'Giá sỉ', t: 'money' }, { h: 'Tồn kho', t: 'num' }, { h: 'Tồn tối thiểu', t: 'num' }, { h: 'Đơn vị lớn', t: 'text' }, { h: 'Quy đổi', t: 'num' }, { h: 'Giá bán đơn vị lớn', t: 'money' }, { h: 'Trạng thái', t: 'text' }],
      rows: list.map(p => { const u = p.units[0], b = p.units[1]; return [p.name, (u.barcodes || []).join(' '), p.sku, categoryPath(p.categoryId), u.name, ...(cost() ? [rnd(p.cost || 0)] : []), u.price, u.wholesale || '', p.stock, p.minStock || '', b ? b.name : '', b ? b.factor : '', b ? b.price : '', p.active ? 'Đang bán' : 'Ngừng bán']; }),
      flags: list.map(p => p.active ? null : 'void') }];
  },
  logs(from, to) {
    const list = S.list('logs').filter(l => inR(l.ts, from, to)).sort((a, b) => b.ts - a.ts).slice(0, 20000);
    return [{ name: 'Nhật ký', title: 'Nhật ký hoạt động', columns: [{ h: 'Thời gian', t: 'datetime' }, { h: 'Người thực hiện', t: 'text', w: 22 }, { h: 'Loại', t: 'text', w: 14 }, { h: 'Nội dung', t: 'text', w: 80 }], rows: list.map(l => [l.ts, l.who, l.action, l.detail]) }];
  }
};

/** Dựng các sheet cho một báo cáo. Ném lỗi nếu không đủ quyền. */
export function buildReport(id, from = 0, to = Date.now()) {
  const def = REPORTS.find(r => r.id === id);
  if (!def) throw new Error('Báo cáo không tồn tại: ' + id);
  if (!def.perm()) throw new Error('Bạn không có quyền xuất báo cáo "' + def.title + '"');
  return BUILD[id](from, to).map(s => Object.assign({ report: id, flags: s.flags || s.rows.map(() => null) }, s));
}
/** Số dòng dữ liệu (để hiện "N dòng" trên thẻ báo cáo). */
export const countRows = (id, from, to) => buildReport(id, from, to).reduce((a, s) => a + (s.kpi ? 0 : s.rows.length), 0);
export const exportMeta = () => ({ store: settings().store.name, user: (currentUser() || {}).name || '', at: Date.now() });
