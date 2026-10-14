/* Báo cáo: tổng quan, doanh thu & lợi nhuận, hàng hóa, tồn kho, công nợ, hao hụt. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, select, empty, badge, kv, stat, tabs } from '../ui.js';
import { fmtMoney, fmtNum, fmtDate, fmtDateTime, DAY, dayStart, ymd, periodRange } from '../util.js';
import { periodBar, exportTable } from './common.js';

let tab = 'overview';
const period = { key: 'month' };
const TABS = [['overview', 'Tổng quan'], ['revenue', 'Doanh thu'], ['products', 'Hàng hóa'], ['stock', 'Tồn kho'], ['debt', 'Công nợ'], ['loss', 'Hao hụt']];
let prodSort = 'revenue';

export function viewReports(root, ctx) {
  const body = h('div'), tabsBox = h('div');
  ctx.setActions(iconBtn('download', () => ctx.go('export'), 'Xuất báo cáo Excel'));
  const draw = () => {
    mount(tabsBox, tabs(TABS, tab, k => { tab = k; draw(); }));
    mount(body, ...(tab === 'overview' ? [overview(ctx)] : [periodBar(period, draw), TAB_FN[tab](ctx, draw)]));
  };
  mount(root, tabsBox, body); draw();
}

function barChart(points, { value, label, highlight, fmt = v => fmtMoney(v) }) {
  const max = Math.max(1, ...points.map(p => value(p)));
  return h('div', null, h('div', { class: 'chart' }, points.map(p => h('div', { class: 'b' + (highlight && highlight(p) ? ' today' : ''), title: `${label(p)}: ${fmt(value(p))}`, style: { height: Math.max(2, value(p) / max * 100) + '%' } }))),
    h('div', { class: 'chart-lbl' }, points.map((p, i) => h('span', null, points.length > 16 && i % Math.ceil(points.length / 8) ? '' : label(p)))));
}
const delta = (a, b) => b ? ((a - b) / b * 100) : null;
const deltaBadge = (a, b) => { const d = delta(a, b); return d == null ? null : badge((d >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(d)) + '%', d >= 0 ? 'green' : 'red'); };
const viewCost = () => E.can('viewCost');

/* ---------------- Tổng quan ---------------- */
function overview(ctx) {
  const d = E.dashboard(), t = d.today, y = d.yesterday;
  const dayLbl = p => p.key.slice(8) + '/' + p.key.slice(5, 7);
  const todayKey = ymd(Date.now());
  return h('div', null,
    h('div', { class: 'grid g2' },
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Doanh thu hôm nay'), h('div', { class: 'v' }, fmtMoney(t.revenue)), h('div', { class: 's' }, `${t.bills} hoá đơn · so hôm qua `, deltaBadge(t.revenue, y.revenue))),
      viewCost() ? h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Lợi nhuận gộp hôm nay'), h('div', { class: 'v pos-c' }, fmtMoney(t.grossProfit)), h('div', { class: 's' }, `Biên ${Math.round(t.margin * 100)}% · hôm qua ${fmtMoney(y.grossProfit)}`)) : stat('Giá trị TB/hoá đơn', fmtMoney(t.avgBill)),
      stat('Tiền mặt hôm nay', fmtMoney(t.pay.cash), `Chuyển khoản ${fmtMoney(t.pay.bank)} · Ghi nợ ${fmtMoney(t.pay.debt)}`),
      stat('Doanh thu tháng này', fmtMoney(d.month.revenue), viewCost() ? `Lãi ròng ước tính ${fmtMoney(d.month.netProfit)}` : `${d.month.bills} hoá đơn`)),
    h('div', { class: 'card' }, h('h3', null, 'Doanh thu 7 ngày'), barChart(d.week.points, { value: p => p.revenue, label: dayLbl, highlight: p => p.key === todayKey })),
    h('div', { class: 'grid g2 mt12' },
      h('a', { class: 'stat', href: '#/stock', style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'k' }, 'Cảnh báo kho'), h('div', { class: 'v ' + (d.alerts.out + d.alerts.low + d.alerts.expired ? 'warn-c' : '') }, d.alerts.out + d.alerts.low + d.alerts.expiring + d.alerts.expired),
        h('div', { class: 's' }, `Hết ${d.alerts.out} · sắp hết ${d.alerts.low} · sắp hết hạn ${d.alerts.expiring} · quá hạn ${d.alerts.expired}`)),
      h('a', { class: 'stat', href: '#/customers', style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'k' }, 'Khách đang nợ'), h('div', { class: 'v neg-c' }, fmtMoney(d.receivable)), h('div', { class: 's' }, `Nợ nhà cung cấp: ${fmtMoney(d.payable)}`)),
      viewCost() ? stat('Giá trị hàng tồn (vốn)', fmtMoney(d.inventory.cost), `${fmtNum(d.inventory.items)} mặt hàng · bán lẻ ${fmtMoney(d.inventory.retail)}`) : null),
    d.top.length ? h('div', { class: 'card' }, h('h3', null, 'Bán chạy hôm nay'), h('div', { class: 'list' }, d.top.map(r => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, r.name), h('div', { class: 'sub' }, `${fmtNum(r.qtyBase)} ${r.unit}`)), h('div', { class: 'bold' }, fmtMoney(r.revenue)))))) : null);
}

