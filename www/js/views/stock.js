/* Kho hàng: cảnh báo, tồn kho, nhập hàng, kiểm kho, xuất hủy, gợi ý đặt hàng. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, modal, toast, guard, confirmBox, promptBox, field, select, badge, kv, empty, moneyInput, qtyInput, tabs, stat, debounce } from '../ui.js';
import { fmtMoney, fmtNum, fmtDate, fmtDateTime, parseQty, parseMoney, roundQty, ymd, DAY } from '../util.js';
import { openScanner, onScan, canScan, shareText } from '../native.js';
import { pickProduct, periodBar } from './common.js';
import { MOVE_NAMES } from './products.js';

let tab = 'alerts';
const TABS = [['alerts', 'Cảnh báo'], ['stock', 'Tồn kho'], ['purchase', 'Nhập hàng'], ['count', 'Kiểm kho'], ['writeoff', 'Xuất hủy'], ['order', 'Đặt hàng']];

export function viewStock(root, ctx) {
  const tabsBox = h('div'), body = h('div');
  const set = k => { tab = k; draw(); };
  function draw() {
    mount(tabsBox, tabs(TABS, tab, set));
    ({ alerts: alertsTab, stock: stockTab, purchase: purchaseTab, count: countTab, writeoff: writeoffTab, order: orderTab })[tab](body, draw);
    ctx.refreshNav();
  }
  mount(root, tabsBox, body); draw();
}

/* ---------------- Cảnh báo ---------------- */
function alertsTab(box) {
  const a = E.stockAlerts(), cfg = E.settings().stock;
  const section = (title, kind, items, render) => items.length ? h('div', { class: 'card' }, h('div', { class: 'row between mb8' }, h('h3', { style: { margin: 0 } }, title), badge(items.length, kind)), h('div', { class: 'list' }, items.slice(0, 30).map(render)),
    items.length > 30 ? h('div', { class: 'small muted center mt8' }, `… và ${items.length - 30} mục nữa`) : null) : null;
  const prodRow = p => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, p.name), h('div', { class: 'sub' }, `${p.sku}${p.minStock ? ' · tối thiểu ' + fmtNum(p.minStock) : ''}`)), h('div', { class: 'bold ' + (p.stock <= 0 ? 'neg-c' : 'warn-c') }, fmtNum(p.stock) + ' ' + p.units[0].name));
  const batchRow = x => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.product.name), h('div', { class: 'sub' }, `Lô ${x.batch.lot || '—'} · HSD ${fmtDate(new Date(x.batch.expiry + 'T00:00:00').getTime())}`)),
    h('div', { class: 'right' }, h('div', { class: 'bold ' + (x.daysLeft < 0 ? 'neg-c' : 'warn-c') }, x.daysLeft < 0 ? `Quá ${-x.daysLeft} ngày` : `Còn ${x.daysLeft} ngày`), h('div', { class: 'tiny muted' }, `${fmtNum(x.batch.qty)} ${x.product.units[0].name} · ${fmtMoney(x.value)}`)));
  const none = !(a.out.length + a.low.length + a.expiring.length + a.expired.length + a.dead.length);
  mount(box, none ? h('div', { class: 'card' }, empty('Mọi thứ ổn 👍', 'Không có hàng sắp hết, hết hạn hay tồn đọng.')) : null,
    section('Đã hết hạn – cần xuất hủy', 'red', a.expired, batchRow),
    section(`Sắp hết hạn (≤ ${cfg.expiryWarnDays} ngày)`, 'amber', a.expiring, batchRow),
    section('Hết hàng', 'red', a.out.slice(0, 200), prodRow),
    section('Sắp hết hàng', 'amber', a.low, prodRow),
    section(`Tồn lâu không bán (> ${cfg.deadStockDays} ngày)`, '', a.dead, x => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.product.name), h('div', { class: 'sub' }, `${x.days} ngày không bán · tồn ${fmtNum(x.product.stock)}`)), h('div', { class: 'bold' }, fmtMoney(x.value)))),
    a.expired.length && E.can('manageStock') ? h('button', { class: 'btn danger block', onClick: () => writeoffForm(a.expired.map(x => ({ product: x.product, batch: x.batch, qty: x.batch.qty })), 'expired') }, 'Xuất hủy tất cả hàng đã hết hạn') : null);
}

