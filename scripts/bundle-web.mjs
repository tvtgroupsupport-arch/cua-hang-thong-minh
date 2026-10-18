/* Gộp toàn bộ JS của giao diện thành MỘT khối <script> nằm ngay trong index.html (như app BEPO), rồi xoá các tệp .js rời (www/js, native-bridge.js, app-config.js, sw.js).
   Dùng cho bản Google Play (.aab): Windows Defender từng báo nhầm (Trojan:JS/Tisifi.A) một tệp .js nhỏ đứng riêng trong .aab, còn app BEPO — đóng gói giao diện thành một index.html duy nhất — không bị.
   Chỉ dùng cho bản app Android (cầu nối native được nhúng và chỉ chạy khi có Capacitor); KHÔNG dùng cho bản chạy trên trình duyệt/PWA.
   Dùng:  node scripts/bundle-web.mjs [thư-mục-www]   (mặc định www; CI chạy ngay trước `cap sync`). Chạy một lần duy nhất trên thư mục build, không chạy trên mã nguồn đang làm việc. */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const dir = path.resolve(process.argv[2] || 'www');
const indexFile = path.join(dir, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
if (!html.includes('src="js/app.js"')) { console.error('index.html không có <script ... src="js/app.js"> (đã gộp rồi, hoặc cấu trúc đã đổi).'); process.exit(1); }

const safe = js => js.replace(/<\/script/gi, '<\/script').replace(/<!--/g, '<\!--');      // không để chuỗi trong JS đóng sớm thẻ <script>
const bundle = async entry => (await build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: ['es2019'], minify: false, write: false, logLevel: 'warning' })).outputFiles[0].text;

const appJs = await bundle(path.join(dir, 'js/app.js'));
const bridge = path.resolve('src/native/bridge.js');
const bridgeJs = await bundle(bridge);
const cfgFile = path.join(dir, 'app-config.js');
const cfgJs = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : '';

const inline =
  `<script>\n${safe(cfgJs)}\n</script>\n` +
  `<script>\n/* cầu nối native: chỉ chạy trong vỏ Capacitor */\nif (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {\n${safe(bridgeJs)}\n}\n</script>\n` +
  `<script>\n${safe(appJs)}\n</script>`;
html = html.replace(/<script src="app-config\.js"><\/script>\s*/, '').replace(/<script type="module" src="js\/app\.js"><\/script>/, () => inline);
fs.writeFileSync(indexFile, html);

for (const p of ['js', 'native-bridge.js', 'app-config.js', 'sw.js']) fs.rmSync(path.join(dir, p), { recursive: true, force: true });
const left = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : /\.(m?js)$/.test(e.name) && left.push(path.relative(dir, f)); } })(dir);
console.log(`✓ Đã gộp JS vào index.html (${(fs.statSync(indexFile).size / 1024).toFixed(0)} KB). Tệp .js còn lại: ${left.join(', ') || '(không)'}`);
