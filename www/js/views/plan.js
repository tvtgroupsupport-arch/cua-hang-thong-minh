/* Gói cước & tài khoản lưu trữ (Supabase trung tâm của nhà cung cấp): đăng ký/đăng nhập, xem hạn, gửi yêu cầu gia hạn. */
import * as E from '../engine/index.js';
import * as Central from '../cloud/central.js';
import * as License from '../license.js';
import { h, mount, toast, guard, confirmBox, field, select, badge } from '../ui.js';
import { fmtDateTime, fmtMoney } from '../util.js';
import { copyText } from '../native.js';

let mode = 'signup';
const planLabel = m => `${m} tháng`;
const priceOf = m => { const p = (Central.cfg().plans || []).find(x => Number(x.months) === m); return p && p.price ? fmtMoney(p.price) : ''; };

export function viewPlan(root, ctx) {
  const box = h('div'), canManage = E.can('settings');
  let reqs = null, loading = false;
  const draw = () => mount(box, License.enabled() ? body() : free());

  /** Chưa có máy chủ gói cước: bản miễn phí. Cho phép nhập địa chỉ máy chủ ngay trong app (kiểm thử / nhà cung cấp tự thử) mà không cần build lại. */
  function free() {
    const url = h('input', { class: 'input', placeholder: 'https://xxxx.supabase.co', autocapitalize: 'none', inputMode: 'url' });
    const key = h('input', { class: 'input', placeholder: 'Khoá anon / publishable (KHÔNG phải service_role / secret)', autocapitalize: 'none', autocomplete: 'off' });
    const save = async () => {
      if (!canManage) return toast('Chỉ chủ cửa hàng mới thiết lập được', 'error');
      const r = await guard(async () => { Central.setLocalConfig(url.value, key.value); return true; });
      if (r) { toast('Đã lưu máy chủ gói cước', 'ok'); License.ensureTrialStart(); draw(); }
    };
    return h('div', null,
      h('div', { class: 'hero' }, h('h2', null, 'Bản miễn phí'), h('p', null, 'Chưa kết nối máy chủ gói cước: dùng đầy đủ chức năng, không giới hạn thời gian.')),
      h('div', { class: 'card mt12' }, h('div', { class: 'bold mb8' }, 'Kết nối máy chủ gói cước'),
        h('div', { class: 'small muted mb8' }, 'Dành cho nhà cung cấp: dán địa chỉ và khoá anon của dự án Supabase trung tâm (đã chạy supabase/central-setup.sql). Bản phát hành chính thức nên điền sẵn khi build (GitHub Secrets) để người dùng không phải nhập.'),
        field('Project URL', url), field('Khoá anon / publishable', key),
        h('button', { class: 'btn primary block', onClick: save }, 'Kết nối')));
  }

  function serverCard() {
    const host = (() => { try { return new URL(Central.cfg().centralUrl).host; } catch (e) { return ''; } })();
    return h('div', { class: 'card mt12' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, 'Máy chủ gói cước'), h('div', { class: 'small muted' }, host)),
      h('button', { class: 'btn sm', onClick: runDiag }, 'Chẩn đoán'),
      Central.isCustomConfig() && canManage ? h('button', { class: 'btn sm danger', onClick: async () => { if (!(await confirmBox('Gỡ máy chủ gói cước khỏi máy này? App sẽ chạy như bản miễn phí.', { danger: true, okText: 'Gỡ' }))) return; Central.clearLocalConfig(); reqs = null; isAdmin = false; draw(); } }, 'Gỡ') : null),
      diagBox);
  }

  /** Chạy lần lượt từng bước kiểm tra (mạng → khoá → đăng nhập → hàm gói cước → quyền admin), báo ✓/✗ kèm lý do để gửi cho nhà phát triển. */
  const diagBox = h('div');
  async function runDiag() {
    const lines = []; const show = () => mount(diagBox, h('div', { class: 'mt8' }, h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', margin: 0 } }, lines.join('\n')),
      h('button', { class: 'btn sm mt8', onClick: async () => toast((await copyText(lines.join('\n'))) ? 'Đã sao chép báo cáo' : 'Không sao chép được', 'ok') }, 'Sao chép báo cáo')));
    const step = async (name, fn) => { lines.push('… ' + name); show(); const i = lines.length - 1; try { lines[i] = '✓ ' + name + ': ' + (await fn()); } catch (e) { lines[i] = '✗ ' + name + ': ' + (e.message || e); } show(); };
    const c = Central.cfg();
    await step('Địa chỉ máy chủ', async () => c.centralUrl);
    await step('Kết nối mạng & khoá API', async () => {
      const r = await fetch(c.centralUrl + '/auth/v1/settings', { headers: { apikey: c.centralAnonKey } }).catch(() => { throw new Error('không kết nối được — kiểm tra mạng/địa chỉ'); });
      if (r.status === 401 || r.status === 403) throw new Error('khoá anon bị từ chối — dán lại khoá anon/publishable của đúng dự án');
      if (!r.ok) throw new Error('máy chủ trả mã ' + r.status + (r.status === 540 || r.status === 503 ? ' (dự án có thể đang tạm dừng — vào dashboard Supabase bấm Restore)' : ''));
      const s = await r.json().catch(() => ({})); return `OK · xác nhận email ${s.mailer_autoconfirm ? 'TẮT (đăng ký dùng được ngay)' : 'BẬT (phải bấm liên kết trong email)'}`;
    });
    await step('Đăng nhập tài khoản lưu trữ', async () => { if (!Central.isSignedIn()) throw new Error('chưa đăng nhập'); await Central.accessToken(); return Central.accountEmail(); });
    if (Central.isSignedIn()) {
      await step('Hàm gói cước (get_my_subscription)', async () => {
        try { const d = await Central.rpc('get_my_subscription'); return d ? `gói ${d.plan_months} tháng · ${d.status} · hết hạn ${d.expires_at}` : 'chưa có gói (tài khoản tạo trước khi chạy script?)'; }
        catch (e) { if (/404|Could not find|function/i.test(e.message) || e.status === 404) throw new Error('chưa cài — hãy chạy supabase/central-setup.sql trong SQL Editor của dự án'); throw e; }
      });
      await step('Quyền quản trị (admin)', async () => ((await Central.rpc('admin_status')) ? 'có quyền admin' : 'không phải admin (bình thường với chủ cửa hàng)'));
    }
  }

  let isAdmin = false;
  async function loadAdmin() { if (!Central.isSignedIn()) return; try { isAdmin = !!(await Central.rpc('admin_status')); } catch (e) { isAdmin = false; } }
  const adminCard = () => isAdmin ? h('a', { class: 'banner green mt12', href: '#/planadmin', style: { display: 'block', textDecoration: 'none', color: 'inherit' } }, h('b', null, 'Quản trị gói cước (nhà cung cấp) →'), ' duyệt yêu cầu gia hạn, xem danh sách chủ cửa hàng, cộng tháng.') : null;

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
      h('button', { class: 'btn sm', onClick: async () => { if (!(await confirmBox('Đăng xuất tài khoản lưu trữ khỏi máy này? (Dữ liệu cửa hàng không mất.)', { okText: 'Đăng xuất' }))) return; Central.signOut(); reqs = null; isAdmin = false; draw(); } }, 'Đăng xuất')));
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
      if (ok === 'in') { await guard(License.refresh); await loadReqs(); await loadAdmin(); toast('Đã đăng nhập', 'ok'); }
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
    h('div', { class: 'mt12' }, statusCard()), accountCard(), adminCard(), renewCard(), serverCard());

  draw();
  if (License.enabled() && Central.isSignedIn() && !loading) { loading = true; (async () => { await License.refresh(); await loadReqs(); await loadAdmin(); loading = false; if (box.isConnected) draw(); })(); }
  mount(root, box);
}
