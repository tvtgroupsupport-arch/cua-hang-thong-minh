/* Thành phần dùng chung giữa các màn hình. */
import * as E from '../engine/index.js';
import { h, icon, mount, modal, toast, debounce, badge, empty } from '../ui.js';
import { fmtMoney, fmtNum, periodRange, parseYmd, ymd, toCsv } from '../util.js';
import { openScanner, onScan, canScan, saveFile } from '../native.js';

/** Chọn một sản phẩm (tìm tên / quét mã). Trả Promise<product|null>. onPick có thể gọi nhiều lần nếu `keepOpen`. */
export function pickProduct({ title = 'Chọn hàng hóa', keepOpen = false, onPick, filter } = {}) {
  return new Promise(res => {
    let done = false;
    const list = h('div', { class: 'list' }), input = h('input', { class: 'input', placeholder: 'Gõ tên, SKU hoặc quét mã vạch…', autocomplete: 'off' });
    const finish = p => { if (keepOpen) { onPick && onPick(p); input.value = ''; draw(); input.focus(); return; } done = true; res(p); m.close(); };
    const draw = () => {
      let r = E.searchProducts(input.value, { limit: 40 }); if (filter) r = r.filter(filter);
      mount(list, r.length ? r.map(p => h('div', { class: 'item click', onClick: () => finish(p) },
        h('div', { class: 'grow' }, h('div', { class: 'ttl' }, p.name), h('div', { class: 'sub' }, `${p.sku} · Tồn ${fmtNum(p.stock)} ${p.units[0].name}`)), h('div', { class: 'bold' }, fmtMoney(p.units[0].price)))) : empty('Không tìm thấy hàng'));
    };
    const byCode = code => { const hit = E.lookupBarcode(code); if (hit && (!filter || filter(hit.product))) { finish(hit.product); return true; } toast('Không tìm thấy mã ' + code, 'error'); return false; };
    input.addEventListener('input', debounce(draw, 120));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = input.value.trim(); if (!v) return; const hit = E.lookupBarcode(v); if (hit) byCode(v); else { const r = E.searchProducts(v, { limit: 2 }); if (r.length === 1) finish(r[0]); } } });
    const off = onScan(byCode);
    const m = modal({ title, body: h('div', null, h('div', { class: 'row' }, h('div', { class: 'grow' }, input), canScan() ? h('button', { class: 'btn', onClick: () => openScanner({ continuous: keepOpen, onCode: c => { byCode(c); return keepOpen ? 'keep' : undefined; } }) }, icon('scan')) : null), h('div', { class: 'mt8' }, list)),
      onClose: () => { off(); if (!done) res(null); } });
    draw(); setTimeout(() => input.focus(), 80);
  });
}

/** Thanh chọn kỳ + khoảng tuỳ chọn. onChange({from,to,label,key}). */
export function periodBar(state, onChange, { keys = ['today', 'yesterday', '7d', 'month', 'lastmonth', 'year', 'custom'] } = {}) {
  const names = { today: 'Hôm nay', yesterday: 'Hôm qua', '7d': '7 ngày', '30d': '30 ngày', month: 'Tháng này', lastmonth: 'Tháng trước', year: 'Năm nay', custom: 'Tuỳ chọn' };
  const box = h('div');
  const draw = () => mount(box, h('div', { class: 'chips' }, keys.map(k => h('span', { class: 'chip ' + (state.key === k ? 'on' : ''), onClick: () => {
    state.key = k; if (k !== 'custom') Object.assign(state, periodRange(k)); draw(); onChange(state);
  } }, names[k]))), state.key === 'custom' ? h('div', { class: 'row mb8' },
    h('input', { class: 'input', type: 'date', value: ymd(state.from), onChange: e => { state.from = parseYmd(e.target.value); onChange(state); } }), h('span', null, '→'),
    h('input', { class: 'input', type: 'date', value: ymd(state.to), onChange: e => { state.to = parseYmd(e.target.value) + 86399999; onChange(state); } })) : null);
  if (state.key !== 'custom') Object.assign(state, periodRange(state.key));
  draw(); return box;
}

/** Xuất nhanh một báo cáo ra Excel (các nút "Xuất…" nằm ngay trong màn hình báo cáo). Muốn chọn nhiều báo cáo → trang Xuất báo cáo. */
export async function exportTable(kind, from, to) {
  const { exportReports } = await import('../xlsx-export.js');
  try {
    const r = await exportReports([kind], { from, to, format: 'xlsx', mode: 'share' });
    if (r && r.empty) toast('Chưa có dữ liệu để xuất trong khoảng đã chọn', 'error');
    else if (r) toast(`Đã xuất ${r.rows} dòng · ${r.filename}`, 'ok', 3500);
  } catch (e) { toast(e.message || 'Không xuất được', 'error'); }
}

export const dueBadge = (days, warnAt = 30) => days > warnAt ? badge(days + ' ngày', 'red') : days > 7 ? badge(days + ' ngày', 'amber') : badge(days + ' ngày');
