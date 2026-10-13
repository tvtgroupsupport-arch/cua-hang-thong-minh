/* Hàng hóa: danh sách, thêm/sửa (đa đơn vị, đa mã vạch, bậc giá, lô/HSD), nhóm hàng, đổi giá hàng loạt, nhập/xuất CSV. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, modal, toast, guard, confirmBox, promptBox, field, select, checkbox, badge, kv, empty, moneyInput, qtyInput, debounce, tabs } from '../ui.js';
import { fmtMoney, fmtNum, fmtDateTime, fmtDate, parseQty, parseMoney, ean13Check, ymd } from '../util.js';
import { openScanner, onScan, canScan, saveFile, pickFile, readFileText, resizeImage } from '../native.js';

const thumb = (p, size) => h('div', { class: 'thumb', style: size ? { width: size + 'px', height: size + 'px' } : null }, p.image ? h('img', { src: p.image }) : p.name.slice(0, 1).toUpperCase());
const catOptions = () => [['', '— Chưa phân nhóm —'], ...E.categoryTree().map(({ cat, depth }) => [cat.id, '  '.repeat(depth) + cat.name])];

export function viewProducts(root, ctx) {
  let q = '', catId = '', onlyLow = false, showInactive = false, limit = 60;
  const canEdit = E.can('manageProducts'), viewCost = E.can('viewCost');
  const listBox = h('div'), chipsBox = h('div');
  const search = h('input', { class: 'input', placeholder: 'Tìm tên, mã vạch, SKU…', onInput: debounce(e => { q = e.target.value.trim(); limit = 60; draw(); }, 150) });

  async function scanFind() {
    await openScanner({ onCode: code => { const hit = E.lookupBarcode(code); if (hit) openDetail(hit.product.id); else if (canEdit) { productForm(null, { barcode: code, onSaved: draw }); toast('Mã mới – thêm sản phẩm', ''); } else toast('Không có hàng với mã ' + code, 'error'); } });
  }
  const offScan = onScan(code => { const hit = E.lookupBarcode(code); if (hit) openDetail(hit.product.id); else if (canEdit) productForm(null, { barcode: code, onSaved: draw }); else toast('Không có hàng với mã ' + code, 'error'); });

  function draw() {
    const cats = E.categoryTree().filter(x => x.depth === 0);
    mount(chipsBox, h('div', { class: 'chips' }, h('span', { class: 'chip ' + (!catId && !onlyLow ? 'on' : ''), onClick: () => { catId = ''; onlyLow = false; draw(); } }, 'Tất cả'),
      h('span', { class: 'chip ' + (onlyLow ? 'on' : ''), onClick: () => { onlyLow = !onlyLow; draw(); } }, '⚠ Sắp hết'),
      cats.map(({ cat }) => h('span', { class: 'chip ' + (catId === cat.id ? 'on' : ''), onClick: () => { catId = catId === cat.id ? '' : cat.id; draw(); } }, cat.name)),
      h('span', { class: 'chip ' + (showInactive ? 'on' : ''), onClick: () => { showInactive = !showInactive; draw(); } }, 'Ngừng bán')));
    let list = E.searchProducts(q, { categoryId: catId || undefined, activeOnly: !showInactive, onlyLow, limit: 100000 });
    if (showInactive) list = list.filter(p => !p.active);
    const total = list.length, shown = list.slice(0, limit);
    mount(listBox, h('div', { class: 'small muted mb8' }, `${total} mặt hàng`), shown.length ? h('div', { class: 'list' }, shown.map(p => h('div', { class: 'item click', onClick: () => openDetail(p.id) },
      thumb(p), h('div', { class: 'grow' }, h('div', { class: 'ttl ellipsis' }, p.name, !p.active ? ' ' : '', !p.active ? badge('Ngừng bán') : null),
        h('div', { class: 'sub ellipsis' }, [p.sku, E.categoryPath(p.categoryId), (p.units[0].barcodes || [])[0]].filter(Boolean).join(' · '))),
      h('div', { class: 'right' }, h('div', { class: 'bold' }, fmtMoney(p.units[0].price)), h('div', { class: 'small ' + (p.stock <= 0 ? 'neg-c' : p.stock <= p.minStock ? 'warn-c' : 'muted') }, `Tồn ${fmtNum(p.stock)} ${p.units[0].name}`))))) : empty(q ? 'Không tìm thấy hàng phù hợp' : 'Chưa có hàng hóa nào', canEdit ? 'Bấm nút + để thêm hàng, hoặc nhập từ tệp CSV ở menu ⋯' : ''),
      total > limit ? h('button', { class: 'btn block mt8', onClick: () => { limit += 100; draw(); } }, `Xem thêm (${total - limit} hàng nữa)`) : null);
  }

  /* ---------- Chi tiết ---------- */
  function openDetail(id) {
    const p = S.get('products', id); if (!p) return;
    const margin = p.cost > 0 && p.units[0].price > 0 ? Math.round((p.units[0].price - p.cost) / p.units[0].price * 100) : null;
    const body = h('div', null,
      h('div', { class: 'row' }, thumb(p, 64), h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '17px' } }, p.name), h('div', { class: 'small muted' }, [p.sku, E.categoryPath(p.categoryId), p.brand].filter(Boolean).join(' · ')))),
      h('div', { class: 'grid g2 mt12' }, h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Tồn kho'), h('div', { class: 'v ' + (p.stock <= 0 ? 'neg-c' : p.stock <= p.minStock ? 'warn-c' : '') }, fmtNum(p.stock) + ' ' + p.units[0].name),
        p.units[1] ? h('div', { class: 's' }, `≈ ${fmtNum(Math.floor(p.stock / p.units[1].factor))} ${p.units[1].name} ${fmtNum(p.stock % p.units[1].factor)} ${p.units[0].name}`) : null),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Giá bán'), h('div', { class: 'v' }, fmtMoney(p.units[0].price)), viewCost ? h('div', { class: 's' }, `Vốn ${fmtMoney(p.cost)}${margin != null ? ` · lãi ${margin}%` : ''}`) : null)),
      h('div', { class: 'list mt12' }, p.units.map(u => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, u.name + (u.factor !== 1 ? ` (= ${fmtNum(u.factor)} ${p.units[0].name})` : '')),
        h('div', { class: 'sub' }, (u.barcodes && u.barcodes.length ? u.barcodes.join(', ') : 'Chưa có mã vạch') + (u.wholesale ? ` · Sỉ ${fmtNum(u.wholesale)}` : '') + (u.tiers && u.tiers.length ? ` · ${u.tiers.length} bậc giá` : ''))), h('div', { class: 'bold' }, fmtMoney(u.price))))),
      p.minStock ? h('div', { class: 'small muted mt8' }, `Tồn tối thiểu: ${fmtNum(p.minStock)}${p.maxStock ? ' · tối đa ' + fmtNum(p.maxStock) : ''}`) : null,
      p.trackBatch ? h('div', { class: 'mt12' }, h('h3', { class: 'small muted' }, 'Lô hàng còn tồn (xuất theo HSD gần nhất)'), h('div', { class: 'list' }, (E.batchesOf(id).length ? E.batchesOf(id).map(b => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, b.lot || '(không số lô)'), h('div', { class: 'sub' }, b.expiry ? 'HSD ' + fmtDate(new Date(b.expiry + 'T00:00:00').getTime()) : 'Không HSD')), h('div', { class: 'bold' }, fmtNum(b.qty)))) : [empty('Không còn lô nào')]))) : null,
      h('div', { class: 'mt12' }, h('h3', { class: 'small muted' }, 'Thẻ kho gần đây'),
        h('div', { class: 'list' }, E.stockMovesOf(id, 15).map(m => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, MOVE_NAMES[m.type] || m.type), h('div', { class: 'sub' }, fmtDateTime(m.ts) + (m.reason ? ' · ' + m.reason : ''))),
          h('div', { class: 'right' }, h('div', { class: 'bold ' + (m.qty > 0 ? 'pos-c' : 'neg-c') }, (m.qty > 0 ? '+' : '') + fmtNum(m.qty)), h('div', { class: 'tiny muted' }, 'còn ' + fmtNum(m.after))))))),
      E.priceHistory(id).length ? h('div', { class: 'mt12' }, h('h3', { class: 'small muted' }, 'Lịch sử đổi giá'), h('div', { class: 'list' }, E.priceHistory(id).slice(0, 8).map(l => h('div', { class: 'item' }, h('div', { class: 'grow small' }, l.detail.replace(/^Đổi giá "[^"]*": /, ''), h('div', { class: 'tiny muted' }, `${fmtDateTime(l.ts)} · ${l.who}`)))))) : null);
    const acts = [];
    if (canEdit) {
      acts.push({ label: 'Sửa', kind: 'primary', onClick: close => { close(); productForm(p, { onSaved: draw }); return false; } });
      acts.push({ label: p.active ? 'Ngừng bán' : 'Bán lại', onClick: async () => { E.setProductActive(id, !p.active); draw(); } });
      if (E.can('deleteData') && !E.productHasHistory(id)) acts.push({ label: 'Xoá', kind: 'danger', onClick: async () => { if (!(await confirmBox(`Xoá "${p.name}"?`, { danger: true, okText: 'Xoá' }))) return false; const r = await guard(() => (E.deleteProduct(id), true)); if (!r) return false; draw(); } });
    }
    modal({ title: 'Chi tiết hàng hóa', body, size: 'wide', actions: acts });
  }

  /* ---------- Nhóm hàng ---------- */
  function categoriesDialog() {
    const m = modal({ title: 'Nhóm hàng', body: h('div') });
    const drawCats = () => {
      const tree = E.categoryTree();
      mount(m.body, h('div', { class: 'list' }, tree.length ? tree.map(({ cat, depth }) => h('div', { class: 'item', style: { paddingLeft: 12 + depth * 22 + 'px' } },
        h('div', { class: 'grow' }, h('div', { class: 'ttl' }, cat.name), h('div', { class: 'sub' }, `${S.list('products').filter(p => p.categoryId === cat.id).length} mặt hàng`)),
        iconBtn('plus', () => editCat(null, cat.id), 'Thêm nhóm con'), iconBtn('edit', () => editCat(cat), 'Sửa'),
        iconBtn('trash', async () => { if (await confirmBox(`Xoá nhóm "${cat.name}"?`, { danger: true, okText: 'Xoá' })) { await guard(() => E.deleteCategory(cat.id)); drawCats(); draw(); } }, 'Xoá'))) : [empty('Chưa có nhóm hàng')]),
        h('button', { class: 'btn primary block mt12', onClick: () => editCat(null, null) }, icon('plus', 18), ' Thêm nhóm'));
    };
    async function editCat(cat, parentId) {
      const v = await promptBox({ title: cat ? 'Đổi tên nhóm' : (parentId ? 'Thêm nhóm con' : 'Thêm nhóm hàng'), value: cat ? cat.name : '', label: 'Tên nhóm' });
      if (!v) return; await guard(() => E.saveCategory({ id: cat && cat.id, name: v, parentId: cat ? cat.parentId : parentId })); drawCats(); draw();
    }
    drawCats();
  }

  /* ---------- Đổi giá hàng loạt ---------- */
  function bulkDialog() {
    const scope = select(catOptions().map(([v, l]) => [v, v ? l : 'Tất cả hàng hóa']), catId), field_ = select([['price', 'Giá bán lẻ'], ['wholesale', 'Giá sỉ']], 'price');
    const mode = select([['percent', 'Tăng/giảm theo %'], ['delta', 'Cộng/trừ số tiền (đ)'], ['set', 'Đặt một mức giá']], 'percent'), val = h('input', { class: 'input', inputMode: 'decimal', placeholder: 'VD: 5 hoặc -3' });
    const step = select([[0, 'Không làm tròn'], [100, 'Tròn 100đ'], [500, 'Tròn 500đ'], [1000, 'Tròn 1.000đ']], 0);
    modal({ title: 'Đổi giá hàng loạt', body: h('div', null, field('Áp dụng cho', scope), field('Loại giá', field_), field('Cách đổi', mode), field('Giá trị', val, 'Số âm = giảm. Đơn vị lớn (thùng, lốc…) đổi theo tỷ lệ tương ứng.'), field('Làm tròn', step)),
      actions: [{ label: 'Huỷ' }, { label: 'Áp dụng', kind: 'primary', onClick: async () => {
        const v = parseQty(val.value); if (!val.value.trim()) { toast('Nhập giá trị', 'error'); return false; }
        if (!(await confirmBox('Đổi giá hàng loạt không thể hoàn tác tự động. Tiếp tục?', { okText: 'Đổi giá' }))) return false;
        const n = await guard(() => E.bulkPrice({ categoryId: scope.value || undefined, mode: mode.value, value: v, field: field_.value, roundStep: Number(step.value) })); if (n == null) return false;
        toast(`Đã cập nhật ${n} mức giá`, 'ok'); draw();
      } }] });
  }

  async function importCsv() {
    const f = await pickFile('.csv,text/csv,text/plain'); if (!f) return;
    const res = await guard(async () => E.importProductsCsv(await readFileText(f))); if (!res) return;
    draw();
    modal({ title: 'Kết quả nhập hàng hóa', body: h('div', null, h('div', { class: 'grid g3' }, h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Thêm mới'), h('div', { class: 'v pos-c' }, res.created)), h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Cập nhật'), h('div', { class: 'v' }, res.updated)), h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Lỗi'), h('div', { class: 'v ' + (res.errors.length ? 'neg-c' : '') }, res.errors.length))),
      res.errors.length ? h('div', { class: 'list mt12' }, res.errors.slice(0, 50).map(e => h('div', { class: 'item' }, h('div', { class: 'grow small' }, h('b', null, 'Dòng ' + e.line + ': '), e.msg)))) : null), actions: [{ label: 'Đóng', kind: 'primary' }] });
  }
  function menu() {
    const m = modal({ title: 'Tuỳ chọn', body: h('div', { class: 'col' },
      canEdit ? h('button', { class: 'btn block', onClick: () => { m.close(); categoriesDialog(); } }, 'Quản lý nhóm hàng') : null,
      canEdit ? h('button', { class: 'btn block', onClick: () => { m.close(); bulkDialog(); } }, 'Đổi giá hàng loạt') : null,
      canEdit ? h('button', { class: 'btn block', onClick: () => { m.close(); importCsv(); } }, icon('upload', 18), ' Nhập từ tệp CSV / Excel (.csv)') : null,
      h('button', { class: 'btn block', onClick: () => { m.close(); saveFile('san-pham.csv', E.exportProductsCsv(), 'text/csv'); } }, icon('download', 18), ' Xuất danh sách hàng hóa (CSV)'),
      canEdit ? h('button', { class: 'btn block', onClick: () => { m.close(); saveFile('mau-nhap-hang-hoa.csv', E.productCsvTemplate(), 'text/csv'); } }, icon('download', 18), ' Tải tệp mẫu để nhập') : null) });
  }

  ctx.setActions(iconBtn('scan', scanFind, 'Quét mã'), iconBtn('more', menu, 'Tuỳ chọn'));
  mount(root, search, chipsBox, listBox, canEdit ? h('button', { class: 'fab', title: 'Thêm hàng hóa', onClick: () => productForm(null, { onSaved: draw }) }, icon('plus')) : null);
  draw();
  return () => offScan();
}

const MOVE_NAMES = { opening: 'Tồn đầu', purchase: 'Nhập hàng', sale: 'Bán hàng', return_in: 'Khách trả hàng', return_out: 'Trả nhà cung cấp', writeoff: 'Xuất hủy', adjust: 'Điều chỉnh', stocktake: 'Kiểm kho', cancel: 'Huỷ hoá đơn' };
export { MOVE_NAMES };

/* ======================= Form thêm / sửa ======================= */
export function productForm(p, { barcode, onSaved } = {}) {
  const viewCost = E.can('viewCost') || !p;
  const st = p ? JSON.parse(JSON.stringify(p)) : { name: '', kind: 'count', units: [{ name: 'cái', factor: 1, price: 0, wholesale: 0, wholesaleMin: 0, tiers: [], barcodes: barcode ? [barcode] : [] }], cost: 0, minStock: 0, maxStock: 0, trackBatch: false, vat: 0, active: true, plu: '' };
  let image = p ? p.image : null, focusUnit = 0;
  const f = {
    name: h('input', { class: 'input', value: st.name, placeholder: 'VD: Nước ngọt Coca-Cola lon 330ml' }),
    sku: h('input', { class: 'input', value: st.sku || '', placeholder: 'Để trống để tự tạo' }),
    cat: select(catOptions(), st.categoryId || ''), kind: select([['count', 'Hàng đếm (cái, gói, chai…)'], ['weight', 'Hàng cân / đo (kg, lít, mét…)']], st.kind),
    brand: h('input', { class: 'input', value: st.brand || '' }), cost: moneyInput(st.cost), stock: qtyInput(''), lot: h('input', { class: 'input', placeholder: 'Số lô (tuỳ chọn)' }), expiry: h('input', { class: 'input', type: 'date' }),
    min: qtyInput(st.minStock || ''), max: qtyInput(st.maxStock || ''), plu: h('input', { class: 'input', value: st.plu || '', inputMode: 'numeric', placeholder: 'VD: 100001' }), vat: qtyInput(st.vat || ''), note: h('textarea', { class: 'textarea', value: st.note || '' }),
    batch: checkbox('Quản lý theo lô & hạn sử dụng (xuất lô hết hạn trước)', st.trackBatch), active: checkbox('Đang bán', st.active !== false)
  };
  const unitsBox = h('div'), imgBox = h('div'), lotBox = h('div'), pluBox = h('div');
  const drawImg = () => mount(imgBox, h('div', { class: 'row' }, h('div', { class: 'thumb', style: { width: '64px', height: '64px' } }, image ? h('img', { src: image }) : icon('box')),
    h('button', { class: 'btn sm', onClick: async () => { const file = await pickFile('image/*'); if (!file) return; try { image = await resizeImage(file, 240); drawImg(); } catch (e) { toast(e.message, 'error'); } } }, image ? 'Đổi ảnh' : 'Chọn ảnh'),
    image ? h('button', { class: 'btn sm ghost neg-c', onClick: () => { image = null; drawImg(); } }, 'Bỏ ảnh') : null));
  const drawLot = () => { mount(lotBox, !p && f.batch.input.checked ? h('div', { class: 'grid g2' }, field('Số lô tồn đầu', f.lot), field('Hạn sử dụng', f.expiry)) : null); };
  const drawPlu = () => { mount(pluBox, f.kind.value === 'weight' ? field('Mã cân (PLU) – dùng cho tem cân điện tử', f.plu, 'Mã vạch cân dạng 2 + PLU + khối lượng(g) sẽ tự nhận ra hàng này.') : null); };
  f.batch.input.addEventListener('change', drawLot); f.kind.addEventListener('change', () => { drawPlu(); const u = st.units[0]; if (f.kind.value === 'weight' && u.name === 'cái') { u.name = 'kg'; drawUnits(); } });

  function drawUnits() {
    mount(unitsBox, st.units.map((u, i) => {
      const bcIn = h('input', { class: 'input', placeholder: 'Nhập / quét mã vạch rồi Enter', inputMode: 'numeric', onFocus: () => { focusUnit = i; } });
      const addBc = v => { v = String(v || '').trim(); if (!v) return; if (!u.barcodes.includes(v)) { u.barcodes.push(v); } bcIn.value = ''; drawUnits(); };
      bcIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addBc(bcIn.value); } });
      const nameIn = h('input', { class: 'input', value: u.name, onInput: e => { u.name = e.target.value; } });
      const factorIn = qtyInput(u.factor, { class: '' }); factorIn.addEventListener('input', () => { u.factor = parseQty(factorIn.value) || 1; });
      const price = moneyInput(u.price, { onInput: v => { u.price = v; } }), whole = moneyInput(u.wholesale || 0, { onInput: v => { u.wholesale = v; } });
      const wmin = qtyInput(u.wholesaleMin || '', { placeholder: '0' }); wmin.addEventListener('input', () => { u.wholesaleMin = parseQty(wmin.value); });
      return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', null, i === 0 ? 'Đơn vị cơ bản (nhỏ nhất)' : 'Đơn vị quy đổi #' + i),
        i > 0 ? h('button', { class: 'btn sm ghost neg-c', onClick: () => { st.units.splice(i, 1); drawUnits(); } }, 'Xoá') : null),
        h('div', { class: 'grid g2 mt8' }, field('Tên đơn vị', nameIn), i === 0 ? field('Giá bán lẻ', price) : field(`Số ${st.units[0].name} trong 1 ${u.name || 'đơn vị'}`, factorIn)),
        i > 0 ? field('Giá bán lẻ', price) : null,
        h('div', { class: 'grid g2' }, field('Giá sỉ (tuỳ chọn)', whole), field('Áp giá sỉ khi mua từ…', wmin)),
        i === 0 ? tiersEditor(u) : null,
        field('Mã vạch', h('div', null, h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, u.barcodes.map(b => h('span', { class: 'chip on' }, b, ' ', h('span', { onClick: () => { u.barcodes = u.barcodes.filter(x => x !== b); drawUnits(); } }, '✕')))),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, bcIn), h('button', { class: 'btn sm', onClick: () => addBc(bcIn.value) }, 'Thêm'),
            canScan() ? h('button', { class: 'btn sm', onClick: () => openScanner({ onCode: c => { addBc(c); } }) }, icon('scan', 16)) : null,
            h('button', { class: 'btn sm', title: 'Tạo mã nội bộ', onClick: () => addBc(ean13Check('2' + String(900000 + Math.floor(Math.random() * 99999)).padStart(6, '0') + String(Date.now()).slice(-5))) }, 'Tạo mã')))));
    }), h('button', { class: 'btn block', onClick: () => { st.units.push({ name: '', factor: 12, price: 0, wholesale: 0, tiers: [], barcodes: [] }); drawUnits(); } }, icon('plus', 16), ' Thêm đơn vị quy đổi (lốc, thùng…)'));
  }
  function tiersEditor(u) {
    const box = h('div');
    const draw = () => mount(box, h('div', { class: 'small muted' }, 'Giá theo số lượng (mua càng nhiều càng rẻ)'), (u.tiers || []).map((t, i) => {
      const mn = qtyInput(t.min), pr = moneyInput(t.price, { onInput: v => { t.price = v; } }); mn.addEventListener('input', () => { t.min = parseQty(mn.value); });
      return h('div', { class: 'row mt8' }, h('span', { class: 'small' }, 'Từ'), h('div', { style: { width: '80px' } }, mn), h('span', { class: 'small' }, 'giá'), h('div', { class: 'grow' }, pr), iconBtn('x', () => { u.tiers.splice(i, 1); draw(); }, 'Xoá'));
    }), h('button', { class: 'btn sm ghost', onClick: () => { u.tiers = u.tiers || []; u.tiers.push({ min: 5, price: Math.max(0, u.price - 500) }); draw(); } }, '+ Thêm bậc giá'));
    draw(); return h('div', { class: 'field' }, box);
  }

  const offScan = onScan(code => { const u = st.units[focusUnit] || st.units[0]; if (!u.barcodes.includes(code)) { u.barcodes.push(code); drawUnits(); toast('Đã thêm mã ' + code, 'ok'); } });
  const body = h('div', null, field('Tên hàng hóa *', f.name), h('div', { class: 'grid g2' }, field('Nhóm hàng', f.cat), field('Mã SKU', f.sku)),
    field('Loại hàng', f.kind), pluBox, h('div', { class: 'grid g2' }, field('Thương hiệu', f.brand), field('Thuế VAT (%)', f.vat)), imgBox,
    h('h3', { class: 'mt12' }, 'Đơn vị, giá bán & mã vạch'), unitsBox,
    h('h3', { class: 'mt12' }, 'Giá vốn & tồn kho'),
    h('div', { class: 'grid g2' }, E.can('viewCost') || !p ? field('Giá vốn (/đơn vị cơ bản)', f.cost, p ? 'Tự cập nhật khi nhập hàng.' : null) : null, !p ? field('Tồn kho ban đầu', f.stock) : null),
    lotBox, h('div', { class: 'grid g2' }, field('Cảnh báo khi tồn ≤', f.min), field('Tồn tối đa (gợi ý nhập)', f.max)), f.batch, h('div', { class: 'mt8' }, f.active), field('Ghi chú', f.note));
  drawImg(); drawUnits(); drawLot(); drawPlu();
  modal({ title: p ? 'Sửa hàng hóa' : 'Thêm hàng hóa', body, size: 'wide', onClose: () => offScan(), closable: true, actions: [{ label: 'Huỷ' }, { label: 'Lưu', kind: 'primary', onClick: async () => {
    const d = { id: p && p.id, name: f.name.value, sku: f.sku.value, categoryId: f.cat.value || null, kind: f.kind.value, brand: f.brand.value, vat: f.vat.num, note: f.note.value, image,
      units: st.units.map(u => ({ id: u.id, name: u.name, factor: u.factor, price: u.price, wholesale: u.wholesale, wholesaleMin: u.wholesaleMin, tiers: (u.tiers || []).filter(t => t.min > 0), barcodes: u.barcodes })),
      minStock: f.min.num, maxStock: f.max.num, trackBatch: f.batch.input.checked, plu: f.plu.value, active: f.active.input.checked };
    if (E.can('viewCost') || !p) d.cost = f.cost.num;
    if (!p) { d.stock = f.stock.num; d.lot = f.lot.value; d.expiry = f.expiry.value || null; }
    const r = await guard(() => E.saveProduct(d)); if (!r) return false;
    toast(p ? 'Đã lưu thay đổi' : 'Đã thêm hàng hóa', 'ok'); if (onSaved) onSaved(r);
  } }] });
  setTimeout(() => f.name.focus(), 80);
}
