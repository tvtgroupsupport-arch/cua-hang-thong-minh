/* Thư viện giao diện tối giản: dựng DOM, hộp thoại, thông báo, biểu mẫu, icon. */
import { fmtNum, parseMoney, parseQty } from './util.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); add(f, kids); return f; };
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function mount(root, ...kids) { root.replaceChildren(); add(root, kids); }

/* ---------- Icon ---------- */
const P = {
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  warehouse: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-7h10v7M7 17h10"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c.8-3.6 3.4-5.5 7-5.5s6.2 1.9 7 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2.3.6 3.6 2.3 4 5.2"/>',
  truck: '<path d="M2 6h11v10H2zM13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-3v3M16 14h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v5M12 17.5v.5"/>',
  back: '<path d="M15 5 8 12l7 7"/>', chevron: '<path d="m9 5 7 7-7 7"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  store: '<path d="M3 9l1.5-5h15L21 9M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8M10 20v-5h4v5"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  trend: '<path d="m3 17 6-6 4 4 8-9M15 6h6v6"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>'
};
export function icon(name, size) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.9'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
  s.innerHTML = P[name] || P.box;
  return s;
}
export const iconBtn = (name, onClick, title, extra) => h('button', { class: 'iconbtn', title, 'aria-label': title, onClick }, icon(name), extra);

/* ---------- Thông báo ---------- */
export function toast(msg, type = '', ms = 2600) {
  const t = h('div', { class: 'toast ' + type }, msg);
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? Math.max(ms, 4000) : ms);
}
/** Chạy hàm, hiện lỗi nghiệp vụ dưới dạng toast thay vì làm vỡ giao diện. Trả về undefined nếu lỗi. */
export async function guard(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && e.name === 'AppError') toast(e.message, 'error');
    else { console.error(e); toast('Lỗi: ' + (e && e.message || e), 'error'); }
  }
}

/* ---------- Hộp thoại ---------- */
export function modal({ title, body, actions = [], size = '', onClose, closable = true }) {
  const overlay = h('div', { class: 'overlay' });
  const close = (val) => { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(val); };
  const onKey = e => { if (e.key === 'Escape' && closable && overlay === topOverlay()) close(); };
  document.addEventListener('keydown', onKey);
  const bodyEl = h('div', { class: 'body' }, body);
  const footer = actions.length ? h('footer', null, actions.map(a => h('button', {
    class: 'btn ' + (a.kind || ''), onClick: async ev => {
      if (!a.onClick) return close();
      const btn = ev.currentTarget;        // currentTarget bị xoá sau khi await, nên giữ lại ngay
      btn.disabled = true;
      let r; try { r = await a.onClick(close); } finally { btn.disabled = false; }
      if (r !== false) close();
    }
  }, a.label))) : null;
  const m = h('div', { class: 'modal ' + size, role: 'dialog', 'aria-label': title },
    h('header', null, h('h2', null, title), closable ? iconBtn('x', () => close(), 'Đóng') : null), bodyEl, footer);
  overlay.appendChild(m);
  if (closable) overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  return { close, el: m, body: bodyEl, overlay };
}
const topOverlay = () => { const o = document.querySelectorAll('.overlay'); return o[o.length - 1]; };

export function confirmBox(message, { okText = 'Đồng ý', danger = false, title = 'Xác nhận' } = {}) {
  return new Promise(res => {
    let done = false;
    modal({ title, body: h('p', { style: { margin: 0, whiteSpace: 'pre-line' } }, message), onClose: () => { if (!done) res(false); },
      actions: [{ label: 'Huỷ', onClick: () => { done = true; res(false); } }, { label: okText, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; res(true); } }] });
  });
}
export function alertBox(message, title = 'Thông báo') {
  return new Promise(res => modal({ title, body: h('p', { style: { margin: 0, whiteSpace: 'pre-line' } }, message), onClose: () => res(), actions: [{ label: 'Đóng', kind: 'primary' }] }));
}

