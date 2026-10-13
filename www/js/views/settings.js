/* Cài đặt cửa hàng, sao lưu/khôi phục, nhân viên & quyền, nhật ký. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, modal, toast, guard, confirmBox, promptBox, field, select, checkbox, badge, kv, empty, moneyInput, qtyInput, alertBox } from '../ui.js';
import { fmtMoney, fmtNum, fmtDateTime, parseQty, ymd } from '../util.js';
import { saveFile, pickFile, readFileText, isNative } from '../native.js';
import { getTheme, setTheme } from '../theme.js';
import { QR } from '../lib/qr.js';
import { VietQR } from '../lib/vietqr.js';

const BANKS = [['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'], ['970405', 'Agribank'], ['970407', 'Techcombank'], ['970422', 'MB Bank'], ['970416', 'ACB'], ['970432', 'VPBank'], ['970423', 'TPBank'],
  ['970403', 'Sacombank'], ['970437', 'HDBank'], ['970441', 'VIB'], ['970443', 'SHB'], ['970448', 'OCB'], ['970426', 'MSB'], ['970440', 'SeABank'], ['970431', 'Eximbank'], ['970449', 'LPBank'], ['970454', 'VietCapital'], ['970429', 'SCB'], ['963388', 'Timo'], ['546034', 'Cake'], ['546035', 'Ubank']];

export function viewSettings(root, ctx) {
  const st = E.settings();
  const owner = E.currentUser().role === 'owner';
  const save = async patch => { const r = await guard(() => E.saveSettings(patch)); if (r) toast('Đã lưu cài đặt', 'ok'); return r; };

  /* ---- Cửa hàng ---- */
  const s = { name: h('input', { class: 'input', value: st.store.name }), addr: h('input', { class: 'input', value: st.store.address }), phone: h('input', { class: 'input', value: st.store.phone, inputMode: 'tel' }), foot: h('input', { class: 'input', value: st.store.footer }) };
  const storeCard = h('div', { class: 'card' }, h('h3', null, 'Thông tin cửa hàng (in trên hoá đơn)'), field('Tên cửa hàng', s.name), field('Địa chỉ', s.addr), field('Điện thoại', s.phone), field('Lời chào cuối hoá đơn', s.foot),
    h('button', { class: 'btn primary', onClick: () => save({ store: { name: s.name.value.trim() || 'Tạp hóa', address: s.addr.value.trim(), phone: s.phone.value.trim(), footer: s.foot.value.trim() } }) }, 'Lưu'));

  /* ---- Bán hàng ---- */
  const sale = st.sale;
  const c = { neg: checkbox('Cho phép bán khi kho không đủ (tồn âm)', sale.allowNegative), shift: checkbox('Bắt buộc mở ca trước khi bán', sale.requireShift), below: checkbox('Chặn bán dưới giá vốn', sale.blockBelowCost), beep: checkbox('Phát tiếng bíp khi quét', sale.beep),
    round: select([[0, 'Không làm tròn'], [500, 'Tròn 500đ'], [1000, 'Tròn 1.000đ']], sale.rounding), cost: select([['avg', 'Bình quân gia quyền'], ['last', 'Giá nhập gần nhất']], sale.costMethod), stack: select([['best', 'Lấy khuyến mãi lợi nhất cho khách'], ['stack', 'Cộng dồn các khuyến mãi']], sale.promoStack),
    over: select([['block', 'Chặn bán'], ['warn', 'Cảnh báo, cho phép tiếp tục']], sale.debtOverLimit), pts: moneyInput(sale.pointsPer), ptv: moneyInput(sale.pointValue), wb: checkbox('Nhận mã vạch cân (EAN-13 bắt đầu bằng 2)', sale.weightBarcode.enabled), wmode: select([['weight', 'Giá trị = khối lượng (gram)'], ['price', 'Giá trị = số tiền (đ)']], sale.weightBarcode.mode) };
  const saleCard = h('div', { class: 'card' }, h('h3', null, 'Bán hàng'), c.neg, c.shift, c.below, c.beep, field('Làm tròn tổng hoá đơn', c.round), field('Cách tính giá vốn khi nhập hàng', c.cost), field('Khi nhiều khuyến mãi trùng nhau', c.stack), field('Khi khách vượt hạn mức nợ', c.over),
    h('div', { class: 'grid g2' }, field('Tích điểm: bao nhiêu đồng = 1 điểm', c.pts, '0 = tắt tích điểm'), field('1 điểm đổi được (đ)', c.ptv)), c.wb, field('Mã vạch cân', c.wmode),
    h('button', { class: 'btn primary', onClick: () => save({ sale: { allowNegative: c.neg.input.checked, requireShift: c.shift.input.checked, blockBelowCost: c.below.input.checked, beep: c.beep.input.checked, rounding: Number(c.round.value), costMethod: c.cost.value, promoStack: c.stack.value, debtOverLimit: c.over.value,
      pointsPer: c.pts.num, pointValue: c.ptv.num || 1000, weightBarcode: { enabled: c.wb.input.checked, mode: c.wmode.value } } }) }, 'Lưu'));

  /* ---- Thanh toán / VietQR ---- */
  const bank = st.bank;
  const known = BANKS.some(([b]) => b === bank.bin);
  const b = { bank: select([['', '— Chọn ngân hàng —'], ...BANKS, ['other', 'Ngân hàng khác (nhập mã BIN)']], known ? bank.bin : (bank.bin ? 'other' : '')), bin: h('input', { class: 'input', value: known ? '' : bank.bin, inputMode: 'numeric', placeholder: 'Mã BIN 6 số' }), acc: h('input', { class: 'input', value: bank.account, inputMode: 'numeric', placeholder: 'Số tài khoản' }), name: h('input', { class: 'input', value: bank.name, placeholder: 'Tên chủ tài khoản (hiện cho khách)' }) };
  const qrPrev = h('div');
  const payCard = h('div', { class: 'card' }, h('h3', null, 'Tài khoản nhận tiền (VietQR)'), field('Ngân hàng', b.bank), h('div', { id: 'binf' }, field('Mã BIN ngân hàng', b.bin, 'Tra mã BIN trên vietqr.io. Kiểm tra bằng cách quét thử mã QR bên dưới.')), field('Số tài khoản', b.acc), field('Tên chủ tài khoản', b.name),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: async () => { const bin = b.bank.value === 'other' ? b.bin.value.trim() : b.bank.value; const r = await save({ bank: { bin, account: b.acc.value.trim(), name: b.name.value.trim() } }); if (r) preview(); } }, 'Lưu'), h('button', { class: 'btn', onClick: preview }, 'Xem thử mã QR')), qrPrev);
  const toggleBin = () => { document.getElementById('binf') && (document.getElementById('binf').style.display = b.bank.value === 'other' ? '' : 'none'); }; b.bank.addEventListener('change', toggleBin);
  function preview() {
    const bin = b.bank.value === 'other' ? b.bin.value.trim() : b.bank.value;
    try { const svg = QR.svg(VietQR.payload({ bin, account: b.acc.value, amount: 10000, info: 'Thu nghiem' })); mount(qrPrev, h('div', { class: 'qr-box', style: { width: '200px' }, html: svg }), h('div', { class: 'small muted center' }, 'Mã thử 10.000đ – quét bằng app ngân hàng để kiểm tra đúng tài khoản. Không cần chuyển tiền.')); }
    catch (e) { mount(qrPrev, h('div', { class: 'banner red mt8' }, e.message)); }
  }

  /* ---- In ấn ---- */
  const pr = st.print, p = { paper: select([[58, 'Giấy 58mm'], [80, 'Giấy 80mm']], pr.paper), auto: checkbox('Tự in hoá đơn sau khi thanh toán', pr.autoPrint), addr: h('input', { class: 'input', value: pr.printerAddress || '', placeholder: 'Địa chỉ Bluetooth máy in (vd. 00:11:22:33:44:55)' }) };
  const printCard = h('div', { class: 'card' }, h('h3', null, 'In hoá đơn'), field('Khổ giấy', p.paper), p.auto, field('Máy in Bluetooth (chỉ bản Android)', p.addr, isNative() ? 'Để trống sẽ dùng hộp thoại in của hệ thống.' : 'Chỉ dùng được khi cài app trên điện thoại Android. Trên trình duyệt sẽ mở hộp thoại in.'),
    h('button', { class: 'btn primary', onClick: () => save({ print: { paper: Number(p.paper.value), autoPrint: p.auto.input.checked, printerAddress: p.addr.value.trim() } }) }, 'Lưu'));

  /* ---- Kho ---- */
  const k = { exp: qtyInput(st.stock.expiryWarnDays), dead: qtyInput(st.stock.deadStockDays), cover: qtyInput(st.stock.reorderCoverDays) };
  const stockCard = h('div', { class: 'card' }, h('h3', null, 'Kho'), field('Cảnh báo hàng sắp hết hạn trước (ngày)', k.exp), field('Coi là tồn lâu nếu không bán trong (ngày)', k.dead), field('Gợi ý nhập đủ bán trong (ngày)', k.cover),
    h('button', { class: 'btn primary', onClick: () => save({ stock: { expiryWarnDays: k.exp.num || 30, deadStockDays: k.dead.num || 60, reorderCoverDays: k.cover.num || 7 } }) }, 'Lưu'));

  /* ---- Giao diện ---- */
  const themeCard = h('div', { class: 'card' }, h('h3', null, 'Giao diện'), select([['auto', 'Theo hệ thống'], ['light', 'Sáng'], ['dark', 'Tối']], getTheme(), { onChange: e => setTheme(e.target.value) }));

  /* ---- Sao lưu ---- */
  const last = S.getMeta('lastBackup', 0);
  const backupCard = h('div', { class: 'card' }, h('h3', null, 'Sao lưu & khôi phục'), h('div', { class: 'small ' + (last && Date.now() - last < 7 * 864e5 ? 'muted' : 'warn-c'), style: { marginBottom: '8px' } }, last ? 'Sao lưu gần nhất: ' + fmtDateTime(last) : 'Chưa sao lưu lần nào – dữ liệu chỉ nằm trên thiết bị này!'),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary grow', onClick: backup }, icon('download', 18), ' Sao lưu ra tệp'), h('button', { class: 'btn grow', onClick: restore }, icon('upload', 18), ' Khôi phục từ tệp')),
    h('div', { class: 'small muted mt8' }, `Dung lượng dữ liệu: ${fmtNum(S.count('products'))} hàng · ${fmtNum(S.count('sales'))} hoá đơn · ${fmtNum(S.count('customers'))} khách. Hãy gửi tệp sao lưu lên Zalo/Google Drive để an toàn khi mất máy.`));
  async function backup() {
    await S.flush();
    const dump = S.dump(); const ok = await saveFile(`tap-hoa-sao-luu-${ymd(Date.now())}.json`, JSON.stringify(dump), 'application/json');
    if (ok !== false) { S.setMeta('lastBackup', Date.now()); await S.flush(); toast('Đã sao lưu', 'ok'); }
  }
  async function restore() {
    const f = await pickFile('.json,application/json'); if (!f) return;
    let dump; try { dump = JSON.parse(await readFileText(f)); } catch (e) { return toast('Tệp không đọc được', 'error'); }
    if (!dump || dump.app !== 'taphoa') return toast('Đây không phải tệp sao lưu của ứng dụng', 'error');
    const info = `${(dump.collections.products || []).length} hàng, ${(dump.collections.sales || []).length} hoá đơn, sao lưu lúc ${fmtDateTime(dump.exportedAt)}`;
    if (!(await confirmBox(`Khôi phục sẽ GHI ĐÈ toàn bộ dữ liệu hiện tại bằng bản sao lưu:\n${info}\n\nBạn nên sao lưu dữ liệu hiện tại trước. Tiếp tục?`, { danger: true, okText: 'Khôi phục' }))) return;
    const r = await guard(async () => { await S.restore(dump); return true; });
    if (r) { await alertBox('Đã khôi phục dữ liệu. Ứng dụng sẽ tải lại; hãy đăng nhập lại bằng tài khoản có trong bản sao lưu.'); S.session.staffId = null; location.reload(); }
  }

  /* ---- Dữ liệu / tài khoản ---- */
  const pwCard = h('div', { class: 'card' }, h('h3', null, 'Tài khoản của tôi'), h('button', { class: 'btn', onClick: changePw }, 'Đổi mật khẩu'));
  function changePw() {
    const o = h('input', { class: 'input', type: 'password' }), n = h('input', { class: 'input', type: 'password' }), n2 = h('input', { class: 'input', type: 'password' });
    modal({ title: 'Đổi mật khẩu', body: h('div', null, field('Mật khẩu hiện tại', o), field('Mật khẩu mới', n), field('Nhập lại mật khẩu mới', n2)), actions: [{ label: 'Huỷ' }, { label: 'Đổi', kind: 'primary', onClick: async () => {
      if (n.value !== n2.value) { toast('Hai mật khẩu mới không khớp', 'error'); return false; } const r = await guard(async () => (await E.changeOwnPassword(o.value, n.value), true)); if (!r) return false; toast('Đã đổi mật khẩu', 'ok'); } }] });
  }
  const dataCard = owner ? h('div', { class: 'card' }, h('h3', null, 'Dữ liệu'), h('div', { class: 'col' },
    h('button', { class: 'btn', disabled: E.demoLoaded(), onClick: async () => { if (!(await confirmBox('Nạp ~45 mặt hàng, khách hàng, nhà cung cấp và 30 ngày bán hàng mẫu để dùng thử?\nDữ liệu mẫu sẽ lẫn với dữ liệu thật – chỉ nên dùng khi mới bắt đầu.', { okText: 'Nạp dữ liệu mẫu' }))) return; toast('Đang nạp…'); await new Promise(r => setTimeout(r, 40)); const r = await guard(async () => (E.loadDemo({}), true)); if (r) { toast('Đã nạp dữ liệu mẫu', 'ok'); ctx.go('pos'); } } }, E.demoLoaded() ? 'Đã nạp dữ liệu mẫu' : 'Nạp dữ liệu mẫu để dùng thử'),
    h('button', { class: 'btn danger', onClick: wipe }, 'Xoá toàn bộ dữ liệu & làm lại từ đầu'))) : null;
  async function wipe() {
    if (!(await confirmBox('XOÁ TOÀN BỘ hàng hóa, hoá đơn, khách hàng, nhân viên…? Không thể hoàn tác!\nHãy sao lưu trước.', { danger: true, okText: 'Tiếp tục' }))) return;
    const t = await promptBox({ title: 'Xác nhận xoá', label: 'Gõ chữ XOA để xác nhận xoá toàn bộ dữ liệu' }); if (!t || t.trim().toUpperCase() !== 'XOA') return toast('Đã huỷ', '');
    await S.wipe(); S.session.staffId = null; try { localStorage.clear(); } catch (e) {} location.hash = ''; location.reload();
  }

  const cards = owner ? [storeCard, saleCard, payCard, printCard, stockCard, themeCard, backupCard, pwCard, dataCard] : [themeCard, pwCard];
  mount(root, ...cards.filter(Boolean));
  toggleBin();
}

