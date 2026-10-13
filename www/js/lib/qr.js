/* ============================================================
   Bộ sinh mã QR đúng chuẩn ISO/IEC 18004 — byte mode, mức sửa lỗi M,
   phiên bản 1..20 (đủ cho mọi URL và mã mời thiết bị của app). Viết thẳng vào app để
   không phụ thuộc mạng hay thư viện ngoài.
   ============================================================ */
export const QR = (() => {

  /* ---- Trường hữu hạn GF(256), đa thức nguyên thuỷ 0x11D ---- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /** Đa thức sinh Reed–Solomon bậc `deg`, hệ số cao nhất đứng đầu (gen[0] = 1):
      nhân dần với (x + α^i). */
  function rsPoly(deg) {
    let p = [1];
    for (let i = 0; i < deg; i++) {
      const q = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) {
        q[j] ^= p[j];                    // × x
        q[j + 1] ^= mul(p[j], EXP[i]);   // × α^i
      }
      p = q;
    }
    return p;
  }
  /** Sinh `deg` mã sửa lỗi cho khối dữ liệu */
  function rsEncode(data, deg) {
    const gen = rsPoly(deg);
    const res = new Uint8Array(deg);
    for (const b of data) {
      const factor = b ^ res[0];
      res.copyWithin(0, 1); res[deg - 1] = 0;
      for (let i = 0; i < deg; i++) res[i] ^= mul(gen[i + 1], factor);
    }
    return res;
  }

  /* ---- Bảng tham số mức M cho phiên bản 1..10 ----
     [tổng codeword, EC mỗi khối, số khối nhóm1, dữ liệu/khối nhóm1, số khối nhóm2, dữ liệu/khối nhóm2] */
  const SPEC = {
    1:  [26, 10, 1, 16, 0, 0],
    2:  [44, 16, 1, 28, 0, 0],
    3:  [70, 26, 1, 44, 0, 0],
    4:  [100, 18, 2, 32, 0, 0],
    5:  [134, 24, 2, 43, 0, 0],
    6:  [172, 16, 4, 27, 0, 0],
    7:  [196, 18, 4, 31, 0, 0],
    8:  [242, 22, 2, 38, 2, 39],
    9:  [292, 22, 3, 36, 2, 37],
    10: [346, 26, 4, 43, 1, 44],
    // Phiên bản 11–20 (mức M): mã mời thiết bị mang khoá API thật nên cần chứa tới ~660 byte
    11: [404, 30, 1, 50, 4, 51],
    12: [466, 22, 6, 36, 2, 37],
    13: [532, 22, 8, 37, 1, 38],
    14: [581, 24, 4, 40, 5, 41],
    15: [655, 24, 5, 41, 5, 42],
    16: [733, 28, 7, 45, 3, 46],
    17: [815, 28, 10, 46, 1, 47],
    18: [901, 26, 9, 43, 4, 44],
    19: [991, 26, 3, 44, 11, 45],
    20: [1085, 26, 3, 41, 13, 42]
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
    11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
    16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90]
  };
  const dataCap = v => { const s = SPEC[v]; return s[2] * s[3] + s[4] * s[5]; };
  const remainderBits = v => (v >= 2 && v <= 6) ? 7 : (v >= 14 && v <= 20) ? 3 : 0;

  /* ---- BCH cho thông tin định dạng và phiên bản ---- */
  /** Thông tin định dạng: 5 bit dữ liệu (mức EC + mặt nạ) + 10 bit BCH, rồi XOR mặt nạ cố định */
  function formatBits(mask) {
    const data = (0b00 << 3) | mask;          // mức sửa lỗi M = 00
    let rem = data << 10;
    for (let i = 4; i >= 0; i--) if ((rem >> (10 + i)) & 1) rem ^= 0b10100110111 << i;
    return ((data << 10) | (rem & 0x3FF)) ^ 0b101010000010010;
  }
  /** Thông tin phiên bản (chỉ v7 trở lên): 6 bit dữ liệu + 12 bit BCH */
  function versionBits(v) {
    let rem = v << 12;
    for (let i = 5; i >= 0; i--) if ((rem >> (12 + i)) & 1) rem ^= 0b1111100100101 << i;
    return (v << 12) | (rem & 0xFFF);
  }

  /* ---- Dựng ma trận ---- */
  function build(version, codewords, mask) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Int8Array(size).fill(-1)); // -1 = chưa đặt
    const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };

    // Ô định vị 3 góc + vùng trống quanh nó
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const inSq = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const on = inSq && ((r === 0 || r === 6 || c === 0 || c === 6) || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(r0 + r, c0 + c, on ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // Ô căn chỉnh
    const ac = ALIGN[version];
    for (const r of ac) for (const c of ac) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        set(r + dr, c + dc, (Math.max(Math.abs(dr), Math.abs(dc)) !== 1) ? 1 : 0);
      }
    }

    // Dải định thời
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }
    set(size - 8, 8, 1); // module tối cố định

    // Chỗ dành cho thông tin định dạng (đặt tạm 0 để không bị ghi dữ liệu đè)
    for (let i = 0; i < 9; i++) { if (m[8][i] === -1) set(8, i, 0); if (m[i][8] === -1) set(i, 8, 0); }
    for (let i = 0; i < 8; i++) { set(8, size - 1 - i, 0); set(size - 1 - i, 8, 0); }

    // Thông tin phiên bản (từ v7)
    if (version >= 7) {
      const bits = versionBits(version);
      for (let i = 0; i < 18; i++) {
        const b = (bits >> i) & 1;
        set(Math.floor(i / 3), size - 11 + (i % 3), b);
        set(size - 11 + (i % 3), Math.floor(i / 3), b);
      }
    }

    // Rải dữ liệu theo đường zigzag từ góc dưới phải
    let bitIdx = 0;
    const nextBit = () => {
      if (bitIdx >= codewords.length * 8) return 0;
      const b = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
      bitIdx++; return b;
    };
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;             // bỏ qua cột định thời
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (m[row][c] !== -1) continue;
          let bit = nextBit();
          // Áp mặt nạ ngay khi đặt
          const cond = [
            (row + c) % 2 === 0,
            row % 2 === 0,
            c % 3 === 0,
            (row + c) % 3 === 0,
            (Math.floor(row / 2) + Math.floor(c / 3)) % 2 === 0,
            ((row * c) % 2) + ((row * c) % 3) === 0,
            ((((row * c) % 2) + ((row * c) % 3)) % 2) === 0,
            ((((row + c) % 2) + ((row * c) % 3)) % 2) === 0
          ][mask];
          if (cond) bit ^= 1;
          m[row][c] = bit;
        }
      }
      upward = !upward;
    }

    // Ghi thông tin định dạng — hai bản sao đúng vị trí chuẩn ISO/IEC 18004 (bit 0 = bit thấp nhất).
    // set(hàng, cột, giá trị). Bản 1: quanh ô định vị góc trên-trái; bản 2: chia giữa góc dưới-trái và góc trên-phải.
    const fb = formatBits(mask);
    const fbit = i => (fb >> i) & 1;
    for (let i = 0; i <= 5; i++) set(i, 8, fbit(i));            // cột 8, hàng 0..5
    set(7, 8, fbit(6)); set(8, 8, fbit(7)); set(8, 7, fbit(8));
    for (let i = 9; i <= 14; i++) set(8, 14 - i, fbit(i));      // hàng 8, cột 5..0
    for (let i = 0; i <= 7; i++) set(8, size - 1 - i, fbit(i)); // hàng 8, cột bên phải
    for (let i = 8; i <= 14; i++) set(size - 15 + i, 8, fbit(i)); // cột 8, hàng đáy
    set(size - 8, 8, 1);                                         // ô tối cố định
    return m;
  }

  /* ---- Chấm điểm phạt để chọn mặt nạ đẹp nhất ---- */
  function penalty(m) {
    const n = m.length; let score = 0;
    // Quy tắc 1: dãy từ 5 ô cùng màu
    for (const dir of [0, 1]) {
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b < n; b++) {
          const cur = dir ? m[b][a] : m[a][b], prev = dir ? m[b - 1][a] : m[a][b - 1];
          if (cur === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
          else run = 1;
        }
      }
    }
    // Quy tắc 2: khối 2×2 cùng màu
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    // Quy tắc 3: mẫu giống ô định vị
    const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const rpat = [...pat].reverse();
    const match = (arr, i, p) => p.every((v, k) => arr[i + k] === v);
    for (let a = 0; a < n; a++) {
      const row = [...m[a]], col = m.map(r => r[a]);
      for (let i = 0; i + 11 <= n; i++) {
        if (match(row, i, pat) || match(row, i, rpat)) score += 40;
        if (match(col, i, pat) || match(col, i, rpat)) score += 40;
      }
    }
    // Quy tắc 4: tỉ lệ ô tối lệch khỏi 50%
    let dark = 0;
    for (const row of m) for (const v of row) dark += v;
    const pct = dark * 100 / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ---- Mã hoá chuỗi thành codeword ---- */
  function encodeData(text, version) {
    const bytes = new TextEncoder().encode(text);
    const cap = dataCap(version);
    const lenBits = version >= 10 ? 16 : 8;

    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);              // chế độ byte
    push(bytes.length, lenBits);
    for (const b of bytes) push(b, 8);

    const capBits = cap * 8;
    push(0, Math.min(4, capBits - bits.length));         // dấu kết thúc
    while (bits.length % 8) bits.push(0);                // đệm cho tròn byte

    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      cw.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    }
    const PAD = [0xEC, 0x11];
    for (let i = 0; cw.length < cap; i++) cw.push(PAD[i % 2]);  // byte đệm luân phiên

    // Chia khối, sinh mã sửa lỗi, rồi đan xen
    const [, ecLen, g1, d1, g2, d2] = SPEC[version];
    const blocks = [], ecs = [];
    let p = 0;
    for (let i = 0; i < g1; i++) { const b = cw.slice(p, p + d1); p += d1; blocks.push(b); ecs.push(rsEncode(b, ecLen)); }
    for (let i = 0; i < g2; i++) { const b = cw.slice(p, p + d2); p += d2; blocks.push(b); ecs.push(rsEncode(b, ecLen)); }

    const out = [];
    const maxData = Math.max(d1, d2);
    for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
    return out;
  }

  /** Chọn phiên bản nhỏ nhất chứa vừa chuỗi */
  function pickVersion(text) {
    const len = new TextEncoder().encode(text).length;
    for (let v = 1; v <= 20; v++) {
      const overhead = 4 + (v >= 10 ? 16 : 8);
      if (len * 8 + overhead <= dataCap(v) * 8) return v;
    }
    return null;
  }

  /** Trả về ma trận 0/1 của mã QR cho chuỗi đầu vào */
  function matrix(text) {
    const version = pickVersion(text);
    if (!version) throw new Error('Nội dung quá dài cho mã QR');
    const cw = encodeData(text, version);
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(version, cw, mask);
      const s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  /** Vẽ mã QR thành SVG, kèm viền trắng bắt buộc (quiet zone 4 ô) */
  function svg(text, opts = {}) {
    const m = matrix(text);
    const n = m.length, q = 4, total = n + q * 2;
    const dark = opts.dark || '#1A1613', light = opts.light || '#ffffff';
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!m[r][c]) { c++; continue; }
        let len = 1;
        while (c + len < n && m[r][c + len]) len++;
        d += `M${c + q} ${r + q}h${len}v1h-${len}z`;
        c += len;
      }
    }
    return `<svg viewBox="0 0 ${total} ${total}" width="100%" height="100%" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${(opts.label || 'Mã QR').replace(/"/g, '')}">
      <rect width="${total}" height="${total}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  }

  // _rs/_format: lộ ra chỉ để kiểm thử đối chiếu với đáp án chuẩn của tài liệu QR
  return { matrix, svg, pickVersion, _rs: rsEncode, _format: formatBits };
})();
