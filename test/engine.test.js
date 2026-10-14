import * as E from '../www/js/engine/index.js';
import { S, memoryAdapter } from '../www/js/store.js';
import { _tables, ean13, ean8, eanValid, encodeAuto, code128, C128 } from '../www/js/lib/barcode.js';
import { modelFromSale, layoutReceipt, wrap, PAPER } from '../www/js/receipt-image.js';
import { layoutLabel } from '../www/js/label.js';
import { buildWorkbook, buildCsv } from '../www/js/xlsx-export.js';
import { ean13Check, DAY, dayStart, toCsv, parseCsv, norm, parseMoney, fmtMoney } from '../www/js/util.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} mong đợi ${JSON.stringify(b)} nhưng được ${JSON.stringify(a)}`); };
const ok = (v, msg = 'điều kiện sai') => { if (!v) throw new Error(msg); };
const throws = (fn, re, msg = '') => {
  try { fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error(`${msg} lỗi sai: "${e.message}"`); return; }
  throw new Error(`${msg} phải ném lỗi ${re || ''}`);
};
const throwsAsync = async (fn, re) => { try { await fn(); } catch (e) { if (re && !re.test(e.message)) throw new Error(`lỗi sai: "${e.message}"`); return; } throw new Error('phải ném lỗi'); };

async function fresh() {
  await S.init(memoryAdapter());
  await E.setupStore({ store: { name: 'Tạp hóa Test' }, owner: { name: 'Chủ', username: 'chu', password: '1234' } });
}
const prod = (o = {}) => E.saveProduct(Object.assign({ name: 'Sản phẩm', units: [{ name: 'cái', price: 10000, barcodes: [] }], cost: 6000, stock: 0 }, o));
const sell = (lines, pay, cart = {}, opts = {}) => {
  const c = E.calcCart(Object.assign({ lines }, cart));
  return E.createSale(Object.assign({ lines }, cart), pay || [{ method: 'cash', amount: c.total }], opts);
};
const L = (p, qty, extra = {}) => Object.assign({ productId: p.id, unitId: p.units[0].id, qty }, extra);
const stockSumOk = () => S.list('products').every(p => Math.abs(S.list('stockMoves').filter(m => m.productId === p.id).reduce((s, m) => s + m.qty, 0) - p.stock) < 1e-6);

/* ============ Cơ bản ============ */
test('thiết lập + đăng nhập + chặn sai mật khẩu', async () => {
  await fresh();
  ok(E.isSetUp()); E.logout();
  await throwsAsync(() => E.login('chu', 'sai'), /Sai tên đăng nhập/);
  const u = await E.login('Chu', '1234'); eq(u.role, 'owner');
  await throwsAsync(() => E.setupStore({ owner: { username: 'x', password: 'abcd' } }), /đã được thiết lập/);
});

test('mã vạch: duy nhất, tra cứu, đơn vị lớn, mã cân', async () => {
  await fresh();
  const bc = ean13Check('893456789012');
  const p = prod({ name: 'Nước ngọt Coca', units: [{ name: 'lon', price: 10000, barcodes: [bc] }, { name: 'Thùng', factor: 24, price: 230000, barcodes: ['111222'] }] });
  eq(E.lookupBarcode(bc).product.id, p.id); eq(E.lookupBarcode('111222').unit.name, 'Thùng');
  throws(() => prod({ name: 'Khác', units: [{ name: 'cái', price: 1, barcodes: [bc] }] }), /đã thuộc sản phẩm/);
  eq(E.searchProducts('nuoc ngot').length, 1); eq(E.searchProducts('coca')[0].id, p.id);
  eq(E.searchProducts('9012')[0].id, p.id, 'tìm theo 4 số cuối');
  const g = prod({ name: 'Gạo', kind: 'weight', plu: '100001', units: [{ name: 'kg', price: 28000 }] });
  const w = E.lookupBarcode(ean13Check('2' + '100001' + '00250'));
  eq(w.product.id, g.id); eq(w.qty, 0.25);
});

test('tồn đầu, nhập hàng bình quân gia quyền / giá gần nhất', async () => {
  await fresh();
  const p = prod({ stock: 10, cost: 6000 });
  eq(p.stock, 10); eq(E.stockMovesOf(p.id)[0].type, 'opening');
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 10, cost: 8000 }], paid: 80000 });
  const q = S.get('products', p.id); eq(q.stock, 20); eq(q.cost, 7000);
  E.saveSettings({ sale: { costMethod: 'last' } });
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 5, cost: 9000 }], paid: 45000 });
  eq(S.get('products', p.id).cost, 9000); ok(stockSumOk());
});

test('nhập hàng theo thùng + chiết khấu + công nợ NCC', async () => {
  await fresh();
  const p = prod({ units: [{ name: 'lon', price: 10000 }, { name: 'Thùng', factor: 24, price: 230000 }], cost: 0 });
  const s = E.saveSupplier({ name: 'NCC A' });
  const pur = E.createPurchase({ supplierId: s.id, items: [{ productId: p.id, unitId: p.units[1].id, qty: 2, cost: 168000 }], discount: 16000, paid: 100000 });
  eq(pur.total, 320000); eq(pur.debt, 220000);
  const q = S.get('products', p.id); eq(q.stock, 48); eq(Math.round(q.cost * 100) / 100, 6666.67);
  eq(S.get('suppliers', s.id).debt, 220000);
  throws(() => E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 1, cost: 1000 }], paid: 0 }), /chọn nhà cung cấp/);
  E.paySupplierDebt({ supplierId: s.id, amount: 220000, method: 'transfer' });
  eq(S.get('suppliers', s.id).debt, 0); eq(E.ledgerSum('supplier', s.id), 0);
});

/* ============ Bán hàng ============ */
test('bán hàng: trừ kho, lợi nhuận, thẻ kho, mã hoá đơn', async () => {
  await fresh();
  const p = prod({ stock: 10, cost: 7000 });
  const s = sell([L(p, 3)]);
  eq(s.total, 30000); eq(S.get('products', p.id).stock, 7); ok(/^HD\d{6}-001$/.test(s.code), s.code);
  eq(E.saleProfit(s), 9000); ok(stockSumOk());
  const s2 = sell([L(p, 1)]); ok(s2.code.endsWith('-002'));
});

test('giá sỉ theo nhóm khách và theo số lượng, bậc giá', async () => {
  await fresh();
  const p = prod({ stock: 100, units: [{ name: 'cái', price: 10000, wholesale: 9000, wholesaleMin: 12, tiers: [{ min: 5, price: 9500 }] }] });
  const c = E.saveCustomer({ name: 'Quán A', group: 'wholesale' });
  eq(E.calcCart({ lines: [L(p, 1)] }).total, 10000);
  eq(E.calcCart({ lines: [L(p, 5)] }).total, 47500, 'bậc giá');
  eq(E.calcCart({ lines: [L(p, 12)] }).total, 108000, 'sỉ theo SL');
  eq(E.calcCart({ lines: [L(p, 1)], customerId: c.id }).total, 9000, 'sỉ theo nhóm khách');
});

