/* Quản trị gói cước cho NHÀ CUNG CẤP (tài khoản đã được thêm vào bảng admins của Supabase trung tâm): duyệt/từ chối yêu cầu gia hạn,
   xem danh sách chủ cửa hàng, cộng tháng. Mọi quyền được kiểm tra lại ở máy chủ (hàm admin_*), màn này chỉ là giao diện. */
import * as Central from '../cloud/central.js';
import { h, mount, toast, guard, confirmBox, badge, empty } from '../ui.js';
import { fmtDateTime } from '../util.js';

const fmtDate = ms => ms ? new Date(ms).toLocaleDateString('vi-VN') : '—';
const statusBadge = o => {
  const left = o.expires_at ? Date.parse(o.expires_at) - Date.now() : 0;
  if (o.status === 'expired' || left <= 0) return badge('Hết hạn', 'red');
  if (left < 7 * 864e5) return badge('Sắp hết', 'amber');
  return o.status === 'trial' ? badge('Dùng thử', 'blue') : badge('Đang dùng', 'green');
};

export function viewPlanAdmin(root, ctx) {
  const box = h('div'); let state = null, err = '', q = '';
  const load = async () => {
    mount(box, h('div', { class: 'muted small center' }, 'Đang tải…'));
    try {
      if (!(await Central.rpc('admin_status'))) throw new Error('Tài khoản này chưa được cấp quyền admin (thêm vào bảng admins trong Supabase trung tâm).');
      const [overview, requests] = await Promise.all([Central.rpc('admin_overview'), Central.rpc('admin_pending_requests')]);
      state = { overview: overview || [], requests: requests || [] }; err = '';
    } catch (e) { err = e.message; state = null; }
    draw();
  };
  const act = async (fn, okMsg) => { const r = await guard(async () => { await fn(); return true; }); if (r) { toast(okMsg, 'ok'); await load(); } };

  function draw() {
    if (err) return mount(box, h('div', { class: 'banner red' }, err), h('button', { class: 'btn mt8', onClick: load }, 'Thử lại'));
    const { overview, requests } = state, active = overview.filter(o => o.status !== 'expired').length;
    const list = overview.filter(o => !q || (`${o.email} ${o.shop_name}`).toLowerCase().includes(q));
    mount(box,
      h('div', { class: 'card row' }, h('div', { class: 'grow' }, h('b', null, overview.length), ' chủ cửa hàng · ', h('b', null, active), ' còn hạn · ', h('b', null, requests.length), ' chờ duyệt'), h('button', { class: 'btn sm', onClick: load }, 'Làm mới')),
      h('div', { class: 'card mt12' }, h('h3', null, 'Yêu cầu gia hạn chờ duyệt'),
        requests.length ? h('div', { class: 'list' }, requests.map(r => h('div', { class: 'item' },
          h('div', { class: 'grow' }, h('div', { class: 'ttl' }, r.shop_name || '—', ' · ', h('b', null, r.plan_months + ' tháng')), h('div', { class: 'sub' }, `${r.email || ''} · ${fmtDateTime(Date.parse(r.created_at))}${r.note ? ' · ' + r.note : ''}`)),
          h('button', { class: 'btn sm primary', onClick: async () => { if (await confirmBox(`Đã nhận tiền? Duyệt gia hạn ${r.plan_months} tháng cho ${r.email}?`, { okText: 'Duyệt' })) act(() => Central.rpc('admin_approve_renewal', { p_id: r.id }), 'Đã duyệt'); } }, 'Duyệt'),
          h('button', { class: 'btn sm danger', onClick: async () => { if (await confirmBox('Từ chối yêu cầu này?', { danger: true, okText: 'Từ chối' })) act(() => Central.rpc('admin_reject_renewal', { p_id: r.id }), 'Đã từ chối'); } }, 'Từ chối'))))
          : h('div', { class: 'muted small' }, 'Không có yêu cầu nào.'),
        h('div', { class: 'small muted mt8' }, 'Chỉ bấm Duyệt sau khi đã nhận tiền. Duyệt sẽ cộng số tháng vào hạn hiện tại (gia hạn sớm không mất phần còn lại).')),
      h('div', { class: 'card mt12' }, h('h3', null, 'Danh sách chủ cửa hàng'),
        h('input', { class: 'input mb8', placeholder: 'Tìm theo email / tên cửa hàng', value: q, onInput: e => { q = e.target.value.trim().toLowerCase(); draw(); const i = box.querySelector('input'); if (i) { i.focus(); i.setSelectionRange(q.length, q.length); } } }),
        list.length ? h('div', { class: 'list' }, list.map(o => h('div', { class: 'item' },
          h('div', { class: 'grow' }, h('div', { class: 'ttl' }, o.shop_name || '—', ' ', statusBadge(o), o.plan_months ? badge(o.plan_months + ' tháng', 'blue') : null, o.linked ? badge('Đã nối kho', 'green') : null),
            h('div', { class: 'sub' }, `${o.email || ''} · hết hạn ${fmtDate(o.expires_at ? Date.parse(o.expires_at) : 0)}`)),
          h('div', { class: 'row', style: { gap: '4px' } }, [1, 6, 12].map(m => h('button', { class: 'btn sm', onClick: async () => { if (await confirmBox(`Cộng thêm ${m} tháng cho ${o.email}?`, { okText: 'Cộng' })) act(() => Central.rpc('admin_extend', { p_owner: o.owner_id, p_months: m }), `Đã cộng ${m} tháng`); } }, '+' + m)))))) : empty('Chưa có chủ cửa hàng nào')));
  }
  load(); mount(root, box);
}
