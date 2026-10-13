/* Hàng hóa: nhóm hàng, sản phẩm (nhiều đơn vị quy đổi, nhiều mã vạch), tra mã vạch, tìm kiếm, nhập/xuất CSV. */
import { S } from '../store.js';
import { uid, fail, norm, rnd, roundQty, parseCsv, toCsv, parseMoney, parseQty } from '../util.js';
import { need, log, settings, can } from './auth.js';
import { stockIn, stockOut, adjustTo } from './stockcore.js';

/* ---------- Nhóm hàng ---------- */
export function saveCategory(d) {
  need('manageProducts');
  const name = String(d.name || '').trim();
  if (!name) fail('Nhập tên nhóm hàng');
  if (S.list('categories').some(c => norm(c.name) === norm(name) && (c.parentId || '') === (d.parentId || '') && c.id !== d.id)) fail('Nhóm hàng đã tồn tại');
  if (d.id && d.parentId === d.id) fail('Nhóm không thể là cha của chính nó');
  if (d.id && d.parentId) { let p = S.get('categories', d.parentId); while (p) { if (p.id === d.id) fail('Không thể chọn nhóm con làm nhóm cha'); p = p.parentId ? S.get('categories', p.parentId) : null; } }
  return S.tx(() => {
    if (d.id) { const c = S.mut('categories', d.id); Object.assign(c, { name, parentId: d.parentId || null, color: d.color || c.color || '' }); return c; }
    return S.add('categories', { name, parentId: d.parentId || null, color: d.color || '', sort: S.count('categories') });
  });
}
export function deleteCategory(id) {
  need('manageProducts');
  if (S.list('products').some(p => p.categoryId === id)) fail('Nhóm này còn hàng hóa, hãy chuyển hàng sang nhóm khác trước');
  if (S.list('categories').some(c => c.parentId === id)) fail('Nhóm này còn nhóm con');
  S.tx(() => S.del('categories', id));
}
export function categoryPath(id) {
  const parts = []; let c = id && S.get('categories', id);
  while (c) { parts.unshift(c.name); c = c.parentId ? S.get('categories', c.parentId) : null; }
  return parts.join(' › ');
}
export function categoryTree() {
  const all = S.list('categories').sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'vi'));
  const out = [];
  const walk = (pid, depth) => all.filter(c => (c.parentId || null) === pid).forEach(c => { out.push({ cat: c, depth }); walk(c.id, depth + 1); });
  walk(null, 0);
  return out;
}
export function categoryDescendants(id) {
  const ids = [id]; S.list('categories').forEach(() => {});
  for (let i = 0; i < ids.length; i++) S.list('categories').filter(c => c.parentId === ids[i]).forEach(c => ids.push(c.id));
  return ids;
}

/* ---------- Chỉ mục mã vạch ---------- */
let _bcVer = -1, _bc = new Map();
function barcodeIndex() {
  if (_bcVer !== S.ver.products) {
    _bc = new Map();
    for (const p of S.c.products.values()) for (const u of p.units) for (const b of (u.barcodes || [])) _bc.set(b, { productId: p.id, unitId: u.id });
    _bcVer = S.ver.products;
  }
  return _bc;
}

/** Tra mã vạch/SKU. Trả về {product, unit, qty?} hoặc null. Hỗ trợ mã vạch cân (tem cân điện tử). */
export function lookupBarcode(code) {
  code = String(code || '').trim();
  if (!code) return null;
  const hit = barcodeIndex().get(code);
  if (hit) { const product = S.get('products', hit.productId); return { product, unit: product.units.find(u => u.id === hit.unitId) || product.units[0] }; }
  const sku = S.list('products').find(p => p.sku && p.sku.toLowerCase() === code.toLowerCase());
  if (sku) return { product: sku, unit: sku.units[0] };
  const wb = settings().sale.weightBarcode;
  if (wb.enabled && code.length === 13 && code.startsWith(wb.prefix)) {
    const plu = code.slice(wb.pluStart, wb.pluStart + wb.pluLen), val = parseInt(code.slice(wb.valueStart, wb.valueStart + wb.valueLen), 10);
    const p = S.list('products').find(x => x.plu && (x.plu === plu || x.plu === plu.replace(/^0+/, '')));
    if (p && val > 0) {
      const unit = p.units[0];
      const qty = wb.mode === 'price' ? roundQty(val / (unit.price || 1)) : roundQty(val / 1000);
      return { product: p, unit, qty };
    }
  }
  return null;
}

