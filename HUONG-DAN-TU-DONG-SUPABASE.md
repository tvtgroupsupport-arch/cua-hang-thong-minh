# Gói cước + tự tạo Supabase cho cửa hàng (phương án OAuth, theo app BEPO)

Có **hai Supabase** khác nhau:

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│  Supabase TRUNG TÂM      │        │  Supabase CỦA TỪNG CỬA HÀNG   │
│  (của nhà cung cấp)      │        │  (chủ cửa hàng sở hữu)        │
│  • tài khoản chủ cửa hàng│        │  • toàn bộ dữ liệu bán hàng   │
│  • gói cước, gia hạn     │        │  • đọc/ghi cần KHOÁ RIÊNG của │
│  • địa chỉ kho từng quán │        │    từng máy — bạn không đọc   │
│  • Edge Function tạo kho │        │    được                       │
└──────────────────────────┘        └──────────────────────────────┘
```

Không cấu hình trung tâm (để trống `centralUrl`) → app là **bản miễn phí**: không gói cước, không khoá. Các bước bên dưới chỉ cần khi bạn muốn thu phí theo gói và/hoặc cho chủ cửa hàng "bấm một lần là có kho dữ liệu".

## A. Dựng Supabase trung tâm (một lần)
1. Tạo dự án Supabase mới → **SQL Editor** → dán toàn bộ `supabase/central-setup.sql` → **Run** (chạy lại nhiều lần vẫn an toàn). `trial_days` (mặc định 14) = số ngày dùng thử của tài khoản mới.
2. Authentication → Providers → Email: nên **bật "Confirm email"**.
3. Mở `admin/index.html` bằng trình duyệt → nhập Project URL + khoá **anon/publishable** → *Chưa có tài khoản? Tạo mới* → tạo tài khoản của bạn, rồi chạy trong SQL Editor (thay email):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'email-cua-ban@example.com';
   ```
   Đăng nhập lại trang admin: thấy danh sách chủ cửa hàng, yêu cầu gia hạn chờ duyệt, nút **+1 / +6 / +12 tháng**.
4. GitHub repo → Settings → Secrets and variables → Actions → thêm:
   | Secret | Giá trị |
   |---|---|
   | `CENTRAL_SUPABASE_URL` | `https://xxxx.supabase.co` (không có dấu `/` cuối) |
   | `CENTRAL_SUPABASE_ANON_KEY` | khoá anon/publishable — **không** phải service_role/secret |
   | `SUPPORT_TEXT` | (tuỳ chọn) hướng dẫn chuyển khoản hiện trong màn Gói cước |
   | `PLAN_PRICES` | (tuỳ chọn) giá hiện kèm tên gói, vd. `1:99000,6:499000,12:899000` |
   
   Chạy lại workflow *Build APK Android*: app có mục **Thêm → Gói cước & tài khoản**.

## B. Cách gói cước hoạt động
- Chủ cửa hàng tạo **tài khoản lưu trữ** (email + mật khẩu) trong app → được dùng thử `trial_days` ngày. Chưa tạo tài khoản: dùng thử cục bộ 14 ngày từ lần đầu mở app.
- Muốn gia hạn: chọn gói 1/6/12 tháng → chuyển khoản theo `SUPPORT_TEXT` → bấm **Gửi yêu cầu gia hạn**. Bạn nhận tiền rồi vào `admin/index.html` bấm **Duyệt** → hạn = hạn cũ (hoặc hôm nay nếu đã hết) + số tháng.
- Hết hạn → **khoá mềm**: vẫn đăng nhập, xem và xuất báo cáo; chặn bán hàng, trả hàng, nhập/xuất hủy kho, thu chi, mở ca, thu nợ. Máy phụ theo hạn của máy chủ cửa hàng (hạn được đồng bộ trong cài đặt dùng chung).
- Chống chỉnh lùi đồng hồ: app nhớ mốc thời gian lớn nhất từng thấy (kể cả giờ máy chủ).
- **Giới hạn thật:** mã nguồn nằm trên máy khách nên người rành kỹ thuật vẫn gỡ được đoạn kiểm tra — đây là rào cản cơ bản, không phải chống crack tuyệt đối. (Bản BEPO còn có chữ ký Ed25519 và Google Play Billing; app này **chưa** có hai phần đó.)

## C. Tự tạo kho Supabase cho cửa hàng (OAuth)
Chủ cửa hàng (đã đăng nhập tài khoản lưu trữ) vào **Thêm → Đồng bộ nhiều máy → "Tạo tự động"**. App mở trang Supabase để họ bấm **Authorize một lần**, máy chủ trung tâm tự tạo dự án, chạy script SQL đồng bộ (do app gửi kèm), kiểm tra, rồi trả địa chỉ + khoá anon; app liên kết và đẩy dữ liệu lên.