/* ---------------- Tồn kho ---------------- */
function stockTab(box, redraw) {
  let q = '', limit = 80; const iv = E.inventoryValue(), list = h('div');
  const drawList = () => {
    const r = E.searchProducts(q, { limit: 100000 }), shown = r.slice(0, limit);
    mount(list, shown.length ? h('div', { class: 'list' }, shown.map(p => h('div', { class: 'item click', onClick: () => adjustDialog(p, redraw) },
      h('div', { class: 'grow' }, h('div', { class: 'ttl ellipsis' }, p.name), h('div', { class: 'sub' }, `${p.sku}${E.can('viewCost') ? ' · vốn ' + fmtNum(p.cost) : ''}`)),
      h('div', { class: 'right' }, h('div', { class: 'bold ' + (p.stock <= 0 ? 'neg-c' : p.stock <= p.minStock ? 'warn-c' : '') }, fmtNum(p.stock) + ' ' + p.units[0].name), E.can('viewCost') ? h('div', { class: 'tiny muted' }, fmtMoney(Math.max(0, p.stock) * p.cost)) : null)))) : empty('Không có hàng'),
      r.length > limit ? h('button', { class: 'btn block mt8', onClick: () => { limit += 100; drawList(); } }, `Xem thêm (${r.length - limit})`) : null);
  };
  mount(box, h('div', { class: 'grid g3 mb8' }, stat('Số mặt hàng có tồn', fmtNum(iv.items)), E.can('viewCost') ? stat('Giá trị tồn (vốn)', fmtMoney(iv.cost)) : null, stat('Giá trị tồn (bán lẻ)', fmtMoney(iv.retail))),
    h('input', { class: 'input mb8', placeholder: 'Tìm hàng trong kho…', onInput: debounce(e => { q = e.target.value; limit = 80; drawList(); }, 150) }), list,
    h('div', { class: 'small muted center mt8' }, 'Chạm vào một mặt hàng để điều chỉnh tồn kho'));
  drawList();
}
function adjustDialog(p, redraw) {
  if (!E.can('manageStock')) return;
  const qty = qtyInput(p.stock), reason = h('input', { class: 'input', placeholder: 'VD: Đếm lại thấy lệch, vỡ hàng…' });
  const moves = E.stockMovesOf(p.id, 6);
  modal({ title: p.name, body: h('div', null, h('div', { class: 'muted small mb8' }, `Tồn sổ sách: ${fmtNum(p.stock)} ${p.units[0].name}`), field('Tồn thực tế mới', qty), field('Lý do điều chỉnh', reason),
    h('h3', { class: 'small muted mt12' }, 'Biến động gần đây'), h('div', { class: 'list' }, moves.map(m => h('div', { class: 'item' }, h('div', { class: 'grow small' }, (MOVE_NAMES[m.type] || m.type), h('div', { class: 'tiny muted' }, fmtDateTime(m.ts))), h('b', { class: m.qty > 0 ? 'pos-c' : 'neg-c' }, (m.qty > 0 ? '+' : '') + fmtNum(m.qty)))))),
    actions: [{ label: 'Huỷ' }, { label: 'Điều chỉnh', kind: 'primary', onClick: async () => { const r = await guard(() => E.adjustStock(p.id, qty.num, reason.value)); if (r === undefined) return false; toast('Đã điều chỉnh tồn kho', 'ok'); redraw(); } }] });
}