export function searchProducts(q, { categoryId, activeOnly = true, limit = 60, onlyLow = false } = {}) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  const cats = categoryId ? new Set(categoryDescendants(categoryId)) : null;
  const out = [];
  for (const p of S.c.products.values()) {
    if (activeOnly && !p.active) continue;
    if (cats && !cats.has(p.categoryId)) continue;
    if (onlyLow && !(p.stock <= (p.minStock || 0))) continue;
    if (tokens.length) {
      const hay = p.nameNorm + ' ' + norm(p.sku || '') + ' ' + p.units.map(u => (u.barcodes || []).join(' ')).join(' ');
      if (!tokens.every(t => hay.includes(t))) {
        // gõ vài số cuối của mã vạch
        if (!(tokens.length === 1 && /^\d{3,}$/.test(tokens[0]) && p.units.some(u => (u.barcodes || []).some(b => b.endsWith(tokens[0]))))) continue;
      }
    }
    out.push(p);
    if (out.length >= limit * 20) break;
  }
  if (tokens.length) {
    const t0 = tokens[0];
    out.sort((a, b) => (b.nameNorm.startsWith(t0) - a.nameNorm.startsWith(t0)) || a.name.localeCompare(b.name, 'vi'));
  } else out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return out.slice(0, limit);
}

/* ---------- Sản phẩm ---------- */
function cleanUnits(d) {
  let units = (d.units && d.units.length ? d.units : [{ name: d.baseUnit || 'cái', factor: 1, price: d.price || 0 }]).map((u, i) => ({
    id: u.id || uid(),
    name: String(u.name || (i ? 'Thùng' : 'cái')).trim(),
    factor: i === 0 ? 1 : Math.max(0.001, Number(u.factor) || 1),
    price: Math.max(0, rnd(Number(u.price) || 0)),
    wholesale: Math.max(0, rnd(Number(u.wholesale) || 0)),
    wholesaleMin: Math.max(0, Number(u.wholesaleMin) || 0),
    tiers: (u.tiers || []).filter(t => t && t.min > 0 && t.price >= 0).map(t => ({ min: Number(t.min), price: rnd(t.price) })).sort((a, b) => a.min - b.min),
    barcodes: Array.from(new Set((u.barcodes || []).map(b => String(b).trim()).filter(Boolean)))
  }));
  const names = new Set();
  for (const u of units) { if (names.has(norm(u.name))) fail(`Đơn vị "${u.name}" bị trùng`); names.add(norm(u.name)); }
  return units;
}

export function nextSku() {
  let n = S.nextSeq('sku');
  while (S.list('products').some(p => p.sku === 'SP' + String(n).padStart(5, '0'))) n = S.nextSeq('sku');
  return 'SP' + String(n).padStart(5, '0');
}

