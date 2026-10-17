/* Cấu hình do nhà cung cấp phần mềm điền khi build (CI ghi đè từ GitHub Secrets CENTRAL_SUPABASE_URL / CENTRAL_SUPABASE_ANON_KEY / SUPPORT_TEXT / PLAN_PRICES).
   Để trống centralUrl = app chạy MIỄN PHÍ, không có gói cước, không có tài khoản lưu trữ (chỉ còn cách liên kết Supabase bằng mã cá nhân). */
window.APP_CONFIG = { centralUrl: '', centralAnonKey: '', supportText: '', localTrialDays: 14 };