/* ---------------- Doanh thu ---------------- */
function revenueTab() {
  const { from, to } = period, m = E.summary(from, to), s = E.series(from, to), hours = E.byHour(from, to), staff = E.byStaff(from, to);
  const lbl = p => s.monthly ? p.key.slice(5) + '/' + p.key.slice(2, 4) : p.key.slice(8) + '/' + p.key.slice(5, 7);
  const prev = E.summary(from - (to - from + 1), from - 1);
  return h('div', null,
    h('div', { class: 'grid g2' }, h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Doanh thu thuần'), h('div', { class: 'v' }, fmtMoney(m.revenue)), h('div', { class: 's' }, 'so kỳ trước ', deltaBadge(m.revenue, prev.revenue))),
      stat('Số hoá đơn', fmtNum(m.bills), `TB ${fmtMoney(m.avgBill)}/hoá đơn`),
      viewCost() ? stat('Lợi nhuận gộp', fmtMoney(m.grossProfit), `Biên ${Math.round(m.margin * 100)}% · giá vốn ${fmtMoney(m.cogs)}`, 'pos-c') : null,
      viewCost() ? stat('Lãi ròng ước tính', fmtMoney(m.netProfit), 'Sau chi phí, hao hụt', m.netProfit < 0 ? 'neg-c' : 'pos-c') : null,
      stat('Giảm giá đã cho', fmtMoney(m.discount)), stat('Hàng trả lại', fmtMoney(m.returns))),
    h('div', { class: 'card' }, h('h3', null, s.monthly ? 'Doanh thu theo tháng' : 'Doanh thu theo ngày'), barChart(s.points, { value: p => p.revenue, label: lbl })),
    h('div', { class: 'card' }, h('h3', null, 'Hình thức thanh toán'),
      ['cash', 'bank', 'debt'].map(k => { const v = m.pay[k], tot = m.pay.cash + m.pay.bank + m.pay.debt || 1; return h('div', { class: 'mb8' }, h('div', { class: 'row between small' }, h('span', null, { cash: 'Tiền mặt', bank: 'Chuyển khoản / VietQR', debt: 'Ghi nợ' }[k]), h('b', null, fmtMoney(v))), h('div', { class: 'bar' }, h('i', { style: { width: v / tot * 100 + '%' } }))); })),
    h('div', { class: 'card' }, h('h3', null, 'Giờ cao điểm'), barChart(hours, { value: p => p.revenue, label: p => p.hour % 3 ? '' : p.hour + 'h', fmt: v => fmtMoney(v) })),
    viewCost() || true ? h('div', { class: 'card' }, h('h3', null, 'Theo thu ngân'), staff.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Nhân viên'), h('th', { class: 'r' }, 'HĐ'), h('th', { class: 'r' }, 'Doanh thu'), viewCost() ? h('th', { class: 'r' }, 'Lãi gộp') : null)),
      h('tbody', null, staff.map(r => h('tr', null, h('td', null, r.name), h('td', { class: 'r' }, r.bills), h('td', { class: 'r' }, fmtMoney(r.revenue)), viewCost() ? h('td', { class: 'r' }, fmtMoney(r.profit)) : null))))) : empty('Chưa có dữ liệu')) : null,
    viewCost() ? h('div', { class: 'card' }, h('h3', null, 'Kết quả kinh doanh (ước tính)'), kv('Doanh thu thuần', fmtMoney(m.revenue)), kv('Giá vốn hàng bán', '-' + fmtMoney(m.cogs)), kv('Lợi nhuận gộp', fmtMoney(m.grossProfit), 'bold'), kv('Chi phí hoạt động (sổ quỹ)', '-' + fmtMoney(m.expenses)),
      m.otherIncome ? kv('Thu nhập khác', fmtMoney(m.otherIncome)) : null, kv('Hàng hủy', '-' + fmtMoney(m.writeOff)), kv('Hao hụt kiểm kho', '-' + fmtMoney(m.stocktakeLoss)), kv('Lãi ròng', fmtMoney(m.netProfit), m.netProfit < 0 ? 'neg-c' : 'pos-c')) : null,
    h('div', { class: 'row mt12' }, h('button', { class: 'btn grow', onClick: () => exportTable('sales', from, to) }, icon('download', 18), ' Xuất DS hoá đơn (Excel)'), h('button', { class: 'btn grow', onClick: () => exportTable('products', from, to) }, icon('download', 18), ' Xuất theo sản phẩm')));
}

