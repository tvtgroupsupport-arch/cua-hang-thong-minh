/* Xuất báo cáo Excel: chọn kỳ, chọn báo cáo (nhiều báo cáo → một tệp nhiều sheet hoặc nhiều tệp), định dạng và cách lưu. */
import * as E from '../engine/index.js';
import { h, icon, mount, modal, toast, guard, tabs, badge, empty, checkbox } from '../ui.js';
import { fmtNum } from '../util.js';
import { periodBar } from './common.js';
import { exportReports } from '../xlsx-export.js';
import { isNative } from '../native.js';
import { fmtDate } from '../util.js';

const state = { period: { key: 'month' }, selected: new Set(['overview']), format: 'xlsx', mode: 'share', merge: true };

export function viewExport(root, ctx) {
  const avail = E.availableReports();
  for (const id of [...state.selected]) if (!avail.some(r => r.id === id)) state.selected.delete(id);
  const cards = h('div', { class: 'col' }), bar = h('div'), counts = new Map();
  const rangeLabel = () => state.period.key === 'custom' || state.period.from ? `${fmtDate(state.period.from)} – ${fmtDate(state.period.to)}` : '';

  const drawCards = () => mount(cards, avail.map(r => {
    const sel = state.selected.has(r.id), n = counts.get(r.id);
    return h('div', { class: 'rcard' + (sel ? ' sel' : ''), onClick: () => { sel ? state.selected.delete(r.id) : state.selected.add(r.id); drawCards(); drawBar(); } },
      h('div', { class: 'ic thumb ' + r.tint }, icon(r.icon)),
      h('div', { class: 'grow' }, h('div', { class: 'bold' }, r.title), h('div', { class: 'small muted' }, r.desc),
        h('div', { class: 'row gap4 mt8' }, badge(r.ranged ? 'Theo kỳ đã chọn' : 'Số liệu hiện tại', r.ranged ? 'blue' : ''), n != null ? badge(fmtNum(n) + ' dòng', n ? 'green' : 'amber') : null)),
      h('div', { class: 'tick' }, icon('check')));
  }));
  function drawBar() {
    const n = state.selected.size;
    mount(bar,
      h('div', { class: 'card' }, h('h3', null, '3 · Định dạng & cách lưu'),
        h('div', { class: 'row between mb8' }, h('div', null, h('div', { class: 'bold' }, 'Định dạng tệp'), h('div', { class: 'small muted' }, state.format === 'xlsx' ? 'Excel: có màu, dòng tổng, lọc cột' : 'CSV: nhẹ, mở được mọi nơi')),
          h('div', { class: 'seg' }, ['xlsx', 'csv'].map(f => h('button', { class: state.format === f ? 'on' : '', onClick: () => { state.format = f; drawBar(); } }, f === 'xlsx' ? 'Excel' : 'CSV')))),
        isNative() ? h('div', { class: 'row between mb8' }, h('div', null, h('div', { class: 'bold' }, 'Sau khi xuất'), h('div', { class: 'small muted' }, state.mode === 'share' ? 'Mở bảng chia sẻ (Zalo, Gmail, Drive…)' : 'Lưu vào máy rồi mở tệp')),
          h('div', { class: 'seg' }, [['share', 'Chia sẻ'], ['save', 'Lưu vào máy']].map(([k, l]) => h('button', { class: state.mode === k ? 'on' : '', onClick: () => { state.mode = k; drawBar(); } }, l)))) : null,
        n > 1 ? checkbox('Gộp vào một tệp — mỗi báo cáo một sheet', state.merge, v => { state.merge = v; }) : null),
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', { class: 'btn', onClick: () => { if (state.selected.size === avail.length) state.selected.clear(); else avail.forEach(r => state.selected.add(r.id)); drawCards(); drawBar(); } }, state.selected.size === avail.length ? 'Bỏ chọn hết' : 'Chọn tất cả'),
        h('button', { class: 'btn primary lg grow', disabled: !n, onClick: run }, icon('download', 20), n ? ` Xuất ${n} báo cáo` : ' Chọn báo cáo để xuất')));
  }
  async function refreshCounts() {
    counts.clear();
    for (const r of avail) { try { counts.set(r.id, E.countRows(r.id, state.period.from, state.period.to)); } catch (e) { counts.set(r.id, 0); } }
    drawCards();
  }
  async function run() {
    const ids = avail.filter(r => state.selected.has(r.id)).map(r => r.id), groups = state.merge || ids.length === 1 ? [ids] : ids.map(i => [i]);
    const results = [];
    for (const g of groups) {
      const r = await guard(() => exportReports(g, { format: state.format, mode: state.mode, from: state.period.from, to: state.period.to, rangeLabel: rangeLabel() }));
      if (r === undefined) return;               // lỗi đã báo
      if (r === null) return;                    // người dùng huỷ
      if (r.empty) { toast(`"${E.REPORTS.find(x => x.id === g[0]).title}" chưa có dữ liệu trong kỳ này`, 'error'); continue; }
      results.push(r);
    }
    if (!results.length) return;
    modal({ title: 'Đã xuất xong 🎉', body: h('div', null, results.map(r => h('div', { class: 'card', style: { boxShadow: 'none', background: 'var(--surface2)' } }, h('div', { class: 'bold', style: { wordBreak: 'break-all' } }, r.filename),
      h('div', { class: 'small muted' }, `${fmtNum(r.rows)} dòng · ${r.sheets} sheet · ${r.format === 'xlsx' ? 'Excel' : 'CSV'}`))),
      results.some(r => r.fellBack) ? h('div', { class: 'banner mt8' }, 'Không tải được bộ tạo Excel nên đã xuất tạm bằng CSV. Kiểm tra kết nối mạng rồi thử lại để có tệp Excel đẹp.') : null),
      actions: [{ label: 'Xong', kind: 'primary' }] });
  }

  const hero = h('div', { class: 'hero' }, h('h2', null, 'Xuất báo cáo Excel'), h('p', null, 'Tệp .xlsx đã trình bày sẵn — mở lên là đọc được ngay: có màu, dòng tổng cộng, bộ lọc và in được gọn trên giấy A4.'));
  const pb = periodBar(state.period, () => { refreshCounts(); }, { keys: ['today', 'yesterday', '7d', 'month', 'lastmonth', 'year', 'custom'] });
  mount(root, hero,
    h('h3', { class: 'small muted mt12 mb8' }, '1 · Khoảng thời gian'), h('div', { class: 'card', style: { paddingBottom: '6px' } }, pb, h('div', { class: 'small muted' }, 'Áp dụng cho các báo cáo "theo kỳ". Tồn kho, công nợ và danh mục luôn xuất số liệu hiện tại.')),
    h('h3', { class: 'small muted mt12 mb8' }, '2 · Chọn báo cáo'), avail.length ? cards : empty('Bạn chưa có quyền xuất báo cáo nào'),
    h('div', { class: 'mt12' }, bar));
  drawCards(); drawBar();
  setTimeout(refreshCounts, 30);
}
