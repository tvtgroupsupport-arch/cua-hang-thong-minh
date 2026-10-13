/* Giao diện sáng/tối + lưu trữ nhỏ trong localStorage (có try/catch vì có thể bị chặn). */
const THEME_KEY = 'taphoa.theme';
export const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
export const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
export const getTheme = () => lsGet(THEME_KEY) || 'auto';
export function applyTheme() {
  const t = getTheme();
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#19211c' : '#15803d';
}
export function setTheme(t) { lsSet(THEME_KEY, t); applyTheme(); }
