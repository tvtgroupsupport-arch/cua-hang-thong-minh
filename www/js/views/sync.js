/* Đồng bộ nhiều máy qua Supabase miễn phí: thiết lập (chủ cửa hàng), kết nối máy phụ bằng mã/QR, quản lý thiết bị, trạng thái. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import * as Sync from '../sync/engine.js';
import { h, icon, mount, modal, toast, guard, confirmBox, field, select, badge, kv, empty, tabs } from '../ui.js';
import { fmtDateTime } from '../util.js';
import { copyText, openUrl, shareText, openScanner, canScan, isNative } from '../native.js';
import { QR } from '../lib/qr.js';
import { autoConnect, oauthProvision, oauthAvailable } from '../sync/provision.js';
import * as Central from '../cloud/central.js';

const hostOf = u => { try { return new URL(u).host; } catch (e) { return u || ''; } };
const ago = ts => { if (!ts) return 'chưa lần nào'; const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? 'vừa xong' : s < 3600 ? Math.round(s / 60) + ' phút trước' : s < 86400 ? Math.round(s / 3600) + ' giờ trước' : fmtDateTime(ts); };
let mode = 'owner';
let devCache = null;      // danh sách thiết bị: nhớ 20 giây để các lần vẽ lại do trạng thái đồng bộ đổi không gọi máy chủ liên tục

/** Hộp thoại kết nối máy phụ bằng mã (dùng cả ở màn thiết lập lần đầu). onDone() gọi sau khi tải xong dữ liệu. */
export function joinDialog(onDone) {
  const code = h('textarea', { class: 'textarea', placeholder: 'Dán mã kết nối bắt đầu bằng TH1. do máy chủ cửa hàng tạo', style: { minHeight: '96px', fontFamily: 'ui-monospace, monospace', fontSize: '12px' } });
  const m = modal({ title: 'Kết nối vào cửa hàng có sẵn', body: h('div', null,
    h('div', { class: 'banner mb8' }, 'Máy này sẽ tải toàn bộ dữ liệu của cửa hàng về. ', E.isSetUp() ? h('b', null, 'Dữ liệu hiện có trên máy này sẽ bị xoá và thay bằng dữ liệu của cửa hàng.') : null),
    field('Mã kết nối', code), canScan() ? h('button', { class: 'btn block', onClick: () => openScanner({ onCode: c => { code.value = c; } }) }, icon('scan', 18), ' Quét mã QR trên máy chủ') : null),
    actions: [{ label: 'Huỷ' }, { label: 'Kết nối', kind: 'primary', onClick: async () => {
      const v = code.value.trim(); if (!v) { toast('Dán hoặc quét mã kết nối', 'error'); return false; }
      if (E.isSetUp() && !(await confirmBox('Xoá dữ liệu trên máy này và thay bằng dữ liệu của cửa hàng?', { danger: true, okText: 'Xoá & kết nối' }))) return false;
      toast('Đang tải dữ liệu cửa hàng…', '', 6000);
      const r = await guard(() => Sync.joinWithCode(v)); if (!r) return false;
      if (r.error) { toast(r.error, 'error', 6000); return false; }
      Sync.start(); toast(`Đã kết nối: tải ${r.pulled} bản ghi`, 'ok'); onDone && onDone();
    } }] });
  void m;
}