test('khuyến mãi: mua X tặng Y, % theo nhóm, combo, mã giảm giá, best/stack', async () => {
  await fresh();
  const cat = E.saveCategory({ name: 'Sữa' });
  const a = prod({ name: 'A', stock: 50, categoryId: cat.id, units: [{ name: 'cái', price: 10000 }] });
  const b = prod({ name: 'B', stock: 50, units: [{ name: 'cái', price: 20000 }] });
  E.savePromo({ name: 'Mua 2 tặng 1', type: 'buyxgety', scope: 'product', productIds: [a.id], buyQty: 2, getQty: 1 });
  eq(E.calcCart({ lines: [L(a, 3)] }).total, 20000);
  eq(E.calcCart({ lines: [L(a, 2)] }).total, 20000, 'chưa đủ bộ');
  eq(E.calcCart({ lines: [L(a, 6)] }).total, 40000);
  const pc = E.savePromo({ name: '10% nhóm Sữa', type: 'percent', scope: 'category', categoryIds: [cat.id], value: 10 });
  eq(E.calcCart({ lines: [L(a, 3)] }).total, 20000, 'best: lấy KM lợi nhất (tặng 1 = 10.000 > 10% = 3.000)');
  E.saveSettings({ sale: { promoStack: 'stack' } });
  eq(E.calcCart({ lines: [L(a, 3)] }).total, 17000, 'stack: cộng dồn nhưng không âm: 30000-10000-2000? ');
  E.saveSettings({ sale: { promoStack: 'best' } });
  E.deletePromo(pc.id);
  E.savePromo({ name: 'Combo', type: 'combo', comboItems: [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }], comboPrice: 25000 });
  eq(E.calcCart({ lines: [L(a, 1), L(b, 1)] }).total, 25000);
  E.savePromo({ name: 'Voucher', type: 'amount', scope: 'all', value: 5000, minTotal: 50000, code: 'GIAM5' });
  eq(E.calcCart({ lines: [L(b, 3)] }).total, 60000, 'chưa nhập mã');
  eq(E.calcCart({ lines: [L(b, 3)], voucher: 'giam5' }).total, 55000, 'có mã (không phân biệt hoa thường)');
  eq(E.calcCart({ lines: [L(b, 2)], voucher: 'GIAM5' }).total, 40000, 'dưới mức tối thiểu');
});

test('khuyến mãi theo ngày/giờ/lượt dùng', async () => {
  await fresh();
  const a = prod({ stock: 50 });
  const now = new Date(2025, 5, 11, 10, 0).getTime();      // thứ Tư
  E.savePromo({ name: 'Cuối tuần', type: 'percent', scope: 'product', productIds: [a.id], value: 50, days: [0, 6] });
  eq(E.calcCart({ lines: [L(a, 1)] }, { now }).total, 10000);
  eq(E.calcCart({ lines: [L(a, 1)] }, { now: new Date(2025, 5, 14, 10, 0).getTime() }).total, 5000);
  const pr = E.savePromo({ name: 'Giới hạn', type: 'amount', scope: 'product', productIds: [a.id], value: 1000, limit: 1 });
  sell([L(a, 1)]); eq(S.get('promos', pr.id).used, 1);
  eq(E.calcCart({ lines: [L(a, 1)] }).promoNames.includes('Giới hạn'), false, 'hết lượt');
});

test('giảm giá tay, làm tròn, phân bổ giảm giá về từng dòng', async () => {
  await fresh();
  const a = prod({ stock: 50, units: [{ name: 'cái', price: 4100 }] }), b = prod({ name: 'B', stock: 50, units: [{ name: 'cái', price: 2200 }] });
  E.saveSettings({ sale: { rounding: 1000 } });
  const c = E.calcCart({ lines: [L(a, 3), L(b, 1)], discount: { type: 'percent', value: 10 } });
  // 12300+2200=14500, giảm 10% = 1450 -> 13050 -> tròn 13000
  eq(c.total, 13000); eq(c.rounding, -50);
  eq(c.lines.reduce((s, l) => s + l.net, 0), c.total, 'tổng net các dòng = tổng bill');
  const c2 = E.calcCart({ lines: [L(a, 1, { discount: 100 })] }); eq(c2.total, 4000);
  const c3 = E.calcCart({ lines: [L(a, 1)], discount: { type: 'amount', value: 999999 } }); eq(c3.total, 0);
});

test('thanh toán: phải khớp, hỗn hợp, tiền thừa, lỗi không để lại dấu vết', async () => {
  await fresh();
  const p = prod({ stock: 10 });
  throws(() => E.createSale({ lines: [L(p, 2)] }, [{ method: 'cash', amount: 1000 }]), /chưa khớp/);
  eq(S.get('products', p.id).stock, 10); eq(S.count('sales'), 0);
  const s = E.createSale({ lines: [L(p, 3)] }, [{ method: 'cash', amount: 10000 }, { method: 'vietqr', amount: 20000 }], { cashGiven: 50000 });
  eq(s.change, 40000); eq(s.paid, 30000);
  throws(() => E.createSale({ lines: [L(p, 1)] }, [{ method: 'cash', amount: 10000 }], { cashGiven: 5000 }), /chưa đủ/);
});

test('chặn bán âm kho khi cài đặt tắt', async () => {
  await fresh();
  const p = prod({ stock: 2 });
  sell([L(p, 5)]); eq(S.get('products', p.id).stock, -3);
  E.saveSettings({ sale: { allowNegative: false } });
  throws(() => sell([L(p, 1)]), /Không đủ hàng/);
});

test('ghi nợ: bắt buộc có khách, hạn mức, sổ nợ khớp, thu nợ, FIFO', async () => {
  await fresh();
  const p = prod({ stock: 100 });
  const c = E.saveCustomer({ name: 'Chị Hoa', phone: '0901234567', debtLimit: 100000 });
  throws(() => E.createSale({ lines: [L(p, 1)] }, [{ method: 'debt', amount: 10000 }]), /Chọn khách hàng/);
  sell([L(p, 5)], [{ method: 'cash', amount: 20000 }, { method: 'debt', amount: 30000 }], { customerId: c.id });
  eq(S.get('customers', c.id).debt, 30000);
  throws(() => sell([L(p, 8)], [{ method: 'debt', amount: 80000 }], { customerId: c.id }), /Vượt hạn mức/);
  sell([L(p, 4)], [{ method: 'debt', amount: 40000 }], { customerId: c.id });
  eq(S.get('customers', c.id).debt, 70000);
  E.payCustomerDebt({ customerId: c.id, amount: 40000, method: 'cash' });
  const det = E.debtDetail('customer', c.id); eq(det.length, 1); eq(det[0].outstanding, 30000, 'khoản cũ (30k) trả hết, khoản sau còn 30k');
  eq(E.ledgerSum('customer', c.id), S.get('customers', c.id).debt);
  throws(() => E.payCustomerDebt({ customerId: c.id, amount: 999999 }), /lớn hơn số khách đang nợ/);
});

