/* Màn hình bán hàng (POS): quét/tìm hàng, giỏ, đơn treo, khách, giảm giá, thanh toán, hoá đơn. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, modal, toast, guard, confirmBox, promptBox, moneyInput, qtyInput, field, select, pickFromList, badge, kv, debounce, tint } from '../ui.js';
import { fmtMoney, fmtNum, parseQty, parseMoney, DAY, dayStart } from '../util.js';
import { beep, openScanner, onScan, canScan, printReceipt, shareText, boostBrightness, restoreBrightness } from '../native.js';
import { receiptText } from '../receipt.js';
import { QR } from '../lib/qr.js';
import { VietQR } from '../lib/vietqr.js';
import { lsGet, lsSet } from '../theme.js';

const CART_KEY = 'taphoa.cart';
const emptyCart = () => ({ lines: [], customerId: null, discount: null, voucher: '', note: '', pointsUse: 0 });
let cart = (() => { try { return Object.assign(emptyCart(), JSON.parse(lsGet(CART_KEY) || '{}')); } catch (e) { return emptyCart(); } })();
let holdId = null;
const saveCart = () => lsSet(CART_KEY, cart.lines.length ? JSON.stringify(cart) : null);

let _topVer = -1, _top = [];
function quickProducts() {
  if (_topVer !== S.ver.sales + ':' + S.ver.products) {
    const now = Date.now(), ids = E.topProducts(dayStart(now) - 30 * DAY, now, { by: 'qty', limit: 30 }).map(r => r.productId);
    const set = new Set(ids);
    _top = ids.map(id => S.get('products', id)).filter(p => p && p.active);
    if (_top.length < 30) _top = _top.concat(S.list('products').filter(p => p.active && !set.has(p.id)).sort((a, b) => a.name.localeCompare(b.name, 'vi')).slice(0, 30 - _top.length));
    _topVer = S.ver.sales + ':' + S.ver.products;
  }
  return _top;
}

export function viewPos(root, ctx) {
  let calc = null, quickCat = '', q = '', cartOpen = false, allLimit = 120;
  const searchInput = h('input', { class: 'input', placeholder: 'Quét mã vạch hoặc gõ tên hàng…', autocomplete: 'off', enterkeyhint: 'search' });
  const chipsBox = h('div', { class: 'chips pos-chips', 'data-swipe': 'chips' });
  const gridBox = h('div', { class: 'pos-grid' });
  const cartBar = h('button', { class: 'cartbar hide', onClick: () => openCart() });
  const cartBox = h('div', { class: 'pos-cart' });
  const foot = h('div', { class: 'pos-foot' });
  const cpTitle = h('div', { class: 'grow' });
  const cpClear = h('button', { class: 'btn sm ghost neg-c' }, 'Xoá hết');
  const cartPage = h('div', { class: 'cartpage' },
    h('div', { class: 'cp-head' }, h('button', { class: 'iconbtn cp-back', title: 'Tiếp tục chọn hàng', 'aria-label': 'Quay lại chọn hàng', onClick: () => closeCart() }, icon('back')), cpTitle, cpClear), cartBox, foot);
  const holdBtn = h('button', { class: 'iconbtn', title: 'Đơn đang treo', onClick: () => openHolds() }, icon('pause'));
  const scanBtn = h('button', { class: 'iconbtn', title: 'Quét bằng camera', onClick: () => scanLoop() }, icon('scan'));
  const tiles = new Map();        // productId -> { tile, badge, minus }: chỉ cập nhật số lượng trên ô, không vẽ lại lưới (giữ nguyên vị trí cuộn)

  /* ---------- Giỏ hàng: mở / đóng ---------- */
  function openCart() { if (!cart.lines.length) return; cartOpen = true; cartPage.classList.add('open'); }
  function closeCart() { cartOpen = false; cartPage.classList.remove('open'); }
  const qtyInCart = pid => Math.round(cart.lines.filter(l => l.productId === pid).reduce((s, l) => s + l.qty * ((S.get('products', pid) || { units: [] }).units.find(u => u.id === l.unitId) || { factor: 1 }).factor, 0) * 1000) / 1000;

  /* ---------- Thêm / bớt hàng ---------- */
  function addLine(p, unit, qty = 1) {
    unit = unit || p.units[0];
    const ex = cart.lines.find(l => l.productId === p.id && l.unitId === unit.id && l.price == null && !l.discount);
    if (ex) ex.qty = Math.round((ex.qty + qty) * 1000) / 1000;
    else cart.lines.push({ productId: p.id, unitId: unit.id, qty });
    changed(); beep('ok');
    if (!cartOpen) toast('+ ' + p.name, 'ok', 900);
    else setTimeout(() => { cartBox.scrollTop = cartBox.scrollHeight; }, 20);
  }
  function removeOne(p) {       // nút "−" trên ô sản phẩm: bớt một đơn vị cơ bản ở dòng gần nhất
    const i = cart.lines.map(l => l.productId).lastIndexOf(p.id); if (i < 0) return;
    const l = cart.lines[i], step = p.kind === 'weight' ? 0.1 : 1;
    if (l.qty - step <= 0.0001) cart.lines.splice(i, 1); else l.qty = Math.round((l.qty - step) * 1000) / 1000;
    changed();
  }
  async function addProductTap(p) {
    if (p.kind === 'weight') {
      const v = await promptBox({ title: p.name, label: `Nhập khối lượng (${p.units[0].name})`, type: 'qty', hint: 'VD: 0,5 hoặc 1,25', okText: 'Thêm' });
      const n = parseQty(v); if (v === null) return;
      if (!(n > 0)) return toast('Khối lượng không hợp lệ', 'error');
      return addLine(p, p.units[0], n);
    }
    addLine(p, p.units[0], 1);
  }
  async function addByCode(code) {
    const hit = E.lookupBarcode(code);
    if (hit) { if (hit.qty) addLine(hit.product, hit.unit, hit.qty); else if (hit.product.kind === 'weight') await addProductTap(hit.product); else addLine(hit.product, hit.unit, 1); return true; }
    return false;
  }
  async function scanLoop() {
    await openScanner({ continuous: true, onCode: async code => {
      if (!(await addByCode(code))) { beep('bad'); toast('Không tìm thấy mã ' + code, 'error'); }
      return 'keep';
    } });
  }

  /* ---------- Tìm kiếm: lọc ngay trên lưới sản phẩm ---------- */
  const clearSearch = () => { searchInput.value = ''; q = ''; renderCatalog(); };
  searchInput.addEventListener('input', debounce(() => { q = searchInput.value.trim(); allLimit = 120; renderCatalog(); }, 120));
  searchInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const v = searchInput.value.trim(); if (!v) return;
    if (await addByCode(v)) return clearSearch();
    const r = E.searchProducts(v, { limit: 3 });
    if (r.length === 1) { clearSearch(); addProductTap(r[0]); } else if (!r.length) { beep('bad'); toast('Không tìm thấy "' + v + '"', 'error'); }
  });
  const offScan = onScan(async code => { if (!(await addByCode(code))) { beep('bad'); toast('Không tìm thấy mã ' + code, 'error'); } else if (q) clearSearch(); });
  const onDocKey = e => { // gõ bất kỳ đâu → vào ô tìm (trừ khi đang ở ô nhập khác/hộp thoại/giỏ hàng)
    if (cartOpen || document.querySelector('.overlay') || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (/^(input|textarea|select)$/i.test(document.activeElement.tagName)) return;
    searchInput.focus();
  };
  document.addEventListener('keydown', onDocKey);

  /* ---------- Khách hàng, giảm giá, mã ---------- */
  async function pickCustomer() {
    const items = E.searchCustomers('', { limit: 500 });
    const r = await pickFromList({
      title: 'Chọn khách hàng', items, allowNone: true, noneLabel: 'Khách lẻ (không lưu)', searchPlaceholder: 'Tìm tên hoặc số điện thoại…',
      match: (c, qn) => c.nameNorm.includes(qn.toLowerCase()) || (c.phone || '').includes(qn) || E.searchCustomers(qn).some(x => x.id === c.id),
      render: c => [h('div', { class: 'thumb' }, c.name.slice(0, 1)), h('div', { class: 'grow' }, h('div', { class: 'ttl' }, c.name), h('div', { class: 'sub' }, [c.phone, E.CUSTOMER_GROUPS[c.group]].filter(Boolean).join(' · '))),
        c.debt > 0 ? badge('Nợ ' + fmtMoney(c.debt), 'red') : null]
    });
    if (r === undefined) return;
    cart.customerId = r ? r.id : null; cart.pointsUse = 0; changed();
  }
  async function newCustomer() {
    const name = h('input', { class: 'input', placeholder: 'Tên khách' }), phone = h('input', { class: 'input', placeholder: 'Số điện thoại', inputMode: 'tel' });
    modal({ title: 'Thêm khách hàng', body: h('div', null, field('Tên', name), field('Điện thoại', phone)), actions: [{ label: 'Huỷ' }, { label: 'Lưu & chọn', kind: 'primary', onClick: async () => {
      const c = await guard(() => E.saveCustomer({ name: name.value, phone: phone.value })); if (!c) return false; cart.customerId = c.id; changed();
    } }] });
  }
  async function editDiscount() {
    const type = select([['amount', 'Số tiền (đ)'], ['percent', 'Phần trăm (%)']], cart.discount ? cart.discount.type : 'amount');
    const val = moneyInput(cart.discount ? cart.discount.value : 0);
    modal({ title: 'Giảm giá cả đơn', body: h('div', null, field('Hình thức', type), field('Giá trị', val), h('div', { class: 'small muted' }, `Bạn được giảm tối đa ${E.maxDiscountPct()}% giá trị đơn.`)),
      actions: [{ label: 'Bỏ giảm giá', onClick: () => { cart.discount = null; changed(); } }, { label: 'Áp dụng', kind: 'primary', onClick: () => { const v = val.num; cart.discount = v > 0 ? { type: type.value, value: v } : null; changed(); } }] });
  }
  async function editVoucher() {
    const v = await promptBox({ title: 'Mã giảm giá', label: 'Nhập mã khuyến mãi', value: cart.voucher, placeholder: 'VD: GIAM20' });
    if (v === null) return; cart.voucher = v.trim().toUpperCase(); changed();
    if (cart.voucher) { const c = E.calcCart(cart), hit = c.promoIds.some(id => (S.get('promos', id) || {}).code === cart.voucher); toast(hit ? 'Đã áp dụng mã ' + cart.voucher : 'Mã chưa áp dụng được (sai mã, hết hạn hoặc đơn chưa đủ điều kiện)', hit ? 'ok' : 'error'); }
  }
  async function editPoints(c) {
    const st = E.settings().sale, max = Math.min(c.customer.points, Math.floor(c.total / st.pointValue));
    const v = await promptBox({ title: 'Đổi điểm thưởng', label: `Khách có ${c.customer.points} điểm (1 điểm = ${fmtMoney(st.pointValue)}). Đổi tối đa ${max} điểm cho đơn này.`, value: String(cart.pointsUse || ''), type: 'number' });
    if (v === null) return; cart.pointsUse = Math.max(0, Math.min(max, Math.floor(parseQty(v)))); changed();
  }

  /* ---------- Dòng hàng ---------- */
  async function lineMenu(i) {
    const l = cart.lines[i], p = S.get('products', l.productId);
    const m = modal({ title: p ? p.name : 'Dòng hàng', body: h('div', { class: 'col' },
      h('button', { class: 'btn block', onClick: async () => { m.close(); const v = await promptBox({ title: 'Giảm giá dòng này', type: 'money', value: String(l.discount || 0), label: 'Số tiền giảm cho cả dòng (đ)' }); if (v === null) return; l.discount = Math.max(0, parseMoney(v)) || undefined; changed(); } }, 'Giảm giá dòng'),
      h('button', { class: 'btn block', onClick: async () => { m.close(); const v = await promptBox({ title: 'Ghi chú dòng', value: l.note || '' }); if (v === null) return; l.note = v.trim(); changed(); } }, 'Ghi chú'),
      h('button', { class: 'btn danger block', onClick: () => { m.close(); cart.lines.splice(i, 1); changed(); } }, 'Xoá khỏi giỏ')) });
  }
  async function editPrice(i, c) {
    if (!E.can('editPrice')) return toast('Bạn không có quyền sửa giá', 'error');
    const l = cart.lines[i], cl = c.lines[i];
    const v = await promptBox({ title: 'Sửa giá bán', type: 'money', value: String(cl.price), label: `Giá niêm yết: ${fmtMoney(cl.listPrice)} / ${cl.unitName}`, hint: 'Để trống hoặc 0 rồi Đồng ý = dùng lại giá niêm yết.' });
    if (v === null) return; const n = parseMoney(v); if (n > 0) l.price = n; else delete l.price; changed();
  }
  async function editQty(i, cl) {
    const v = await promptBox({ title: cl.name, label: `Số lượng (${cl.unitName})`, type: 'qty', value: String(cl.qty).replace('.', ',') });
    if (v === null) return; const n = parseQty(v);
    if (n > 0) cart.lines[i].qty = n; else cart.lines.splice(i, 1); changed();
  }

  /* ---------- Vẽ ---------- */
  function changed() { saveCart(); render(); }
  function render() {
    try { calc = E.calcCart(cart); }
    catch (e) { if (e.name === 'AppError') { toast(e.message, 'error'); const bad = cart.lines.findIndex(l => !S.get('products', l.productId)); if (bad >= 0) cart.lines.splice(bad, 1); else cart.lines.pop(); saveCart(); return render(); } throw e; }
    const holds = E.listHolds();
    mount(holdBtn, icon('pause'), holds.length ? h('span', { class: 'dot' }, holds.length) : null);
    if (!cart.lines.length && cartOpen) closeCart();
    updateTiles(); renderCartBar(); renderCartPage();
  }

  /* --- Danh sách sản phẩm (chiếm gần hết màn hình) --- */
  function catalogList() {
    if (q) return E.searchProducts(q, { limit: 150 });
    if (quickCat === '*') return E.searchProducts('', { limit: allLimit });
    if (quickCat) return E.searchProducts('', { categoryId: quickCat, limit: 200 });
    return quickProducts();
  }
  function renderCatalog() {
    const cats = E.categoryTree().filter(x => x.depth === 0);
    const chip = (key, label) => h('span', { class: 'chip ' + (!q && quickCat === key ? 'on' : ''), 'data-sw': '', onClick: () => { quickCat = key; allLimit = 120; if (q) { searchInput.value = ''; q = ''; } renderCatalog(); } }, label);
    mount(chipsBox, chip('', 'Hay bán'), chip('*', 'Tất cả'), cats.map(({ cat }) => chip(cat.id, cat.name)));
    const list = catalogList();
    tiles.clear();
    const more = !q && quickCat === '*' && list.length >= allLimit;
    mount(gridBox, list.length ? [h('div', { class: 'qgrid' }, list.map(p => {
      const badge_ = h('span', { class: 'qbadge hide' }), minus = h('span', { class: 'qminus hide', role: 'button', 'aria-label': 'Bớt 1', onClick: e => { e.stopPropagation(); removeOne(p); } }, '−');
      const tile = h('button', { class: 'qitem', onClick: () => addProductTap(p) }, badge_, minus, h('div', { class: 'n' }, p.name),
        h('div', { class: 'row between' }, h('span', { class: 'p' }, fmtNum(p.units[0].price) + (p.kind === 'weight' ? '/' + p.units[0].name : '')), p.stock <= 0 ? badge('Hết', 'red') : h('span', { class: 'tiny muted' }, fmtNum(p.stock))));
      tiles.set(p.id, { tile, badge: badge_, minus });
      return tile;
    })), more ? h('button', { class: 'btn block mt12', onClick: () => { allLimit += 150; renderCatalog(); } }, 'Xem thêm sản phẩm') : null]
      : h('div', { class: 'empty' }, q ? 'Không tìm thấy "' + q + '"' : 'Chưa có hàng hóa. Vào mục Hàng hóa để thêm.'));
    updateTiles();
  }
  function updateTiles() {
    for (const [pid, t] of tiles) {
      const n = qtyInCart(pid);
      t.tile.classList.toggle('inc', n > 0);
      t.badge.classList.toggle('hide', !(n > 0)); t.minus.classList.toggle('hide', !(n > 0));
      if (n > 0) t.badge.textContent = '×' + fmtNum(n);
    }
  }

  /* --- Thanh giỏ hàng thu gọn: chỉ hiện khi có hàng, chạm vào mới mở giỏ --- */
  function renderCartBar() {
    cartBar.classList.toggle('hide', !cart.lines.length);
    if (!cart.lines.length) return;
    mount(cartBar, h('span', { class: 'cnt' }, icon('cart', 22), h('i', null, fmtNum(calc.itemCount))), h('span', { class: 'grow left' }, h('span', { class: 'lbl' }, `${calc.lines.length} mặt hàng`), h('span', { class: 'sum' }, fmtMoney(calc.total))),
      h('span', { class: 'go' }, 'Xem giỏ hàng', icon('chevron', 18)));
  }

  /* --- Trang giỏ hàng (chỉ hiện khi người dùng chạm vào thanh giỏ hàng) --- */
  function renderCartPage() {
    mount(cpTitle, h('div', { class: 'bold', style: { fontSize: '18px' } }, 'Giỏ hàng'), h('div', { class: 'small muted' }, `${calc.lines.length} mặt hàng · ${fmtNum(calc.itemCount)} sản phẩm`));
    cpClear.onclick = async () => { if (await confirmBox('Xoá toàn bộ giỏ hàng?', { danger: true, okText: 'Xoá' })) { cart = emptyCart(); holdId = null; changed(); } };
    cpClear.classList.toggle('hide', !cart.lines.length);
    const shiftBanner = E.settings().sale.requireShift && !E.currentShift() ? h('div', { class: 'banner mb8' }, 'Chưa mở ca làm việc. ', h('a', { href: '#/cash', style: { fontWeight: 700 } }, 'Mở ca ngay')) : null;
    const cust = calc.customer;
    const top = h('div', { class: 'row mb8' },
      h('button', { class: 'btn sm cust ' + (cust ? 'soft' : ''), onClick: pickCustomer }, icon('user', 16), h('span', { class: 'nm' }, cust ? cust.name : 'Khách lẻ'), cust && cust.debt > 0 ? h('span', { class: 'neg-c tiny nowrap' }, ' nợ ' + fmtNum(cust.debt)) : null),
      cust && E.settings().sale.pointsPer > 0 ? h('button', { class: 'btn sm', onClick: () => editPoints(calc) }, `★ ${cust.points} điểm`) : null,
      h('div', { class: 'grow' }),
      h('button', { class: 'btn sm', onClick: editVoucher }, icon('tag', 16), cart.voucher || 'Mã giảm giá'));
    const lines = calc.lines.map((cl, i) => {
      const p = S.get('products', cl.productId), line = cart.lines[i];
      const warn = calc.warnings.filter(w => w.productId === cl.productId);
      return h('div', { class: 'cl' },
        h('div', { class: 'top' }, h('div', { class: 'nm' }, cl.name, h('div', { class: 'tiny muted' }, cl.sku + (cl.note ? ' · ' + cl.note : ''))),
          h('div', { class: 'bold nowrap' }, fmtMoney(cl.total)), h('button', { class: 'iconbtn', style: { width: '28px', height: '28px' }, onClick: () => lineMenu(i) }, icon('more', 18))),
        h('div', { class: 'bot' },
          p.units.length > 1 ? select(p.units.map(u => [u.id, u.name]), cl.unitId, { style: { width: 'auto', minHeight: '36px', padding: '4px 8px' }, onChange: e => { line.unitId = e.target.value; delete line.price; changed(); } }) : h('span', { class: 'muted small' }, cl.unitName),
          h('div', { class: 'stepper' }, h('button', { onClick: () => { if (cl.qty <= 1 && p.kind === 'count') { cart.lines.splice(i, 1); } else line.qty = Math.max(p.kind === 'weight' ? 0.05 : 1, Math.round((cl.qty - (p.kind === 'weight' ? 0.1 : 1)) * 1000) / 1000); changed(); } }, '−'),
            h('button', { class: 'q', onClick: () => editQty(i, cl) }, fmtNum(cl.qty)),
            h('button', { onClick: () => { line.qty = Math.round((cl.qty + (p.kind === 'weight' ? 0.1 : 1)) * 1000) / 1000; changed(); } }, '+')),
          h('span', null, '×'), h('button', { class: 'btn sm ' + (cl.overridden ? 'soft' : ''), onClick: () => editPrice(i, calc) }, fmtNum(cl.price), cl.overridden ? ' ✎' : ''),
          cl.manualDiscount ? badge('-' + fmtNum(cl.manualDiscount), 'amber') : null,
          ...cl.promoNames.map(n => badge('KM: ' + n, 'green'))),
        warn.map(w => h('div', { class: 'tiny ' + (w.code === 'expired' || w.code === 'below_cost' ? 'neg-c' : 'warn-c'), style: { marginTop: '4px' } }, '⚠ ' + w.text)));
    });
    mount(cartBox, shiftBanner, top, lines.length ? lines : h('div', { class: 'empty' }, icon('cart', 40), h('div', null, 'Giỏ hàng trống')));
    const disc = calc.discountTotal;
    mount(foot, h('div', { class: 'row between' },
      h('div', null, disc > 0 ? h('div', { class: 'small' }, 'Tạm tính ', h('s', { class: 'muted' }, fmtMoney(calc.subtotal)), h('span', { class: 'pos-c' }, ` giảm ${fmtMoney(disc)}`)) : h('div', { class: 'small muted' }, 'Tổng thanh toán'),
        h('div', { class: 'tot' }, fmtMoney(calc.total))),
      h('div', { class: 'row foot-btns' }, h('button', { class: 'btn', disabled: !cart.lines.length, onClick: editDiscount, title: 'Giảm giá cả đơn' }, icon('tag', 18), cart.discount ? (cart.discount.type === 'percent' ? cart.discount.value + '%' : fmtNum(cart.discount.value)) : 'Giảm'),
        h('button', { class: 'btn', disabled: !cart.lines.length, onClick: holdCart, title: 'Treo đơn' }, icon('pause', 18)),
        h('button', { class: 'btn primary lg', disabled: !cart.lines.length, onClick: () => openPayment(calc) }, 'Thanh toán'))));
  }

  /* ---------- Đơn treo ---------- */
  async function holdCart() {
    const name = await promptBox({ title: 'Treo đơn', label: 'Đặt tên để dễ nhận ra (có thể bỏ trống)', value: calc.customer ? calc.customer.name : '' });
    if (name === null) return;
    const r = await guard(() => E.saveHold({ id: holdId, name: name.trim(), cart })); if (!r) return;
    cart = emptyCart(); holdId = null; changed(); toast('Đã treo đơn', 'ok');
  }
  function openHolds() {
    const draw = () => {
      const hs = E.listHolds();
      mount(m.body, hs.length ? h('div', { class: 'list' }, hs.map(x => {
        let total = 0; try { total = E.calcCart(x.cart).total; } catch (e) {}
        return h('div', { class: 'item' }, h('div', { class: 'grow click', onClick: () => resume(x) }, h('div', { class: 'ttl' }, x.name || 'Đơn treo'), h('div', { class: 'sub' }, `${x.cart.lines.length} mặt hàng · ${new Date(x.ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`)),
          h('div', { class: 'bold' }, fmtMoney(total)), iconBtn('trash', async () => { if (await confirmBox('Xoá đơn treo này?', { danger: true, okText: 'Xoá' })) { E.deleteHold(x.id); draw(); render(); } }, 'Xoá'));
      })) : h('div', { class: 'empty' }, 'Không có đơn nào đang treo'));
    };
    const resume = async x => {
      if (cart.lines.length) await guard(() => E.saveHold({ id: holdId, name: 'Đơn dở dang', cart }));
      cart = Object.assign(emptyCart(), JSON.parse(JSON.stringify(x.cart))); holdId = null; E.deleteHold(x.id); m.close(); changed();
    };
    const m = modal({ title: 'Đơn đang treo', body: h('div') }); draw();
  }

  /* ---------- Thanh toán ---------- */
  function openPayment(c) {
    const total = c.total, cust = c.customer, bank = E.settings().bank;
    const transfer = moneyInput(0, { onInput: upd }), debt = moneyInput(0, { onInput: upd }), given = moneyInput(total, { onInput: () => { givenTouched = true; upd(); } });
    let givenTouched = false, qrOn = false;
    const info = h('div'), qrBox = h('div', { class: 'hide' }), quick = h('div', { class: 'row wrap' });
    const needCash = () => total - transfer.num - debt.num;
    function upd() {
      const nc = needCash();
      if (!givenTouched) given.num = Math.max(0, nc);
      const change = given.num - Math.max(0, nc);
      mount(info, kv('Cần thu', fmtMoney(total)),
        nc < 0 ? h('div', { class: 'banner red' }, 'Tổng chuyển khoản + ghi nợ vượt quá số tiền cần thu') : null,
        kv('Tiền mặt phải thu', fmtMoney(Math.max(0, nc))),
        nc > 0 ? (given.num < nc ? kv('Còn thiếu', fmtMoney(nc - given.num), 'neg-c') : kv('Tiền thừa trả khách', fmtMoney(change), 'pos-c')) : null);
      const sug = nc > 0 ? Array.from(new Set([nc, ...[10000, 20000, 50000, 100000, 200000, 500000].map(s => Math.ceil(nc / s) * s)])).filter(v => v >= nc).slice(0, 5) : [];
      mount(quick, sug.map(v => h('button', { class: 'btn sm', onClick: () => { givenTouched = true; given.num = v; upd(); } }, v === nc ? 'Đủ tiền' : fmtNum(v))));
      if (qrOn) drawQr();
    }
    function drawQr() {
      const amt = transfer.num || total;
      if (!bank.bin || !bank.account) { mount(qrBox, h('div', { class: 'banner' }, 'Chưa cài tài khoản ngân hàng. Vào Cài đặt → Thanh toán để nhập số tài khoản.')); qrBox.classList.remove('hide'); return; }
      let svg; try { svg = QR.svg(VietQR.payload({ bin: bank.bin, account: bank.account, amount: amt, info: 'Thanh toan don hang' }), { label: 'VietQR' }); } catch (e) { svg = null; mount(qrBox, h('div', { class: 'banner red' }, e.message)); }
      if (svg) mount(qrBox, h('div', { class: 'qr-box', html: svg }), h('div', { class: 'center bold' }, `${bank.name || ''}`), h('div', { class: 'center small muted' }, `STK ${bank.account} · ${fmtMoney(amt)}`));
      qrBox.classList.remove('hide');
    }
    const body = h('div', null,
      h('div', { class: 'bigmoney' }, fmtMoney(total)), h('div', { class: 'center small muted mb8' }, cust ? 'Khách: ' + cust.name : 'Khách lẻ'),
      field('Tiền khách đưa (tiền mặt)', given), quick,
      h('div', { class: 'row mt12' }, h('div', { class: 'grow' }, field('Chuyển khoản / VietQR', transfer)), h('button', { class: 'btn sm', style: { marginTop: '10px' }, onClick: () => { transfer.num = total; debt.num = 0; givenTouched = false; qrOn = true; boostBrightness(); upd(); } }, 'Cả đơn')),
      h('div', { class: 'row' }, h('button', { class: 'btn sm soft', onClick: () => { qrOn = !qrOn; if (qrOn) { boostBrightness(); drawQr(); } else { restoreBrightness(); qrBox.classList.add('hide'); } } }, icon('qr', 16), ' Hiện mã VietQR')),
      qrBox,
      cust ? h('div', { class: 'row mt12' }, h('div', { class: 'grow' }, field('Ghi nợ' + (cust.debtLimit ? ` (hạn mức ${fmtNum(cust.debtLimit)}, đang nợ ${fmtNum(cust.debt)})` : ` (đang nợ ${fmtNum(cust.debt)})`), debt)),
        h('button', { class: 'btn sm', style: { marginTop: '10px' }, onClick: () => { debt.num = total; transfer.num = 0; givenTouched = false; upd(); } }, 'Cả đơn')) : null,
      h('div', { class: 'mt12' }, info));
    const m = modal({ title: 'Thanh toán', body, size: 'wide', onClose: restoreBrightness, actions: [{ label: 'Quay lại' }, { label: 'Xác nhận thanh toán', kind: 'primary', onClick: async () => {
      const nc = needCash();
      if (nc < 0) { toast('Số tiền thanh toán không hợp lệ', 'error'); return false; }
      if (nc > 0 && given.num < nc) { toast('Tiền khách đưa chưa đủ', 'error'); return false; }
      const payments = [];
      if (nc > 0) payments.push({ method: 'cash', amount: nc });
      if (transfer.num > 0) payments.push({ method: bank.bin && qrOn ? 'vietqr' : 'transfer', amount: transfer.num });
      if (debt.num > 0) payments.push({ method: 'debt', amount: debt.num });
      let sale;
      try { sale = E.createSale(cart, payments, { cashGiven: nc > 0 ? given.num : undefined, holdId }); }
      catch (e) {
        if (e.code === 'debt_limit' && E.settings().sale.debtOverLimit === 'warn' && await confirmBox(e.message + '\nVẫn tiếp tục ghi nợ?', { okText: 'Vẫn ghi nợ' })) {
          sale = await guard(() => E.createSale(cart, payments, { cashGiven: nc > 0 ? given.num : undefined, holdId, confirmOverLimit: true }));
        } else { toast(e.name === 'AppError' ? e.message : 'Lỗi: ' + e.message, 'error'); return false; }
      }
      if (!sale) return false;
      cart = emptyCart(); holdId = null; saveCart(); beep('ok'); render();
      setTimeout(() => showReceipt(sale), 60);
    } }] });
    upd(); setTimeout(() => { given.focus(); }, 80);
  }
  function showReceipt(sale) {
    const cfg = E.settings().print;
    if (cfg.autoPrint) printReceipt(sale);
    const m = modal({ title: 'Đã thanh toán ✔', body: h('div', null,
      h('div', { class: 'bigmoney pos-c' }, fmtMoney(sale.total)), sale.change > 0 ? h('div', { class: 'center bold' }, 'Tiền thừa trả khách: ' + fmtMoney(sale.change)) : null,
      h('div', { class: 'center small muted mb8' }, sale.code), h('div', { class: 'receipt' }, receiptText(sale, cfg.paper === 80 ? 48 : 32))),
      actions: [{ label: 'In hoá đơn', onClick: () => { printReceipt(sale); return false; } }, { label: 'Chia sẻ', onClick: () => { shareText(receiptText(sale), sale.code); return false; } }, { label: 'Bán tiếp', kind: 'primary' }] });
    void m;
  }

  /* ---------- Khung ---------- */
  ctx.setActions(holdBtn, iconBtn('receipt', () => ctx.go('sales'), 'Lịch sử hoá đơn'));
  mount(root, h('div', { class: 'pos' },
    h('div', { class: 'pos-search' }, h('span', { class: 'sicon' }, icon('search')), h('div', { class: 'row' }, h('div', { class: 'grow' }, searchInput), scanBtn)),
    h('div', { class: 'pos-catalog' }, chipsBox, gridBox), cartBar, cartPage));
  renderCatalog();
  render();
  if (!canScan()) scanBtn.title = 'Thiết bị không hỗ trợ quét bằng camera – dùng máy quét hoặc gõ mã';
  return () => { offScan(); document.removeEventListener('keydown', onDocKey); };
}
