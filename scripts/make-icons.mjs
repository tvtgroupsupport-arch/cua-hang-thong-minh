/* Sinh biểu tượng Android (launcher) từ www/icon.svg bằng `sharp`. Chạy sau `npx cap add android`; chạy lại nhiều lần không sao.
   • mipmap-(mật độ)/ic_launcher.png, ic_launcher_round.png : biểu tượng cho Android 7 trở xuống
   • mipmap-(mật độ)/ic_launcher_foreground.png + nền gradient (drawable) : biểu tượng thích ứng (adaptive) cho Android 8+
   Thiếu `sharp` hoặc thư mục android/ → bỏ qua (giữ biểu tượng mặc định), không làm hỏng build. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd(), RES = path.join(ROOT, 'android/app/src/main/res');
if (!fs.existsSync(RES)) { console.log('Chưa có thư mục android/ — bỏ qua tạo biểu tượng.'); process.exit(0); }
let sharp;
try { sharp = (await import('sharp')).default; } catch (e) { console.warn('::warning::Không có thư viện sharp — giữ biểu tượng mặc định của Capacitor'); process.exit(0); }

const iconSvg = fs.readFileSync(path.join(ROOT, 'www/icon.svg'));
/* Lớp trước của biểu tượng thích ứng: chỉ túi + mặt cười + tia sáng, nằm gọn trong vùng an toàn 66% (Android cắt tròn/vuông bo tuỳ máy). */
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="34 11 494 494">
  <defs><linearGradient id="face" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#4f6df5"/></linearGradient>
  <linearGradient id="spark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="#ff8a5c"/></linearGradient></defs>
  <path d="M202 200V176a54 54 0 0 1 108 0v24" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round"/>
  <path d="M148 196H364L384 372Q387 406 352 406H160Q125 406 128 372Z" fill="#fff"/>
  <circle cx="216" cy="276" r="14" fill="url(#face)"/><circle cx="296" cy="276" r="14" fill="url(#face)"/>
  <path d="M212 318Q256 362 300 318" fill="none" stroke="url(#face)" stroke-width="22" stroke-linecap="round"/>
  <path d="M394 112l11 29 29 11-29 11-11 29-11-29-29-11 29-11z" fill="url(#spark)"/></svg>`;

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
let n = 0;
for (const [d, k] of Object.entries(dens)) {
  const dir = path.join(RES, 'mipmap-' + d); fs.mkdirSync(dir, { recursive: true });
  const s = Math.round(48 * k), big = Math.round(108 * k);
  const sq = await sharp(iconSvg, { density: 384 }).resize(s, s).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), sq);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/></svg>`);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), await sharp(sq).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer());
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), await sharp(Buffer.from(fg), { density: 384 }).resize(big, big).png().toBuffer());
  n += 3;
}
fs.mkdirSync(path.join(RES, 'drawable'), { recursive: true });
fs.writeFileSync(path.join(RES, 'drawable/ic_launcher_bg_grad.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <gradient android:angle="315" android:startColor="#9B6BFF" android:endColor="#4F6DF5" />\n</shape>\n');
const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@drawable/ic_launcher_bg_grad" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n';
const any = path.join(RES, 'mipmap-anydpi-v26'); fs.mkdirSync(any, { recursive: true });
fs.writeFileSync(path.join(any, 'ic_launcher.xml'), adaptive); fs.writeFileSync(path.join(any, 'ic_launcher_round.xml'), adaptive);
console.log(`✓ Đã tạo biểu tượng Android (${n} ảnh + nền gradient)`);