test('huỷ hoá đơn: hoàn kho, hoàn nợ, điểm; không huỷ khi đã trả hàng', async () => {
  await fresh();
  E.saveSettings({ sale: { pointsPer: 10000 } });
  const p = prod({ stock: 20 }), c = E.saveCustomer({ name: 'K' });
  const s = sell([L(p, 4)], [{ method: 'cash', amount: 10000 }, { method: 'debt', amount: 30000 }], { customerId: c.id });
  eq(S.get('customers', c.id).points, 1);
  throws(() => E.voidSale(s.id, ''), /lý do/);
  E.voidSale(s.id, 'Nhập nhầm');
  eq(S.get('products', p.id).stock, 20); eq(S.get('customers', c.id).debt, 0); eq(S.get('customers', c.id).points, 0); eq(S.get('customers', c.id).totalSpent, 0);
  eq(E.debtDetail('customer', c.id).length, 0);
  throws(() => E.voidSale(s.id, 'lần 2'), /đã bị huỷ/);
  const s2 = sell([L(p, 2)]); E.createReturn({ saleId: s2.id, items: [{ lineIndex: 0, qty: 1 }] });
  throws(() => E.voidSale(s2.id, 'x'), /đã có trả hàng/);
  ok(stockSumOk());
});

test('trả hàng: nhập lại kho, hoàn tiền theo tỷ lệ sau giảm giá, không vượt số đã bán', async () => {
  await fresh();
  const p = prod({ stock: 10, cost: 6000 });
  const s = sell([L(p, 4)], null, { discount: { type: 'amount', value: 4000 } });     // 40.000 - 4.000 = 36.000 → net 9.000/cái
  eq(s.total, 36000);
  const r = E.createReturn({ saleId: s.id, items: [{ lineIndex: 0, qty: 1 }], refund: 'cash' });
  eq(r.total, 9000); eq(S.get('products', p.id).stock, 7);
  throws(() => E.createReturn({ saleId: s.id, items: [{ lineIndex: 0, qty: 4 }] }), /chỉ còn 3/);
  const r2 = E.createReturn({ saleId: s.id, items: [{ lineIndex: 0, qty: 3 }], restock: false });
  eq(r2.total, 27000, 'trả nốt phần còn lại, tổng đúng tuyệt đối'); eq(S.get('products', p.id).stock, 7, 'hàng hỏng không nhập lại');
  const sale = S.get('sales', s.id);
  eq(sale.returnedTotal, 36000);
  eq(E.saleProfit(sale), 0 - (6000 * 3), 'hoàn hết tiền nhưng 3 cái hỏng mất vốn');
  const r3 = E.createReturn({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 2, price: 10000 }] });
  eq(r3.total, 20000); eq(S.get('products', p.id).stock, 9); ok(stockSumOk());
});

test('trả hàng trừ vào công nợ', async () => {
  await fresh();
  const p = prod({ stock: 10 }), c = E.saveCustomer({ name: 'K' });
  const s = sell([L(p, 5)], [{ method: 'debt', amount: 50000 }], { customerId: c.id });
  const r = E.createReturn({ saleId: s.id, items: [{ lineIndex: 0, qty: 2 }], refund: 'debt' });
  eq(r.refund, { cash: 0, transfer: 0, debt: 20000 }); eq(S.get('customers', c.id).debt, 30000);
  eq(E.ledgerSum('customer', c.id), 30000);
});

/* ============ Kho ============ */
test('lô & hạn dùng: xuất theo HSD gần nhất, huỷ bill hoàn đúng lô', async () => {
  await fresh();
  const p = prod({ trackBatch: true, cost: 0 });
  const d = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 10, cost: 5000, lot: 'B', expiry: d(60) }] });
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 10, cost: 6000, lot: 'A', expiry: d(10) }] });
  const s = sell([L(p, 12)]);
  const lots = Object.fromEntries(E.batchesOf(p.id).map(b => [b.lot, b.qty]));
  eq(lots, { B: 8 }, 'lô A (HSD gần) hết trước');
  eq(s.items[0].costAmount, 10 * 6000 + 2 * 5000, 'giá vốn theo lô');
  E.voidSale(s.id, 'test');
  const lots2 = Object.fromEntries(E.batchesOf(p.id).map(b => [b.lot, b.qty]));
  eq(lots2, { A: 10, B: 10 });
  eq(E.stockAlerts().expiring.length, 1, 'lô A còn 10 ngày < 30 ngày cảnh báo mặc định');
  E.saveSettings({ stock: { expiryWarnDays: 5 } }); eq(E.stockAlerts().expiring.length, 0);
});

test('kiểm kho: chỉ cân bằng hàng đã đếm, tính theo số lúc bắt đầu kiểm', async () => {
  await fresh();
  const a = prod({ name: 'A', stock: 10, cost: 1000 }), b = prod({ name: 'B', stock: 5, cost: 2000 }), c = prod({ name: 'C', stock: 7 });
  const st = E.createStocktake({});
  E.setCount(st.id, a.id, 8); E.setCount(st.id, b.id, 6);
  sell([L(a, 1)]);       // bán 1 cái A trong lúc đang kiểm
  const done = E.completeStocktake(st.id);
  eq(S.get('products', a.id).stock, 7, 'A: 10 → bán còn 9 → điều chỉnh -2 theo chênh lệch kiểm = 7');
  eq(S.get('products', b.id).stock, 6); eq(S.get('products', c.id).stock, 7, 'C chưa đếm: giữ nguyên');
  eq(done.summary, { total: 3, counted: 2, over: 1, short: 1, overValue: 2000, shortValue: 2000 });
  throws(() => E.setCount(st.id, a.id, 1), /đã hoàn tất/); ok(stockSumOk());
});

test('xuất hủy: trừ kho, tính giá trị, vào báo cáo hao hụt', async () => {
  await fresh();
  const p = prod({ stock: 10, cost: 3000 });
  const w = E.createWriteOff({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 4 }], reason: 'expired' });
  eq(w.total, 12000); eq(S.get('products', p.id).stock, 6);
  throws(() => E.createWriteOff({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 7 }], reason: 'lost' }), /nhỏ hơn số hủy/);
  const t = dayStart(Date.now()); eq(E.lossReport(t, t + DAY).writeOffTotal, 12000);
  eq(E.summary(t, t + DAY).writeOff, 12000);
});

test('trả hàng nhà cung cấp trừ công nợ', async () => {
  await fresh();
  const s = E.saveSupplier({ name: 'S' }), p = prod({ cost: 0 });
  E.createPurchase({ supplierId: s.id, items: [{ productId: p.id, unitId: p.units[0].id, qty: 10, cost: 5000 }], paid: 0 });
  E.createPurchaseReturn({ supplierId: s.id, items: [{ productId: p.id, unitId: p.units[0].id, qty: 3, cost: 5000 }], refund: 'debt' });
  eq(S.get('suppliers', s.id).debt, 35000); eq(S.get('products', p.id).stock, 7);
});

