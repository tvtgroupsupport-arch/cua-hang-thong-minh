/* Thiết lập lần đầu + đăng nhập (mật khẩu hoặc PIN). */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, mount, field, guard, toast, checkbox } from '../ui.js';
import { joinDialog } from './sync.js';

const logo = () => h('div', { class: 'logo' }, icon('shop'));

export function viewLogin(root, { done }) {
  document.title = 'Tạp Hóa';
  if (!E.isSetUp()) return setup(root, done);
  const staff = S.list('staff').filter(s => s.active);
  let mode = staff.some(s => s.pin) ? 'pin' : 'pw', picked = null;
  const body = h('div');
  const draw = () => {
    if (mode === 'pw') {
      const u = h('input', { class: 'input', placeholder: 'Tên đăng nhập', autocomplete: 'username', autocapitalize: 'none', value: staff.length === 1 ? staff[0].username : '' });
      const p = h('input', { class: 'input', type: 'password', placeholder: 'Mật khẩu', autocomplete: 'current-password' });
      const go = () => guard(async () => { const s = await E.login(u.value, p.value); done(s); });
      p.addEventListener('keydown', e => e.key === 'Enter' && go());
      mount(body, field('Tên đăng nhập', u), field('Mật khẩu', p), h('button', { class: 'btn primary lg block', onClick: go }, 'Đăng nhập'),
        staff.some(s => s.pin) ? h('button', { class: 'btn ghost block mt8', onClick: () => { mode = 'pin'; draw(); } }, 'Đăng nhập nhanh bằng PIN') : null);
      setTimeout(() => (u.value ? p : u).focus(), 50);
    } else {
      const pinStaff = staff.filter(s => s.pin);
      let pin = '';
      const dots = h('div', { class: 'bigmoney', style: { letterSpacing: '8px', minHeight: '44px' } });
      const upd = () => { dots.textContent = '●'.repeat(pin.length) || ' '; };
      const submit = () => guard(async () => { const s = await E.loginPin(picked.id, pin); done(s); }).then(() => { pin = ''; upd(); });
      const key = k => { if (k === '⌫') pin = pin.slice(0, -1); else if (pin.length < 6) pin += k; upd(); if (pin.length >= 4 && k !== '⌫') { clearTimeout(key.t); key.t = setTimeout(() => pin.length >= 4 && submit(), 450); } };
      picked = picked || pinStaff[0];
      mount(body, h('div', { class: 'chips' }, pinStaff.map(s => h('span', { class: 'chip ' + (picked && picked.id === s.id ? 'on' : ''), onClick: () => { picked = s; pin = ''; draw(); } }, s.name))),
        dots, h('div', { class: 'numpad mt8' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(k => k ? h('button', { onClick: () => key(k) }, k) : h('span'))),
        h('button', { class: 'btn ghost block mt8', onClick: () => { mode = 'pw'; draw(); } }, 'Dùng tên đăng nhập & mật khẩu'));
      upd();
    }
  };
  draw();
  mount(root, h('div', { class: 'login' }, logo(), h('h2', { class: 'center' }, E.settings().store.name), h('p', { class: 'center muted small', style: { margin: '2px 0 18px' } }, 'Đăng nhập để bắt đầu bán hàng'), body));
}

function setup(root, done) {
  const f = {
    name: h('input', { class: 'input', placeholder: 'VD: Tạp hóa Minh Anh', autocomplete: 'off' }),
    address: h('input', { class: 'input', placeholder: 'Địa chỉ (in trên hoá đơn)' }),
    phone: h('input', { class: 'input', placeholder: 'Số điện thoại', inputMode: 'tel' }),
    owner: h('input', { class: 'input', placeholder: 'Họ tên chủ cửa hàng' }),
    user: h('input', { class: 'input', placeholder: 'VD: chu', autocapitalize: 'none', autocomplete: 'username' }),
    pw: h('input', { class: 'input', type: 'password', placeholder: 'Tối thiểu 4 ký tự', autocomplete: 'new-password' }),
    pw2: h('input', { class: 'input', type: 'password', placeholder: 'Nhập lại mật khẩu', autocomplete: 'new-password' })
  };
  const demo = checkbox('Nạp dữ liệu mẫu để dùng thử (có thể xoá sau)', false);
  const submit = () => guard(async () => {
    if (!f.name.value.trim()) throw Object.assign(new Error('Nhập tên cửa hàng'), { name: 'AppError' });
    if (f.pw.value !== f.pw2.value) throw Object.assign(new Error('Hai mật khẩu không khớp'), { name: 'AppError' });
    const st = await E.setupStore({ store: { name: f.name.value.trim(), address: f.address.value.trim(), phone: f.phone.value.trim() }, owner: { name: f.owner.value.trim() || 'Chủ cửa hàng', username: f.user.value.trim(), password: f.pw.value } });
    if (demo.input.checked) { toast('Đang nạp dữ liệu mẫu…'); await new Promise(r => setTimeout(r, 30)); E.loadDemo({}); }
    await S.flush();
    done(st);
  });
  mount(root, h('div', { class: 'login' }, logo(), h('h2', { class: 'center' }, 'Chào mừng đến với Tạp Hóa'), h('p', { class: 'center muted small', style: { margin: '2px 0 16px' } }, 'Thiết lập cửa hàng lần đầu – chỉ mất một phút'),
    h('div', { class: 'card' }, h('h3', null, 'Cửa hàng'), field('Tên cửa hàng', f.name), field('Địa chỉ', f.address), field('Điện thoại', f.phone)),
    h('div', { class: 'card' }, h('h3', null, 'Tài khoản chủ cửa hàng'), field('Họ tên', f.owner), field('Tên đăng nhập', f.user), field('Mật khẩu', f.pw), field('Nhập lại mật khẩu', f.pw2)),
    h('div', { class: 'mt8' }, demo), h('button', { class: 'btn primary lg block mt8', onClick: submit }, 'Bắt đầu sử dụng'),
    h('button', { class: 'btn ghost block mt12', onClick: () => joinDialog(() => { location.hash = '#/login'; location.reload(); }) }, icon('cloud', 18), ' Đã có cửa hàng? Kết nối máy này bằng mã đồng bộ'),
    h('p', { class: 'center muted tiny mt12' }, 'Dữ liệu lưu ngay trên thiết bị này, dùng được khi mất mạng. Hãy sao lưu định kỳ trong Cài đặt.')));
  setTimeout(() => f.name.focus(), 50);
}