/* ---------------- Nhập hàng ---------------- */
function purchaseTab(box, redraw) {
  const period = { key: 'month' };
  const list = h('div');
  const drawList = () => {
    const ps = S.list('purchases').filter(p => p.ts >= period.from && p.ts <= period.to).sort((a, b) => b.ts - a.ts);
    const rets = S.list('purchaseReturns').filter(p => p.ts >= period.from && p.ts <= period.to).sort((a, b) => b.ts - a.ts);
    mount(list, h('div', { class: 'row between small muted mb8' }, h('span', null, `${ps.length} phiếu nhập`), h('span', null, 'Tổng: ', h('b', null, fmtMoney(ps.reduce((a, p) => a + p.total, 0))))),
      ps.length ? h('div', { class: 'list' }, ps.map(p => h('div', { class: 'item click', onClick: () => purchaseDetail(p.id, redraw) },
        h('div', { class: 'grow' }, h('div', { class: 'ttl' }, p.code, ' ', p.debt > 0 ? badge('Nợ ' + fmtNum(p.debt), 'red') : null), h('div', { class: 'sub' }, `${fmtDateTime(p.ts)} · ${p.supplierName || 'Mua lẻ'} · ${p.items.length} mặt hàng`)), h('div', { class: 'bold' }, fmtMoney(p.total))))) : empty('Chưa có phiếu nhập trong kỳ'),
      rets.length ? h('div', { class: 'mt12' }, h('h3', { class: 'small muted' }, 'Trả hàng nhà cung cấp'), h('div', { class: 'list' }, rets.map(r => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, r.code), h('div', { class: 'sub' }, `${fmtDateTime(r.ts)} · ${r.supplierName}`)), h('div', { class: 'bold neg-c' }, '-' + fmtMoney(r.total)))))) : null);
  };
  mount(box, periodBar(period, drawList, { keys: ['today', '7d', 'month', 'lastmonth', 'year', 'custom'] }),
    E.can('manageStock') ? h('div', { class: 'row mb8' }, h('button', { class: 'btn primary grow', onClick: () => purchaseForm(redraw) }, icon('plus', 18), ' Tạo phiếu nhập hàng'), h('button', { class: 'btn', onClick: () => supplierReturnForm(redraw) }, icon('undo', 18), ' Trả NCC')) : null, list);
  drawList();
}
function purchaseDetail(id, redraw) {
  const p = S.get('purchases', id);
  modal({ title: 'Phiếu nhập ' + p.code, size: 'wide', body: h('div', null, h('div', { class: 'small muted' }, `${fmtDateTime(p.ts)} · ${p.supplierName || 'Mua lẻ'}`),
    h('div', { class: 'list mt8' }, p.items.map(i => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, i.name), h('div', { class: 'sub' }, `${fmtNum(i.qty)} ${i.unitName} × ${fmtNum(i.cost)}${i.lot ? ' · lô ' + i.lot : ''}${i.expiry ? ' · HSD ' + i.expiry : ''}`)), h('div', { class: 'bold' }, fmtMoney(i.total))))),
    h('div', { class: 'mt12' }, p.discount ? kv('Chiết khấu', '-' + fmtMoney(p.discount)) : null, kv('Tổng tiền', fmtMoney(p.total), 'pos-c'), kv('Đã trả', fmtMoney(p.paid)), p.debt ? kv('Còn nợ NCC', fmtMoney(p.debt), 'neg-c') : null), p.note ? h('div', { class: 'small muted mt8' }, p.note) : null),
    actions: [{ label: 'Đóng' }] });
}