/** Tạo/sửa sản phẩm. Khi tạo mới có `stock` > 0 sẽ ghi tồn đầu kỳ (kèm lô nếu theo dõi lô). */
export function saveProduct(d, { skipPerm = false } = {}) {
  if (!skipPerm) need('manageProducts');
  const name = String(d.name || '').trim();
  if (!name) fail('Nhập tên hàng hóa');
  const units = cleanUnits(d);
  // mã vạch không được trùng với sản phẩm khác
  const mine = new Set(), seen = new Map();
  for (const p of S.c.products.values()) if (p.id !== d.id) for (const u of p.units) for (const b of (u.barcodes || [])) seen.set(b, p.name);
  for (const u of units) for (const b of u.barcodes) {
    if (seen.has(b)) fail(`Mã vạch ${b} đã thuộc sản phẩm "${seen.get(b)}"`);
    if (mine.has(b)) fail(`Mã vạch ${b} bị nhập hai lần`);
    mine.add(b);
  }
  const sku = String(d.sku || '').trim();
  if (sku && S.list('products').some(p => p.id !== d.id && p.sku && p.sku.toLowerCase() === sku.toLowerCase())) fail(`Mã SKU ${sku} đã tồn tại`);
  const plu = String(d.plu || '').trim();
  if (plu && S.list('products').some(p => p.id !== d.id && p.plu === plu)) fail(`Mã cân (PLU) ${plu} đã dùng cho hàng khác`);
  if (d.categoryId && !S.get('categories', d.categoryId)) fail('Nhóm hàng không tồn tại');
  const cost = Math.max(0, Number(d.cost) || 0);
  return S.tx(() => {
    const fields = {
      name, nameNorm: norm(name), sku: sku || (d.id ? S.get('products', d.id).sku : nextSku()), plu,
      categoryId: d.categoryId || null, brand: String(d.brand || '').trim(), note: String(d.note || '').trim(),
      image: d.image === undefined ? undefined : d.image,
      kind: d.kind === 'weight' ? 'weight' : 'count', units,
      minStock: Math.max(0, Number(d.minStock) || 0), maxStock: Math.max(0, Number(d.maxStock) || 0),
      trackBatch: !!d.trackBatch, vat: Math.max(0, Number(d.vat) || 0), active: d.active !== false
    };
    if (d.id) {
      const p = S.mut('products', d.id);
      const oldPrice = p.units[0].price;
      if (fields.image === undefined) delete fields.image;
      if (p.trackBatch && !fields.trackBatch && S.list('batches').some(b => b.productId === p.id && b.qty > 0)) fail('Không thể tắt theo dõi lô khi còn lô hàng tồn');
      Object.assign(p, fields);
      if (d.cost !== undefined && can('viewCost')) p.cost = cost;
      if (oldPrice !== p.units[0].price) log('price', `Đổi giá "${p.name}": ${oldPrice} → ${p.units[0].price}`, { kind: 'price', ref: p.id });
      return p;
    }
    if (fields.image === undefined) fields.image = null;
    const p = S.add('products', Object.assign(fields, { cost, stock: 0, lastSupplierId: null }));
    const opening = Number(d.stock) || 0;
    if (opening !== 0) openingStock(p, opening, cost, { lot: d.lot || '', expiry: d.expiry || null });
    log('product', `Thêm hàng "${p.name}"`, { ref: p.id });
    return p;
  });
}
function openingStock(p, qty, cost, { lot, expiry }) {
  if (qty > 0) stockIn(p.id, qty, { type: 'opening', cost, lot: lot || 'TON-DAU', expiry, reason: 'Tồn đầu kỳ' });
  else stockOut(p.id, -qty, { type: 'opening', reason: 'Tồn đầu kỳ' });
}

export function setProductActive(id, active) {
  need('manageProducts');
  S.tx(() => { S.mut('products', id).active = !!active; });
}
export function productHasHistory(id) {
  return S.list('stockMoves').some(m => m.productId === id && m.type !== 'opening') ||
    S.list('sales').some(s => s.items.some(i => i.productId === id)) ||
    S.list('purchases').some(s => s.items.some(i => i.productId === id));
}
export function deleteProduct(id) {
  need('manageProducts'); need('deleteData');
  if (productHasHistory(id)) fail('Hàng đã phát sinh giao dịch, chỉ có thể "ngừng bán"');
  S.tx(() => {
    S.list('stockMoves').filter(m => m.productId === id).forEach(m => S.del('stockMoves', m.id));
    S.list('batches').filter(b => b.productId === id).forEach(b => S.del('batches', b.id));
    const p = S.get('products', id); S.del('products', id);
    log('product', `Xoá hàng "${p && p.name}"`);
  });
}
export const toBase = (p, unitId, qty) => roundQty(qty * ((p.units.find(u => u.id === unitId) || p.units[0]).factor));
export const unitOf = (p, unitId) => p.units.find(u => u.id === unitId) || p.units[0];