/** Hỏi một giá trị. type: text | money | qty | number | date | textarea. Trả về chuỗi hoặc null nếu huỷ. */
export function promptBox({ title, label, value = '', type = 'text', hint, okText = 'Đồng ý', placeholder }) {
  return new Promise(res => {
    let done = false;
    const input = type === 'textarea' ? h('textarea', { class: 'textarea', value }) :
      type === 'money' ? moneyInput(value) : h('input', { class: 'input', type: type === 'qty' || type === 'number' ? 'text' : type, inputMode: type === 'qty' || type === 'number' ? 'decimal' : undefined, value, placeholder });
    const submit = (close) => { done = true; res(type === 'money' ? String(input.num) : input.value); close(); };
    const m = modal({ title, body: h('div', null, label ? h('div', { class: 'muted small mb8' }, label) : null, input, hint ? h('div', { class: 'hint small muted mt8' }, hint) : null),
      onClose: () => { if (!done) res(null); }, actions: [{ label: 'Huỷ', onClick: () => { done = true; res(null); } }, { label: okText, kind: 'primary', onClick: close => { submit(close); return false; } }] });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); submit(m.close); } });
    setTimeout(() => { input.focus(); input.select && input.select(); }, 60);
  });
}

/* ---------- Ô nhập ---------- */
/** Ô nhập tiền: hiển thị 1.234.567; đọc/ghi số qua thuộc tính .num. */
export function moneyInput(value = '', opts = {}) {
  const el = h('input', { class: 'input ' + (opts.class || ''), type: 'text', inputMode: 'numeric', placeholder: opts.placeholder || '0', autocomplete: 'off' });
  const show = n => { el.value = n ? fmtNum(n) : ''; };
  el.addEventListener('input', () => {
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, '').length;
    const n = parseMoney(el.value); show(n);
    let pos = 0, seen = 0; while (pos < el.value.length && seen < digitsBefore) { if (/\d/.test(el.value[pos])) seen++; pos++; }
    try { el.setSelectionRange(pos, pos); } catch (e) {}
    if (opts.onInput) opts.onInput(n);
  });
  el.addEventListener('focus', () => setTimeout(() => el.select(), 0));
  Object.defineProperty(el, 'num', { get: () => parseMoney(el.value), set: v => show(Number(v) || 0) });
  show(Number(value) || 0);
  return el;
}export function qtyInput(value = '', opts = {}) {
  const el = h('input', { class: 'input ' + (opts.class || ''), type: 'text', inputMode: 'decimal', placeholder: opts.placeholder || '0', value: value === '' ? '' : String(value).replace('.', ',') });
  Object.defineProperty(el, 'num', { get: () => parseQty(el.value), set: v => { el.value = String(v).replace('.', ','); } });
  el.addEventListener('focus', () => setTimeout(() => el.select(), 0));
  return el;
}
export function field(label, input, hint) {
  return h('div', { class: 'field' }, label ? h('label', null, label) : null, input, hint ? h('div', { class: 'hint' }, hint) : null);
}
export function select(options, value, attrs) {
  const s = h('select', Object.assign({ class: 'select' }, attrs || {}), options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v, selected: String(v) === String(value) }, l);
  }));
  s.value = value == null ? '' : value;
  return s;
}
export function checkbox(label, checked, onChange) {
  const i = h('input', { type: 'checkbox', checked: !!checked, onChange: onChange && (e => onChange(e.target.checked)) });
  const w = h('label', { class: 'check' }, i, h('span', null, label));
  w.input = i; return w;
}
export function tabs(items, active, onPick) {
  const el = h('div', { class: 'tabs', 'data-swipe': 'tabs' }, items.map(([k, l]) => h('button', { class: k === active ? 'on' : '', onClick: () => onPick(k) }, l)));
  return el;
}
export const empty = (text, sub) => h('div', { class: 'empty' }, h('div', null, text), sub ? h('div', { class: 'small', style: { marginTop: '4px' } }, sub) : null);
export const badge = (text, kind = '') => h('span', { class: 'badge ' + kind }, text);
export const stat = (k, v, s, cls) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v), s ? h('div', { class: 's' }, s) : null);

