/* Ghi www/app-config.js từ biến môi trường (GitHub Secrets) khi build. Không có CENTRAL_SUPABASE_URL → giữ bản mặc định (miễn phí, không gói cước). */
import { writeFileSync } from 'node:fs';
const url = (process.env.CENTRAL_SUPABASE_URL || '').trim(), key = (process.env.CENTRAL_SUPABASE_ANON_KEY || '').trim();
if (!url || !key) { console.log('Không có CENTRAL_SUPABASE_URL/ANON_KEY → build bản MIỄN PHÍ (không gói cước).'); process.exit(0); }
if (!/^https:\/\/[A-Za-z0-9._-]+$/.test(url)) { console.error('CENTRAL_SUPABASE_URL không hợp lệ (dạng https://xxxx.supabase.co, không có dấu / cuối)'); process.exit(1); }
if (/service_role|sb_secret_/.test(key)) { console.error('Đây là khoá BÍ MẬT — chỉ được dùng khoá anon/publishable'); process.exit(1); }
const plans = (process.env.PLAN_PRICES || '').trim();      // vd. 1:99000,6:499000,12:899000
const cfg = { centralUrl: url, centralAnonKey: key, supportText: (process.env.SUPPORT_TEXT || '').trim(), localTrialDays: Number(process.env.LOCAL_TRIAL_DAYS || 14) };
if (plans) cfg.plans = plans.split(',').map(s => s.split(':')).map(([m, p]) => ({ months: Number(m), price: Number(p) })).filter(x => x.months && x.price);
writeFileSync('www/app-config.js', '/* Sinh tự động khi build — không sửa tay */\nwindow.APP_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n');
console.log('Đã ghi www/app-config.js (có gói cước, máy chủ trung tâm:', url + ')');