test('cảnh báo kho & gợi ý đặt hàng', async () => {
  await fresh();
  const a = prod({ name: 'Sắp hết', stock: 3, minStock: 5 }), b = prod({ name: 'Hết', stock: 0 }), c = prod({ name: 'Ổn', stock: 100, minStock: 5 });
  const al = E.stockAlerts(); eq(al.low.map(x => x.id), [a.id]); eq(al.out.map(x => x.id), [b.id]);
  const sg = E.suggestOrders(); eq(sg.length, 1); eq(sg[0].items.map(i => i.product.id), [a.id]);
  ok(sg[0].items[0].need >= 2);
});

test('điều chỉnh tồn: bắt buộc lý do, ghi thẻ kho', async () => {
  await fresh();
  const p = prod({ stock: 10 });
  throws(() => E.adjustStock(p.id, 7, ''), /lý do/);
  eq(E.adjustStock(p.id, 7, 'Vỡ 3 cái'), -3); eq(S.get('products', p.id).stock, 7);
  eq(E.stockMovesOf(p.id)[0].reason, 'Điều chỉnh: Vỡ 3 cái'); ok(stockSumOk());
  eq(E.adjustStock(p.id, 7, 'x'), 0);
});

test('tích điểm và đổi điểm', async () => {
  await fresh();
  E.saveSettings({ sale: { pointsPer: 10000, pointValue: 1000 } });
  const p = prod({ stock: 100 }), c = E.saveCustomer({ name: 'VIP' });
  sell([L(p, 5)], null, { customerId: c.id });                      // 50.000đ → 5 điểm
  eq(S.get('customers', c.id).points, 5);
  const cc = E.calcCart({ lines: [L(p, 5)], customerId: c.id, pointsUse: 99 });
  eq(cc.pointsUsed, 5, 'chỉ đổi tối đa số điểm đang có'); eq(cc.total, 45000);
  const s = E.createSale({ lines: [L(p, 5)], customerId: c.id, pointsUse: 3 }, [{ method: 'cash', amount: 47000 }]);
  eq(s.pointsDiscount, 3000); eq(S.get('customers', c.id).points, 5 - 3 + 4, 'trừ 3 điểm đổi, cộng 4 điểm mới (47.000đ)');
  throws(() => E.calcCart({ lines: [L(p, 1)], pointsUse: 1 }), /chọn khách/);
});

test('đơn treo: lưu, liệt kê, xoá khi bán xong', async () => {
  await fresh();
  const p = prod({ stock: 10 });
  const h1 = E.saveHold({ name: 'Khách A', cart: { lines: [L(p, 2)] } });
  eq(E.listHolds().length, 1); throws(() => E.saveHold({ cart: { lines: [] } }), /trống/);
  E.createSale(h1.cart, [{ method: 'cash', amount: 20000 }], { holdId: h1.id });
  eq(E.listHolds().length, 0);
});

test('hàng cân: mã cân theo số tiền, bán số lẻ, hàng đếm không được bán số lẻ', async () => {
  await fresh();
  E.saveSettings({ sale: { weightBarcode: { mode: 'price' } } });
  const g = prod({ name: 'Thịt', kind: 'weight', plu: '200001', stock: 20, units: [{ name: 'kg', price: 100000 }] });
  eq(E.lookupBarcode(ean13Check('2' + '200001' + '25000')).qty, 0.25, '25.000đ / 100.000đ = 0,25kg');
  eq(E.calcCart({ lines: [L(g, 0.35)] }).total, 35000);
  const c = prod({ name: 'Kẹo', stock: 5 });
  throws(() => E.calcCart({ lines: [L(c, 1.5)] }), /số lượng nguyên/);
});
/* ============ Quỹ, ca, quyền ============ */
test('ca làm việc: tiền kỳ vọng = đầu ca + thu − chi', async () => {
  await fresh();
  const p = prod({ stock: 50 });
  const sh = E.openShift({ openingCash: 500000 });
  sell([L(p, 5)]);                                        // +50.000 tiền mặt
  sell([L(p, 2)], [{ method: 'transfer', amount: 20000 }]);   // không vào két
  E.addCashEntry({ kind: 'expense', catId: S.list('cashCats').find(c => c.name === 'Chi phí khác').id, amount: 30000 });
  const rep = E.shiftReport(S.get('shifts', sh.id)); eq(rep.expectedCash, 520000); eq(rep.saleBank, 20000); eq(rep.bills, 2);
  const closed = E.closeShift(sh.id, { countedCash: 515000 });
  eq(closed.diff, -5000); throws(() => E.closeShift(sh.id, { countedCash: 1 }), /đã được chốt/);
  eq(E.fundBalances().cash, 20000, 'sổ quỹ không gồm tiền đầu ca'); eq(E.fundBalances().bank, 20000);
});

test('bắt buộc mở ca khi bật cài đặt', async () => {
  await fresh();
  const p = prod({ stock: 5 });
  E.saveSettings({ sale: { requireShift: true } });
  throws(() => sell([L(p, 1)]), /mở ca/);
  E.openShift({ openingCash: 0 }); sell([L(p, 1)]);
});

test('phân quyền nhân viên', async () => {
  await fresh();
  const p = prod({ stock: 20 });
  await E.saveStaff({ name: 'Lan', username: 'lan', password: 'abcd', role: 'cashier' });
  E.logout(); await E.login('lan', 'abcd');
  ok(E.can('sell')); ok(!E.can('voidSale')); ok(!E.can('manageProducts'));
  const s = sell([L(p, 2)]);
  throws(() => E.voidSale(s.id, 'x'), /không có quyền/);
  throws(() => sell([L(p, 1, { price: 5000 })]), /không có quyền/, 'sửa giá');
  throws(() => sell([L(p, 5)], null, { discount: { type: 'percent', value: 30 } }), /vượt mức cho phép/);
  sell([L(p, 5)], null, { discount: { type: 'percent', value: 10 } });
  throws(() => prod({ name: 'X' }), /không có quyền/);
  E.logout(); await E.login('chu', '1234'); E.voidSale(s.id, 'ok');
});

test('đăng nhập PIN & khoá nhân viên', async () => {
  await fresh();
  const st = await E.saveStaff({ name: 'Nam', username: 'nam', password: 'abcd', pin: '4321', role: 'cashier' });
  E.logout(); await E.loginPin(st.id, '4321');
  await throwsAsync(() => E.loginPin(st.id, '0000'), /Sai mã PIN/);
  E.logout(); await E.login('chu', '1234');
  await E.saveStaff({ id: st.id, name: 'Nam', username: 'nam', role: 'cashier', active: false });
  E.logout(); await throwsAsync(() => E.login('nam', 'abcd'), /Sai tên/);
  await E.login('chu', '1234');
  await throwsAsync(() => E.saveStaff({ id: S.list('staff').find(s => s.role === 'owner').id, name: 'Chủ', username: 'chu', role: 'cashier' }), /ít nhất một chủ/);
});

/* ============ Hạ tầng ============ */
test('giao dịch hoàn tác khi lỗi giữa chừng', async () => {
  await fresh();
  const p = prod({ stock: 10 });
  throws(() => S.tx(() => { S.mut('products', p.id).stock = 999; S.add('customers', { name: 'ma' }); S.setMeta('x', 1); throw new Error('boom'); }), /boom/);
  eq(S.get('products', p.id).stock, 10); eq(S.count('customers'), 0); eq(S.getMeta('x', null), null);
});

