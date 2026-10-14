/* Giao diện: chế độ sáng/tối + màu chủ đạo (violet | mint | ocean | sunset), lưu trong localStorage (có try/catch vì có thể bị chặn). */
const THEME_KEY = 'taphoa.theme', ACCENT_KEY = 'taphoa.accent';
export const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
export const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

export const ACCENTS = {
  violet: { name: 'Tím hoa cà', a1: '#8b5cf6', a2: '#5b7cfa' },
  mint: { name: 'Xanh bạc hà', a1: '#10c9a0', a2: '#2fa5f0' },
  ocean: { name: 'Xanh đại dương', a1: '#38a3ff', a2: '#4f5bf5' },
  sunset: { name: 'Hoàng hôn', a1: '#ff8a5c', a2: '#ff4f8b' }
};
export const getTheme = () => lsGet(THEME_KEY) || 'auto';
export const getAccent = () => (ACCENTS[lsGet(ACCENT_KEY)] ? lsGet(ACCENT_KEY) : 'violet');

export function applyTheme() {
  const t = getTheme(), a = getAccent(), root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  root.setAttribute('data-accent', a);
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#0e0f21' : ACCENTS[a].a1;
}
export function setTheme(t) { lsSet(THEME_KEY, t); applyTheme(); }
export function setAccent(a) { lsSet(ACCENT_KEY, a); applyTheme(); }