/* ---------------- Hàng hóa ---------------- */
function productsTab(ctx, redraw) {
  const { from, to } = period;
  const top = E.topProducts(from, to, { by: prodSort, limit: 15 }), slow = E.slowProducts(from, to, 15), abc = E.abc(from, to), cats = E.categoryStats(from, to);
  const sel = select([['revenue', 'Theo doanh thu'], ['qty', 'Theo số lượng'], ...(viewCost() ? [['profit', 'Theo lợi nhuận']] : [])], prodSort, { style: { width: 'auto', minHeight: '34px', padding: '2px 8px' }, onChange: e => { prodSort = e.target.value; redraw(); } });
  const cnt = c => abc.filter(x => x.cls === c).length;
  return h('div', null,
    h('div', { class: 'card' }, h('div', { class: 'row between mb8' }, h('h3', { style: { margin: 0 } }, 'Bán chạy nhất'), sel),
      top.length ? h('div', { class: 'list' }, top.map((r, i) => h('div', { class: 'item' }, h('div', { class: 'thumb' }, i + 1), h('div', { class: 'grow' }, h('div', { class: 'ttl' }, r.name), h('div', { class: 'sub' }, `${fmtNum(r.qtyBase)} ${r.unit}${viewCost() ? ' · lãi ' + fmtMoney(r.profit) : ''}`)), h('div', { class: 'bold' }, fmtMoney(r.revenue))))) : empty('Chưa có dữ liệu bán hàng trong kỳ')),
    abc.length ? h('div', { class: 'card' }, h('h3', null, 'Phân tích ABC theo doanh thu'), h('div', { class: 'grid g3' }, stat('Nhóm A (80% DT)', cnt('A') + ' mặt hàng'), stat('Nhóm B (15%)', cnt('B') + ' mặt hàng'), stat('Nhóm C (5%)', cnt('C') + ' mặt hàng')),
      h('div', { class: 'small muted mt8' }, 'Nhóm A là hàng mang lại phần lớn doanh thu – luôn phải đủ hàng. Nhóm C bán ít, cân nhắc giảm lượng nhập.')) : null,
    cats.length ? h('div', { class: 'card' }, h('h3', null, 'Theo nhóm hàng'), h('div', { class: 'list' }, cats.map(c => { const mx = cats[0].revenue || 1; return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, c.name), h('div', { class: 'bar mt8' }, h('i', { style: { width: c.revenue / mx * 100 + '%' } }))), h('div', { class: 'right' }, h('div', { class: 'bold' }, fmtMoney(c.revenue)), viewCost() ? h('div', { class: 'tiny muted' }, 'lãi ' + fmtMoney(c.profit)) : null)); }))) : null,
    h('div', { class: 'card' }, h('h3', null, 'Bán chậm / không bán được trong kỳ'), slow.length ? h('div', { class: 'list' }, slow.map(x => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.product.name), h('div', { class: 'sub' }, `Bán ${fmtNum(x.qtyBase)} · tồn ${fmtNum(x.product.stock)}${x.lastSold ? ' · bán gần nhất ' + fmtDate(x.lastSold) : ' · chưa từng bán'}`)), h('div', { class: 'bold' }, fmtMoney(x.value))))) : empty('Không có hàng tồn chậm')),
    h('button', { class: 'btn block', onClick: () => exportTable('products', from, to) }, icon('download', 18), ' Xuất báo cáo sản phẩm (Excel)'));
}

