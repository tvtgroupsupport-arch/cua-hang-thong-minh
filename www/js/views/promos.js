/* Khuyến mãi: danh sách và biểu mẫu tạo/sửa. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, iconBtn, mount, modal, toast, guard, confirmBox, field, select, badge, empty, moneyInput, qtyInput, checkbox } from '../ui.js';
import { fmtMoney, fmtNum, parseQty } from '../util.js';
import { pickProduct } from './common.js';

export function viewPromos(root, ctx) {
  const canEdit = E.can('managePromos'), box = h('div');
  const draw = () => {
    const list = S.list('promos').sort((a, b) => (E.promoStatus(a) === 'Đang chạy' ? 0 : 1) - (E.promoStatus(b) === 'Đang chạy' ? 0 : 1) || a.name.localeCompare(b.name, 'vi'));
    mount(box, list.length ? h('div', { class: 'list' }, list.map(p => { const st = E.promoStatus(p);
      return h('div', { class: 'item' + (canEdit ? ' click' : ''), onClick: () => canEdit && form(p) }, h('div', { class: 'thumb' }, icon('tag')),
        h('div', { class: 'grow' }, h('div', { class: 'ttl' }, p.name, ' ', badge(st, st === 'Đang chạy' ? 'green' : st === 'Chưa bắt đầu' ? 'blue' : '')),
          h('div', { class: 'sub' }, E.PROMO_TYPES[p.type] + ' · ' + E.promoSummary(p)), h('div', { class: 'tiny muted' }, [p.from || p.to ? `${p.from || '…'} → ${p.to || '…'}` : 'Không giới hạn thời gian', p.days && p.days.length ? 'Thứ: ' + p.days.map(d => d === 0 ? 'CN' : d + 1).join(',') : '', p.hourFrom ? `${p.hourFrom}-${p.hourTo || '24:00'}` : '', p.limit ? `Đã dùng ${p.used || 0}/${p.limit}` : p.used ? `Đã dùng ${p.used}` : ''].filter(Boolean).join(' · '))),
        canEdit ? h('label', { class: 'check', onClick: e => e.stopPropagation() }, h('input', { type: 'checkbox', checked: p.active, onChange: e => { guard(() => E.savePromo(Object.assign({}, p, { active: e.target.checked }))).then(draw); } })) : null); })) : empty('Chưa có chương trình khuyến mãi', canEdit ? 'Bấm + để tạo. Khuyến mãi được áp dụng tự động khi bán hàng.' : ''));
  };

  function form(p) {
    const st = p ? JSON.parse(JSON.stringify(p)) : { type: 'percent', scope: 'all', productIds: [], categoryIds: [], comboItems: [], days: [], groups: [], active: true };
    const f = { name: h('input', { class: 'input', value: st.name || '', placeholder: 'VD: Giảm 10% bánh kẹo' }), type: select(Object.entries(E.PROMO_TYPES), st.type), scope: select(Object.entries(E.PROMO_SCOPES), st.scope),
      value: qtyInput(st.value || ''), minTotal: moneyInput(st.minTotal || 0), minQty: qtyInput(st.minQty || ''), buy: qtyInput(st.buyQty || ''), get: qtyInput(st.getQty || ''), comboPrice: moneyInput(st.comboPrice || 0),
      code: h('input', { class: 'input', value: st.code || '', placeholder: 'Để trống = tự áp dụng', autocapitalize: 'characters' }), from: h('input', { class: 'input', type: 'date', value: st.from || '' }), to: h('input', { class: 'input', type: 'date', value: st.to || '' }),
      hf: h('input', { class: 'input', type: 'time', value: st.hourFrom || '' }), ht: h('input', { class: 'input', type: 'time', value: st.hourTo || '' }), limit: qtyInput(st.limit || '') };
    const targets = h('div'), dyn = h('div'), dayBox = h('div', { class: 'chips', style: { flexWrap: 'wrap' } }), grpBox = h('div', { class: 'chips', style: { flexWrap: 'wrap' } });
    const drawTargets = () => {
      const t = f.type.value, sc = t === 'combo' ? 'product' : (t === 'buyxgety' && f.scope.value === 'all' ? 'product' : f.scope.value);
      mount(targets, t === 'combo' ? h('div', null, h('div', { class: 'small muted mb8' }, 'Mặt hàng trong combo (số lượng theo đơn vị cơ bản)'), st.comboItems.map((c, i) => { const p2 = S.get('products', c.productId); const q = qtyInput(c.qty); q.style.width = '80px'; q.addEventListener('input', () => { c.qty = parseQty(q.value); });
          return h('div', { class: 'row mb8' }, h('div', { class: 'grow ellipsis' }, p2 ? p2.name : '(đã xoá)'), q, iconBtn('x', () => { st.comboItems.splice(i, 1); drawTargets(); })); }),
        h('button', { class: 'btn sm', onClick: async () => { const p2 = await pickProduct({ title: 'Thêm vào combo' }); if (p2) { st.comboItems.push({ productId: p2.id, qty: 1 }); drawTargets(); } } }, '+ Thêm mặt hàng'))
        : sc === 'product' ? h('div', null, field('Áp dụng cho sản phẩm', h('div', null, h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, st.productIds.map(id => { const p2 = S.get('products', id); return h('span', { class: 'chip on' }, p2 ? p2.name : '?', ' ', h('span', { onClick: () => { st.productIds = st.productIds.filter(x => x !== id); drawTargets(); } }, '✕')); })),
          h('button', { class: 'btn sm', onClick: async () => { const p2 = await pickProduct({ title: 'Chọn sản phẩm', keepOpen: true, onPick: p3 => { if (!st.productIds.includes(p3.id)) { st.productIds.push(p3.id); drawTargets(); } } }); void p2; } }, '+ Thêm sản phẩm'))))
        : sc === 'category' ? field('Áp dụng cho nhóm hàng', h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, E.categoryTree().map(({ cat, depth }) => h('span', { class: 'chip ' + (st.categoryIds.includes(cat.id) ? 'on' : ''), onClick: () => { st.categoryIds = st.categoryIds.includes(cat.id) ? st.categoryIds.filter(x => x !== cat.id) : [...st.categoryIds, cat.id]; drawTargets(); } }, ' '.repeat(depth * 2) + cat.name)))) : null);
      const pct = t === 'percent';
      mount(dyn, t === 'combo' ? field('Giá combo (đ)', f.comboPrice) : t === 'buyxgety' ? h('div', { class: 'grid g2' }, field('Mua (số lượng)', f.buy), field('Tặng (số lượng)', f.get)) : field(pct ? 'Giảm (%)' : (sc === 'all' ? 'Giảm (đ) cho cả đơn' : 'Giảm (đ) cho mỗi đơn vị'), f.value),
        t !== 'combo' && sc === 'all' && (t === 'percent' || t === 'amount') ? field('Đơn tối thiểu (đ)', f.minTotal) : null, t !== 'combo' && sc !== 'all' ? field('Số lượng tối thiểu trên dòng', f.minQty) : null);
    };
    const drawDays = () => { mount(dayBox, ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((n, i) => h('span', { class: 'chip ' + (st.days.includes(i) ? 'on' : ''), onClick: () => { st.days = st.days.includes(i) ? st.days.filter(x => x !== i) : [...st.days, i]; drawDays(); } }, n)));
      mount(grpBox, Object.entries(E.CUSTOMER_GROUPS).map(([k, l]) => h('span', { class: 'chip ' + (st.groups.includes(k) ? 'on' : ''), onClick: () => { st.groups = st.groups.includes(k) ? st.groups.filter(x => x !== k) : [...st.groups, k]; drawDays(); } }, l))); };
    f.type.addEventListener('change', drawTargets); f.scope.addEventListener('change', drawTargets);
    const scopeField = field('Phạm vi áp dụng', f.scope);
    modal({ title: p ? 'Sửa khuyến mãi' : 'Tạo khuyến mãi', size: 'wide', body: h('div', null, field('Tên chương trình *', f.name), field('Loại khuyến mãi', f.type), scopeField, targets, dyn,
      field('Mã giảm giá (tuỳ chọn)', f.code, 'Có mã thì khách/thu ngân phải nhập mã trong giỏ hàng mới áp dụng.'),
      h('div', { class: 'grid g2' }, field('Từ ngày', f.from), field('Đến ngày', f.to)), field('Chỉ áp dụng các thứ', dayBox, 'Không chọn = mọi ngày'), h('div', { class: 'grid g2' }, field('Từ giờ', f.hf), field('Đến giờ', f.ht)),
      field('Dành cho nhóm khách', grpBox, 'Không chọn = mọi khách (kể cả khách lẻ)'), field('Giới hạn số lần dùng', f.limit, '0 = không giới hạn')),
      actions: [p ? { label: 'Xoá', kind: 'danger', onClick: async () => { if (!(await confirmBox('Xoá khuyến mãi này?', { danger: true, okText: 'Xoá' }))) return false; E.deletePromo(p.id); draw(); } } : { label: 'Huỷ' },
        { label: 'Lưu', kind: 'primary', onClick: async () => {
          const r = await guard(() => E.savePromo({ id: p && p.id, name: f.name.value, type: f.type.value, scope: f.type.value === 'buyxgety' && f.scope.value === 'all' ? 'product' : f.scope.value, productIds: st.productIds, categoryIds: st.categoryIds, comboItems: st.comboItems, value: f.value.num, minTotal: f.minTotal.num, minQty: f.minQty.num,
            buyQty: f.buy.num, getQty: f.get.num, comboPrice: f.comboPrice.num, code: f.code.value, from: f.from.value, to: f.to.value, days: st.days, hourFrom: f.hf.value, hourTo: f.ht.value, groups: st.groups, limit: f.limit.num, active: st.active }));
          if (!r) return false; toast('Đã lưu khuyến mãi', 'ok'); draw();
        } }] });
    drawTargets(); drawDays(); setTimeout(() => { scopeField.style.display = ['combo', 'buyxgety'].includes(f.type.value) ? 'none' : ''; }, 0);
    f.type.addEventListener('change', () => { scopeField.style.display = ['combo', 'buyxgety'].includes(f.type.value) ? 'none' : ''; if (f.type.value === 'buyxgety' && f.scope.value === 'all') { f.scope.value = 'product'; drawTargets(); } });
  }
  mount(root, h('div', { class: 'banner blue mb8' }, 'Khuyến mãi được tự động áp dụng khi thu ngân thêm hàng vào giỏ. Nếu nhiều khuyến mãi trùng nhau, hệ thống lấy mức lợi nhất cho khách (đổi trong Cài đặt).'), box, canEdit ? h('button', { class: 'fab', onClick: () => form(null) }, icon('plus')) : null);
  draw();
}