/** Cách nhanh (như BEPO): đăng nhập tài khoản lưu trữ → bấm Authorize một lần trên trang Supabase → máy chủ trung tâm tự tạo dự án. */
function oauthDialog(onDone) {
  const bar = h('div', { style: { height: '8px', width: '0%', background: 'var(--accent, #7c5cff)', borderRadius: '6px', transition: 'width .3s' } });
  const msg = h('div', { class: 'small mt8' }); let busy = false;
  const go = async () => {
    if (busy) return; busy = true; btn.disabled = true; msg.className = 'small mt8'; msg.textContent = 'Đang chuẩn bị…';
    try {
      await oauthProvision({ openUrl: u => openUrl(u), onProgress: (i, n, t) => { bar.style.width = Math.round(i / n * 100) + '%'; msg.textContent = t ? `Bước ${i}/${n}: ${t}` : ''; } });
      Sync.start(); m.close && m.close(); toast('Đã tạo kho dữ liệu & liên kết xong — dữ liệu đã được đẩy lên', 'ok', 5000); onDone && onDone();
    } catch (e) { msg.className = 'banner red mt8'; msg.textContent = e.message; btn.textContent = 'Tiếp tục / thử lại'; }
    finally { busy = false; btn.disabled = false; }
  };
  const btn = h('button', { class: 'btn primary block mt8', onClick: go }, 'Bắt đầu');
  const m = modal({ title: 'Tạo kho dữ liệu tự động', body: h('div', null,
    h('div', { class: 'small mb8' }, 'App sẽ mở trang Supabase để bạn bấm ', h('b', null, 'Authorize'), ' một lần (đăng nhập hoặc đăng ký Supabase miễn phí nếu chưa có), rồi tự tạo dự án, cài hàm đồng bộ và liên kết. Mất khoảng 1–3 phút, đừng đóng app.'),
    btn, h('div', null, h('div', { style: { height: '8px', background: 'rgba(128,128,128,.2)', borderRadius: '6px', overflow: 'hidden', marginTop: '10px' } }, bar), msg),
    h('div', { class: 'banner mt8 small' }, 'An toàn: app không cầm token của Supabase — token chỉ nằm tạm trên máy chủ gói cước và bị xoá ngay khi xong. Nếu Supabase báo "No organizations found": tạo một organization (gói Free) rồi bấm Tiếp tục.')),
    actions: [{ label: 'Đóng' }] });
}

/** Tự tạo dự án Supabase + liên kết bằng mã truy cập cá nhân (xem sync/provision.js). onDone() gọi khi liên kết xong. */
function autoDialog(onDone) {
  const token = h('input', { class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'none', placeholder: 'sbp_…' });
  const orgSel = h('div'), bar = h('div', { style: { height: '8px', width: '0%', background: 'var(--accent, #7c5cff)', borderRadius: '6px', transition: 'width .3s' } });
  const msg = h('div', { class: 'small mt8' }), prog = h('div', { class: 'hide mt8' }, h('div', { style: { height: '8px', background: 'rgba(128,128,128,.2)', borderRadius: '6px', overflow: 'hidden' } }, bar), msg);
  let busy = false, orgSlug = '';
  const go = async () => {
    if (busy) return; busy = true; btn.disabled = true; prog.classList.remove('hide'); msg.className = 'small mt8'; msg.textContent = '';
    try {
      const r = await autoConnect({ token: token.value, orgSlug, onProgress: (i, n, t) => { bar.style.width = Math.round(i / n * 100) + '%'; msg.textContent = `Bước ${i}/${n}: ${t}…`; } });
      if (r.needOrg) { mount(orgSel, field('Chọn tổ chức Supabase để tạo dự án', select(r.needOrg.map(o => [o.slug, o.name]), r.needOrg[0].slug, { onChange: e => { orgSlug = e.target.value; } }))); orgSlug = r.needOrg[0].slug; msg.textContent = 'Chọn tổ chức rồi bấm "Thử lại".'; btn.textContent = 'Thử lại'; return; }
      token.value = ''; Sync.start(); m.close && m.close(); toast('Đã tạo dự án & liên kết xong — dữ liệu đã được đẩy lên', 'ok', 5000); onDone && onDone();
    } catch (e) { msg.className = 'banner red mt8'; msg.textContent = e.message; btn.textContent = 'Thử lại'; }
    finally { busy = false; btn.disabled = false; }
  };
  const btn = h('button', { class: 'btn primary block mt8', onClick: go }, 'Bắt đầu');
  const m = modal({ title: 'Tự động liên kết Supabase', body: h('div', null,
    h('div', { class: 'small mb8' }, h('b', null, '1. '), 'Đăng nhập supabase.com (miễn phí) → ', h('b', null, 'Account → Access Tokens → Generate new token'), ' → chép mã (bắt đầu bằng sbp_).'),
    h('button', { class: 'btn sm mb8', onClick: () => openUrl('https://supabase.com/dashboard/account/tokens') }, 'Mở trang tạo mã'),
    h('div', { class: 'small mb8' }, h('b', null, '2. '), 'Dán mã vào đây rồi bấm Bắt đầu. App tạo dự án (mất 1–2 phút) và tự cài đặt.'),
    field('Mã truy cập Supabase', token), orgSel, btn, prog,
    h('div', { class: 'banner mt8 small' }, 'Bảo mật: mã chỉ dùng một lần trên máy này, không được lưu hay gửi đi đâu ngoài Supabase. Xong việc nên vào trang Access Tokens thu hồi (Revoke) mã đó. Mỗi tài khoản Supabase miễn phí tối đa 2 dự án đang hoạt động.'),
    isNative() ? null : h('div', { class: 'small muted mt8' }, 'Lưu ý: trên trình duyệt web, Supabase có thể chặn kiểu gọi này — hãy dùng app Android hoặc làm thủ công.')),
    actions: [{ label: 'Đóng' }] });
}

