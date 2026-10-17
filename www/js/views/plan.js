/* Gói cước & tài khoản lưu trữ (Supabase trung tâm của nhà cung cấp): đăng ký/đăng nhập, xem hạn, gửi yêu cầu gia hạn. */
import * as E from '../engine/index.js';
import * as Central from '../cloud/central.js';
import * as License from '../license.js';
import { h, mount, toast, guard, confirmBox, field, select, badge } from '../ui.js';
import { fmtDateTime, fmtMoney } from '../util.js';

let mode = 'signup';
const planLabel = m => `${m} tháng`;
const priceOf = m => { const p = (Central.cfg().plans || []).find(x => Number(x.months) === m); return p && p.price ? fmtMoney(p.price) : ''; };

export function viewPlan(root, ctx) {
  const box = h('div'), canManage = E.can('settings');
  let reqs = null, loading = false;
  const draw = () => mount(box, License.enabled() ? body() : free());

  const free = () => h('div', null,
    h('div', { class: 'hero' }, h('h2', null, 'Bản miễn phí'), h('p', null, 'Bản app này không có gói cước: dùng đầy đủ chức năng, không giới hạn thời gian.')),
    h('div', { class: 'card mt12 small muted' }, 'Nhà cung cấp muốn thu phí theo gói: điền địa chỉ Supabase trung tâm khi build (xem README → "Gói cước").'));

  function statusCard() {
    const s = License.status(), tone = s.locked ? 'red' : s.state === 'expiring' ? 'amber' : 'green';
    const total = s.plan ? s.plan * 30 : License.trialDays(), pct = s.locked ? 0 : Math.max(4, Math.min(100, Math.round(s.daysLeft / Math.max(1, total) * 100)));
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, License.describe()),
      h('div', { class: 'small muted' }, s.checkedAt ? 'Kiểm tra với máy chủ: ' + fmtDateTime(s.checkedAt) : 'Chưa kiểm tra với máy chủ')), badge(s.locked ? 'Đã khoá' : s.state === 'expiring' ? 'Sắp hết' : s.state === 'unknown' ? '—' : 'Còn hạn', tone)),
      s.state === 'unknown' ? null : h('div', { style: { height: '8px', borderRadius: '6px', background: 'rgba(128,128,128,.2)', overflow: 'hidden', marginTop: '10px' } }, h('div', { style: { height: '8px', width: pct + '%', background: s.locked ? '#dc2626' : 'var(--accent, #16a34a)' } })),
      s.locked ? h('div', { class: 'banner red mt8 small' }, 'Đã khoá thao tác ghi (bán hàng, nhập kho, thu chi…). Vẫn xem và xuất báo cáo được. Gia hạn xong, bấm "Kiểm tra lại".') : null,
      canManage && Central.isSignedIn() ? h('button', { class: 'btn mt8', onClick: async () => { await guard(License.refresh); await loadReqs(); draw(); toast('Đã kiểm tra lại', 'ok'); } }, 'Kiểm tra lại') : null);
  }

  function accountCard() {
    if (Central.isSignedIn()) return h('div', { class: 'card mt12' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, 'Tài khoản lưu trữ'), h('div', { class: 'small muted' }, Central.accountEmail())),
      h('button', { class: 'btn sm', onClick: async () => { if (!(await confirmBox('Đăng xuất tài khoản lưu trữ khỏi máy này? (Dữ liệu cửa hàng không mất.)', { okText: 'Đăng xuất' }))) return; Central.signOut(); reqs = null; draw(); } }, 'Đăng xuất')));
    const email = h('input', { class: 'input', type: 'email', autocapitalize: 'none', autocomplete: 'username', placeholder: 'email@vidu.com' });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: 'Mật khẩu (tối thiểu 6 ký tự)' });
    const shop = h('input', { class: 'input', value: E.settings().store.name || '', placeholder: 'Tên cửa hàng' });
    const go = async () => {
      if (!canManage) return toast('Chỉ chủ cửa hàng mới thao tác được', 'error');
      const ok = await guard(async () => {
        if (mode === 'signup') {
          const r = await Central.signUp({ email: email.value, password: pass.value, shopName: shop.value });
          if (r.needConfirm) { toast('Đã gửi email xác nhận — bấm liên kết trong email rồi quay lại đăng nhập', 'ok', 7000); mode = 'login'; return 'confirm'; }
        } else await Central.signIn({ email: email.value, password: pass.value });
        return 'in';
      });
      if (ok === 'in') { await guard(License.refresh); await loadReqs(); toast('Đã đăng nhập', 'ok'); }
      draw();
    };
    return h('div', { class: 'card mt12' }, h('div', { class: 'bold mb8' }, 'Tài khoản lưu trữ'),
      h('div', { class: 'small muted mb8' }, 'Tài khoản này giữ gói cước của cửa hàng bạn (không chứa dữ liệu bán hàng). Tài khoản mới được dùng thử theo cấu hình của nhà cung cấp.'),
      h('div', { class: 'seg mb8' }, [['signup', 'Đăng ký mới'], ['login', 'Đã có tài khoản']].map(([k, l]) => h('button', { class: mode === k ? 'on' : '', onClick: () => { mode = k; draw(); } }, l))),
      field('Email', email), field('Mật khẩu', pass), mode === 'signup' ? field('Tên cửa hàng', shop) : null,
      h('button', { class: 'btn primary block', onClick: go }, mode === 'signup' ? 'Tạo tài khoản' : 'Đăng nhập'));
  }

  async function loadReqs() { if (!Central.isSignedIn()) return; try { reqs = await Central.rpc('get_my_requests'); } catch (e) { reqs = reqs || []; } }

  function renewCard() {
    if (!Central.isSignedIn()) return null;
    const sel = select(License.PLAN_MONTHS.map(m => [String(m), planLabel(m) + (priceOf(m) ? ' — ' + priceOf(m) : '')]), '6'), note = h('input', { class: 'input', placeholder: 'Ghi chú (vd. nội dung chuyển khoản, tên người chuyển)' });
    const pending = (reqs || []).find(r => r.status === 'pending');
    const send = async () => {
      if (!canManage) return toast('Chỉ chủ cửa hàng mới gửi được', 'error');
      const r = await guard(async () => { await Central.rpc('request_renewal', { p_months: Number(sel.value), p_note: note.value }); return true; });
      if (!r) return;
      toast('Đã gửi yêu cầu — chờ nhà cung cấp duyệt', 'ok', 4500); await loadReqs(); draw();
    };
    return h('div', { class: 'card mt12' }, h('div', { class: 'bold mb8' }, 'Đăng ký / gia hạn gói cước'),
      Central.cfg().supportText ? h('div', { class: 'banner mb8 small', style: { whiteSpace: 'pre-wrap' } }, Central.cfg().supportText) : null,
      pending ? h('div', { class: 'banner amber mb8 small' }, `Đang chờ duyệt: gói ${planLabel(pending.plan_months)} (gửi ${fmtDateTime(Date.parse(pending.created_at))}). Gửi lại sẽ thay yêu cầu này.`) : null,
      field('Chọn gói', sel), field('Ghi chú', note),
      h('div', { class: 'small muted mb8' }, 'Chuyển khoản theo hướng dẫn trên rồi bấm gửi yêu cầu — nhà cung cấp kiểm tra tiền và duyệt, hạn được cộng thêm vào hạn hiện tại.'),
      h('button', { class: 'btn primary block', onClick: send }, 'Gửi yêu cầu gia hạn'),
      reqs && reqs.length ? h('div', { class: 'list mt12' }, reqs.slice(0, 6).map(r => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, 'Gói ' + planLabel(r.plan_months)), h('div', { class: 'sub' }, fmtDateTime(Date.parse(r.created_at)))), badge(r.status === 'approved' ? 'Đã duyệt' : r.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt', r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber')))) : null);
  }

  const body = () => h('div', null, h('div', { class: 'hero' }, h('h2', null, 'Gói cước'), h('p', null, 'Dùng thử miễn phí, sau đó đăng ký gói theo tháng. Hết hạn app chỉ khoá thao tác ghi — dữ liệu và báo cáo của bạn luôn còn nguyên.')),
    h('div', { class: 'mt12' }, statusCard()), accountCard(), renewCard());

  draw();
  if (License.enabled() && Central.isSignedIn() && !loading) { loading = true; (async () => { await License.refresh(); await loadReqs(); loading = false; if (box.isConnected) draw(); })(); }
  mount(root, box);
}
