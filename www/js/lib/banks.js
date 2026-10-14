/* Danh sách ngân hàng hỗ trợ VietQR (mã BIN 6 số). Cách làm theo app BEPO: tải danh sách đầy đủ, mới nhất từ API chính thức của VietQR khi có mạng
   (khoảng 55 ngân hàng), lưu lại trong máy để dùng offline lần sau; BANKS_FALLBACK chỉ là phương án dự phòng khi chưa từng tải được.
   Chỉ thử tải MỘT lần mỗi phiên (nút "Thử lại" thì mới thử lại) để mất mạng không làm màn hình kẹt vì gọi lặp. */
export const BANKS_FALLBACK = [
  ['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'], ['970407', 'Techcombank'], ['970432', 'VPBank'], ['970422', 'MB Bank'], ['970416', 'ACB'],
  ['970403', 'Sacombank'], ['970423', 'TPBank'], ['970441', 'VIB'], ['970426', 'MSB'], ['970440', 'SeABank'], ['970443', 'SHB'], ['970437', 'HDBank'], ['970431', 'Eximbank'], ['970448', 'OCB'],
  ['970429', 'SCB'], ['970449', 'LPBank'], ['970428', 'Nam A Bank'], ['970419', 'NCB'], ['970452', 'KienLongBank'], ['970454', 'VietCapitalBank'], ['970409', 'BacABank'], ['970446', 'Co-opBank'],
  ['970400', 'SaigonBank'], ['970406', 'DongA Bank'], ['970408', 'GPBank'], ['970412', 'PVcomBank'], ['970414', 'Oceanbank'], ['970430', 'PGBank'], ['970438', 'BaoVietBank'], ['970444', 'CBBank'],
  ['970457', 'Woori Bank'], ['970424', 'Shinhan Bank'], ['970458', 'UOB'], ['970439', 'Public Bank'], ['970410', 'Standard Chartered'], ['970463', 'Kookmin Bank'], ['963388', 'Timo'],
  ['546034', 'CAKE'], ['546035', 'Ubank'], ['422589', 'CIMB'], ['458761', 'HSBC']
].map(([bin, name]) => ({ bin, name }));

const KEY = 'taphoa.banks';
let live = null, loading = false, tried = false;
const read = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && Array.isArray(j.list) && j.list.length ? j.list : null; } catch (e) { return null; } };

/** Danh sách đang dùng: bản tải từ VietQR (trong phiên hoặc đã lưu) → dự phòng. */
export function getBanks() { return live || read() || BANKS_FALLBACK; }
export const banksSource = () => (live ? 'live' : read() ? 'cached' : 'fallback');
export const banksLoading = () => loading;

/** Tải danh sách đầy đủ từ API VietQR. Trả true nếu được. opts.retry=true để thử lại dù đã thử trong phiên. */
export async function loadBanksLive(opts = {}) {
  if (live || loading || (tried && !opts.retry)) return !!live;
  loading = true; tried = true;
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = setTimeout(() => ctl && ctl.abort(), 8000);
    const r = await fetch('https://api.vietqr.io/v2/banks', ctl ? { signal: ctl.signal } : undefined); clearTimeout(t);
    const j = await r.json();
    const list = (j.data || []).filter(b => b.transferSupported !== 0 && b.bin).map(b => ({ bin: String(b.bin), name: b.shortName || b.name })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    if (list.length) { live = list; try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list })); } catch (e) {} }
  } catch (e) { /* không có mạng/API lỗi: dùng bản đã lưu hoặc dự phòng, không tự thử lại */ }
  loading = false;
  return !!live;
}
export const bankName = bin => (getBanks().find(b => b.bin === bin) || BANKS_FALLBACK.find(b => b.bin === bin) || {}).name || '';