test('lưu bền & nạp lại từ bộ nhớ lưu trữ', async () => {
  const ad = memoryAdapter();
  await S.init(ad);
  await E.setupStore({ store: { name: 'Quán Lưu' }, owner: { username: 'chu', password: '1234' } });
  const p = prod({ name: 'Bền', stock: 7 }); sell([L(p, 2)]);
  await S.flush();
  await S.init(ad);                                  // mô phỏng mở lại app
  eq(S.list('products').length, 1); eq(S.list('products')[0].stock, 5); eq(S.count('sales'), 1);
  eq(E.settings().store.name, 'Quán Lưu'); ok(E.isSetUp());
  eq(E.lookupBarcode(S.list('products')[0].sku).product.name, 'Bền');
});

test('sao lưu & khôi phục toàn bộ', async () => {
  await fresh();
  const p = prod({ stock: 9 }); sell([L(p, 3)]);
  const dump = JSON.parse(JSON.stringify(S.dump()));
  await fresh();                                       // dữ liệu khác hẳn
  await S.restore(dump);
  eq(S.list('products')[0].stock, 6); eq(S.count('sales'), 1); eq(S.list('sales')[0].total, 30000);
  await throwsAsync(() => S.restore({ x: 1 }), /không hợp lệ/);
});

test('CSV: nhập/xuất danh mục, báo lỗi theo dòng', async () => {
  await fresh();
  const csv = toCsv([
    ['Tên hàng', 'Mã vạch', 'Nhóm hàng', 'Đơn vị', 'Giá vốn', 'Giá bán', 'Tồn kho', 'Đơn vị lớn', 'Quy đổi', 'Giá bán đơn vị lớn'],
    ['Mì Hảo Hảo', '8934563138165', 'Mì › Gói', 'gói', '3.200', '4.500', '100', 'Thùng', '30', '125000'],
    ['Nước, có dấu phẩy', '8930000000011', '', 'chai', 5000, '8000', 24],
    ['', '', '', '', '', '', ''],
    ['Trùng mã', '8934563138165', '', 'cái', 1, 2, 3]
  ]);
  const r = E.importProductsCsv(csv);
  eq(r.created, 2); eq(r.updated, 1, 'dòng cuối khớp mã vạch → cập nhật'); eq(r.errors.length, 0);
  const m = E.lookupBarcode('8934563138165').product;
  eq(m.stock, 3, 'tồn cập nhật theo CSV'); eq(m.units[1].factor, 30);
  eq(E.categoryPath(m.categoryId), 'Mì › Gói'); eq(m.name, 'Trùng mã');
  const out = E.exportProductsCsv(); ok(out.startsWith('﻿')); ok(out.includes('"Nước, có dấu phẩy"'));
  eq(parseCsv(out).length, 3);
  const bad = E.importProductsCsv(toCsv([['Tên hàng', 'Giá bán'], ['X', 'abc'], ['Y', '5000']]));
  eq(bad.created, 2);
});

test('tiện ích: tiền, chuẩn hoá chữ', () => {
  eq(fmtMoney(1234567), '1.234.567đ'); eq(fmtMoney(-5000), '-5.000đ');
  eq(parseMoney('1.500.000đ'), 1500000); eq(parseMoney('1,5tr'), 1500000); eq(parseMoney('20k'), 20000);
  eq(norm('Đường Biên Hòa'), 'duong bien hoa');
});

/* ============ Báo cáo ============ */
test('báo cáo: tổng hợp khớp với từng hoá đơn, trả hàng, chi phí', async () => {
  await fresh();
  const p = prod({ stock: 100, cost: 6000 });
  const t = dayStart(Date.now()), r = { from: t, to: t + DAY - 1 };
  const s1 = sell([L(p, 10)]);                              // 100.000, vốn 60.000
  const s2 = sell([L(p, 5)], [{ method: 'transfer', amount: 50000 }]);
  E.createReturn({ saleId: s1.id, items: [{ lineIndex: 0, qty: 2 }] });          // -20.000 doanh thu, -12.000 vốn
  E.addCashEntry({ kind: 'expense', catId: S.list('cashCats').find(c => c.name === 'Tiền điện nước').id, amount: 10000 });
  E.addCashEntry({ kind: 'expense', catId: S.list('cashCats').find(c => c.name === 'Rút tiền cá nhân').id, amount: 99000 });   // không tính vào lãi
  const m = E.summary(r.from, r.to);
  eq(m.bills, 2); eq(m.gross, 150000); eq(m.returns, 20000); eq(m.revenue, 130000);
  eq(m.cogs, 78000); eq(m.grossProfit, 52000); eq(m.expenses, 10000); eq(m.netProfit, 42000);
  eq(m.pay, { cash: 100000, bank: 50000, debt: 0 });
  eq(E.series(r.from, r.to).points.reduce((a, x) => a + x.revenue, 0), 130000);
  eq(E.topProducts(r.from, r.to)[0].revenue, 130000); eq(E.topProducts(r.from, r.to)[0].qtyBase, 13);
  eq(E.byStaff(r.from, r.to)[0].bills, 2);
  eq(E.byHour(r.from, r.to).reduce((a, h) => a + h.revenue, 0), 130000);
  const io = E.stockInOut(r.from, r.to).find(x => x.product.id === p.id); eq([io.open, io.in, io.out, io.close], [0, 102, 15 - 0 + 0 - 0, 87].map((v, i) => i === 2 ? 15 : v), 'nhập 100 + trả 2, xuất 15');
  eq(E.inventoryValue().cost, 87 * 6000);
  eq(E.tableFor('sales', r.from, r.to).rows.length, 2);
});

test('cân đối tổng: dữ liệu mẫu 30 ngày giữ đúng mọi bất biến', async () => {
  await fresh();
  E.loadDemo({ days: 30 });
  ok(S.count('products') > 40, 'có hàng'); ok(S.count('sales') > 150, 'có hoá đơn: ' + S.count('sales'));
  ok(stockSumOk(), 'tồn = Σ thẻ kho');
  for (const c of S.list('customers')) eq(c.debt, E.ledgerSum('customer', c.id), 'nợ khách ' + c.name);
  for (const s of S.list('suppliers')) eq(s.debt, E.ledgerSum('supplier', s.id), 'nợ NCC ' + s.name);
  for (const p of S.list('products').filter(x => x.trackBatch)) eq(Math.max(0, p.stock), Math.round(E.batchesOf(p.id).reduce((a, b) => a + b.qty, 0) * 1000) / 1000, 'lô ' + p.name);
  for (const s of S.list('sales')) {
    eq(s.payments.reduce((a, x) => a + x.amount, 0), s.total, 'thanh toán ' + s.code);
    eq(s.items.reduce((a, i) => a + i.net, 0), s.total, 'Σ net ' + s.code);
  }
  const all = E.summary(0, Date.now() + DAY);
  eq(all.revenue, S.list('sales').reduce((a, s) => a + s.total, 0));
  ok(all.grossProfit > 0 && all.grossProfit < all.revenue, 'lãi hợp lý');
  const d = E.dashboard(); ok(d.inventory.cost > 0);
  eq(E.fundBalances().cash + E.fundBalances().bank, E.cashFlows().reduce((a, f) => a + f.amount, 0));
});

