/* Lịch sử hoá đơn: xem lại, in lại, trả hàng, huỷ hoá đơn; danh sách phiếu trả. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, mount, modal, toast, guard, confirmBox, promptBox, field, select, checkbox, badge, kv, empty, tabs, qtyInput, moneyInput, pickFromList, debounce } from '../ui.js';
import { fmtMoney, fmtNum, fmtDateTime, periodRange, parseQty, roundQty } from '../util.js';
import { printReceipt, shareText } from '../native.js';
import { receiptText } from '../receipt.js';

const PERIODS = [['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['7d', '7 ngày'], ['month', 'Tháng này'], ['lastmonth', 'Tháng trước'], ['all', 'Tất cả']];

export function viewSales(root, ctx) {
  let tab = 'sales', period = 'today', status = '', q = '';
  const listBox = h('div'), head = h('div');
  const range = () => period === 'all' ? { from: 0, to: Infinity } : periodRange(period);
  const search = h('input', { class: 'input', placeholder: 'Tìm mã hoá đơn, tên hoặc SĐT khách…', onInput: debounce(e => { q = e.target.value; draw(); }, 200) });

  function draw() {
    mount(head, tabs([['sales', 'Hoá đơn'], ['returns', 'Phiếu trả hàng']], tab, k => { tab = k; draw(); }),
      h('div', { class: 'chips' }, PERIODS.map(([k, l]) => h('span', { class: 'chip ' + (period === k ? 'on' : ''), onClick: () => { period = k; draw(); } }, l))),
      tab === 'sales' ? h('div', { class: 'row mb8' }, h('div', { class: 'grow' }, search),
        select([['', 'Tất cả'], ['done', 'Hoàn thành'], ['void', 'Đã huỷ']], status, { style: { width: 'auto' }, onChange: e => { status = e.target.value; draw(); } })) : null);
    const r = range();
    if (tab === 'sales') {
      const list = E.listSales({ from: r.from, to: r.to, status, q, limit: 1e6 });
      const done = list.filter(s => s.status === 'done');
      mount(listBox, h('div', { class: 'row between small muted mb8' }, h('span', null, `${list.length} hoá đơn`), h('span', null, 'Doanh thu: ', h('b', null, fmtMoney(done.reduce((a, s) => a + s.total - (s.returnedTotal || 0), 0))))),
        list.length ? h('div', { class: 'list' }, list.slice(0, 400).map(s => h('div', { class: 'item click', onClick: () => openSale(s.id) },
          h('div', { class: 'grow' }, h('div', { class: 'ttl' }, s.code, ' ', s.status === 'void' ? badge('Đã huỷ', 'red') : null, s.returnedTotal ? badge('Có trả hàng', 'amber') : null, s.debt > 0 && s.status === 'done' ? badge('Nợ ' + fmtNum(s.debt), 'red') : null),
            h('div', { class: 'sub' }, `${fmtDateTime(s.ts)} · ${s.customerName || 'Khách lẻ'} · ${s.staffName} · ${s.items.length} mặt hàng`)),
          h('div', { class: 'bold nowrap' + (s.status === 'void' ? ' muted' : '') }, fmtMoney(s.total))))) : empty('Không có hoá đơn nào'));
    } else {
      const list = S.list('returns').filter(x => x.ts >= r.from && x.ts <= r.to).sort((a, b) => b.ts - a.ts);
      mount(listBox, E.can('returns') ? h('button', { class: 'btn block mb8', onClick: () => returnFlow(null) }, icon('undo', 18), ' Nhận trả hàng không có hoá đơn') : null,
        list.length ? h('div', { class: 'list' }, list.map(x => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.code, ' ', x.restock ? null : badge('Không nhập kho', 'amber')),
          h('div', { class: 'sub' }, `${fmtDateTime(x.ts)} · ${x.saleCode || 'Không hoá đơn'}${x.customerName ? ' · ' + x.customerName : ''}`), h('div', { class: 'sub' }, x.items.map(i => `${i.name} ×${fmtNum(i.qty)}`).join(', '))),
          h('div', { class: 'bold nowrap neg-c' }, '-' + fmtMoney(x.total))))) : empty('Chưa có phiếu trả hàng'));
    }
  }

  function openSale(id) {
    const s = S.get('sales', id); if (!s) return;
    const rets = E.returnsOfSale(id);
    const canReturn = s.status === 'done' && E.can('returns') && s.items.some(i => i.qty - i.returnedQty > 1e-9);
    const body = h('div', null,
      h('div', { class: 'row between' }, h('div', null, h('div', { class: 'bold' }, s.code), h('div', { class: 'small muted' }, fmtDateTime(s.ts) + ' · ' + s.staffName)), s.status === 'void' ? badge('Đã huỷ', 'red') : badge('Hoàn thành', 'green')),
      s.customerName ? h('div', { class: 'small mt8' }, 'Khách: ', h('b', null, s.customerName), s.customerPhone ? ' · ' + s.customerPhone : '') : null,
      s.status === 'void' ? h('div', { class: 'banner red mt8' }, `Huỷ bởi ${s.voidBy}: ${s.voidReason}`) : null,
      h('div', { class: 'list mt12' }, s.items.map(i => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, i.name),
        h('div', { class: 'sub' }, `${fmtNum(i.qty)} ${i.unitName} × ${fmtNum(i.price)}` + (i.manualDiscount + i.promoDiscount ? ` (giảm ${fmtNum(i.manualDiscount + i.promoDiscount)})` : '') + (i.returnedQty ? ` · đã trả ${fmtNum(i.returnedQty)}` : ''))),
        h('div', { class: 'bold nowrap' }, fmtMoney(i.total))))),
      h('div', { class: 'mt12' }, kv('Tạm tính', fmtMoney(s.subtotal)), s.discountTotal ? kv('Giảm giá', '-' + fmtMoney(s.discountTotal), 'pos-c') : null, s.rounding ? kv('Làm tròn', fmtMoney(s.rounding)) : null,
        kv('Tổng cộng', fmtMoney(s.total), 'pos-c'), ...s.payments.map(p => kv(E.PAY_METHODS[p.method], fmtMoney(p.amount))), s.change > 0 ? kv('Tiền thừa', fmtMoney(s.change)) : null,
        s.returnedTotal ? kv('Đã hoàn trả', '-' + fmtMoney(s.returnedTotal), 'neg-c') : null,
        E.can('viewCost') && s.status === 'done' ? kv('Lợi nhuận', fmtMoney(E.saleProfit(s))) : null),
      s.note ? h('div', { class: 'small muted mt8' }, 'Ghi chú: ' + s.note) : null,
      rets.length ? h('div', { class: 'mt12 small' }, h('b', null, 'Phiếu trả hàng: '), rets.map(r => `${r.code} (${fmtMoney(r.total)})`).join(', ')) : null);
    const acts = [{ label: 'In', onClick: () => { printReceipt(s); return false; } }, { label: 'Chia sẻ', onClick: () => { shareText(receiptText(s), s.code); return false; } }];
    if (canReturn) acts.push({ label: 'Trả hàng', onClick: close => { close(); returnFlow(s); return false; } });
    if (s.status === 'done' && E.can('voidSale') && !s.returnedTotal) acts.push({ label: 'Huỷ HĐ', kind: 'danger', onClick: async close => {
      const reason = await promptBox({ title: 'Huỷ hoá đơn ' + s.code, label: 'Lý do huỷ (bắt buộc). Hàng sẽ được hoàn lại kho và công nợ được xoá.', type: 'textarea', okText: 'Huỷ hoá đơn' });
      if (reason === null) return false;
      const r = await guard(() => E.voidSale(id, reason)); if (!r) return false; toast('Đã huỷ hoá đơn', 'ok'); close(); draw();
    } });
    modal({ title: 'Chi tiết hoá đơn', body, size: 'wide', actions: acts.length > 4 ? acts.slice(0, 4) : acts });
  }

  /** Trả hàng: có hoá đơn gốc (sale) hoặc không (null). */
  function returnFlow(sale) {
    const rows = [];       // {lineIndex|product, qtyInput}
    const refund = select([['cash', 'Hoàn tiền mặt'], ['transfer', 'Hoàn chuyển khoản'], ...(sale && sale.customerId ? [['debt', 'Trừ vào công nợ khách']] : [])], 'cash');
    const restock = checkbox('Nhập lại kho (hàng còn bán được)', true);
    const reason = h('input', { class: 'input', placeholder: 'Lý do trả hàng (không bắt buộc)' });
    const totalBox = h('div', { class: 'bigmoney' }), listBox2 = h('div', { class: 'list' });
    let anon = [];       // trả không hoá đơn: [{product, unit, qty, price}]
    function refreshTotal() {
      let t = 0;
      if (sale) rows.forEach(r => { const q = parseQty(r.input.value); const it = sale.items[r.idx]; if (q > 0) t += q >= it.qty - it.returnedQty - 1e-9 ? it.net - it.returnedAmount : Math.round(it.net * q / it.qty); });
      else t = anon.reduce((a, x) => a + Math.round(x.qty * x.price), 0);
      totalBox.textContent = fmtMoney(t);
    }
    if (sale) {
      sale.items.forEach((it, idx) => {
        const remain = roundQty(it.qty - it.returnedQty); if (remain <= 0) return;
        const input = qtyInput('', { placeholder: '0' }); input.style.width = '90px'; input.addEventListener('input', refreshTotal);
        rows.push({ idx, input, remain });
        listBox2.appendChild(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, it.name), h('div', { class: 'sub' }, `Đã mua ${fmtNum(it.qty)} ${it.unitName} · có thể trả ${fmtNum(remain)}`)),
          input, h('button', { class: 'btn sm', onClick: () => { input.value = String(remain).replace('.', ','); refreshTotal(); } }, 'Tất cả')));
      });
    } else {
      const drawAnon = () => { mount(listBox2, anon.length ? anon.map((x, i) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'ttl' }, x.product.name), h('div', { class: 'sub' }, `${fmtNum(x.qty)} ${x.unit.name} × ${fmtNum(x.price)}`)),
        h('button', { class: 'iconbtn', onClick: () => { anon.splice(i, 1); drawAnon(); refreshTotal(); } }, icon('x')))) : empty('Chưa chọn hàng'),
        h('div', { class: 'item click', onClick: async () => {
          const p = await pickFromList({ title: 'Chọn hàng khách trả', items: S.list('products').filter(x => x.active).sort((a, b) => a.name.localeCompare(b.name, 'vi')), match: (p, qn) => E.searchProducts(qn, { limit: 500 }).some(x => x.id === p.id), render: p => h('div', { class: 'grow' }, h('div', { class: 'ttl' }, p.name), h('div', { class: 'sub' }, fmtMoney(p.units[0].price))) });
          if (!p) return; const v = await promptBox({ title: p.name, label: 'Số lượng trả', type: 'qty', value: '1' }); if (v === null) return;
          const qn = parseQty(v); if (qn > 0) { anon.push({ product: p, unit: p.units[0], qty: qn, price: p.units[0].price }); drawAnon(); refreshTotal(); }
        } }, h('div', { class: 'grow pos-c bold' }, '+ Thêm hàng trả')));
      };
      drawAnon();
    }
    refreshTotal();
    modal({ title: sale ? 'Trả hàng – ' + sale.code : 'Trả hàng không hoá đơn', size: 'wide', body: h('div', null, h('div', { class: 'small muted mb8' }, 'Số tiền hoàn tính theo giá khách thực trả (đã trừ giảm giá).'), listBox2,
      h('div', { class: 'mt12' }, field('Hình thức hoàn tiền', refund), restock, h('div', { class: 'mt8' }, field('Lý do', reason)), h('div', { class: 'center small muted' }, 'Tổng tiền hoàn'), totalBox)),
      actions: [{ label: 'Huỷ' }, { label: 'Xác nhận trả hàng', kind: 'primary', onClick: async () => {
        const items = sale ? rows.map(r => ({ lineIndex: r.idx, qty: parseQty(r.input.value) })).filter(x => x.qty > 0) : anon.map(x => ({ productId: x.product.id, unitId: x.unit.id, qty: x.qty, price: x.price }));
        if (!items.length) { toast('Chưa nhập số lượng trả', 'error'); return false; }
        const r = await guard(() => E.createReturn({ saleId: sale && sale.id, items, refund: refund.value, restock: restock.input.checked, reason: reason.value }));
        if (!r) return false; toast(`Đã trả hàng, hoàn ${fmtMoney(r.total)}`, 'ok'); draw();
      } }] });
  }

  mount(root, head, listBox);
  draw();
}
