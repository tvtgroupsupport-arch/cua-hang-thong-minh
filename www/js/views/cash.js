/* Ca làm việc, sổ quỹ (tiền mặt & ngân hàng), thu chi khác. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, modal, toast, guard, confirmBox, promptBox, field, select, badge, kv, empty, moneyInput, tabs, stat } from '../ui.js';
import { fmtMoney, fmtNum, fmtDateTime, fmtDate } from '../util.js';
import { shareText } from '../native.js';
import { shiftText } from '../receipt.js';
import { periodBar, exportTable } from './common.js';

let tab = 'shift';
const period = { key: 'month' };

export function viewCash(root, ctx) {
  const body = h('div'), tb = h('div');
  const draw = () => { mount(tb, tabs([['shift', 'Ca làm việc'], ['book', 'Sổ quỹ'], ['entries', 'Thu chi']], tab, k => { tab = k; draw(); })); ({ shift: shiftTab, book: bookTab, entries: entriesTab })[tab](body, draw); };
  mount(root, tb, body); draw();
}

function shiftTab(box, redraw) {
  const cur = E.currentShift(), me = E.currentUser();
  let panel;
  if (cur) {
    const r = E.shiftReport(cur);
    panel = h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, 'Ca đang mở'), badge('Đang mở', 'green')), h('div', { class: 'small muted mb8' }, `${cur.staffName} · từ ${fmtDateTime(cur.openAt)}`),
      h('div', { class: 'grid g2' }, stat('Hoá đơn', r.bills, fmtMoney(r.revenue)), stat('Tiền mặt phải có', fmtMoney(r.expectedCash), `Đầu ca ${fmtMoney(cur.openingCash)}`)),
      h('div', { class: 'mt12' }, kv('Bán hàng thu tiền mặt', fmtMoney(r.saleCash)), kv('Chuyển khoản (không vào két)', fmtMoney(r.saleBank)), kv('Ghi nợ', fmtMoney(r.debtSold)), kv('Thu nợ tiền mặt', fmtMoney(r.debtCollectedCash)),
        kv('Hoàn trả khách', '-' + fmtMoney(r.refundsCash)), kv('Thu khác / chi khác', `+${fmtNum(r.entriesIn)} / -${fmtNum(r.entriesOut + r.otherCashOut)}`)),
      h('button', { class: 'btn primary block lg mt12', onClick: () => closeDialog(cur, redraw) }, 'Chốt ca'));
  } else {
    panel = h('div', { class: 'card' }, h('div', { class: 'center' }, icon('clock', 40), h('div', { class: 'bold mt8' }, 'Chưa mở ca làm việc'), h('div', { class: 'small muted mb8' }, 'Mở ca để theo dõi tiền két và đối chiếu cuối ngày.')),
      h('button', { class: 'btn primary block lg', onClick: async () => { const v = await promptBox({ title: 'Mở ca', label: 'Tiền mặt có sẵn trong két đầu ca (đ)', type: 'money', value: '0' }); if (v === null) return; const r = await guard(() => E.openShift({ openingCash: Number(v) })); if (r) { toast('Đã mở ca', 'ok'); redraw(); } } }, 'Mở ca'));
  }
  const all = E.listShifts().filter(s => s.status === 'closed' && (me.role === 'owner' || s.staffId === me.id)).slice(0, 40);
  mount(box, panel, h('h3', { class: 'small muted mt12 mb8' }, 'Các ca đã chốt'), all.length ? h('div', { class: 'list' }, all.map(s => h('div', { class: 'item click', onClick: () => modal({ title: 'Biên bản chốt ca', body: h('pre', { class: 'receipt', style: { margin: 0 } }, shiftText(s)), actions: [{ label: 'Chia sẻ', onClick: () => { shareText(shiftText(s), 'Chốt ca'); return false; } }, { label: 'Đóng', kind: 'primary' }] }) },
    h('div', { class: 'grow' }, h('div', { class: 'ttl' }, `${s.staffName} · ${fmtDate(s.openAt)}`), h('div', { class: 'sub' }, `${fmtDateTime(s.openAt)} → ${fmtDateTime(s.closeAt)} · ${s.report.bills} hoá đơn`)),
    h('div', { class: 'right' }, h('div', { class: 'bold' }, fmtMoney(s.report.revenue)), h('div', { class: 'small ' + (s.diff === 0 ? 'pos-c' : s.diff < 0 ? 'neg-c' : 'warn-c') }, s.diff === 0 ? 'Khớp' : (s.diff > 0 ? 'Thừa ' : 'Thiếu ') + fmtNum(Math.abs(s.diff)))))) ) : empty('Chưa có ca nào được chốt'));
}
function closeDialog(cur, redraw) {
  const r = E.shiftReport(cur), counted = moneyInput(r.expectedCash), note = h('input', { class: 'input', placeholder: 'Ghi chú (nếu có chênh lệch)' }), diffBox = h('div');
  const upd = () => { const d = counted.num - r.expectedCash; mount(diffBox, kv('Tiền hệ thống tính', fmtMoney(r.expectedCash)), kv('Chênh lệch', (d > 0 ? '+' : '') + fmtMoney(d), d === 0 ? 'pos-c' : 'neg-c')); };
  counted.addEventListener('input', upd);
  modal({ title: 'Chốt ca', body: h('div', null, h('div', { class: 'small muted mb8' }, 'Đếm toàn bộ tiền mặt trong két và nhập vào dưới đây.'), field('Tiền mặt đếm được', counted), diffBox, field('Ghi chú', note)),
    actions: [{ label: 'Huỷ' }, { label: 'Chốt ca', kind: 'primary', onClick: async () => {
      const diff = counted.num - r.expectedCash;
      if (diff !== 0 && !(await confirmBox(`Tiền đếm ${diff < 0 ? 'THIẾU' : 'THỪA'} ${fmtMoney(Math.abs(diff))} so với hệ thống. Vẫn chốt ca?`, { okText: 'Chốt ca' }))) return false;
      const s = await guard(() => E.closeShift(cur.id, { countedCash: counted.num, note: note.value })); if (!s) return false; toast('Đã chốt ca', 'ok'); redraw();
      setTimeout(() => modal({ title: 'Biên bản chốt ca', body: h('pre', { class: 'receipt', style: { margin: 0 } }, shiftText(s)), actions: [{ label: 'Chia sẻ', onClick: () => { shareText(shiftText(s), 'Chốt ca'); return false; } }, { label: 'Xong', kind: 'primary' }] }), 60);
    } }] });
  upd();
}

function bookTab(box, redraw) {
  const list = h('div'), bal = h('div');
  const drawList = () => {
    const fl = E.cashFlows(period.from, period.to), b = E.fundBalances(), ob = S.getMeta('openingBalance', { cash: 0, bank: 0 });
    const sum = f => fl.filter(x => x.fund === f);
    const inn = f => sum(f).filter(x => x.amount > 0).reduce((a, x) => a + x.amount, 0), out = f => -sum(f).filter(x => x.amount < 0).reduce((a, x) => a + x.amount, 0);
    mount(bal, h('div', { class: 'grid g2' }, stat('Tiền mặt hiện có', fmtMoney(b.cash), `Kỳ này: +${fmtNum(inn('cash'))} / -${fmtNum(out('cash'))}`), stat('Ngân hàng', fmtMoney(b.bank), `Kỳ này: +${fmtNum(inn('bank'))} / -${fmtNum(out('bank'))}`)),
      E.can('settings') ? h('div', { class: 'small muted mt8' }, `Số dư đầu kỳ ghi nhận: tiền mặt ${fmtMoney(ob.cash)}, ngân hàng ${fmtMoney(ob.bank)} `, h('a', { href: '#', onClick: async ev => { ev.preventDefault(); const c = await promptBox({ title: 'Số dư tiền mặt ban đầu', type: 'money', value: String(ob.cash) }); if (c === null) return; const k = await promptBox({ title: 'Số dư ngân hàng ban đầu', type: 'money', value: String(ob.bank) }); if (k === null) return; await guard(() => E.setOpeningBalance({ cash: Number(c), bank: Number(k) })); redraw(); } }, 'Sửa')) : null);
    mount(list, fl.length ? h('div', { class: 'list' }, fl.slice().reverse().slice(0, 300).map(x => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.desc), h('div', { class: 'sub' }, fmtDateTime(x.ts) + ' · ' + (x.fund === 'cash' ? 'Tiền mặt' : 'Ngân hàng'))), h('div', { class: 'bold nowrap ' + (x.amount > 0 ? 'pos-c' : 'neg-c') }, (x.amount > 0 ? '+' : '') + fmtNum(x.amount))))) : empty('Không có giao dịch trong kỳ'));
  };
  mount(box, bal, periodBar(period, drawList), list, h('button', { class: 'btn block mt12', onClick: () => exportTable('cashbook', period.from, period.to) }, icon('download', 18), ' Xuất sổ quỹ (Excel)'));
  drawList();
}

function entriesTab(box, redraw) {
  const list = h('div'), canEdit = E.can('cashbook');
  const drawList = () => {
    const es = S.list('cashEntries').filter(e => e.ts >= period.from && e.ts <= period.to).sort((a, b) => b.ts - a.ts);
    const inn = es.filter(e => e.kind === 'income').reduce((a, e) => a + e.amount, 0), out = es.filter(e => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
    mount(list, h('div', { class: 'grid g2 mb8' }, stat('Tổng thu', fmtMoney(inn), '', 'pos-c'), stat('Tổng chi', fmtMoney(out), '', 'neg-c')),
      es.length ? h('div', { class: 'list' }, es.map(e => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, e.catName, !e.operating ? ' ' : '', !e.operating ? badge('Không tính vào lãi') : null), h('div', { class: 'sub' }, fmtDateTime(e.ts) + (e.note ? ' · ' + e.note : '') + ' · ' + (e.fund === 'cash' ? 'Tiền mặt' : 'Ngân hàng'))),
        h('div', { class: 'bold ' + (e.kind === 'income' ? 'pos-c' : 'neg-c') }, (e.kind === 'income' ? '+' : '-') + fmtNum(e.amount)),
        E.can('deleteData') ? iconBtn('trash', async () => { if (await confirmBox('Xoá khoản này?', { danger: true, okText: 'Xoá' })) { await guard(() => E.deleteCashEntry(e.id)); drawList(); } }, 'Xoá') : null))) : empty('Chưa có khoản thu chi nào'));
  };
  mount(box, canEdit ? h('div', { class: 'row mb8' }, h('button', { class: 'btn danger grow', onClick: () => entryForm('expense', drawList) }, icon('minus', 16), ' Chi tiền'), h('button', { class: 'btn primary grow', onClick: () => entryForm('income', drawList) }, icon('plus', 16), ' Thu tiền'), h('button', { class: 'btn', onClick: () => catDialog(redraw) }, 'Danh mục')) : null,
    periodBar(period, drawList), list); drawList();
}
function entryForm(kind, done) {
  const cats = S.list('cashCats').filter(c => c.kind === kind), cat = select(cats.map(c => [c.id, c.name]), cats[0] && cats[0].id), amt = moneyInput(0), fund = select([['cash', 'Tiền mặt (két)'], ['bank', 'Ngân hàng']], 'cash'), note = h('input', { class: 'input', placeholder: 'Ghi chú' });
  modal({ title: kind === 'expense' ? 'Chi tiền' : 'Thu tiền', body: h('div', null, field('Danh mục', cat), field('Số tiền', amt), field('Lấy từ / nhập vào', fund), field('Ghi chú', note)),
    actions: [{ label: 'Huỷ' }, { label: 'Lưu', kind: 'primary', onClick: async () => { const r = await guard(() => E.addCashEntry({ kind, catId: cat.value, amount: amt.num, fund: fund.value, note: note.value })); if (!r) return false; toast('Đã ghi nhận', 'ok'); done(); } }] });
  setTimeout(() => amt.focus(), 80);
}
function catDialog(redraw) {
  const m = modal({ title: 'Danh mục thu chi', body: h('div') });
  const draw = () => mount(m.body, h('div', { class: 'list' }, S.list('cashCats').sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'vi')).map(c => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, c.name), h('div', { class: 'sub' }, (c.kind === 'income' ? 'Thu' : 'Chi') + (c.operating ? '' : ' · không tính vào lãi/lỗ'))),
    iconBtn('trash', async () => { await guard(() => E.deleteCashCat(c.id)); draw(); }, 'Xoá')))),
    h('div', { class: 'row mt12' }, h('button', { class: 'btn grow', onClick: () => add('expense') }, '+ Danh mục chi'), h('button', { class: 'btn grow', onClick: () => add('income') }, '+ Danh mục thu')));
  async function add(kind) { const n = await promptBox({ title: kind === 'income' ? 'Danh mục thu mới' : 'Danh mục chi mới', label: 'Tên danh mục' }); if (!n) return; await guard(() => E.saveCashCat({ name: n, kind })); draw(); }
  draw();
}
