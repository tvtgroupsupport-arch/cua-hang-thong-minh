/* Kiểm tra tương thích trang bộ nhớ 16 KB (Google Play bắt buộc với app nhắm Android 15+): mọi thư viện native 64-bit (.so trong arm64-v8a, x86_64) phải có các đoạn PT_LOAD
   căn lề ≥ 0x4000 (16 KB). Lỗi trên Play Console: "Ứng dụng của bạn không hỗ trợ kích thước trang bộ nhớ 16 KB".
   Dùng:  node scripts/check-16kb.mjs <tệp .aab/.apk/.zip | thư mục chứa .so>      Thoát mã 1 nếu có thư viện không đạt (kèm annotation cho GitHub Actions).
   Cần lệnh `unzip` khi đối số là tệp nén (có sẵn trên máy chủ build Ubuntu). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = process.argv[2];
if (!arg || !fs.existsSync(arg)) { console.error('Dùng: node scripts/check-16kb.mjs <tệp .aab/.apk hoặc thư mục>'); process.exit(2); }
let dir = arg, tmp = null;
if (fs.statSync(arg).isFile()) { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chk16-')); execFileSync('unzip', ['-q', '-o', arg, '*.so', '-d', tmp], { stdio: ['ignore', 'ignore', 'inherit'] }); dir = tmp; }

const sos = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : e.name.endsWith('.so') && sos.push(f); } })(dir);

/** Trả { bits, minAlign } từ bảng chương trình ELF (các đoạn PT_LOAD). */
function elfAlign(file) {
  const b = fs.readFileSync(file);
  if (b.length < 64 || b.readUInt32BE(0) !== 0x7f454c46) return null;
  const is64 = b[4] === 2, le = b[5] === 1;
  const r16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o), r32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o), r64 = o => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  const phoff = is64 ? r64(0x20) : r32(0x1c), phentsize = is64 ? r16(0x36) : r16(0x2a), phnum = is64 ? r16(0x38) : r16(0x2c);
  const aligns = [];
  for (let i = 0; i < phnum; i++) { const o = phoff + i * phentsize; if (r32(o) === 1) aligns.push(is64 ? r64(o + 0x30) : r32(o + 0x1c)); }
  return { bits: is64 ? 64 : 32, minAlign: aligns.length ? Math.min(...aligns) : 0 };
}

let bad = 0, checked = 0;
for (const f of sos.sort()) {
  const info = elfAlign(f); if (!info) continue;
  const rel = path.relative(dir, f).split(path.sep).join('/');
  if (info.bits !== 64) { console.log(`  · ${rel} (32-bit, không cần)`); continue; }      // máy 16 KB chỉ chạy 64-bit
  checked++;
  if (info.minAlign >= 0x4000) console.log(`  ✔ ${rel} (căn lề 0x${info.minAlign.toString(16)})`);
  else { bad++; console.log(`  ✘ ${rel} căn lề 0x${info.minAlign.toString(16)} < 0x4000`); console.log(`::error title=Thư viện không hỗ trợ 16 KB::${rel} căn lề 0x${info.minAlign.toString(16)} (cần ≥ 0x4000) — loại bỏ hoặc nâng cấp thư viện chứa nó`); }
}
if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nĐã kiểm tra ${checked} thư viện 64-bit: ${bad ? bad + ' KHÔNG đạt 16 KB' : 'tất cả đạt 16 KB'}.`);
process.exit(bad ? 1 : 0);
