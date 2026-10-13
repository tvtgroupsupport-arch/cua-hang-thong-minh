/* Khởi động, điều hướng (hash router), khung ứng dụng. */
import { S, idbAdapter, memoryAdapter } from './store.js';
import * as E from './engine/index.js';
import { h, icon, mount, toast, debounce } from './ui.js';
import { applyTheme, lsGet, lsSet } from './theme.js';
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

  const root = h('div', { class: 'shell' }, nav,
    h('div', { class: 'content' },
      h('header', { class: 'topbar' }, title, actions,
        h('button', { class: 'iconbtn', title: 'Khoá / đổi người dùng', 'aria-label': 'Khoá', onClick: lock }, icon('lock'))),
      main));
  mount(app, root);
  shell = { root, title, actions, main, nav };
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

async function boot() {
  applyTheme();
  try { await S.init(idbAdapter()); }
  catch (e) {
    console.error(e); await S.init(memoryAdapter());
    toast('Không mở được bộ nhớ lưu trữ – dữ liệu sẽ MẤT khi đóng app. Hãy sao lưu thường xuyên!', 'error', 8000);
  }
  const sid = lsGet(SESSION_KEY), st = sid && S.get('staff', sid);
  if (st && st.active) S.session.staffId = st.id;
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.flush(); });
  window.addEventListener('pagehide', () => S.flush());
  S.subscribe(debounce(() => { if (shell) renderNav(); }, 500));
  window.__app = { S, E, go };
  const native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol) && !native) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
}
boot();