/* ---------------- Tồn kho ---------------- */
function stockReportTab() {
  const { from, to } = period, iv = E.inventoryValue(), rows = E.stockInOut(from, to);
  const byCat = new Map();
  for (const p of S.list('products')) if (p.stock > 0) { const k = p.categoryId || ''; const x = byCat.get(k) || { name: p.categoryId ? E.categoryPath(p.categoryId) : 'Chưa phân nhóm', cost: 0, retail: 0 }; x.cost += p.stock * (p.cost || 0); x.retail += p.stock * p.units[0].price; byCat.set(k, x); }
  const cats = [...byCat.values()].sort((a, b) => b.cost - a.cost);
  const al = E.stockAlerts();
  return h('div', null,
    h('div', { class: 'grid g3' }, viewCost() ? stat('Giá trị tồn (vốn)', fmtMoney(iv.cost)) : null, stat('Giá trị bán lẻ', fmtMoney(iv.retail)), viewCost() ? stat('Lãi tiềm năng', fmtMoney(iv.retail - iv.cost)) : null),
    cats.length ? h('div', { class: 'card' }, h('h3', null, 'Giá trị tồn theo nhóm'), h('div', { class: 'list' }, cats.map(c => h('div', { class: 'item' }, h('div', { class: 'grow ttl' }, c.name), h('div', { class: 'right' }, h('div', { class: 'bold' }, fmtMoney(viewCost() ? c.cost : c.retail)), h('div', { class: 'tiny muted' }, 'Bán lẻ ' + fmtMoney(c.retail))))))) : null,
    h('div', { class: 'card' }, h('h3', null, 'Hạn sử dụng'), kv('Đã quá hạn', `${al.expired.length} lô · ${fmtMoney(al.expired.reduce((a, x) => a + x.value, 0))}`, al.expired.length ? 'neg-c' : ''), kv('Sắp hết hạn', `${al.expiring.length} lô · ${fmtMoney(al.expiring.reduce((a, x) => a + x.value, 0))}`, al.expiring.length ? 'warn-c' : ''),
      kv('Tồn lâu không bán', `${al.dead.length} mặt hàng · ${fmtMoney(al.dead.reduce((a, x) => a + x.value, 0))}`)),
    h('div', { class: 'card' }, h('h3', null, 'Nhập – xuất – tồn trong kỳ'), h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Sản phẩm'), ['Đầu', 'Nhập', 'Xuất', 'Cuối'].map(x => h('th', { class: 'r' }, x)))),
      h('tbody', null, rows.slice(0, 100).map(r => h('tr', null, h('td', null, r.product.name), h('td', { class: 'r' }, fmtNum(r.open)), h('td', { class: 'r pos-c' }, r.in ? fmtNum(r.in) : ''), h('td', { class: 'r neg-c' }, r.out ? fmtNum(r.out) : ''), h('td', { class: 'r bold' }, fmtNum(r.close)))))), rows.length > 100 ? h('div', { class: 'small muted center mt8' }, `Hiển thị 100/${rows.length} dòng – xuất CSV để xem đầy đủ`) : null)),
    h('div', { class: 'row' }, h('button', { class: 'btn grow', onClick: () => exportTable('inout', from, to) }, icon('download', 18), ' Xuất nhập–xuất–tồn'), h('button', { class: 'btn grow', onClick: () => exportTable('inventory', from, to) }, icon('download', 18), ' Xuất tồn kho')));
}