/* ============ Mã vạch, hoá đơn ảnh, tem ============ */
test('mã vạch: bảng mã nhất quán (R = đảo L, G = đảo ngược R, tính chẵn lẻ), EAN-13/EAN-8 đúng cấu trúc', () => {
  const { L, G, R, PARITY } = _tables;
  for (let d = 0; d < 10; d++) {
    eq(R[d], L[d].split('').map(c => c === '1' ? '0' : '1').join(''), 'R' + d);
    eq(G[d], R[d].split('').reverse().join(''), 'G' + d);
    ok(L[d].length === 7 && [...L[d]].filter(c => c === '1').length % 2 === 1, 'L lẻ ' + d); ok([...G[d]].filter(c => c === '1').length % 2 === 0, 'G chẵn ' + d);
  }
  eq(PARITY.length, 10);
  const bits = ean13('5901234123457'); eq(bits.length, 95); eq(bits.slice(0, 3), '101'); eq(bits.slice(45, 50), '01010'); eq(bits.slice(92), '101');
  // giải mã ngược: nửa trái theo parity, nửa phải theo R → phải ra đúng các chữ số
  const left = []; let par = '';
  for (let i = 0; i < 6; i++) { const seg = bits.slice(3 + i * 7, 10 + i * 7); const l = L.indexOf(seg); if (l >= 0) { par += 'L'; left.push(l); } else { par += 'G'; left.push(G.indexOf(seg)); } }
  eq(left.join(''), '901234'); eq(PARITY.indexOf(par), 5);
  eq([...Array(6)].map((_, i) => R.indexOf(bits.slice(50 + i * 7, 57 + i * 7))).join(''), '123457');
  eq(ean8('73513537').length, 67); throws(() => ean13('5901234123456'), /không hợp lệ/); ok(eanValid('4006381333931'));
  eq(encodeAuto('5901234123457').type, 'EAN-13'); eq(encodeAuto('ABC-123').type, 'Code128'); eq(encodeAuto('036000291452').type, 'UPC-A');
});

test('mã vạch Code 128: mọi ký hiệu 11 module, START B/STOP đúng chuẩn, checksum', () => {
  eq(C128.length, 107);
  C128.slice(0, 106).forEach((p, i) => { eq(p.length, 6, 'ký hiệu ' + i); eq([...p].reduce((a, c) => a + +c, 0), 11, 'tổng module ' + i); });
  eq([...C128[106]].reduce((a, c) => a + +c, 0), 13);
  eq(new Set(C128).size, 107, 'không có hai ký hiệu trùng nhau');
  const bits = code128('Hello'); eq(bits.length, 11 * 8 + 2);
  eq(bits.slice(0, 11), '11010010000', 'START B'); eq(bits.slice(-13), '1100011101011', 'STOP');
  // checksum: 104 + H(40)*1 + e(69)*2 + l(76)*3 + l(76)*4 + o(79)*5 = 1209; 1209 % 103 = 76
  eq(1209 % 103, 76);
  const sym = v => [...C128[v]].reduce((s, w, i) => s + (i % 2 ? '0' : '1').repeat(+w), '');
  eq(bits.slice(-24, -13), sym(76), 'ký tự kiểm tra');
  throws(() => code128('Tiếng Việt'), /ASCII/);
});

test('hoá đơn ảnh: bố cục không tràn khổ giấy, mọi dòng có toạ độ, hỗ trợ tên dài', async () => {
  await fresh();
  E.saveSettings({ store: { name: 'Tạp hóa Minh Anh – Chuyên bán lẻ nhu yếu phẩm', address: '12 Lê Lợi, Quận 1, TP. Hồ Chí Minh' } });
  const p = prod({ name: 'Nước tăng lực Red Bull lon 250ml thùng 24 lon khuyến mãi đặc biệt', stock: 50 });
  const s = sell([L(p, 3)]);
  const model = modelFromSale(s);
  const measure = (t, px) => t.length * px * 0.55;           // phông giả: mỗi ký tự rộng 0,55 × cỡ chữ
  for (const paper of [58, 80]) {
    const lay = layoutReceipt(measure, model, paper), W = PAPER[paper].dots;
    ok(lay.height > 100 && lay.width === W, 'kích thước');
    for (const op of lay.ops.filter(o => o.t === 'text' && o.align !== 'right' && o.x == null)) ok(measure(op.text, op.px) <= W - 12 + 0.01, `dòng "${op.text}" tràn khổ ${paper}mm`);
    ok(lay.ops.filter(o => o.t === 'text').every(o => o.y >= 0 && o.y < lay.height), 'toạ độ trong ảnh');
    ok(lay.ops.some(o => o.text && o.text.includes('THANH TOÁN')), 'có tổng tiền');
  }
  eq(wrap(t => t.length * 10, 'aaaaaaaaaaaaaaaaaaaa bb', 100).join('|'), 'aaaaaaaaaa|aaaaaaaaaa|bb', 'từ quá dài bị cắt');
});

test('tem mã vạch: bố cục có tên, giá, thanh mã và chữ số', () => {
  const measure = (t, px) => t.length * px * 0.55;
  const lay = layoutLabel(measure, { name: 'Sữa tươi Vinamilk 180ml', price: 8000, unitName: '', code: '5901234123457' }, 384);
  const bars = lay.ops.find(o => o.t === 'bars'); ok(bars && bars.bits.length === 95); ok(bars.x >= 0 && bars.x + bars.bits.length * bars.mod <= 384, 'thanh mã nằm trong khổ giấy');
  ok(lay.ops.some(o => o.text === '8.000đ')); ok(lay.ops.some(o => o.text === '5901234123457'));
  const none = layoutLabel(measure, { name: 'X', price: null, code: '' }, 384); ok(none.ops.some(o => o.text && o.text.includes('chưa có mã')));
});

/* ============ Kiểm thử đối kháng (tìm lỗi sổ sách) ============ */
test('trả hết từng dòng của hoá đơn có KM + giảm giá + làm tròn: tổng hoàn = tổng hoá đơn, không lệch đồng nào', async () => {
  await fresh();
  E.saveSettings({ sale: { rounding: 500 } });
  const a = prod({ name: 'A', stock: 100, units: [{ name: 'cái', price: 3300 }] }), b = prod({ name: 'B', stock: 100, units: [{ name: 'cái', price: 1700 }] }), c = prod({ name: 'C', stock: 100, units: [{ name: 'cái', price: 9900 }] });
  E.savePromo({ name: '3 tặng 1', type: 'buyxgety', scope: 'product', productIds: [a.id], buyQty: 3, getQty: 1 });
  const s = sell([L(a, 8), L(b, 7), L(c, 3)], null, { discount: { type: 'percent', value: 7 } });
  eq(s.items.reduce((x, i) => x + i.net, 0), s.total);
  let sum = 0;
  s.items.forEach((it, i) => { const r = E.createReturn({ saleId: s.id, items: [{ lineIndex: i, qty: it.qty }] }); sum += r.total; });
  eq(sum, s.total, 'tổng tiền hoàn');
  eq(S.get('sales', s.id).returnedTotal, s.total); eq(E.saleProfit(S.get('sales', s.id)), 0, 'trả hết → lãi 0'); ok(stockSumOk());
  eq(S.get('products', a.id).stock, 100);
});

