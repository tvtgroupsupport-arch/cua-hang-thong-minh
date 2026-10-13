/* Bộ mã hoá mã vạch 1D (thuần, không DOM): EAN-13, EAN-8, Code 128 (bộ B). Trả về chuỗi "1"/"0" — mỗi ký tự là một module (vạch đen/trắng). */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
export const _tables = { L, G, R, PARITY };

export function eanCheckDigit(body) {            // body: 7 hoặc 12 chữ số
  let s = 0;
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) s += +body[i] * w;
  return (10 - s % 10) % 10;
}
export function eanValid(code) { return /^\d{8}$|^\d{13}$/.test(code) && eanCheckDigit(code.slice(0, -1)) === +code.slice(-1); }

export function ean13(code) {
  if (!/^\d{13}$/.test(code) || !eanValid(code)) throw new Error('Mã EAN-13 không hợp lệ');
  const par = PARITY[+code[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[+code[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[+code[i]];
  return bits + '101';
}
export function ean8(code) {
  if (!/^\d{8}$/.test(code) || !eanValid(code)) throw new Error('Mã EAN-8 không hợp lệ');
  let bits = '101';
  for (let i = 0; i < 4; i++) bits += L[+code[i]];
  bits += '01010';
  for (let i = 4; i < 8; i++) bits += R[+code[i]];
  return bits + '101';
}

/* Code 128: mỗi ký hiệu là 6 số = độ rộng luân phiên vạch/khoảng trắng (tổng 11 module); STOP có 7 số (13 module). */
export const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
const bars = widths => { let out = '', dark = true; for (const w of widths) { out += (dark ? '1' : '0').repeat(+w); dark = !dark; } return out; };

/** Code 128 bộ B: ký tự ASCII 32–126. */
export function code128(text) {
  text = String(text);
  if (!text.length) throw new Error('Mã rỗng');
  const vals = [104];
  for (const ch of text) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) throw new Error('Code 128 (bộ B) chỉ nhận ký tự ASCII in được'); vals.push(c - 32); }
  let sum = vals[0]; for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  return vals.map(v => bars(C128[v])).join('');
}

/** Chọn kiểu mã phù hợp: 13 số hợp lệ → EAN-13; 12 số → UPC-A (EAN-13 thêm số 0 đầu); 8 số hợp lệ → EAN-8; còn lại Code 128. */
export function encodeAuto(code) {
  code = String(code).trim();
  if (/^\d{13}$/.test(code) && eanValid(code)) return { type: 'EAN-13', bits: ean13(code), text: code };
  if (/^\d{12}$/.test(code) && eanValid('0' + code)) return { type: 'UPC-A', bits: ean13('0' + code), text: code };
  if (/^\d{8}$/.test(code) && eanValid(code)) return { type: 'EAN-8', bits: ean8(code), text: code };
  return { type: 'Code128', bits: code128(code), text: code };
}
