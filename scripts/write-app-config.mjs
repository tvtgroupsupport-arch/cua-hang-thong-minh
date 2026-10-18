/* Ghi www/app-config.js (và appId trong capacitor.config.json cho bản Google Play) từ biến môi trường (GitHub Secrets/Variables) khi build.
   Không có CENTRAL_SUPABASE_URL → giữ bản mặc định (miễn phí, không gói cước).
   BILLING_MODE=play → bản Google Play: gói cước mua qua Google Play Billing; BẮT BUỘC có PLAY_APP_ID (package name riêng, khác bản APK chuyển khoản) — Google coi là hai app khác nhau,
   và chính sách Google Play không cho trộn chuyển khoản tay vào app phát hành trên Play. */
import { readFileSync, writeFileSync } from 'node:fs';
const env = n => (process.env[n] || '').trim();
const url = env('CENTRAL_SUPABASE_URL'), key = env('CENTRAL_SUPABASE_ANON_KEY'), mode = env('BILLING_MODE') === 'play' ? 'play' : 'manual';
const MANUAL_APP_ID = 'vn.taphoa.quanly';
if (mode === 'play' && (!url || !key)) { console.error('Bản Google Play cần CENTRAL_SUPABASE_URL và CENTRAL_SUPABASE_ANON_KEY (máy chủ gói cước)'); process.exit(1); }
if (!url || !key) { console.log('Không có CENTRAL_SUPABASE_URL/ANON_KEY → build bản MIỄN PHÍ (không gói cước).'); process.exit(0); }
if (!/^https:\/\/[A-Za-z0-9._-]+$/.test(url)) { console.error('CENTRAL_SUPABASE_URL không hợp lệ (dạng https://xxxx.supabase.co, không có dấu / cuối)'); process.exit(1); }
if (/service_role|sb_secret_/.test(key)) { console.error('Đây là khoá BÍ MẬT — chỉ được dùng khoá anon/publishable'); process.exit(1); }
const cfg = { centralUrl: url, centralAnonKey: key, supportText: env('SUPPORT_TEXT'), localTrialDays: Number(env('LOCAL_TRIAL_DAYS') || 14), billingMode: mode };
const plans = env('PLAN_PRICES');      // vd. 1:99000,6:499000,12:899000 (bản Google Play lấy giá thật từ Google, không dùng)
if (plans) cfg.plans = plans.split(',').map(s => s.split(':')).map(([m, p]) => ({ months: Number(m), price: Number(p) })).filter(x => x.months && x.price);
writeFileSync('www/app-config.js', '/* Sinh tự động khi build — không sửa tay */\nwindow.APP_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n');
console.log(`Đã ghi www/app-config.js (máy chủ trung tâm: ${url}, billingMode=${mode})`);

/* appId luôn được đặt lại đúng theo chế độ mỗi lần build (không chỉ ghi đè một chiều) để build lần lượt hai bản ở cùng một thư mục không dính appId của lần trước. */
const capFile = 'capacitor.config.json', cap = JSON.parse(readFileSync(capFile, 'utf8'));
let appId = MANUAL_APP_ID;
if (mode === 'play') {
  appId = env('PLAY_APP_ID');
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) { console.error('PLAY_APP_ID không hợp lệ (vd. vn.taphoa.quanly.play)'); process.exit(1); }
  if (appId === MANUAL_APP_ID) { console.error('PLAY_APP_ID phải KHÁC ' + MANUAL_APP_ID + ' (bản Google Play là app riêng)'); process.exit(1); }
}
cap.appId = appId; if (env('APP_NAME')) cap.appName = env('APP_NAME');
writeFileSync(capFile, JSON.stringify(cap, null, 2) + '\n');
console.log(`capacitor.config.json → appId = ${appId}`);