export function viewSync(root, ctx) {
  const box = h('div'), canManage = E.can('settings');
  let unsub = Sync.onStatus(() => draw());
  const draw = () => {
    const st = Sync.getStatus();
    mount(box, st.enabled ? configured(st) : setup());
  };

  /* ---------- Chưa kết nối ---------- */
  function setup() {
    const url = h('input', { class: 'input', placeholder: 'https://abcdxyz.supabase.co', autocapitalize: 'none', inputMode: 'url', value: S.meta.syncDraft && S.meta.syncDraft.url || '' });
    const anon = h('input', { class: 'input', placeholder: 'Khoá anon / publishable (dài, bắt đầu eyJ… hoặc sb_publishable_…)', autocapitalize: 'none', value: S.meta.syncDraft && S.meta.syncDraft.anon || '' });
    const step = (n, title, ...kids) => h('div', { class: 'card' }, h('div', { class: 'row mb8' }, h('div', { class: 'thumb t0', style: { width: '34px', height: '34px', borderRadius: '12px' } }, n), h('div', { class: 'bold' }, title)), ...kids);
    const sqlBox = h('textarea', { class: 'textarea hide', readOnly: true, style: { minHeight: '180px', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px' } });
    const connect = async () => {
      if (!E.can('settings')) return toast('Chỉ chủ cửa hàng mới thiết lập được', 'error');
      S.setMeta('syncDraft', Object.assign({}, S.meta.syncDraft, { url: url.value.trim(), anon: anon.value.trim() }));
      toast('Đang kết nối và đẩy dữ liệu lên…', '', 8000);
      const r = await guard(() => Sync.connectOwner({ url: url.value, anon: anon.value })); if (!r) return;
      if (r.error) { toast(r.error, 'error', 7000); return; }
      Sync.start(); toast(`Đã đồng bộ lần đầu: đẩy ${r.pushed} bản ghi`, 'ok'); draw();
    };
    return h('div', null,
      h('div', { class: 'hero' }, h('h2', null, 'Đồng bộ nhiều máy'), h('p', null, 'Dùng chung dữ liệu giữa điện thoại chủ, thu ngân, thủ kho… Chạy trên Supabase gói MIỄN PHÍ của chính bạn; mất mạng vẫn bán bình thường, có mạng tự đồng bộ.')),
      h('div', { class: 'mt12' }, h('div', { class: 'seg' }, [['owner', 'Tôi là chủ cửa hàng'], ['join', 'Máy thứ hai (có mã)']].map(([k, l]) => h('button', { class: mode === k ? 'on' : '', onClick: () => { mode = k; draw(); } }, l)))),
      mode === 'join' ? h('div', { class: 'card mt12' }, h('h3', null, 'Kết nối vào cửa hàng có sẵn'), h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Trên máy chủ cửa hàng vào Thêm → Đồng bộ nhiều máy → "Thêm máy", app sẽ cho một mã (và mã QR). Nhập mã đó vào đây.'), h('button', { class: 'btn primary block', onClick: () => joinDialog(() => ctx.go('pos')) }, 'Nhập mã kết nối'))
      : h('div', { class: 'mt12' },
        h('div', { class: 'card' }, h('div', { class: 'bold mb8' }, '⚡ Tự động liên kết Supabase'),
          h('div', { class: 'small mb8' }, 'App tự tạo dự án Supabase, cài hàm đồng bộ và liên kết giúp bạn — không cần chép script hay khoá. Bạn chỉ cần tài khoản Supabase miễn phí và một mã truy cập cá nhân.'),
          oauthAvailable() ? h('button', { class: 'btn primary block mb8', onClick: () => { if (!E.can('settings')) return toast('Chỉ chủ cửa hàng mới thiết lập được', 'error'); oauthDialog(draw); } }, icon('cloud', 18), ' Tạo tự động (chỉ bấm đồng ý một lần)')
            : Central.configured() ? h('a', { class: 'banner small mb8', href: '#/plan', style: { display: 'block', textDecoration: 'none', color: 'inherit' } }, 'Cách nhanh nhất: đăng nhập tài khoản lưu trữ ở ', h('b', null, 'Thêm → Gói cước & tài khoản'), ' rồi quay lại đây →') : null,
          h('button', { class: 'btn ' + (oauthAvailable() ? '' : 'primary ') + 'block', onClick: () => { if (!E.can('settings')) return toast('Chỉ chủ cửa hàng mới thiết lập được', 'error'); autoDialog(draw); } }, icon('cloud', 18), oauthAvailable() ? ' Hoặc dùng mã truy cập cá nhân' : ' Tự động tạo & liên kết (mã truy cập cá nhân)'),
          h('div', { class: 'small muted mt8' }, 'Hoặc làm thủ công theo 3 bước dưới đây.')),
        step(1,'Tạo dự án Supabase miễn phí', h('div', { class: 'small' }, 'Đăng ký bằng GitHub/Google → New project → đặt tên & mật khẩu cơ sở dữ liệu → vùng gần nhất (Singapore) → gói Free. Chờ ~2 phút cho dự án khởi tạo.'),
          h('button', { class: 'btn mt8', onClick: () => openUrl('https://supabase.com/dashboard/new') }, icon('cloud', 18), ' Mở Supabase')),
        step(2, 'Cài hàm đồng bộ (chạy script SQL một lần)', h('div', { class: 'small' }, 'Nhấn nút để sao chép script → trong Supabase mở ', h('b', null, 'SQL Editor → New query'), ', dán vào rồi bấm ', h('b', null, 'Run'), ' (phải báo Success). Script chứa khoá riêng của cửa hàng — không gửi cho ai.'),
          h('div', { class: 'row mt8' }, h('button', { class: 'btn primary', onClick: async () => { const s = Sync.sqlScript(); sqlBox.value = s; sqlBox.classList.remove('hide'); toast((await copyText(s)) ? 'Đã sao chép script SQL' : 'Không tự sao chép được — hãy chọn và sao chép trong khung bên dưới', 'ok', 3500); } }, icon('download', 18), ' Sao chép script SQL'), h('button', { class: 'btn', onClick: () => { sqlBox.value = Sync.sqlScript(); sqlBox.classList.toggle('hide'); } }, 'Xem script')), h('div', { class: 'mt8' }, sqlBox)),
        step(3, 'Nhập địa chỉ dự án', h('div', { class: 'small mb8' }, 'Trong Supabase: Project Settings → API (hoặc nút Connect) → chép ', h('b', null, 'Project URL'), ' và khoá ', h('b', null, 'anon / publishable'), ' (KHÔNG dùng khoá service_role/secret).'),
          field('Project URL', url), field('Khoá anon / publishable', anon),
          h('button', { class: 'btn primary lg block', onClick: connect }, icon('cloud', 20), ' Kết nối & đồng bộ lần đầu')),
        h('div', { class: 'small muted mt8' }, 'Gói miễn phí: 500 MB cơ sở dữ liệu (đủ cho nhiều năm bán lẻ) và tự tạm dừng sau 7 ngày không có truy cập — app đồng bộ mỗi ngày nên không bị dừng; nếu nghỉ lễ dài, vào dashboard Supabase bấm "Restore project".')));
  }

  /* ---------- Đã kết nối ---------- */
  function configured(st) {
    const devBox = h('div'), isOwner = st.role === 'owner' && canManage;
    const state = st.running ? ['Đang đồng bộ…', 'blue'] : st.error ? ['Có lỗi', 'red'] : st.pending ? [`Chờ gửi ${st.pending} thay đổi`, 'amber'] : ['Đã đồng bộ', 'green'];
    const loadDevices = async (force) => {
      if (!isOwner) return;
      if (!force && devCache && Date.now() - devCache.at < 20000) { renderDevices(devCache.r); return; }
      mount(devBox, h('div', { class: 'muted small center' }, 'Đang tải danh sách thiết bị…'));
      try {
        const r = await Sync.listDevices(); devCache = { at: Date.now(), r }; renderDevices(r);
      } catch (e) { mount(devBox, h('div', { class: 'banner red' }, e.message)); }
    };
    const renderDevices = r => {
      try {
        mount(devBox, h('div', { class: 'list' }, r.devices.map(d => h('div', { class: 'item' },
          h('div', { class: 'thumb ' + (d.role === 'owner' ? 't0' : 't3') }, icon(d.role === 'owner' ? 'store' : 'user')), h('div', { class: 'grow' }, h('div', { class: 'ttl' }, d.name, ' ', d.hash === r.me ? badge('Máy này', 'green') : null, d.revoked ? badge('Đã thu hồi', 'red') : null),
            h('div', { class: 'sub' }, `${d.role === 'owner' ? 'Chủ cửa hàng' : 'Nhân viên'} · hoạt động ${d.last_seen ? ago(new Date(d.last_seen).getTime()) : 'chưa lần nào'}`)),
          d.hash === r.me ? null : h('button', { class: 'btn sm ' + (d.revoked ? '' : 'danger'), onClick: async () => { if (!d.revoked && !(await confirmBox(`Thu hồi "${d.name}"? Máy này sẽ không đồng bộ được nữa (dữ liệu đã có trên máy vẫn giữ).`, { danger: true, okText: 'Thu hồi' }))) return; await guard(() => Sync.revokeDevice(d.hash, d.revoked)); loadDevices(true); } }, d.revoked ? 'Cấp lại' : 'Thu hồi')))));
      } catch (e) { mount(devBox, h('div', { class: 'banner red' }, e.message)); }
    };
    if (isOwner) setTimeout(loadDevices, 50);
    return h('div', null,
      h('div', { class: 'hero' }, h('h2', null, state[0]), h('p', null, `Lần đồng bộ gần nhất: ${ago(st.lastSyncAt)}`), h('div', { class: 'row mt8' }, h('button', { class: 'btn', disabled: st.running, style: { background: 'rgba(255,255,255,.95)', color: 'var(--primary)' }, onClick: async () => { const r = await Sync.syncNow(); if (r.error) toast(r.error, 'error', 6000); else toast(`Xong: nhận ${r.pulled}, gửi ${r.pushed}`, 'ok'); draw(); } }, icon('cloud', 18), st.running ? ' Đang chạy…' : ' Đồng bộ ngay'))),
      st.error ? h('div', { class: 'banner red mt12' }, st.error) : null,
      h('div', { class: 'card mt12' }, h('h3', null, 'Thông tin kết nối'), kv('Dự án Supabase', hostOf(st.url)), kv('Vai trò máy này', st.role === 'owner' ? 'Máy chủ cửa hàng' : 'Máy nhân viên'), kv('Mã máy', st.tag || '—'), kv('Chờ gửi', st.pending + ' thay đổi'),
        h('div', { class: 'small muted mt8' }, 'Mã máy được gắn vào số hoá đơn/phiếu (VD HD261014-B003) để hai máy không bao giờ trùng mã.')),
      isOwner ? h('div', { class: 'card' }, h('div', { class: 'row between mb8' }, h('h3', { style: { margin: 0 } }, 'Thiết bị đã kết nối'), h('button', { class: 'btn sm primary', onClick: () => addDevice(() => loadDevices(true)) }, icon('plus', 16), ' Thêm máy')), devBox) : null,
      canManage ? h('div', { class: 'card' }, h('h3', null, 'Quản lý'), h('div', { class: 'col' },
        isOwner ? h('button', { class: 'btn block', onClick: async () => { if (!(await confirmBox('Đẩy lại TOÀN BỘ dữ liệu của máy này lên máy chủ? Dùng khi nghi máy chủ bị thiếu dữ liệu (bản ghi mới hơn trên máy chủ vẫn được ưu tiên).', { okText: 'Đẩy lại' }))) return; const r = await guard(() => Sync.resyncAll()); if (r && r.error) toast(r.error, 'error'); else toast('Đã đẩy lại toàn bộ', 'ok'); draw(); } }, 'Đồng bộ lại toàn bộ') : null,
        h('button', { class: 'btn danger block', onClick: async () => { if (!(await confirmBox('Ngắt đồng bộ trên máy này? Dữ liệu trên máy vẫn giữ nguyên nhưng không còn chia sẻ với các máy khác.', { danger: true, okText: 'Ngắt đồng bộ' }))) return; await guard(() => Sync.disconnect()); draw(); } }, 'Ngắt đồng bộ trên máy này'))) : null);
  }

  /** Thêm máy mới: tạo khoá riêng cho thiết bị, trả về mã (kèm QR) chỉ hiện một lần. */
  function addDevice(reload) {
    const name = h('input', { class: 'input', placeholder: 'VD: Quầy thu ngân 2, Điện thoại thủ kho' }), role = select([['staff', 'Máy nhân viên (không sửa được tài khoản/cài đặt, không xoá dữ liệu)'], ['owner', 'Máy chủ cửa hàng (toàn quyền)']], 'staff');
    modal({ title: 'Thêm máy vào cửa hàng', body: h('div', null, field('Tên máy', name), field('Quyền của máy', role), h('div', { class: 'small muted' }, 'Quyền người dùng trong app (thu ngân, thủ kho…) vẫn do tài khoản đăng nhập quyết định; "quyền của máy" là lớp bảo vệ ở máy chủ.')),
      actions: [{ label: 'Huỷ' }, { label: 'Tạo mã kết nối', kind: 'primary', onClick: async close => {
        if (!name.value.trim()) { toast('Đặt tên cho máy', 'error'); return false; }
        const code = await guard(() => Sync.createJoinCode({ name: name.value.trim(), role: role.value })); if (!code) return false;
        close(); setTimeout(() => showCode(code, name.value.trim(), reload), 80); return false;
      } }] });
  }
  function showCode(code, name, reload) {
    let svg = ''; try { svg = QR.svg(code, { label: 'Mã kết nối' }); } catch (e) { svg = ''; }
    modal({ title: 'Mã kết nối cho "' + name + '"', size: 'wide', body: h('div', null,
      svg ? h('div', { class: 'qr-box', html: svg }) : h('div', { class: 'banner' }, 'Mã quá dài để vẽ QR — hãy dùng mã chữ bên dưới.'),
      h('div', { class: 'small center muted mb8' }, 'Trên máy mới: mở app → "Máy thứ hai (có mã)" → quét QR hoặc dán mã.'),
      h('textarea', { class: 'textarea', readOnly: true, value: code, style: { minHeight: '90px', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px' } }),
      h('div', { class: 'banner red mt8' }, 'Mã chỉ hiện MỘT lần và cho quyền truy cập dữ liệu cửa hàng. Chỉ đưa cho người tin cậy; mất mã thì thu hồi máy rồi tạo mã mới.')),
      onClose: reload, actions: [{ label: 'Sao chép', onClick: async () => { toast((await copyText(code)) ? 'Đã sao chép mã' : 'Hãy chọn và sao chép mã trong khung', 'ok'); return false; } }, { label: 'Chia sẻ', onClick: () => { shareText(code, 'Mã kết nối cửa hàng'); return false; } }, { label: 'Xong', kind: 'primary' }] });
  }

  mount(root, box); draw();
  const t = setInterval(() => { if (document.contains(box)) draw(); }, 20000);   // làm mới "x phút trước"
  return () => { unsub(); clearInterval(t); };
}