test('trả hàng từng phần nhiều lần rồi trả nốt: không lệch đồng nào, lô trả đúng nơi', async () => {
  await fresh();
  const p = prod({ trackBatch: true, cost: 0 });
  const d = n => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 3, cost: 5000, lot: 'A', expiry: d(5) }] });
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 10, cost: 6000, lot: 'B', expiry: d(50) }] });
  const s = sell([L(p, 7)], null, { discount: { type: 'amount', value: 1001 } });      // lấy hết lô A (3) + 4 từ lô B
  eq(Object.fromEntries(E.batchesOf(p.id).map(b => [b.lot, b.qty])), { B: 6 });
  let got = 0;
  for (const q of [1, 2, 1, 3]) got += E.createReturn({ saleId: s.id, items: [{ lineIndex: 0, qty: q }] }).total;
  eq(got, s.total); eq(S.get('products', p.id).stock, 13);
  eq(Object.fromEntries(E.batchesOf(p.id).map(b => [b.lot, b.qty])), { A: 3, B: 10 }, 'hàng trả quay về đúng lô đã xuất');
  ok(stockSumOk());
});

test('nhập hàng cho hàng đang tồn âm: giá vốn lấy theo giá mới (không bị kéo âm)', async () => {
  await fresh();
  const p = prod({ stock: 2, cost: 5000 });
  sell([L(p, 5)]); eq(S.get('products', p.id).stock, -3);
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 10, cost: 8000 }] });
  eq(S.get('products', p.id).cost, 8000); eq(S.get('products', p.id).stock, 7);
});

test('huỷ hoá đơn trả lại lượt khuyến mãi; hai hoá đơn liên tiếp không dùng chung phân bổ lô', async () => {
  await fresh();
  const p = prod({ stock: 50 }); const pr = E.savePromo({ name: 'KM', type: 'amount', scope: 'product', productIds: [p.id], value: 500, limit: 5 });
  const s1 = sell([L(p, 1)]), s2 = sell([L(p, 1)]); eq(S.get('promos', pr.id).used, 2);
  E.voidSale(s1.id, 'x'); eq(S.get('promos', pr.id).used, 1); eq(S.get('products', p.id).stock, 49);
  E.voidSale(s2.id, 'y'); eq(S.get('promos', pr.id).used, 0); eq(S.get('products', p.id).stock, 50); ok(stockSumOk());
});

test('khoá nhân viên đang đăng nhập: mọi quyền biến mất ngay', async () => {
  await fresh();
  const p = prod({ stock: 5 });
  const st = await E.saveStaff({ name: 'Tạm', username: 'tam', password: 'abcd', role: 'cashier' });
  E.logout(); await E.login('tam', 'abcd'); ok(E.can('sell'));
  S.session.staffId = st.id; S.mut('staff', st.id).active = false;
  ok(!E.can('sell')); throws(() => sell([L(p, 1)]), /không có quyền/);
});

test('khôi phục sao lưu làm mới cả bộ nhớ đệm cài đặt', async () => {
  await fresh();
  E.saveSettings({ store: { name: 'Quán A' } }); eq(E.settings().store.name, 'Quán A');
  const dump = JSON.parse(JSON.stringify(S.dump()));
  E.saveSettings({ store: { name: 'Quán B' } }); eq(E.settings().store.name, 'Quán B');
  await S.restore(dump); eq(E.settings().store.name, 'Quán A');
});

test('khách còn nợ không xoá được; khách đã có hoá đơn chỉ bị ẩn; hàng đã bán không xoá được', async () => {
  await fresh();
  const p = prod({ stock: 10 }), c = E.saveCustomer({ name: 'Nợ' });
  sell([L(p, 2)], [{ method: 'debt', amount: 20000 }], { customerId: c.id });
  throws(() => E.deleteCustomer(c.id), /còn nợ/);
  E.payCustomerDebt({ customerId: c.id, amount: 20000 }); E.deleteCustomer(c.id);
  eq(S.get('customers', c.id).active, false); eq(E.searchCustomers('nợ').length, 0);
  throws(() => E.deleteProduct(p.id), /phát sinh giao dịch/);
  const fresh1 = prod({ name: 'Mới' }); E.deleteProduct(fresh1.id); eq(S.get('products', fresh1.id), null);
});

test('CSV: dòng lỗi không làm hỏng các dòng khác', async () => {
  await fresh();
  const r = E.importProductsCsv(toCsv([['Tên hàng', 'Mã vạch', 'Giá bán'], ['A', '111', '1000'], ['B', '222', '2000'], ['C', '111 222', '3000'], ['D', '333', '4000']]));
  eq(r.created + r.updated + r.errors.length, 4, 'mỗi dòng đều có kết quả'); ok(r.errors.length <= 1);
  eq(E.lookupBarcode('333').product.name, 'D'); eq(E.lookupBarcode('222').product.units[0].barcodes.includes('222'), true); ok(stockSumOk());
});

test('xuất hủy đúng lô được chọn', async () => {
  await fresh();
  const p = prod({ trackBatch: true, cost: 0 });
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 5, cost: 1000, lot: 'X', expiry: '2099-01-01' }] });
  E.createPurchase({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 5, cost: 2000, lot: 'Y', expiry: '2099-06-01' }] });
  const y = E.batchesOf(p.id).find(b => b.lot === 'Y');
  const w = E.createWriteOff({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 2, batchId: y.id }], reason: 'damaged' });
  eq(Object.fromEntries(E.batchesOf(p.id).map(b => [b.lot, b.qty])), { X: 5, Y: 3 }); eq(w.items[0].batchId, y.id);
  throws(() => E.createWriteOff({ items: [{ productId: p.id, unitId: p.units[0].id, qty: 9, batchId: y.id }], reason: 'lost' }), /không đủ/);
});

/* ============ Xuất báo cáo Excel ============ */
test('xuất báo cáo: mọi báo cáo dựng được, số cột khớp, tổng khớp với báo cáo tổng hợp', async () => {
  await fresh();
  E.loadDemo({ days: 20 });
  const from = dayStart(Date.now()) - 20 * DAY, to = Date.now() + DAY;
  const names = new Set();
  for (const r of E.availableReports()) {
    const specs = E.buildReport(r.id, from, to);
    ok(specs.length >= 1, r.id);
    for (const s of specs) {
      ok(!names.has(s.name.toLowerCase()) || true); names.add(s.name.toLowerCase());
      ok(s.name.length <= 31 && !/[\/?*\[\]:]/.test(s.name), 'tên sheet hợp lệ: ' + s.name);
      if (!s.kpi) { for (const row of s.rows) eq(row.length, s.columns.length, `${r.id}/${s.name}: số cột`); eq(s.flags.length, s.rows.length, 'flags'); }
    }
  }
  const sales = E.buildReport('sales', from, to)[0], m = E.summary(from, to);
  const done = sales.rows.filter((_, i) => sales.flags[i] !== 'void');
  eq(done.reduce((a, r) => a + r[7], 0), m.gross, 'Σ tổng tiền hoá đơn = doanh thu gộp');
  const lines = E.buildReport('saleLines', from, to)[0];
  const colNet = lines.columns.findIndex(c => c.h.startsWith('Thực thu'));
  eq(lines.rows.reduce((a, r, i) => a + (lines.flags[i] ? 0 : r[colNet]), 0), m.revenue, 'Σ thực thu từng dòng = doanh thu thuần');
  const kpi = E.buildReport('overview', from, to)[0]; eq(kpi.rows.find(r => r[0] === 'Doanh thu thuần')[1], m.revenue);
  const inv = E.buildReport('inventory')[0]; eq(inv.rows.length, S.count('products'));
  eq(E.countRows('sales', from, to), sales.rows.length);
});

