/* Dữ liệu mẫu để dùng thử: hàng hóa, khách, NCC, khuyến mãi và ~30 ngày bán hàng. Đi qua đúng các hàm nghiệp vụ thật. */
import { S } from '../store.js';
import { DAY, ymd, ean13Check, dayStart } from '../util.js';
import { saveCategory, saveProduct, lookupBarcode } from './products.js';
import { saveCustomer, saveSupplier, payCustomerDebt } from './people.js';
import { createPurchase } from './inventory.js';
import { createSale, calcCart } from './sales.js';
import { savePromo } from './promos.js';
import { addCashEntry } from './cash.js';
import { log } from './auth.js';

// [tên, nhóm, đơn vị, giá vốn, giá bán, đơn vị lớn?[tên,hệ số,giá], tuỳ chọn]
const CATS = ['Đồ uống', 'Mì & thực phẩm khô', 'Sữa & bánh kẹo', 'Gia vị & dầu ăn', 'Hóa phẩm & gia dụng', 'Rau củ & thịt (cân)'];
const P = [
  ['Nước ngọt Coca-Cola lon 330ml', 0, 'lon', 7500, 10000, ['Thùng 24 lon', 24, 230000]],
  ['Nước ngọt Pepsi lon 330ml', 0, 'lon', 7300, 10000, ['Thùng 24 lon', 24, 225000]],
  ['Nước suối Aquafina 500ml', 0, 'chai', 3000, 5000, ['Thùng 24 chai', 24, 105000]],
  ['Trà xanh 0 độ chai 455ml', 0, 'chai', 6200, 9000, ['Thùng 24 chai', 24, 205000]],
  ['Bia Tiger lon 330ml', 0, 'lon', 14500, 18000, ['Thùng 24 lon', 24, 410000]],
  ['Bia Saigon Special lon', 0, 'lon', 12000, 15000, ['Thùng 24 lon', 24, 340000]],
  ['Nước tăng lực Red Bull lon', 0, 'lon', 9500, 13000, null],
  ['Cà phê hòa tan G7 3in1 (hộp 18 gói)', 0, 'hộp', 42000, 52000, null],
  ['Mì Hảo Hảo tôm chua cay', 1, 'gói', 3200, 4500, ['Thùng 30 gói', 30, 125000]],
  ['Mì Omachi sườn hầm', 1, 'gói', 6500, 9000, ['Thùng 30 gói', 30, 255000]],
  ['Mì ly Modern lẩu thái', 1, 'ly', 8200, 11000, null],
  ['Phở bò ăn liền Vifon', 1, 'gói', 7200, 10000, null],
  ['Miến Phú Hương 200g', 1, 'gói', 14000, 19000, null],
  ['Bún khô Safoco 300g', 1, 'gói', 9500, 13000, null],
  ['Nui rau củ 400g', 1, 'gói', 11000, 15000, null],
  ['Cháo ăn liền Gấu Đỏ', 1, 'gói', 4300, 6000, null],
  ['Sữa tươi Vinamilk 180ml', 2, 'hộp', 6000, 8000, ['Lốc 4 hộp', 4, 30000], { batch: true }],
  ['Sữa TH True Milk 180ml', 2, 'hộp', 6500, 8500, ['Lốc 4 hộp', 4, 32500], { batch: true }],
  ['Sữa chua Vinamilk hộp 100g', 2, 'hộp', 4200, 6000, ['Lốc 4 hộp', 4, 22000], { batch: true }],
  ['Bánh Oreo vị vani 137g', 2, 'gói', 11500, 16000, null],
  ['Bánh quy Cosy 336g', 2, 'gói', 24000, 32000, null],
  ['Kẹo Alpenliebe gói 120g', 2, 'gói', 10500, 15000, null],
  ['Snack Oishi tôm cay', 2, 'gói', 4800, 7000, ['Thùng 24 gói', 24, 150000]],
  ['Bánh mì sandwich Kinh Đô', 2, 'gói', 13500, 18000, null, { batch: true }],
  ['Dầu ăn Neptune 1 lít', 3, 'chai', 42000, 52000, null],
  ['Nước mắm Nam Ngư 500ml', 3, 'chai', 26000, 34000, null],
  ['Nước tương Maggi 300ml', 3, 'chai', 17500, 23000, null],
  ['Đường trắng Biên Hòa 1kg', 3, 'gói', 21000, 27000, null],
  ['Muối i-ốt 500g', 3, 'gói', 4000, 6000, null],
  ['Hạt nêm Knorr 900g', 3, 'gói', 54000, 68000, null],
  ['Bột ngọt Ajinomoto 400g', 3, 'gói', 31000, 40000, null],
  ['Tương ớt Chinsu 250g', 3, 'chai', 9500, 13000, null],
  ['Nước rửa chén Sunlight 750g', 4, 'chai', 24000, 32000, null],
  ['Bột giặt Omo 800g', 4, 'gói', 42000, 54000, null],
  ['Dầu gội Clear 330g', 4, 'chai', 98000, 125000, null],
  ['Kem đánh răng P/S 180g', 4, 'tuýp', 27000, 36000, null],
  ['Giấy vệ sinh Pulppy (lốc 10 cuộn)', 4, 'lốc', 36000, 48000, null],
  ['Xà phòng Lifebuoy 90g', 4, 'cục', 9000, 13000, null],
  ['Gạo thơm ST25', 5, 'kg', 22000, 28000, null, { weight: true, plu: '100001', stock: 120 }],
  ['Gạo thường', 5, 'kg', 13500, 17000, null, { weight: true, plu: '100002', stock: 200 }],
  ['Thịt ba rọi', 5, 'kg', 105000, 135000, null, { weight: true, plu: '100003', stock: 45 }],
  ['Trứng gà (vỉ 10 quả)', 5, 'vỉ', 28000, 35000, null],
  ['Cà chua', 5, 'kg', 14000, 22000, null, { weight: true, plu: '100004', stock: 35 }],
  ['Hành tây', 5, 'kg', 16000, 24000, null, { weight: true, plu: '100005', stock: 30 }]
];