/** Phiếu nhập hàng. */
function purchaseForm(done) {
  const rows = [];   // {product, unitId, qty, cost, discount, lot, expiry}
  const sup = select([['', '— Mua lẻ / không chọn NCC —'], ...S.list('suppliers').filter(s => s.active !== false).map(s => [s.id, s.name + (s.debt ? ` (nợ ${fmtNum(s.debt)})` : '')])], '');
  const linesBox = h('div'), sumBox = h('div');
  const discount = moneyInput(0, { onInput: sum }), paid = moneyInput(0, { onInput: () => { paidTouched = true; sum(); } }), method = select([['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản']], 'cash');
  const due = h('input', { class: 'input', type: 'date' }), note = h('input', { class: 'input', placeholder: 'Ghi chú / số hoá đơn NCC' });
  let paidTouched = false;
  const subtotal = () => rows.reduce((a, r) => a + Math.round(r.qty * r.cost) - (r.discount || 0), 0);
  function sum() {
    const total = Math.max(0, subtotal() - discount.num);
    if (!paidTouched) paid.num = total;
    mount(sumBox, kv('Tiền hàng', fmtMoney(subtotal())), discount.num ? kv('Chiết khấu', '-' + fmtMoney(discount.num)) : null, kv('Tổng thanh toán', fmtMoney(total), 'pos-c'),
      total - paid.num > 0 ? kv('Ghi nợ NCC', fmtMoney(total - paid.num), 'neg-c') : null);
  }
  function drawLines() {
    mount(linesBox, rows.length ? rows.map((r, i) => {
      const p = r.product, u = p.units.find(x => x.id === r.unitId) || p.units[0];
      const qty = qtyInput(r.qty), cost = moneyInput(r.cost, { onInput: v => { r.cost = v; sum(); } }); qty.addEventListener('input', () => { r.qty = parseQty(qty.value); sum(); });
      return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', null, p.name), iconBtn('x', () => { rows.splice(i, 1); drawLines(); sum(); }, 'Bỏ')),
        h('div', { class: 'grid g3 mt8' }, field('Đơn vị', select(p.units.map(x => [x.id, x.name]), r.unitId, { onChange: e => { const nu = p.units.find(x => x.id === e.target.value); r.cost = Math.round((p.lastCost || p.cost || 0) * nu.factor); r.unitId = nu.id; drawLines(); sum(); } })), field('Số lượng', qty), field(`Giá nhập /${u.name}`, cost)),
        p.trackBatch ? h('div', { class: 'grid g2' }, field('Số lô', h('input', { class: 'input', value: r.lot, onInput: e => { r.lot = e.target.value; } })), field('Hạn sử dụng', h('input', { class: 'input', type: 'date', value: r.expiry || '', onChange: e => { r.expiry = e.target.value || null; } }))) : null,
        h('div', { class: 'small muted' }, `Thành tiền: ${fmtMoney(Math.round(r.qty * r.cost))} · Tồn hiện tại ${fmtNum(p.stock)} · giá bán ${fmtMoney(u.price)}${r.cost && u.price ? ` (lãi ${Math.round((u.price - r.cost) / u.price * 100)}%)` : ''}`));
    }) : empty('Chưa có hàng. Bấm "Thêm hàng" hoặc quét mã vạch.'));
  }
  const addProd = p => {
    const ex = rows.find(r => r.product.id === p.id); if (ex) { ex.qty++; drawLines(); sum(); return; }
    rows.push({ product: p, unitId: p.units[0].id, qty: 1, cost: Math.round(p.lastCost || p.cost || 0), discount: 0, lot: '', expiry: null }); drawLines(); sum();
  };
  const off = onScan(code => { const hit = E.lookupBarcode(code); if (hit) { const ex = rows.find(r => r.product.id === hit.product.id); if (ex) { ex.qty++; } else { addProd(hit.product); const r = rows[rows.length - 1]; r.unitId = hit.unit.id; r.cost = Math.round((hit.product.lastCost || hit.product.cost || 0) * hit.unit.factor); } drawLines(); sum(); } else toast('Không tìm thấy mã ' + code, 'error'); });
  const m = modal({ title: 'Phiếu nhập hàng', size: 'wide', onClose: off, body: h('div', null, field('Nhà cung cấp', sup),
    linesBox, h('button', { class: 'btn block mb8', onClick: () => pickProduct({ keepOpen: true, title: 'Thêm hàng vào phiếu nhập', onPick: addProd }) }, icon('plus', 16), ' Thêm hàng / quét mã'),
    h('div', { class: 'grid g2' }, field('Chiết khấu cả phiếu', discount), field('Đã thanh toán', paid)), h('div', { class: 'grid g2' }, field('Hình thức trả', method), field('Hạn thanh toán nợ', due)), field('Ghi chú', note), sumBox),
    actions: [{ label: 'Huỷ' }, { label: 'Lưu phiếu nhập', kind: 'primary', onClick: async () => {
      if (!rows.length) { toast('Chưa có hàng nào trong phiếu', 'error'); return false; }
      const r = await guard(() => E.createPurchase({ supplierId: sup.value || null, items: rows.map(x => ({ productId: x.product.id, unitId: x.unitId, qty: x.qty, cost: x.cost, discount: x.discount, lot: x.lot, expiry: x.expiry })), discount: discount.num, paid: paid.num, method: method.value, dueDate: due.value || null, note: note.value }));
      if (!r) return false; toast('Đã nhập hàng ' + r.code, 'ok'); done();
    } }] });
  drawLines(); sum(); void m;
}
function supplierReturnForm(done) {
  const sup = select([['', '— Chọn nhà cung cấp —'], ...S.list('suppliers').map(s => [s.id, s.name])], ''), rows = [], box = h('div'), refund = select([['debt', 'Trừ vào công nợ phải trả'], ['cash', 'NCC hoàn tiền mặt'], ['transfer', 'NCC hoàn chuyển khoản']], 'debt');
  const draw = () => mount(box, rows.map((r, i) => { const q = qtyInput(r.qty), c = moneyInput(r.cost, { onInput: v => { r.cost = v; } }); q.addEventListener('input', () => { r.qty = parseQty(q.value); });
    return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', null, r.product.name), iconBtn('x', () => { rows.splice(i, 1); draw(); })), h('div', { class: 'grid g2 mt8' }, field(`Số lượng (${r.product.units[0].name})`, q), field('Giá nhập', c))); }));
  modal({ title: 'Trả hàng nhà cung cấp', body: h('div', null, field('Nhà cung cấp', sup), box, h('button', { class: 'btn block mb8', onClick: async () => { const p = await pickProduct({ title: 'Chọn hàng trả' }); if (p) { rows.push({ product: p, qty: 1, cost: Math.round(p.lastCost || p.cost || 0) }); draw(); } } }, '+ Thêm hàng trả'), field('Hình thức', refund)),
    actions: [{ label: 'Huỷ' }, { label: 'Xác nhận trả', kind: 'primary', onClick: async () => { const r = await guard(() => E.createPurchaseReturn({ supplierId: sup.value, items: rows.map(x => ({ productId: x.product.id, unitId: x.product.units[0].id, qty: x.qty, cost: x.cost })), refund: refund.value })); if (!r) return false; toast('Đã trả hàng ' + r.code, 'ok'); done(); } }] });
}

/* ---------------- Kiểm kho ---------------- */
function countTab(box, redraw) {
  const sts = S.list('stocktakes').sort((a, b) => b.startedAt - a.startedAt);
  mount(box, E.can('manageStock') ? h('button', { class: 'btn primary block mb8', onClick: newStocktake }, icon('plus', 18), ' Bắt đầu phiếu kiểm kho mới') : null,
    sts.length ? h('div', { class: 'list' }, sts.map(s => { const sm = s.summary || E.stocktakeSummary(s); return h('div', { class: 'item click', onClick: () => stocktakeScreen(s.id, redraw) },
      h('div', { class: 'grow' }, h('div', { class: 'ttl' }, s.name, ' ', s.status === 'draft' ? badge('Đang kiểm', 'amber') : badge('Hoàn tất', 'green')), h('div', { class: 'sub' }, `${fmtDateTime(s.startedAt)} · đã đếm ${sm.counted}/${sm.total}`)),
      s.status === 'done' ? h('div', { class: 'right small' }, sm.short ? h('div', { class: 'neg-c' }, `Thiếu ${sm.short}`) : null, sm.over ? h('div', { class: 'pos-c' }, `Thừa ${sm.over}`) : null) : null); })) : empty('Chưa có phiếu kiểm kho'));
  function newStocktake() {
    const cats = E.categoryTree(), sel = new Set();
    const chips = h('div', { class: 'chips', style: { flexWrap: 'wrap' } });
    const dr = () => mount(chips, cats.map(({ cat }) => h('span', { class: 'chip ' + (sel.has(cat.id) ? 'on' : ''), onClick: () => { sel.has(cat.id) ? sel.delete(cat.id) : sel.add(cat.id); dr(); } }, cat.name)));
    dr(); const name = h('input', { class: 'input', placeholder: 'Tên phiếu (tuỳ chọn)' });
    modal({ title: 'Phiếu kiểm kho mới', body: h('div', null, field('Tên phiếu', name), h('div', { class: 'small muted mb8' }, 'Chọn nhóm hàng cần kiểm (không chọn = kiểm toàn bộ cửa hàng). Có thể kiểm từng kệ/nhóm rồi tiếp tục sau.'), chips),
      actions: [{ label: 'Huỷ' }, { label: 'Bắt đầu kiểm', kind: 'primary', onClick: async () => { const ids = [...sel].flatMap(c => E.categoryDescendants(c)); const r = await guard(() => E.createStocktake({ name: name.value.trim(), categoryIds: ids.length ? ids : undefined })); if (!r) return false; redraw(); stocktakeScreen(r.id, redraw); } }] });
  }
}
function stocktakeScreen(id, redraw) {
  let st = S.get('stocktakes', id), q = '', onlyDiff = false;
  const list = h('div'), head = h('div');
  const draft = () => st.status === 'draft' && E.can('manageStock');
  function drawAll() {
    st = S.get('stocktakes', id); if (!st) return;
    const sm = E.stocktakeSummary(st);
    mount(head, h('div', { class: 'grid g3 mb8' }, stat('Đã đếm', `${sm.counted}/${sm.total}`), stat('Thừa', `${sm.over}`, fmtMoney(sm.overValue), 'pos-c'), stat('Thiếu', `${sm.short}`, fmtMoney(sm.shortValue), 'neg-c')),
      h('div', { class: 'row mb8' }, h('input', { class: 'input grow', placeholder: 'Tìm hàng…', onInput: debounce(e => { q = e.target.value; drawList(); }, 120) }), h('span', { class: 'chip ' + (onlyDiff ? 'on' : ''), onClick: () => { onlyDiff = !onlyDiff; drawAll(); } }, 'Chỉ lệch'),
        draft() && canScan() ? h('button', { class: 'btn', onClick: () => openScanner({ continuous: true, onCode: c => { scan(c); return 'keep'; } }) }, icon('scan')) : null));
    drawList();
  }
  function drawList() {
    const tk = q.toLowerCase().split(/\s+/).filter(Boolean);
    let items = st.items.map((it, i) => ({ it, i })).filter(({ it }) => !tk.length || tk.every(t => (it.name + ' ' + it.sku).toLowerCase().includes(t)));
    if (onlyDiff) items = items.filter(({ it }) => it.counted != null && it.counted !== it.system);
    mount(list, h('div', { class: 'list' }, items.slice(0, 150).map(({ it }) => {
      const diff = it.counted == null ? null : roundQty(it.counted - it.system);
      const inp = qtyInput(it.counted == null ? '' : it.counted, { placeholder: '—' }); inp.style.width = '90px'; inp.disabled = !draft();
      inp.addEventListener('change', async () => { const v = inp.value.trim(); await guard(() => E.setCount(id, it.productId, v === '' ? null : parseQty(v))); drawAll(); });
      return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, it.name), h('div', { class: 'sub' }, `Sổ sách ${fmtNum(it.system)} ${it.unitName}`, diff ? h('span', { class: diff > 0 ? 'pos-c' : 'neg-c' }, ` · ${diff > 0 ? '+' : ''}${fmtNum(diff)}`) : null)), inp);
    }), items.length > 150 ? [h('div', { class: 'item small muted' }, `Còn ${items.length - 150} mặt hàng — dùng ô tìm kiếm để lọc`)] : []));
  }
  async function scan(code) {
    const hit = E.lookupBarcode(code); if (!hit) { toast('Không tìm thấy mã ' + code, 'error'); return; }
    await guard(() => E.addCount(id, hit.product.id, hit.qty || hit.unit.factor || 1)); toast(`${hit.product.name}: ${fmtNum(S.get('stocktakes', id).items.find(i => i.productId === hit.product.id).counted)}`, 'ok', 1200); drawAll();
  }
  const off = onScan(c => draft() && scan(c));
  const acts = st.status === 'draft' && E.can('manageStock') ? [{ label: 'Xoá phiếu', kind: 'danger', onClick: async close => { if (!(await confirmBox('Xoá phiếu kiểm này?', { danger: true, okText: 'Xoá' }))) return false; await guard(() => E.cancelStocktake(id)); close(); redraw(); } },
    { label: 'Hoàn tất & cân bằng kho', kind: 'primary', onClick: async close => {
      const sm = E.stocktakeSummary(S.get('stocktakes', id));
      if (!sm.counted) { toast('Chưa đếm mặt hàng nào', 'error'); return false; }
      if (!(await confirmBox(`Cân bằng kho cho ${sm.counted} mặt hàng đã đếm?\nThừa ${sm.over} (${fmtMoney(sm.overValue)}), thiếu ${sm.short} (${fmtMoney(sm.shortValue)}).\nHàng chưa đếm giữ nguyên.`, { okText: 'Cân bằng kho' }))) return false;
      const r = await guard(() => E.completeStocktake(id)); if (!r) return false; toast('Đã cân bằng kho', 'ok'); close(); redraw();
    } }] : [{ label: 'Đóng' }];
  modal({ title: st.name, size: 'wide', body: h('div', null, head, list), actions: acts, onClose: () => { off(); redraw(); } });
  drawAll();
}

