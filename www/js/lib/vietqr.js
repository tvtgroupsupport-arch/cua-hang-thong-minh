/* ============================================================
   VIETQR TẠO NGAY TRONG APP — không cần mạng.
   Trước đây mã thanh toán là ảnh tải từ img.vietqr.io nên mất mạng là không có mã. Mã VietQR thực chất chỉ là một
   chuỗi theo chuẩn EMVCo (kèm AID NAPAS A000000727) cộng mã kiểm tra CRC16; app tự dựng chuỗi đó rồi vẽ bằng bộ QR sẵn
   có (QR.svg), nên ra đúng cùng mã mà ngân hàng quét được, cả khi không có Internet.
   Cấu trúc (mỗi trường = ID 2 số + độ dài 2 số + giá trị), đúng thứ tự tăng dần của ID:
     00 "01"                          phiên bản
     01 "11" tĩnh | "12" động         có số tiền → "12"
     38 { 00 "A000000727"             AID NAPAS 247
          01 { 00 mã BIN ngân hàng    6 số
               01 số tài khoản }
          02 "QRIBFTTA" }              chuyển nhanh tới tài khoản
     53 "704"                         tiền tệ VND
     54 số tiền                       (chỉ khi có số tiền, không dấu chấm)
     58 "VN"
     62 { 08 nội dung chuyển khoản }  (tối đa 25 ký tự, chỉ chữ/số/khoảng trắng, không dấu)
     63 "04" + CRC16
   ============================================================ */
export const VietQR = (() => {
  const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

  /** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF) — tính trên toàn bộ chuỗi gồm cả "6304". */
  function crc16(text) {
    let crc = 0xFFFF;
    for (const byte of new TextEncoder().encode(text)) {
      crc ^= byte << 8;
      for (let i = 0; i < 8; i++) crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  /** Nội dung chuyển khoản: bỏ dấu tiếng Việt, chỉ giữ chữ/số/khoảng trắng, tối đa 25 ký tự (giới hạn của chuẩn). */
  function cleanInfo(text, max = 25) {
    return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /** Dựng chuỗi VietQR. amount=0/bỏ trống → mã tĩnh (khách tự nhập số tiền). */
  function payload({ bin, account, amount, info }) {
    bin = String(bin || '').trim();
    account = String(account || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(bin)) throw new Error('Mã ngân hàng (BIN) phải gồm 6 chữ số');
    if (!/^[0-9A-Za-z]{1,19}$/.test(account)) throw new Error('Số tài khoản không hợp lệ (tối đa 19 ký tự, chỉ chữ và số)');
    const amt = Math.round(Number(amount) || 0);
    const memo = cleanInfo(info);
    let s = tlv('00', '01')
      + tlv('01', amt > 0 ? '12' : '11')
      + tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', 'QRIBFTTA'))
      + tlv('53', '704')
      + (amt > 0 ? tlv('54', String(amt)) : '')
      + tlv('58', 'VN')
      + (memo ? tlv('62', tlv('08', memo)) : '');
    s += '6304';
    return s + crc16(s);
  }

  return { payload, crc16, cleanInfo };
})();
