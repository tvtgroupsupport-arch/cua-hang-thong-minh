/* Trang "Thêm": lối vào các chức năng còn lại + hướng dẫn sử dụng. */
import { S } from '../store.js';
import * as E from '../engine/index.js';
import { h, icon, mount } from '../ui.js';
import { fmtMoney, fmtDateTime } from '../util.js';

const ITEMS = [
  ['sales', 'Hoá đơn & trả hàng', 'receipt', ['sell', 'viewReports']], ['customers', 'Khách hàng & nợ', 'users', ['manageCustomers', 'sell']], ['suppliers', 'Nhà cung cấp & nợ', 'truck', ['manageSuppliers']],
  ['promos', 'Khuyến mãi', 'tag', ['managePromos', 'sell']], ['cash', 'Sổ quỹ & ca làm việc', 'wallet', ['cashbook']], ['staff', 'Nhân viên & quyền', 'user', ['manageStaff']],
  ['export', 'Xuất báo cáo Excel', 'download', ['viewReports', 'manageStock', 'cashbook', 'manageProducts']], ['settings', 'Cài đặt & sao lưu', 'settings', ['settings']], ['logs', 'Nhật ký hoạt động', 'list', ['settings', 'manageStaff']], ['help', 'Hướng dẫn sử dụng', 'book', []]
];

export function viewMore(root, ctx) {
  const u = E.currentUser(), st = E.settings();
  const last = S.getMeta('lastBackup', 0), needBackup = E.can('settings') && (!last || Date.now() - last > 7 * 864e5) && S.count('sales') + S.count('products') > 0;
  const shift = E.currentShift();
  mount(root,
    h('div', { class: 'card row' }, h('div', { class: 'thumb' }, u.name.slice(0, 1).toUpperCase()), h('div', { class: 'grow' }, h('div', { class: 'bold' }, u.name), h('div', { class: 'small muted' }, `${E.ROLE_NAMES[u.role] || 'Tuỳ chỉnh'} · ${st.store.name}`)),
      shift ? h('span', { class: 'badge green' }, 'Đang mở ca') : null),
    needBackup ? h('a', { class: 'banner mt8', href: '#/settings', style: { display: 'block', textDecoration: 'none', color: 'inherit' } }, last ? `Đã ${Math.floor((Date.now() - last) / 864e5)} ngày chưa sao lưu dữ liệu. ` : 'Bạn chưa sao lưu dữ liệu lần nào. ', h('b', null, 'Sao lưu ngay →')) : null,
    h('div', { class: 'grid g2 mt12' }, ITEMS.filter(([k, , , perms]) => !perms.length || perms.some(p => E.can(p))).map(([k, label, ic]) =>
      h('a', { class: 'stat', href: '#/' + k, style: { textDecoration: 'none', color: 'inherit', display: 'flex', gap: '12px', alignItems: 'center', minHeight: '64px' } }, h('div', { class: 'thumb' }, icon(ic)), h('div', { class: 'bold' }, label)))),
    h('div', { class: 'center muted tiny mt12' }, `Tạp Hóa v1.0 · Dữ liệu lưu trên thiết bị này`));
}

const GUIDE = [
  ['Bắt đầu nhanh', ['1. Vào mục Hàng hóa → bấm + để thêm sản phẩm (hoặc ⋯ → Nhập từ tệp CSV để nhập hàng loạt từ Excel).', '2. Nhập tồn kho ban đầu khi thêm hàng, hoặc dùng Kho → Nhập hàng khi có phiếu nhập từ nhà cung cấp.', '3. Vào Cài đặt: điền thông tin cửa hàng, tài khoản ngân hàng (để hiện mã VietQR), khổ giấy in.', '4. Sang Bán hàng và bán thử một đơn.']],
  ['Bán hàng', ['• Quét mã vạch bằng nút camera, bằng máy quét Bluetooth/USB (cắm là dùng, mã vào giỏ ngay), hoặc gõ tên/mã rồi Enter.', '• Chạm vào số lượng để gõ số lẻ (hàng cân: 0,35 kg). Chạm vào giá để sửa giá (cần quyền). Nút ⋯ trên mỗi dòng: giảm giá dòng, ghi chú, xoá.', '• "Treo đơn" để phục vụ khách khác rồi quay lại sau (biểu tượng ⏸ ở góc trên).', '• Thanh toán: nhập tiền khách đưa để biết tiền thừa; có thể trả hỗn hợp (một phần tiền mặt, một phần chuyển khoản, một phần ghi nợ). Chọn khách trước khi ghi nợ.', '• Hàng bán theo thùng/lốc: chọn đơn vị ngay trên dòng hàng trong giỏ.']],
  ['Hàng cân (rau, thịt, gạo)', ['Đặt loại hàng là "Hàng cân/đo" và đơn vị kg. Khi bán chạm vào hàng, nhập khối lượng.', 'Nếu có cân điện tử in tem mã vạch (EAN-13 bắt đầu bằng số 2): nhập "Mã cân (PLU)" cho hàng, quét tem là tự vào giỏ đúng khối lượng. Bật/tắt và chọn kiểu mã trong Cài đặt.']],
  ['Nhập hàng & kho', ['• Kho → Nhập hàng → Tạo phiếu: chọn nhà cung cấp, thêm hàng (quét mã), nhập giá nhập; phần chưa trả sẽ tính vào công nợ nhà cung cấp. Giá vốn tự cập nhật.', '• Kiểm kho: bắt đầu phiếu, quét/nhập số đếm thực tế, bấm Hoàn tất để cân bằng. Hàng chưa đếm giữ nguyên.', '• Hàng hết hạn/hỏng: Kho → Xuất hủy. Bật "Quản lý theo lô & hạn" cho sữa, bánh… để cảnh báo cận date và tự bán lô hết hạn trước.', '• Kho → Đặt hàng: gợi ý hàng cần nhập, gửi nhanh qua Zalo.']],
  ['Công nợ', ['• Bán ghi nợ cho khách quen: chọn khách rồi nhập số tiền ở ô "Ghi nợ". Đặt hạn mức nợ cho từng khách nếu muốn.', '• Thu nợ: Thêm → Khách hàng & nợ → chọn khách → Thu nợ. Tiền thu trừ vào khoản nợ cũ nhất trước. Có nút gửi tin nhắc nợ.']],
  ['Ca làm việc & sổ quỹ', ['Mở ca khi bắt đầu bán (nhập tiền có sẵn trong két), chốt ca khi kết thúc: đếm tiền, app báo chênh lệch. Chi tiêu (tiền điện, lương…) ghi ở Thu chi để báo cáo tính ra lãi ròng.']],
  ['Sao lưu — rất quan trọng', ['Dữ liệu nằm trên thiết bị. Mất/hỏng máy là mất dữ liệu nếu không có bản sao lưu. Vào Cài đặt → Sao lưu ra tệp rồi gửi lên Zalo/Google Drive; nên làm hằng tuần. Khôi phục: chọn lại tệp đó trên máy mới.']],
  ['Bảo mật', ['Tạo tài khoản riêng cho từng nhân viên ở Thêm → Nhân viên & quyền. Nhân viên thu ngân không xem được giá vốn/lợi nhuận và không huỷ được hoá đơn nếu không cấp quyền. Bấm biểu tượng ổ khoá trên cùng để khoá máy / đổi người.']]
];
export function viewHelp(root) {
  mount(root, GUIDE.map(([t, lines], i) => h('details', { class: 'card', open: i < 2 }, h('summary', { style: { fontWeight: 650, cursor: 'pointer' } }, t), h('div', { class: 'small', style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' } }, lines.map(l => h('div', null, l))))));
}
