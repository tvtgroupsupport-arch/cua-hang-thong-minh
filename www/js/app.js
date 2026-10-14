/* Khởi động, điều hướng (hash router), khung ứng dụng. */
import { S, idbAdapter, memoryAdapter } from './store.js';
import * as E from './engine/index.js';
import { h, icon, mount, toast, debounce, installSwipe, installAutoCenter } from './ui.js';
import { applyTheme, lsGet, lsSet } from './theme.js';
import { loadNativeBridge, onBack, isNative } from './native.js';
import { viewLogin } from './views/login.js';
import { viewPos } from './views/pos.js';
import { viewSales } from './views/sales.js';
import { viewProducts } from './views/products.js';
import { viewStock } from './views/stock.js';
import { viewReports } from './views/reports.js';
import { viewMore, viewHelp } from './views/more.js';
import { viewCustomers, viewSuppliers } from './views/people.js';
import { viewPromos } from './views/promos.js';
import { viewCash } from './views/cash.js';
import { viewSettings, viewStaff, viewLogs } from './views/settings.js';
import { viewExport } from './views/export.js';
import { viewSync } from './views/sync.js';
import * as Sync from './sync/engine.js';

const SESSION_KEY = 'taphoa.staff';
/* path, tiêu đề, quyền cần có (một trong), mục nav */
const ROUTES = {
  pos: { title: 'Bán hàng', perm: ['sell'], nav: 'pos', view: viewPos, flush: true },
  sales: { title: 'Hoá đơn', perm: ['sell', 'viewReports'], nav: 'pos', view: viewSales },
  products: { title: 'Hàng hóa', perm: ['manageProducts', 'sell', 'manageStock'], nav: 'products', view: viewProducts },
  stock: { title: 'Kho hàng', perm: ['manageStock', 'manageProducts'], nav: 'stock', view: viewStock },
  reports: { title: 'Báo cáo', perm: ['viewReports'], nav: 'reports', view: viewReports },
  more: { title: 'Thêm', perm: [], nav: 'more', view: viewMore },
  customers: { title: 'Khách hàng & công nợ', perm: ['manageCustomers', 'sell'], nav: 'more', view: viewCustomers },
  suppliers: { title: 'Nhà cung cấp & công nợ', perm: ['manageSuppliers'], nav: 'more', view: viewSuppliers },
  promos: { title: 'Khuyến mãi', perm: ['managePromos', 'sell'], nav: 'more', view: viewPromos },
  cash: { title: 'Sổ quỹ & ca làm việc', perm: ['cashbook'], nav: 'more', view: viewCash },
  settings: { title: 'Cài đặt', perm: ['settings'], nav: 'more', view: viewSettings },
  staff: { title: 'Nhân viên & quyền', perm: ['manageStaff'], nav: 'more', view: viewStaff },
  logs: { title: 'Nhật ký hoạt động', perm: ['settings', 'manageStaff'], nav: 'more', view: viewLogs },
  export: { title: 'Xuất báo cáo', perm: ['viewReports', 'manageStock', 'cashbook', 'manageProducts'], nav: 'reports', view: viewExport },
  sync: { title: 'Đồng bộ nhiều máy', perm: [], nav: 'more', view: viewSync },
  help: { title: 'Hướng dẫn', perm: [], nav: 'more', view: viewHelp }
};
const NAV = [['pos', 'Bán hàng', 'cart'], ['products', 'Hàng hóa', 'box'], ['stock', 'Kho', 'warehouse'], ['reports', 'Báo cáo', 'chart'], ['more', 'Thêm', 'menu']];

const app = document.getElementById('app');
let cleanup = null, shell = null, navActive = '';

export const go = path => { if (location.hash === '#/' + path) route(); else location.hash = '#/' + path; };
const allowed = r => !r.perm.length || r.perm.some(p => E.can(p));

function buildShell() {
  const title = h('h1'), actions = h('div', { class: 'row', style: { gap: '2px' } }), main = h('div', { class: 'main' });
  const nav = h('nav', { class: 'bottomnav' });
  const syncBtn = h('button', { class: 'iconbtn sync-btn hide', title: 'Đồng bộ nhiều máy', 'aria-label': 'Đồng bộ', onClick: () => go('sync') });

  const root = h('div', { class: 'shell' }, nav,
    h('div', { class: 'content' },
      h('header', { class: 'topbar' }, title, actions, syncBtn,
        h('button', { class: 'iconbtn', title: 'Khoá / đổi người dùng', 'aria-label': 'Khoá', onClick: lock }, icon('lock'))),
      main));
  mount(app, root);
  shell = { root, title, actions, main, nav, syncBtn };
  updateSyncBtn();
  renderNav();

}
function renderNav(active = navActive) {
  navActive = active;
  if (!shell) return;
  const al = alertCount();
  mount(shell.nav, NAV.filter(([k]) => allowed(ROUTES[k])).map(([k, label, ic]) => h('a', { href: '#/' + k, class: active === k ? 'on' : '' }, icon(ic), label,
    k === 'stock' && al ? h('span', { class: 'dot' }, al > 99 ? '99+' : al) : null)));
}
function alertCount() {
  try { if (!E.can('manageStock')) return 0; const a = E.stockAlerts(); return a.low.length + a.out.length + a.expiring.length + a.expired.length; } catch (e) { return 0; }
}