/** Đổi giá hàng loạt. mode: 'percent' | 'delta' | 'set'. field: 'price' | 'wholesale' (áp cho đơn vị cơ bản; đơn vị lớn đổi tỷ lệ). */
export function bulkPrice({ productIds, categoryId, mode, value, field = 'price', roundStep = 0 }) {
  need('manageProducts');
  let list = productIds ? productIds.map(id => S.get('products', id)).filter(Boolean)
    : S.list('products').filter(p => !categoryId || categoryDescendants(categoryId).includes(p.categoryId));
  if (!list.length) fail('Không có hàng nào để đổi giá');
  return S.tx(() => {
    let n = 0;
    for (const p0 of list) {
      const p = S.mut('products', p0.id);
      for (const u of p.units) {
        const cur = u[field] || 0; if (!cur && field === 'wholesale') continue;
        let nv = mode === 'percent' ? cur * (1 + value / 100) : mode === 'delta' ? cur + value * (u.factor || 1) : (u === p.units[0] ? value : cur);
        nv = Math.max(0, roundStep > 1 ? Math.round(nv / roundStep) * roundStep : rnd(nv));
        if (nv !== cur) { if (u === p.units[0]) log('price', `Đổi giá "${p.name}": ${cur} → ${nv}`, { kind: 'price', ref: p.id }); u[field] = nv; n++; }
      }
    }
    return n;
  });
}
export function priceHistory(productId) {
  return S.list('logs').filter(l => l.kind === 'price' && l.ref === productId).sort((a, b) => b.ts - a.ts);
}