/** Chọn một mục từ danh sách có ô tìm kiếm. items: mảng bất kỳ; render(item) -> Node; match(item, normQuery) -> bool. Trả Promise<item|null>. */
export function pickFromList({ title, items, render, match, searchPlaceholder = 'Tìm…', allowNone, noneLabel = 'Không chọn', limit = 80 }) {
  return new Promise(res => {
    let done = false, q = '';
    const list = h('div', { class: 'list' });
    const draw = () => {
      const f = (q ? items.filter(i => match(i, q)) : items).slice(0, limit);
      mount(list, allowNone ? h('div', { class: 'item click', onClick: () => finish(null, true) }, h('div', { class: 'grow muted' }, noneLabel)) : null,
        f.length ? f.map(i => h('div', { class: 'item click', onClick: () => finish(i) }, render(i))) : empty('Không có kết quả'));
    };
    const finish = (v) => { done = true; res(v); m.close(); };
    const search = h('input', { class: 'input', placeholder: searchPlaceholder, onInput: e => { q = e.target.value; draw(); } });
    const m = modal({ title, body: h('div', null, items.length > 6 ? search : null, h('div', { class: 'mt8' }, list)), onClose: () => { if (!done) res(undefined); } });
    draw(); setTimeout(() => items.length > 6 && search.focus(), 60);
  });
}

/** Ghi chú ngắn dạng "mô tả: giá trị" */
export const kv = (k, v, cls) => h('div', { class: 'row between', style: { padding: '3px 0' } }, h('span', { class: 'muted' }, k), h('span', { class: 'bold ' + (cls || '') }, v));

export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** Màu nhạt cố định theo chuỗi (tên hàng/khách) → class t0..t7 cho ô thumb, để danh sách sinh động mà vẫn nhất quán. */
export function tint(s) { let x = 0; for (const c of String(s || "")) x = (x * 31 + c.charCodeAt(0)) % 997; return "t" + (x % 8); }

/* ---------- Vuốt ngang để đổi tab / danh mục, tab đang chọn tự cuộn ra giữa (cách làm của app BEPO) ---------- */
function insideHScroll(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const o = getComputedStyle(n).overflowX;
    if ((o === 'auto' || o === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true;
  }
  return false;
}
/** Đưa phần tử đang chọn ra giữa thanh cuộn ngang của nó. */
export function centerIn(box, el, smooth) {
  if (!box || !el || box.scrollWidth <= box.clientWidth + 2) return;
  const br = box.getBoundingClientRect(), er = el.getBoundingClientRect();
  box.scrollTo({ left: Math.max(0, box.scrollLeft + (er.left - br.left) - (br.width - er.width) / 2), behavior: smooth ? 'smooth' : 'auto' });
}
/** Lắp một lần: vuốt trái/phải trên màn hình hoặc hộp thoại → chuyển sang tab/danh mục kế bên (phần tử có data-swipe, mục con là .tabs button hoặc [data-sw]).
    Không bắt cử chỉ khi đang vuốt trong vùng tự cuộn ngang (bảng, thanh chip, biểu đồ cuộn), ô nhập, hay trang giỏ hàng. */
export function installSwipe() {
  let x0 = null, y0 = null, start = null;
  document.addEventListener('touchstart', e => { if (e.touches.length !== 1) { x0 = null; return; } start = e.target; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (x0 === null || !start) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;               // phải là vuốt ngang đủ xa, không phải cuộn dọc
    if (/^(input|textarea|select)$/i.test(start.tagName) || start.closest('.cartpage, .scanner') || insideHScroll(start)) return;
    const ov = document.querySelectorAll('.overlay'), scope = ov.length ? ov[ov.length - 1].querySelector('.body') : document.querySelector('.main');
    const set = scope && scope.querySelector('[data-swipe]'); if (!set) return;
    const items = Array.from(set.children).filter(c => set.classList.contains('tabs') ? c.tagName === 'BUTTON' : c.hasAttribute('data-sw'));
    const cur = items.findIndex(c => c.classList.contains('on')), next = cur + (dx < 0 ? 1 : -1);
    if (cur < 0 || next < 0 || next >= items.length) return;
    items[next].click();
    try { scope.animate([{ transform: `translateX(${dx < 0 ? 28 : -28}px)`, opacity: .35 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'ease-out' }); } catch (e) {}
  }, { passive: true });
}
/** Lắp một lần: mỗi khi giao diện đổi, tab/chip đang chọn của thanh cuộn ngang được kéo ra giữa (nhảy ngay nếu thanh mới dựng, trượt mượt nếu đổi tab trên thanh đang có). */
export function installAutoCenter() {
  const last = new WeakMap();
  let queued = false;
  const scan = () => {
    queued = false;
    document.querySelectorAll('.tabs, .chips, .seg').forEach(box => {
      const on = box.querySelector('.on'); if (!on) return;
      const prev = last.get(box); if (prev === on) return;
      last.set(box, on); centerIn(box, on, !!(prev && prev.isConnected));
    });
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(scan); } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