/* ======================= Nhân viên & quyền ======================= */
export function viewStaff(root, ctx) {
  const box = h('div');
  const draw = () => mount(box, h('div', { class: 'list' }, S.list('staff').sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name, 'vi')).map(s => h('div', { class: 'item click', onClick: () => form(s) },
    h('div', { class: 'thumb' }, s.name.slice(0, 1).toUpperCase()), h('div', { class: 'grow' }, h('div', { class: 'ttl' }, s.name, ' ', !s.active ? badge('Đã khoá', 'red') : null, s.pin ? badge('PIN') : null), h('div', { class: 'sub' }, `@${s.username} · ${E.ROLE_NAMES[s.role] || 'Tuỳ chỉnh'}`)), icon('chevron', 18)))));
  function form(s) {
    const f = { name: h('input', { class: 'input', value: s ? s.name : '' }), user: h('input', { class: 'input', value: s ? s.username : '', autocapitalize: 'none', disabled: !!s && s.role === 'owner' && false }), pw: h('input', { class: 'input', type: 'password', placeholder: s ? 'Để trống nếu không đổi' : 'Tối thiểu 4 ký tự', autocomplete: 'new-password' }),
      pin: h('input', { class: 'input', inputMode: 'numeric', maxLength: 6, placeholder: s && s.pin ? 'Để trống nếu không đổi' : '4–6 chữ số (tuỳ chọn)' }), role: select(Object.entries(E.ROLE_NAMES), s ? s.role : 'cashier'), active: checkbox('Cho phép đăng nhập', s ? s.active : true) };
    const perms = Object.assign({}, s ? (s.perms || {}) : E.ROLE_PERMS.cashier), permBox = h('div');
    const drawPerms = () => {
      const role = f.role.value;
      if (role === 'owner') return mount(permBox, h('div', { class: 'banner green' }, 'Chủ cửa hàng có toàn quyền.'));
      const preset = E.ROLE_PERMS[role];
      mount(permBox, h('div', { class: 'small muted mb8' }, 'Quyền chi tiết'), Object.entries(E.PERMS).filter(([k]) => k !== 'discountMax').map(([k, label]) => checkbox(label, preset && role !== 'custom' ? !!preset[k] : !!perms[k], v => { perms[k] = v; f.role.value = 'custom'; })),
        field('Giảm giá tối đa mỗi đơn (%)', qtyIn(role !== 'custom' && preset ? preset.discountMax || 0 : perms.discountMax || 0, v => { perms.discountMax = v; })));
    };
    const qtyIn = (v, on) => { const i = qtyInput(v); i.addEventListener('input', () => on(parseQty(i.value))); return i; };
    f.role.addEventListener('change', () => { if (E.ROLE_PERMS[f.role.value]) Object.assign(perms, E.ROLE_PERMS[f.role.value]); drawPerms(); });
    modal({ title: s ? 'Sửa nhân viên' : 'Thêm nhân viên', size: 'wide', body: h('div', null, field('Họ tên', f.name), field('Tên đăng nhập', f.user), field('Mật khẩu', f.pw), field('Mã PIN đăng nhập nhanh', f.pin), field('Vai trò', f.role), permBox, f.active),
      actions: [{ label: 'Huỷ' }, { label: 'Lưu', kind: 'primary', onClick: async () => {
        const role = f.role.value; const finalPerms = role === 'custom' ? perms : (E.ROLE_PERMS[role] || perms);
        const r = await guard(() => E.saveStaff({ id: s && s.id, name: f.name.value, username: f.user.value, password: f.pw.value, pin: f.pin.value, role, perms: finalPerms, active: f.active.input.checked })); if (!r) return false; toast('Đã lưu', 'ok'); draw();
      } }] });
    drawPerms();
  }
  mount(root, h('div', { class: 'banner blue mb8' }, 'Mỗi nhân viên có tài khoản riêng. Thu ngân thường chỉ cần quyền Bán hàng; Thủ kho có quyền Nhập hàng/Kiểm kho nhưng không bán.'), box, h('button', { class: 'fab', onClick: () => form(null) }, icon('plus')));
  draw();
}

/* ======================= Nhật ký ======================= */
export function viewLogs(root) {
  let action = '';
  const box = h('div');
  const actions = [...new Set(S.list('logs').map(l => l.action))].sort();
  const draw = () => { const ls = E.listLogs({ limit: 300, action: action || undefined });
    mount(box, ls.length ? h('div', { class: 'list' }, ls.map(l => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'small' }, l.detail || l.action), h('div', { class: 'tiny muted' }, `${fmtDateTime(l.ts)} · ${l.who}`)), badge(l.action)))) : empty('Chưa có nhật ký')); };
  mount(root, h('div', { class: 'chips' }, h('span', { class: 'chip ' + (!action ? 'on' : ''), onClick: e => { action = ''; refreshChips(); } }, 'Tất cả'), ...actions.map(a => h('span', { class: 'chip', 'data-a': a, onClick: () => { action = a; refreshChips(); } }, a))), box);
  function refreshChips() { root.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', (c.dataset.a || '') === action)); draw(); }
  draw();
}