```
App ──provision-start (kèm script SQL)──▶ trả đường dẫn uỷ quyền ──▶ trình duyệt: Authorize
Supabase ──▶ provision-callback (đổi code lấy token bằng client secret, cất tạm trong provision_jobs)
App ──provision-step (lặp 3–5 giây/lần)──▶ tổ chức → tạo dự án → chờ khởi động → khoá anon → chạy SQL → kiểm tra hàm → done
App nhận url + anon_key → liên kết (connectOwner) và đẩy dữ liệu
```
Token của Supabase **chỉ nằm trên máy chủ trung tâm** (bảng `provision_jobs`, không client nào đọc được) và bị xoá cùng script SQL ngay khi xong. Script SQL chạy **trên dự án của chính chủ cửa hàng**, không đụng tới trung tâm. Chỉ nhận tổ chức Supabase mà **email của chủ cửa hàng là chủ/quản trị** (tránh tạo nhầm vào tài khoản khác đang đăng nhập sẵn trong trình duyệt).

### Thiết lập (một lần, nhà cung cấp)
1. **OAuth App**: supabase.com → tổ chức của bạn → **OAuth Apps** → Add application.

   | Mục | Giá trị |
   |---|---|
   | Redirect URIs | `https://<project-ref>.supabase.co/functions/v1/provision-callback` (project-ref của Supabase **trung tâm**) |
   | Scopes | Organizations: **Read** · Projects: **Read, Write** · Database: **Write** · Secrets: **Read** |

   Supabase hiện **Client ID** và **Client Secret** — chép lại ngay (secret chỉ hiện một lần).
2. Đặt secret (tên **không** được bắt đầu bằng `SUPABASE_`):
   ```bash
   supabase secrets set SB_OAUTH_CLIENT_ID=<client id>
   supabase secrets set SB_OAUTH_CLIENT_SECRET=<client secret>
   ```
3. Deploy 3 hàm (từ thư mục dự án, đã `supabase link` tới dự án trung tâm):
   ```bash
   supabase functions deploy provision-start
   supabase functions deploy provision-callback --no-verify-jwt
   supabase functions deploy provision-step
   ```
   `provision-callback` **bắt buộc** `--no-verify-jwt` vì trình duyệt quay về từ Supabase không mang JWT của app.

### Giới hạn & sự cố
- Chủ cửa hàng vẫn phải **có tài khoản Supabase** (đăng ký ~1 phút) và dùng **đúng email** của tài khoản lưu trữ. Supabase báo "No organizations found" → tạo một organization (gói Free) rồi bấm *Tiếp tục*.
- Gói Free giới hạn số dự án đang hoạt động; đã đủ thì app báo rõ, bấm *Tiếp tục* sau khi xoá/tạm dừng một dự án cũ — **không tạo trùng** (phiên dở dang được nối lại).
- Dự án mới khởi động 1–2 phút. Mật khẩu CSDL sinh ngẫu nhiên và không lưu ở đâu (app chỉ dùng khoá anon).
- Không muốn dựng trung tâm: dùng cách **mã truy cập cá nhân** (Thêm → Đồng bộ nhiều máy → "Tự động tạo & liên kết") hoặc làm thủ công 3 bước.

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| "Máy chủ chưa cấu hình kết nối Supabase" | Chưa đặt `SB_OAUTH_CLIENT_ID`/`SB_OAUTH_CLIENT_SECRET` |
| Trang Supabase báo `redirect_uri` không hợp lệ | Redirect URI không khớp **từng ký tự** với `…/functions/v1/provision-callback` |
| "Supabase từ chối quyền" | Thiếu scope, hoặc chưa bấm Authorize |
| "Thiếu hoặc sai script SQL" (400) | App cũ — cập nhật lên bản mới nhất |
| Dừng ở "Đang dựng bảng dữ liệu" | Dự án vừa khởi động chưa nhận kết nối; app tự thử lại, chờ 1–2 phút |

## D. Chưa kiểm chứng
Đã kiểm thử bằng **Postgres thật (PGlite)** cho `central-setup.sql` (RLS, duyệt gia hạn, quyền admin) và bằng Edge Function/Management API **giả lập** cho phía app (`test/plan.html`). **Chưa** chạy với Supabase thật, chưa deploy 3 Edge Function (viết theo mã đã chạy thật ở BEPO, chỉ đổi phần script SQL và bước kiểm tra cuối) và chưa thử vòng OAuth thật.