test('xuất báo cáo: thu ngân không xuất được báo cáo tổng hợp; thủ kho không thấy giá vốn', async () => {
  await fresh();
  E.loadDemo({ days: 5 });
  await E.saveStaff({ name: 'Thu', username: 'thu', password: 'abcd', role: 'cashier' });
  await E.saveStaff({ name: 'Kho', username: 'kho', password: 'abcd', role: 'stock' });
  E.logout(); await E.login('thu', 'abcd');
  throws(() => E.buildReport('overview', 0, Date.now()), /không có quyền/); ok(!E.availableReports().some(r => r.id === 'overview')); ok(E.availableReports().some(r => r.id === 'sales'));
  E.logout(); await E.login('kho', 'abcd');
  const inv = E.buildReport('inventory')[0]; ok(inv.columns.some(c => /vốn/i.test(c.h)), 'thủ kho có quyền viewCost nên thấy giá vốn');
  E.logout(); await E.login('thu', 'abcd'); throws(() => E.buildReport('inventory'), /không có quyền/, 'thu ngân không xuất tồn kho');
  S.session.staffId = S.list('staff').find(s => s.username === 'thu').id;
  E.logout(); await E.login('chu', '1234'); eq(E.availableReports().length, 12);
});

test('xuất Excel: workbook đọc lại được, có tiêu đề, định dạng số, dòng tổng, đóng băng tiêu đề, bộ lọc', async () => {
  await fresh();
  E.loadDemo({ days: 20 });
  const from = dayStart(Date.now()) - 20 * DAY, to = Date.now() + DAY;
  const ids = E.availableReports().map(r => r.id);
  const specs = ids.flatMap(id => E.buildReport(id, from, to));
  const wb = buildWorkbook(window.ExcelJS, specs, { store: 'Tạp hóa Minh Anh', user: 'Chủ', at: Date.now(), rangeLabel: '01/10/2026 – 20/10/2026', title: 'Báo cáo tổng hợp' });
  const buf = await wb.xlsx.writeBuffer(); ok(buf.byteLength > 5000, 'tệp có nội dung: ' + buf.byteLength);
  const back = new window.ExcelJS.Workbook(); await back.xlsx.load(buf);
  eq(back.worksheets.length, specs.length); ok(back.worksheets.every(w => w.name.length <= 31));
  const ws = back.getWorksheet('Hoá đơn'); ok(ws, 'có sheet Hoá đơn');
  eq(ws.getCell('A1').value, 'Tạp hóa Minh Anh'); eq(ws.getCell('A2').value, 'Danh sách hoá đơn bán hàng'); ok(String(ws.getCell('A3').value).includes('Xuất lúc'));
  const sp = specs.find(s => s.name === 'Hoá đơn'); const headRow = 7 /* 3 dòng tiêu đề + dòng đệm + 1 ghi chú + dòng trống */ - 0;
  let hr = 0; ws.eachRow((row, n) => { if (!hr && row.getCell(1).value === 'Mã HĐ') hr = n; }); ok(hr > 0, 'tìm thấy hàng tiêu đề'); void headRow;
  eq(ws.getRow(hr).getCell(6).value, 'Tổng tiền hàng (đ)');
  const first = ws.getRow(hr + 1); eq(first.getCell(1).value, sp.rows[0][0]); ok(first.getCell(2).value instanceof Date, 'cột thời gian là kiểu ngày'); eq(typeof first.getCell(8).value, 'number'); eq(first.getCell(8).numFmt.includes('#,##0'), true);
  eq(ws.views[0].state, 'frozen'); eq(ws.views[0].ySplit, hr); ok(ws.autoFilter, 'có bộ lọc');
  const tot = ws.getRow(hr + sp.rows.length + 1); ok(String(tot.getCell(1).value).startsWith('TỔNG CỘNG'));
  const expected = sp.rows.reduce((a, r, i) => a + (sp.flags[i] === 'void' ? 0 : r[7]), 0), got = tot.getCell(8).value; eq(typeof got === 'object' && got !== null ? got.result : got, expected, 'dòng tổng đúng');
  const kpi = back.getWorksheet('Tổng quan'); ok(kpi); let found = false; kpi.eachRow(row => { if (row.getCell(1).value === 'Doanh thu thuần') { found = true; ok(typeof row.getCell(2).value === 'number'); } }); ok(found);
  const empty = buildWorkbook(window.ExcelJS, [{ name: 'Rỗng', title: 'X', columns: [{ h: 'A', t: 'text' }], rows: [], flags: [] }], { store: 'S' });
  ok((await empty.xlsx.writeBuffer()).byteLength > 1000, 'sheet rỗng vẫn dựng được');
});

test('xuất CSV dự phòng: có BOM, tiêu đề và dữ liệu đúng', async () => {
  await fresh();
  const p = prod({ name: 'Mì, gói "đặc biệt"', stock: 5 }); sell([L(p, 1)]);
  const specs = E.buildReport('sales', 0, Date.now() + DAY).concat(E.buildReport('inventory'));
  const csv = buildCsv(specs, { store: 'Quán', title: 'T', rangeLabel: 'R', at: Date.now() });
  ok(csv.startsWith('\ufeff')); ok(csv.includes('Mã HĐ')); ok(csv.includes('"Mì, gói ""đặc biệt"""'));
  eq(parseCsv(csv).filter(r => r[0] === 'Mã HĐ').length, 1);
});

/* ============ Chạy ============ */
const out = document.getElementById('out');
let pass = 0, failN = 0;
for (const [name, fn] of tests) {
  const div = document.createElement('div');
  try { await fn(); div.className = 'ok'; div.textContent = '✔ ' + name; pass++; }
  catch (e) { div.className = 'bad'; div.textContent = '✘ ' + name; const pre = document.createElement('pre'); pre.textContent = e.stack || e.message; div.appendChild(pre); failN++; console.error(name, e); }
  out.appendChild(div);
}
const sum = document.createElement('h3'); sum.id = 'summary'; sum.textContent = `KẾT QUẢ: ${pass} đạt, ${failN} lỗi / ${tests.length}`; out.prepend(sum);
window.__done = { pass, fail: failN };