let seed = 20240607;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = arr => arr[Math.floor(rand() * arr.length)];

export function demoLoaded() { return S.list('products').some(p => p.demo); }

export function loadDemo({ days = 30, now = Date.now() } = {}) {
  seed = 20240607;
  const cats = CATS.map(n => saveCategory({ name: n }));
  const prods = [];
  P.forEach((r, i) => {
    const [name, ci, unit, cost, price, big, opt = {}] = r;
    const units = [{ name: unit, factor: 1, price, wholesale: Math.round(price * 0.93 / 100) * 100, wholesaleMin: big ? 12 : 0, barcodes: opt.weight ? [] : [ean13Check('893456' + String(100000 + i).slice(-6))] }];
    if (big) units.push({ name: big[0], factor: big[1], price: big[2], barcodes: [ean13Check('893457' + String(100000 + i).slice(-6))] });
    const p = saveProduct({ name, categoryId: cats[ci].id, units, cost: 0, kind: opt.weight ? 'weight' : 'count', plu: opt.plu || '', minStock: opt.weight ? 10 : 12, trackBatch: !!opt.batch });
    S.tx(() => { S.mut('products', p.id).demo = true; S.mut('products', p.id).cost = cost; });
    prods.push({ p, r, opt });
  });
  const sup = [['Công ty Phân phối Hòa Bình', '0903123456'], ['Đại lý nước giải khát Minh Phát', '0912345678'], ['Cô Lan – rau củ thịt', '0987001122'], ['Tổng kho Hóa phẩm An Khang', '0938222333']]
    .map(([name, phone]) => saveSupplier({ name, phone, payTermDays: 15 }));
  const supOf = ci => sup[ci === 0 ? 1 : ci === 4 ? 3 : ci === 5 ? 2 : 0];
  const cus = [['Chị Hoa (hàng xóm)', '0901000001', 'retail', 500000], ['Anh Tuấn – quán cơm', '0901000002', 'wholesale', 3000000], ['Cô Mai', '0901000003', 'vip', 1000000], ['Chú Ba', '0901000004', 'retail', 300000], ['Quán nước Gió Biển', '0901000005', 'wholesale', 5000000]]
    .map(([name, phone, group, debtLimit]) => saveCustomer({ name, phone, group, debtLimit }));

  // nhập hàng đầu kỳ
  const start = dayStart(now) - (days + 3) * DAY + 8 * 3600000;
  const exp = d => ymd(now + d * DAY);
  for (const si of [1, 0, 3, 2]) {
    const items = prods.filter(x => supOf(x.r[1]) === sup[si]).map(({ p, r, opt }) => {
      const qty = opt.weight ? (opt.stock || 30) : 160;
      const bigUnit = !opt.weight && r[5];
      return { productId: p.id, unitId: bigUnit ? p.units[1].id : p.units[0].id, qty: bigUnit ? Math.ceil(qty / r[5][1]) + 2 : qty, cost: bigUnit ? r[3] * r[5][1] : r[3],
        lot: opt.batch ? 'L' + ymd(start).replace(/-/g, '').slice(4) : '', expiry: opt.batch ? exp(r[0].includes('Sữa tươi') ? 20 : r[0].includes('Sữa chua') ? 9 : 40) : null };
    });
    if (items.length) createPurchase({ supplierId: sup[si].id, items, paid: si === 0 ? 0 : undefined, ts: start });
  }
  // bán hàng
  for (let d = days; d >= 0; d--) {
    const dayTs = dayStart(now) - d * DAY;
    const bills = d === 0 ? 5 : 8 + Math.floor(rand() * 8);
    for (let b = 0; b < bills; b++) {
      const ts = dayTs + (7 + Math.floor(rand() * 14)) * 3600000 + Math.floor(rand() * 3600000);
      if (ts > now) continue;
      const n = 1 + Math.floor(rand() * 5), lines = [];
      for (let k = 0; k < n; k++) {
        const x = pick(prods), qty = x.opt.weight ? Math.round((0.3 + rand() * 2) * 10) / 10 : 1 + Math.floor(rand() * 3);
        if (!lines.some(l => l.productId === x.p.id)) lines.push({ productId: x.p.id, unitId: x.p.units[0].id, qty });
      }
      const useCus = rand() < 0.25 ? pick(cus) : null;
      let cart = { lines, customerId: useCus && useCus.id };
      const total = calcCart(cart, { now: ts }).total;
      const debt = useCus && rand() < 0.4 && total > 50000 ? Math.round(total * 0.5 / 1000) * 1000 : 0;
      const method = rand() < 0.3 ? 'transfer' : 'cash';
      const payments = [{ method, amount: total - debt }]; if (debt) payments.push({ method: 'debt', amount: debt });
      try { createSale(cart, payments, { ts, cashGiven: method === 'cash' ? Math.ceil((total - debt) / 1000) * 1000 : undefined }); } catch (e) { /* bỏ bill lỗi (vd. vượt hạn mức nợ) */ }
    }
  }
  // một vài chi phí & thu nợ
  addCashEntry({ kind: 'expense', catId: S.list('cashCats').find(c => c.name === 'Tiền điện nước').id, amount: 850000, note: 'Tiền điện tháng trước', ts: dayStart(now) - 5 * DAY + 36000000 });
  addCashEntry({ kind: 'expense', catId: S.list('cashCats').find(c => c.name === 'Lương nhân viên').id, amount: 4500000, note: 'Lương nhân viên', ts: dayStart(now) - 3 * DAY + 36000000 });
  const debtor = S.list('customers').find(c => c.debt > 0);
  if (debtor) payCustomerDebt({ customerId: debtor.id, amount: Math.round(debtor.debt / 2 / 1000) * 1000 || debtor.debt, method: 'cash', note: 'Khách trả bớt' });
  // khuyến mãi
  const cocaId = prods[0].p.id, cat = cats[2].id;
  savePromo({ name: 'Mua 2 tặng 1 – Mì Hảo Hảo', type: 'buyxgety', scope: 'product', productIds: [prods[8].p.id], buyQty: 2, getQty: 1 });
  savePromo({ name: 'Giảm 10% Sữa & bánh kẹo cuối tuần', type: 'percent', scope: 'category', categoryIds: [cat], value: 10, days: [0, 6] });
  savePromo({ name: 'Combo Coca + Snack Oishi', type: 'combo', comboItems: [{ productId: cocaId, qty: 1 }, { productId: prods[22].p.id, qty: 1 }], comboPrice: 14000 });
  savePromo({ name: 'Giảm 20.000đ đơn từ 300.000đ (mã GIAM20)', type: 'amount', scope: 'all', value: 20000, minTotal: 300000, code: 'GIAM20' });
  log('demo', 'Nạp dữ liệu mẫu');
}
export { lookupBarcode };