/* ---------- CSV ---------- */
const CSV_HEAD = ['Tên hàng', 'Mã vạch', 'SKU', 'Nhóm hàng', 'Đơn vị', 'Giá vốn', 'Giá bán', 'Giá sỉ', 'Tồn kho', 'Tồn tối thiểu', 'Hàng cân (x)', 'Mã cân PLU', 'Đơn vị lớn', 'Quy đổi', 'Giá bán đơn vị lớn', 'Mã vạch đơn vị lớn'];
export function productCsvTemplate() {
  return toCsv([CSV_HEAD, ['Mì Hảo Hảo tôm chua cay', '8934563138165', '', 'Mì ăn liền', 'gói', 3200, 4500, 4200, 100, 20, '', '', 'Thùng', 30, 130000, '']]);
}
export function exportProductsCsv() {
  const rows = [CSV_HEAD];
  for (const p of S.list('products').sort((a, b) => a.name.localeCompare(b.name, 'vi'))) {
    const u = p.units[0], big = p.units[1];
    rows.push([p.name, (u.barcodes || []).join(' '), p.sku, categoryPath(p.categoryId), u.name, can('viewCost') ? rnd(p.cost) : '', u.price, u.wholesale || '', p.stock, p.minStock || '',
      p.kind === 'weight' ? 'x' : '', p.plu || '', big ? big.name : '', big ? big.factor : '', big ? big.price : '', big ? (big.barcodes || []).join(' ') : '']);
  }
  return toCsv(rows);
}
const HEAD_ALIASES = {
  name: ['ten hang', 'ten', 'ten san pham', 'name', 'san pham', 'ten hang hoa'],
  barcode: ['ma vach', 'barcode', 'ma'], sku: ['sku', 'ma hang', 'ma sp'], cat: ['nhom hang', 'nhom', 'category', 'loai'],
  unit: ['don vi', 'dvt', 'unit'], cost: ['gia von', 'gia nhap', 'cost'], price: ['gia ban', 'gia', 'price', 'gia le', 'gia ban le'],
  wholesale: ['gia si', 'wholesale'], stock: ['ton kho', 'ton', 'so luong', 'stock', 'ton dau'], min: ['ton toi thieu', 'ton min', 'min'],
  weight: ['hang can (x)', 'hang can', 'can'], plu: ['ma can plu', 'plu', 'ma can'],
  bigUnit: ['don vi lon'], bigFactor: ['quy doi', 'he so'], bigPrice: ['gia ban don vi lon'], bigBarcode: ['ma vach don vi lon']
};
/** Nhập danh mục từ CSV. Trả {created, updated, errors:[{line,msg}]}. Khớp hàng cũ theo mã vạch hoặc SKU. */
export function importProductsCsv(text) {
  need('manageProducts');
  const rows = parseCsv(text);
  if (rows.length < 2) fail('Tệp không có dòng dữ liệu');
  const head = rows[0].map(h => norm(h));
  const col = {};
  for (const [k, al] of Object.entries(HEAD_ALIASES)) { const i = head.findIndex(h => al.includes(h)); if (i >= 0) col[k] = i; }
  if (col.name === undefined) fail('Không tìm thấy cột "Tên hàng" ở dòng đầu tiên');
  const res = { created: 0, updated: 0, errors: [] };
  const get = (r, k) => col[k] === undefined ? '' : String(r[col[k]] ?? '').trim();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    try {
      const name = get(r, 'name'); if (!name) return;
      const barcodes = get(r, 'barcode').split(/[\s;|]+/).filter(Boolean);
      const sku = get(r, 'sku');
      const existing = (barcodes[0] && lookupBarcode(barcodes[0])?.product) || (sku && S.list('products').find(p => p.sku && p.sku.toLowerCase() === sku.toLowerCase())) || null;
      // nhóm hàng (hỗ trợ "A › B")
      let categoryId = null; const cp = get(r, 'cat');
      if (cp) {
        let parent = null;
        for (const part of cp.split(/›|>/).map(s => s.trim()).filter(Boolean)) {
          let c = S.list('categories').find(x => norm(x.name) === norm(part) && (x.parentId || null) === (parent || null));
          if (!c) c = saveCategory({ name: part, parentId: parent });
          parent = c.id;
        }
        categoryId = parent;
      }
      const unitName = get(r, 'unit') || 'cái';
      const units = [{ id: existing ? existing.units[0].id : undefined, name: unitName, factor: 1, price: parseMoney(get(r, 'price')), wholesale: parseMoney(get(r, 'wholesale')), barcodes }];
      if (existing) { units[0].tiers = existing.units[0].tiers; units[0].wholesaleMin = existing.units[0].wholesaleMin; }
      const bigName = get(r, 'bigUnit');
      if (!bigName && existing) units.push(...existing.units.slice(1));      // dòng CSV không nhắc tới đơn vị lớn → giữ nguyên các đơn vị lớn đã có
      if (bigName) units.push({ name: bigName, factor: parseQty(get(r, 'bigFactor')) || 1, price: parseMoney(get(r, 'bigPrice')), barcodes: get(r, 'bigBarcode').split(/[\s;|]+/).filter(Boolean) });
      const d = {
        id: existing ? existing.id : undefined, name, sku, categoryId: categoryId || (existing ? existing.categoryId : null), units,
        cost: get(r, 'cost') !== '' ? parseMoney(get(r, 'cost')) : (existing ? existing.cost : 0),
        minStock: get(r, 'min') !== '' ? parseQty(get(r, 'min')) : (existing ? existing.minStock : 0),
        kind: /^(x|1|c|co|có)$/i.test(get(r, 'weight')) ? 'weight' : (existing ? existing.kind : 'count'),
        plu: get(r, 'plu') || (existing ? existing.plu : ''), trackBatch: existing ? existing.trackBatch : false,
        stock: existing ? undefined : parseQty(get(r, 'stock')), active: true
      };
      if (existing) { d.maxStock = existing.maxStock; d.vat = existing.vat; d.brand = existing.brand; d.note = existing.note; }
      S.tx(() => { saveProduct(d); });
      // tồn kho của hàng đã có: chỉ điều chỉnh nếu cột Tồn có giá trị khác
      if (existing && get(r, 'stock') !== '') {
        const want = parseQty(get(r, 'stock'));
        if (Math.abs(want - S.get('products', existing.id).stock) > 0.0005) S.tx(() => adjustTo(existing.id, want, { reason: 'Nhập từ tệp CSV' }));
      }
      if (existing) res.updated++; else res.created++;
    } catch (e) { res.errors.push({ line, msg: e.message }); }
  });
  log('import', `Nhập hàng từ CSV: ${res.created} mới, ${res.updated} cập nhật, ${res.errors.length} lỗi`);
  return res;
}