/* ---------------- Xuất hủy ---------------- */
function writeoffTab(box, redraw) {
  const period = { key: 'month' }, list = h('div');
  const drawList = () => {
    const ws = S.list('writeOffs').filter(w => w.ts >= period.from && w.ts <= period.to).sort((a, b) => b.ts - a.ts);
    mount(list, h('div', { class: 'row between small muted mb8' }, h('span', null, `${ws.length} phiếu`), h('span', null, 'Giá trị hủy: ', h('b', { class: 'neg-c' }, fmtMoney(ws.reduce((a, w) => a + w.total, 0))))),
      ws.length ? h('div', { class: 'list' }, ws.map(w => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, w.code, ' ', badge(E.WRITEOFF_REASONS[w.reason])), h('div', { class: 'sub' }, `${fmtDateTime(w.ts)} · ${w.items.map(i => `${i.name} ×${fmtNum(i.qty)}`).join(', ')}`)), h('div', { class: 'bold neg-c' }, fmtMoney(w.total))))) : empty('Chưa có phiếu xuất hủy'));
  };
  mount(box, periodBar(period, drawList, { keys: ['today', '7d', 'month', 'lastmonth', 'year', 'custom'] }), E.can('manageStock') ? h('button', { class: 'btn primary block mb8', onClick: () => writeoffForm([], 'damaged', redraw) }, icon('plus', 18), ' Tạo phiếu xuất hủy') : null, list);
  drawList();
}
function writeoffForm(preset, reasonKey, done) {
  const rows = preset.map(x => ({ product: x.product, batch: x.batch || null, qty: x.qty }));
  const reason = select(Object.entries(E.WRITEOFF_REASONS), reasonKey || 'damaged'), note = h('input', { class: 'input', placeholder: 'Ghi chú' }), box = h('div');
  const draw = () => mount(box, rows.map((r, i) => { const q = qtyInput(r.qty); q.addEventListener('input', () => { r.qty = parseQty(q.value); });
    return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('div', null, h('b', null, r.product.name), r.batch ? h('div', { class: 'small muted' }, `Lô ${r.batch.lot || '—'} · HSD ${r.batch.expiry || '—'}`) : null), iconBtn('x', () => { rows.splice(i, 1); draw(); })),
      field(`Số lượng hủy (${r.product.units[0].name}) · tồn ${fmtNum(r.batch ? r.batch.qty : r.product.stock)}`, q)); }), rows.length ? null : empty('Chưa chọn hàng'));
  modal({ title: 'Phiếu xuất hủy', size: 'wide', body: h('div', null, field('Lý do', reason), box, h('button', { class: 'btn block mb8', onClick: async () => { const p = await pickProduct({ title: 'Chọn hàng cần hủy' }); if (p) { rows.push({ product: p, batch: null, qty: 1 }); draw(); } } }, '+ Thêm hàng'), field('Ghi chú', note)),
    actions: [{ label: 'Huỷ' }, { label: 'Xác nhận xuất hủy', kind: 'danger', onClick: async () => {
      if (!rows.length) { toast('Chưa chọn hàng', 'error'); return false; }
      const r = await guard(() => E.createWriteOff({ reason: reason.value, note: note.value, items: rows.map(x => ({ productId: x.product.id, unitId: x.product.units[0].id, qty: x.qty, batchId: x.batch && x.batch.id })) }));
      if (!r) return false; toast(`Đã xuất hủy ${r.code} – ${fmtMoney(r.total)}`, 'ok'); done && done();
    } }] });
  draw();
}