async function lock() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  E.logout(); lsSet(SESSION_KEY, null); shell = null;
  location.hash = '#/login'; route();
}
export function afterLogin(staff) {
  lsSet(SESSION_KEY, staff.id);
  const first = ['pos', 'products', 'stock', 'reports', 'more'].find(k => allowed(ROUTES[k])) || 'more';
  location.hash = '#/' + (location.hash.match(/^#\/(login)?$/) || !location.hash ? first : location.hash.slice(2));
  route();
}

function route() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const [name, ...rest] = (location.hash.replace(/^#\/?/, '') || '').split('/');
  if (!E.isSetUp() || !E.currentUser()) {
    shell = null;
    return viewLogin(app, { done: afterLogin });
  }
  const r = ROUTES[name];
  if (!r) { location.hash = '#/' + (['pos', 'products', 'stock', 'reports', 'more'].find(k => allowed(ROUTES[k])) || 'more'); return; }
  if (!allowed(r)) { toast('Bạn không có quyền vào mục này', 'error'); location.hash = '#/more'; return; }
  if (!shell || !shell.root.isConnected) buildShell();
  renderNav(r.nav);
  shell.title.textContent = r.title;
  mount(shell.actions);
  shell.main.className = 'main' + (r.flush ? ' flush' : '');
  shell.main.scrollTop = 0;
  mount(shell.main);
  const ctx = {
    params: rest, go,
    setTitle: t => { shell.title.textContent = t; },
    setActions: (...a) => mount(shell.actions, a),
    refreshNav: () => renderNav(r.nav)
  };
  try { const c = r.view(shell.main, ctx); cleanup = typeof c === 'function' ? c : null; }
  catch (e) { console.error(e); mount(shell.main, h('div', { class: 'banner red' }, 'Lỗi hiển thị: ' + e.message)); }
}

/** Mở kho dữ liệu với hạn chót: nếu IndexedDB treo (đã gặp với plugin SQLite trong app BEPO) thì báo rõ thay vì kẹt mãi ở màn "Đang tải". */
async function openStore() {
  let timer;
  try {
    await Promise.race([S.init(idbAdapter()), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Mở bộ nhớ quá 10 giây')), 10000); })]);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}   // xin hệ thống không tự dọn dữ liệu khi thiếu bộ nhớ
  } catch (e) {
    console.error(e); await S.init(memoryAdapter());
    toast('Không mở được bộ nhớ lưu trữ – dữ liệu sẽ MẤT khi đóng app. Hãy sao lưu thường xuyên! (' + e.message + ')', 'error', 10000);
  } finally { clearTimeout(timer); }
}

/** Nút Back của Android: đóng hộp thoại trước, rồi lùi màn hình, rồi về Bán hàng; ở Bán hàng thì thu nhỏ app (không thoát hẳn, khỏi mất phiên). */
function handleBack() {
  if (document.querySelector('.overlay')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return true; }
  const cp = document.querySelector('.cartpage.open .cp-back'); if (cp) { cp.click(); return true; }      // đang xem giỏ hàng → quay lại danh sách sản phẩm
  if (!shell) return false;
  const name = (location.hash.replace(/^#\/?/, '') || '').split('/')[0];
  if (name && name !== 'pos' && ['sales', 'customers', 'suppliers', 'promos', 'cash', 'settings', 'staff', 'logs', 'help'].includes(name)) { go('more'); return true; }
  if (name && name !== 'pos') { go('pos'); return true; }
  return false;
}

let lastPersistWarn = 0;
async function boot() {
  applyTheme();
  await loadNativeBridge();
  await openStore();
  const sid = lsGet(SESSION_KEY), st = sid && S.get('staff', sid);
  if (st && st.active) S.session.staffId = st.id;
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.flush(); });
  window.addEventListener('pagehide', () => S.flush());
  S.subscribe(debounce(() => {
    if (shell) renderNav();
    if (S.persistError && Date.now() - lastPersistWarn > 30000) { lastPersistWarn = Date.now(); toast('CẢNH BÁO: không ghi được dữ liệu vào bộ nhớ (' + (S.persistError.message || 'lỗi') + '). Hãy sao lưu ngay!', 'error', 10000); }
  }, 500));
  onBack(handleBack);
  Sync.onStatus(updateSyncBtn); Sync.onDataChanged(debounce(refreshView, 400));
  if (Sync.isEnabled()) Sync.start();
  installSwipe(); installAutoCenter();
  window.__app = { S, E, go };
  const native = isNative();
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol) && !native) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
}
boot();

/* ---------- Đồng bộ: biểu tượng trạng thái trên thanh trên + làm mới màn hình khi có dữ liệu từ máy khác ---------- */
function updateSyncBtn() {
  if (!shell || !shell.syncBtn) return;
  const st = Sync.getStatus(), b = shell.syncBtn;
  b.classList.toggle('hide', !st.enabled);
  if (!st.enabled) return;
  b.className = 'iconbtn sync-btn ' + (st.running ? 'busy' : st.error ? 'err' : st.pending ? 'pend' : 'ok');
  b.title = st.running ? 'Đang đồng bộ…' : st.error ? 'Lỗi đồng bộ — chạm để xem' : st.pending ? `Chờ gửi ${st.pending} thay đổi` : 'Đã đồng bộ';
  mount(b, icon('cloud'), st.pending && !st.running ? h('span', { class: 'dot' }, st.pending > 99 ? '99+' : st.pending) : null);
}
function refreshView() {
  // dữ liệu mới từ máy khác: vẽ lại màn hình hiện tại, trừ khi người dùng đang gõ/đang mở hộp thoại/đang có giỏ hàng mở
  const a = document.activeElement;
  if (document.querySelector('.overlay, .cartpage.open') || (a && /^(input|textarea|select)$/i.test(a.tagName))) return;
  if (shell) renderNav();
  route();
}
