/* Khách hàng & nhà cung cấp: danh bạ, công nợ, thu/trả nợ, lịch sử. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, modal, toast, guard, confirmBox, promptBox, field, select, badge, kv, empty, moneyInput, debounce, tabs } from '../ui.js';
import { fmtMoney, fmtNum, fmtDate, fmtDateTime, DAY, norm } from '../util.js';
import { shareText, saveFile } from '../native.js';
import { dueBadge } from './common.js';

export const viewCustomers = (root, ctx) => peopleView(root, ctx, 'customer');
export const viewSuppliers = (root, ctx) => peopleView(root, ctx, 'supplier');

function peopleView(root, ctx, kind) {
  const isC = kind === 'customer', coll = isC ? 'customers' : 'suppliers', permKey = isC ? 'manageCustomers' : 'manageSuppliers', canEdit = E.can(permKey);
  const noun = isC ? 'khách hàng' : 'nhà cung cấp';
  let q = '', onlyDebt = false;
  const listBox = h('div'), sumBox = h('div');

  function draw() {
    let list = S.list(coll).filter(x => x.active !== false);
    const t = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (t.length) list = list.filter(x => { const hay = (x.nameNorm || norm(x.name)) + ' ' + (x.phone || ''); return t.every(w => hay.includes(norm(w))); });
    if (onlyDebt) list = list.filter(x => x.debt > 0);
    list.sort((a, b) => (b.debt - a.debt) || a.name.localeCompare(b.name, 'vi'));
    const totalDebt = S.list(coll).reduce((a, x) => a + Math.max(0, x.debt || 0), 0);
    mount(sumBox, h('div', { class: 'grid g2 mb8' }, h('div', { class: 'stat' }, h('div', { class: 'k' }, isC ? 'Khách đang nợ' : 'Đang nợ nhà cung cấp'), h('div', { class: 'v neg-c' }, fmtMoney(totalDebt)), h('div', { class: 's' }, `${S.list(coll).filter(x => x.debt > 0).length} ${noun}`)),
      h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Tổng số'), h('div', { class: 'v' }, S.list(coll).filter(x => x.active !== false).length), h('div', { class: 's' }, noun))));
    mount(listBox, list.length ? h('div', { class: 'list' }, list.slice(0, 300).map(x => h('div', { class: 'item click', onClick: () => detail(x.id) },
      h('div', { class: 'thumb' }, x.name.slice(0, 1).toUpperCase()), h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.name), h('div', { class: 'sub' }, [x.phone, isC ? E.CUSTOMER_GROUPS[x.group] : x.contact].filter(Boolean).join(' · ') || '—')),
      x.debt > 0 ? h('div', { class: 'right' }, h('div', { class: 'bold neg-c' }, fmtMoney(x.debt)), dueBadge(E.oldestDebtAge(kind, x.id))) : x.debt < 0 ? badge('Dư ' + fmtNum(-x.debt), 'green') : null))) : empty(q || onlyDebt ? 'Không tìm thấy' : `Chưa có ${noun} nào`, canEdit ? 'Bấm + để thêm' : ''));
  }

  function form(x) {
    const f = { name: h('input', { class: 'input', value: x ? x.name : '' }), phone: h('input', { class: 'input', value: x ? x.phone : '', inputMode: 'tel' }), address: h('input', { class: 'input', value: x ? x.address : '' }), note: h('textarea', { class: 'textarea', value: x ? x.note : '' }),
      group: select(Object.entries(E.CUSTOMER_GROUPS), x ? x.group : 'retail'), limit: moneyInput(x ? x.debtLimit : 0), contact: h('input', { class: 'input', value: x ? x.contact : '' }), term: h('input', { class: 'input', inputMode: 'numeric', value: x ? x.payTermDays || '' : '' }) };
    modal({ title: (x ? 'Sửa ' : 'Thêm ') + noun, body: h('div', null, field('Tên *', f.name), field('Điện thoại', f.phone), isC ? null : field('Người liên hệ', f.contact), field('Địa chỉ', f.address),
      isC ? h('div', { class: 'grid g2' }, field('Nhóm khách', f.group, 'Khách sỉ tự được giá sỉ'), field('Hạn mức nợ (đ)', f.limit, '0 = không giới hạn')) : field('Số ngày công nợ', f.term), field('Ghi chú', f.note)),
      actions: [{ label: 'Huỷ' }, { label: 'Lưu', kind: 'primary', onClick: async () => {
        const d = { id: x && x.id, name: f.name.value, phone: f.phone.value, address: f.address.value, note: f.note.value };
        if (isC) Object.assign(d, { group: f.group.value, debtLimit: f.limit.num }); else Object.assign(d, { contact: f.contact.value, payTermDays: Number(f.term.value) || 0 });
        const r = await guard(() => isC ? E.saveCustomer(d) : E.saveSupplier(d)); if (!r) return false; toast('Đã lưu', 'ok'); draw();
      } }] });
    setTimeout(() => f.name.focus(), 80);
  }

  function payDialog(x, redraw) {
    const amt = moneyInput(x.debt), method = select([['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản']], 'cash'), note = h('input', { class: 'input', placeholder: 'Ghi chú (tuỳ chọn)' });
    modal({ title: isC ? 'Thu nợ – ' + x.name : 'Trả nợ – ' + x.name, body: h('div', null, h('div', { class: 'muted small mb8' }, `Đang nợ: ${fmtMoney(x.debt)}`), field('Số tiền', amt), h('div', { class: 'row mb8' }, h('button', { class: 'btn sm', onClick: () => { amt.num = x.debt; } }, 'Toàn bộ'), h('button', { class: 'btn sm', onClick: () => { amt.num = Math.floor(x.debt / 2); } }, 'Một nửa')), field('Hình thức', method), field('Ghi chú', note)),
      actions: [{ label: 'Huỷ' }, { label: isC ? 'Xác nhận thu' : 'Xác nhận trả', kind: 'primary', onClick: async () => {
        const r = await guard(() => isC ? E.payCustomerDebt({ customerId: x.id, amount: amt.num, method: method.value, note: note.value }) : E.paySupplierDebt({ supplierId: x.id, amount: amt.num, method: method.value, note: note.value }));
        if (!r) return false; toast('Đã ghi nhận', 'ok'); draw(); redraw();
      } }] });
  }

  function statementText(x) {
    const st = E.settings().store, det = E.debtDetail(kind, x.id);
    return [`${st.name} – ${isC ? 'ĐỐI CHIẾU CÔNG NỢ' : 'CÔNG NỢ NHÀ CUNG CẤP'}`, `${isC ? 'Khách' : 'NCC'}: ${x.name}${x.phone ? ' (' + x.phone + ')' : ''}`, `Ngày: ${fmtDate(Date.now())}`, '',
      ...det.map(d => `- ${fmtDate(d.ts)} ${d.note || ''}: ${fmtNum(d.outstanding)}đ`), '', `TỔNG ${isC ? 'CÒN NỢ' : 'CẦN TRẢ'}: ${fmtNum(x.debt)}đ`, st.phone ? `Liên hệ: ${st.phone}` : ''].join('\n');
  }

  function detail(id) {
    let x = S.get(coll, id), sub = 'debt';
    const box = h('div'), subBox = h('div');
    const draw2 = () => {
      x = S.get(coll, id); if (!x) return;
      mount(box, h('div', { class: 'row' }, h('div', { class: 'thumb', style: { width: '56px', height: '56px' } }, x.name.slice(0, 1).toUpperCase()), h('div', { class: 'grow' }, h('div', { class: 'bold', style: { fontSize: '17px' } }, x.name), h('div', { class: 'small muted' }, [x.phone, x.address].filter(Boolean).join(' · ') || '—')),
        x.phone ? h('a', { class: 'iconbtn', href: 'tel:' + x.phone, title: 'Gọi' }, icon('phone')) : null),
        h('div', { class: 'grid g2 mt12' }, h('div', { class: 'stat' }, h('div', { class: 'k' }, x.debt < 0 ? 'Dư có' : (isC ? 'Đang nợ' : 'Mình đang nợ')), h('div', { class: 'v ' + (x.debt > 0 ? 'neg-c' : '') }, fmtMoney(Math.abs(x.debt))), isC && x.debtLimit ? h('div', { class: 's' }, 'Hạn mức ' + fmtMoney(x.debtLimit)) : null),
          isC ? h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Tổng đã mua'), h('div', { class: 'v' }, fmtMoney(x.totalSpent || 0)), E.settings().sale.pointsPer ? h('div', { class: 's' }, `★ ${x.points || 0} điểm`) : (x.lastBuyAt ? h('div', { class: 's' }, 'Lần cuối ' + fmtDate(x.lastBuyAt)) : null))
            : h('div', { class: 'stat' }, h('div', { class: 'k' }, 'Tổng đã nhập'), h('div', { class: 'v' }, fmtMoney(S.list('purchases').filter(p => p.supplierId === id).reduce((a, p) => a + p.total, 0))))),
        x.note ? h('div', { class: 'small muted mt8' }, x.note) : null,
        h('div', { class: 'row wrap mt12' }, x.debt > 0 && canEdit ? h('button', { class: 'btn primary grow', onClick: () => payDialog(x, draw2) }, isC ? 'Thu nợ' : 'Trả nợ') : null,
          x.debt > 0 ? h('button', { class: 'btn grow', onClick: () => shareText(statementText(x), 'Công nợ') }, icon('share', 16), isC ? ' Gửi nhắc nợ' : ' Chia sẻ') : null),
        h('div', { class: 'mt12' }, tabs([['debt', 'Công nợ'], ['hist', isC ? 'Lịch sử mua' : 'Phiếu nhập'], ['ledger', 'Sổ giao dịch']], sub, k => { sub = k; draw2(); })), subBox);
      const det = E.debtDetail(kind, id);
      if (sub === 'debt') mount(subBox, det.length ? h('div', { class: 'list' }, det.map(d => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, d.note || (d.type === 'sale' ? 'Mua nợ' : 'Nhập chịu')), h('div', { class: 'sub' }, fmtDate(d.ts) + ' · ' + Math.floor((Date.now() - d.ts) / DAY) + ' ngày')), h('div', { class: 'right' }, h('div', { class: 'bold neg-c' }, fmtMoney(d.outstanding)), d.outstanding !== d.amount ? h('div', { class: 'tiny muted' }, 'gốc ' + fmtNum(d.amount)) : null)))) : empty('Không còn khoản nợ nào'));
      else if (sub === 'hist') {
        const rows = isC ? E.listSales({ customerId: id, limit: 50 }) : S.list('purchases').filter(p => p.supplierId === id).sort((a, b) => b.ts - a.ts).slice(0, 50);
        mount(subBox, rows.length ? h('div', { class: 'list' }, rows.map(s => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, s.code, ' ', s.status === 'void' ? badge('Đã huỷ', 'red') : null), h('div', { class: 'sub' }, fmtDateTime(s.ts) + ' · ' + s.items.length + ' mặt hàng')), h('div', { class: 'bold' }, fmtMoney(s.total))))) : empty('Chưa có giao dịch'));
      } else {
        const led = E.ledgerOf(kind, id).slice().reverse().slice(0, 80), T = { sale: 'Mua nợ', payment: isC ? 'Thu nợ' : 'Trả nợ', return: 'Trả hàng', void: 'Huỷ hoá đơn', purchase: 'Nhập chịu', adjust: 'Điều chỉnh' };
        mount(subBox, led.length ? h('div', { class: 'list' }, led.map(l => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, T[l.type] || l.type, l.void ? ' (đã huỷ)' : ''), h('div', { class: 'sub' }, fmtDateTime(l.ts) + (l.note ? ' · ' + l.note : '') + (l.method ? ' · ' + (l.method === 'cash' ? 'tiền mặt' : 'chuyển khoản') : ''))),
          h('div', { class: 'right' }, h('div', { class: 'bold ' + (l.amount > 0 ? 'neg-c' : 'pos-c') }, (l.amount > 0 ? '+' : '') + fmtNum(l.amount)), h('div', { class: 'tiny muted' }, 'dư nợ ' + fmtNum(l.balance)))))) : empty('Chưa có giao dịch'));
      }
    };
    const acts = [];
    if (canEdit) { acts.push({ label: 'Sửa', onClick: close => { close(); form(x); return false; } });
      if (E.can('deleteData') || x.debt === 0) acts.push({ label: 'Xoá', kind: 'danger', onClick: async close => { if (!(await confirmBox(`Xoá ${noun} "${x.name}"?`, { danger: true, okText: 'Xoá' }))) return false; const r = await guard(() => (isC ? E.deleteCustomer(id) : E.deleteSupplier(id), true)); if (!r) return false; close(); draw(); } }); }
    modal({ title: isC ? 'Khách hàng' : 'Nhà cung cấp', size: 'wide', body: box, actions: acts }); draw2();
  }

  ctx.setActions(...(isC ? [] : []));
  mount(root, sumBox, h('div', { class: 'row mb8' }, h('input', { class: 'input grow', placeholder: `Tìm ${noun}…`, onInput: debounce(e => { q = e.target.value.trim(); draw(); }, 150) }), h('span', { class: 'chip', id: 'dbt', onClick: e => { onlyDebt = !onlyDebt; e.currentTarget.classList.toggle('on', onlyDebt); draw(); } }, 'Đang nợ')),
    listBox, canEdit ? h('button', { class: 'fab', onClick: () => form(null) }, icon('plus')) : null);
  draw();
}