/* ---------------- Gợi ý đặt hàng ---------------- */
function orderTab(box) {
  const groups = E.suggestOrders(), store = E.settings().store.name;
  mount(box, h('div', { class: 'banner blue mb8' }, `Gợi ý dựa trên tồn tối thiểu và tốc độ bán 30 ngày gần nhất (đủ bán ${E.settings().stock.reorderCoverDays} ngày). Gom theo nhà cung cấp nhập gần nhất.`),
    groups.length ? groups.map(g => h('div', { class: 'card' }, h('div', { class: 'row between mb8' }, h('h3', { style: { margin: 0 } }, g.supplier ? g.supplier.name : 'Chưa rõ nhà cung cấp'),
      h('button', { class: 'btn sm', onClick: () => shareText(E.orderText(g, store), 'Đặt hàng') }, icon('share', 16), ' Gửi / sao chép')),
      h('div', { class: 'list' }, g.items.map(x => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.product.name), h('div', { class: 'sub' }, `Tồn ${fmtNum(x.stock)} · bán ~${x.avgDaily}/ngày`)), h('div', { class: 'bold pos-c' }, '+' + fmtNum(x.need) + ' ' + x.unit)))))) : h('div', { class: 'card' }, empty('Chưa cần đặt thêm hàng nào 👍', 'Đặt "Tồn tối thiểu" cho từng mặt hàng để được gợi ý chính xác hơn.')));
}