/* ---------------- Công nợ ---------------- */
function debtTab(ctx) {
  const d = E.debtReport(), row = (name, sub, amount, aging, href) => h('a', { class: 'item click', href, style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, name), h('div', { class: 'sub' }, sub)),
    h('div', { class: 'right' }, h('div', { class: 'bold neg-c' }, fmtMoney(amount)), aging.d90 ? h('div', { class: 'tiny neg-c' }, 'Quá 90 ngày: ' + fmtNum(aging.d90)) : aging.d61_90 ? h('div', { class: 'tiny warn-c' }, '61–90 ngày: ' + fmtNum(aging.d61_90)) : null));
  return h('div', null, h('div', { class: 'grid g2' }, stat('Khách đang nợ', fmtMoney(d.receivable), `${d.customers.length} khách`, 'neg-c'), stat('Nợ nhà cung cấp', fmtMoney(d.payable), `${d.suppliers.length} nhà cung cấp`)),
    h('div', { class: 'card' }, h('h3', null, 'Khách hàng nợ'), d.customers.length ? h('div', { class: 'list' }, d.customers.map(x => row(x.customer.name, (x.customer.phone || '—') + (x.oldest ? ' · nợ từ ' + fmtDate(x.oldest) : ''), x.customer.debt, x.aging, '#/customers'))) : empty('Không có khách nợ 🎉')),
    h('div', { class: 'card' }, h('h3', null, 'Nợ nhà cung cấp'), d.suppliers.length ? h('div', { class: 'list' }, d.suppliers.map(x => row(x.supplier.name, (x.supplier.phone || '—') + (x.oldest ? ' · từ ' + fmtDate(x.oldest) : ''), x.supplier.debt, x.aging, '#/suppliers'))) : empty('Không nợ nhà cung cấp nào')),
    h('button', { class: 'btn block', onClick: () => exportTable('debts', 0, Date.now(), 'cong-no.csv') }, icon('download', 18), ' Xuất công nợ (Excel)'));
}

/* ---------------- Hao hụt ---------------- */
function lossTab() {
  const { from, to } = period, l = E.lossReport(from, to);
  return h('div', null,
    h('div', { class: 'grid g2' }, stat('Hàng hủy', fmtMoney(l.writeOffTotal), `${l.writeOffs.length} phiếu`, 'neg-c'), stat('Kiểm kho thiếu', fmtMoney(l.stocktakeShort), `Thừa ${fmtMoney(l.stocktakeOver)}`, 'neg-c'), stat('Khách trả hàng hỏng', fmtMoney(l.badReturnCost), `${l.badReturns.length} phiếu`)),
    h('div', { class: 'card' }, h('h3', null, 'Phiếu xuất hủy'), l.writeOffs.length ? h('div', { class: 'list' }, l.writeOffs.map(w => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, w.code, ' ', badge(E.WRITEOFF_REASONS[w.reason])), h('div', { class: 'sub' }, `${fmtDateTime(w.ts)} · ${w.items.map(i => `${i.name} ×${fmtNum(i.qty)}`).join(', ')}`)), h('div', { class: 'bold neg-c' }, fmtMoney(w.total))))) : empty('Không có hàng hủy trong kỳ')),
    h('div', { class: 'card' }, h('h3', null, 'Phiếu kiểm kho đã cân bằng'), l.stocktakes.length ? h('div', { class: 'list' }, l.stocktakes.map(s => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, s.name), h('div', { class: 'sub' }, fmtDateTime(s.completedAt))), h('div', { class: 'right small' }, h('div', { class: 'neg-c' }, 'Thiếu ' + fmtMoney(s.summary.shortValue)), h('div', { class: 'pos-c' }, 'Thừa ' + fmtMoney(s.summary.overValue)))))) : empty('Không có phiếu kiểm trong kỳ')));
}
const TAB_FN = { revenue: revenueTab, products: productsTab, stock: stockReportTab, debt: debtTab, loss: lossTab };
