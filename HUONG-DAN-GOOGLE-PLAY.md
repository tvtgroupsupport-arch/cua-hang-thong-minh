# Gia hạn gói cước bằng Google Play Billing — hướng dẫn thiết lập

Đây là **bản app riêng** cho Google Play (package name khác bản APK chuyển khoản). Chính sách Google Play không cho trộn hai cách thu phí trong một app, nên:

| | Bản APK chuyển khoản | Bản Google Play |
|---|---|---|
| Cách gia hạn | gửi yêu cầu + chuyển khoản, admin duyệt tay | mua gói đăng ký trong app qua Google Play |
| Build | workflow *Build APK Android* | workflow *Build bản Google Play (AAB)* |
| `billingMode` | `manual` (mặc định) | `play` |
| package name | `vn.taphoa.quanly` | `PLAY_APP_ID` (vd. `vn.taphoa.quanly.play`) |

Cả hai dùng chung một Supabase trung tâm (xem `HUONG-DAN-TU-DONG-SUPABASE.md` mục A) — một chủ cửa hàng chỉ nên dùng **một** nguồn thu phí tại một thời điểm.

**Trạng thái thật:** code đã chạy thử với Postgres thật (SQL ghi nhận giao dịch, dùng thử 1 lần/máy, quyền) và với Google Play **giả lập** ở phía app (`test/plan.html`, 16 kiểm tra), bản vá plugin đã áp dụng thử trên mã thật của `@capgo/native-purchases@7.19.3`, và script ký/R8 đã chạy thử trên dự án Android do `cap add android` sinh ra. **Chưa** chạy với Google thật: hai Edge Function (`verify-purchase`, `rtdn-webhook`) chưa được deploy/thử, chưa mua hàng thật trên điện thoại. Hãy thử ở **Internal testing** (không mất tiền thật) trước khi phát hành.

## Luồng hoạt động
```
Điện thoại                     Supabase TRUNG TÂM                    Google
App bấm "Mua gói"
  → Play Billing ───────────────────────────────────────────→  hộp thoại mua hàng
  ← purchaseToken ←─────────────────────────────────────────   (khách xác nhận)
  → verify-purchase ──→ hỏi Google: token thật không? gói nào, còn hạn tới khi nào?
                    ←── Google trả trạng thái → xác nhận (acknowledge) → ghi bảng subscriptions
  ← "đã kích hoạt"
(sau này) Google gửi RTDN qua Pub/Sub ──→ rtdn-webhook tự cập nhật: gia hạn / huỷ / hết hạn / hoàn tiền
```
App **không bao giờ** tự quyết "đã mua" — chỉ máy chủ (sau khi tự hỏi lại Google) mới ghi nhận. Mỗi lần mở màn Gói cước / bấm "Kiểm tra lại" / quay lại app, app gửi các giao dịch đang có trên máy lên máy chủ xác minh (cài lại app vẫn không mất gói). Có chặn: mua trùng gói đang có, mua khi đang có gói khác (Google tính tiền cả hai), ưu đãi dùng thử đã hết, mỗi máy chỉ dùng thử miễn phí 1 lần (so mã băm của Android ID).

## Bước 1 — Play Console: app riêng + 3 gói đăng ký
1. Tạo ứng dụng MỚI trên Play Console. Ghi lại **package name** — đặt vào GitHub → Settings → Secrets and variables → Actions → **Variables** → `PLAY_APP_ID` (bắt buộc, phải khác `vn.taphoa.quanly`).
2. **Monetize → Subscriptions**: tạo đúng 3 gói với **Product ID** (gõ đúng chữ):
   `goi_1_thang` · `goi_6_thang` · `goi_12_thang`
3. Mỗi gói cần ít nhất một **base plan** đang Active, với **Base plan ID** đúng: `goi-1-thang`, `goi-6-thang`, `goi-12-thang` (chữ thường, số, gạch ngang — plugin bắt buộc khi mua gói đăng ký).
4. (Tuỳ chọn) gói 1 tháng thêm **ưu đãi dùng thử miễn phí** có Offer ID `free-trial` (nếu đặt mã khác, đặt secret `TRIAL_OFFER_ID` cho `verify-purchase`).
   Muốn đổi mã gói / thêm gói: sửa bảng `play_products` trong `supabase/central-setup.sql` và `PRODUCT_IDS`, `BASE_PLANS` trong `www/js/cloud/play-billing.js` cho khớp.

## Bước 2 — Google Cloud: tài khoản dịch vụ (service account)
Mục đích: để máy chủ (Edge Function `verify-purchase`) **hỏi lại Google** xem mã giao dịch có thật không. Làm lần lượt:

**2.1 — Tạo/chọn dự án Google Cloud và bật API**
1. Vào https://console.cloud.google.com (đăng nhập cùng tài khoản Google đang dùng Play Console).
2. Thanh trên cùng → chọn dự án → **New project** (tên tuỳ ý, vd. `tap-hoa-play`) → Create, rồi chọn dự án đó.
3. Menu ☰ → **APIs & Services → Library** → tìm **Google Play Android Developer API** → **Enable**.

**2.2 — Tạo service account + khoá JSON**
1. Menu ☰ → **IAM & Admin → Service Accounts → Create service account**.
2. Đặt tên (vd. `play-billing`) → **Create and continue** → bỏ qua phần chọn quyền (không cần gán role nào) → **Done**.
3. Bấm vào tài khoản vừa tạo → **chép địa chỉ email** của nó (dạng `play-billing@tap-hoa-play.iam.gserviceaccount.com`) — cần ở bước 2.3.
4. Tab **Keys → Add key → Create new key → JSON → Create**: trình duyệt tải về một tệp `.json`. **Tệp này cho toàn quyền xem/xử lý giao dịch thật — giữ kín, không commit vào git, không gửi qua chat/email.**
   Nếu báo "Service account key creation is disabled" (chính sách tổ chức), cần bật quyền tạo khoá cho tổ chức hoặc dùng dự án Google Cloud cá nhân.

**2.3 — Cấp quyền cho service account trong Play Console**
(Trang *Setup → API access* cũ đã bị Google gỡ ở nhiều tài khoản; cách dưới đây dùng được ở mọi tài khoản.)
1. Play Console → **Users and permissions** (Người dùng và quyền) → **Invite new users**.
2. Ô email: dán **email service account** ở bước 2.2.3.
3. Tab **App permissions** → **Add app** → chọn app Tạp Hóa của bạn → **Apply**, rồi tích các quyền:
   - **View app information and download bulk reports (read-only)**
   - **View financial data, orders, and cancellation survey responses**
   - **Manage orders and subscriptions** — *cần để máy chủ xác nhận (acknowledge) giao dịch; thiếu quyền này Google tự hoàn tiền sau 3 ngày*
   - (chỉ nếu dùng tính năng tự tải `.aab` bằng CI) **Release to testing tracks**
4. **Invite user** → **Send invitation** (service account được chấp nhận tự động, không cần mở email).
5. Quyền có thể mất từ vài phút tới **vài giờ** (hiếm khi lâu hơn) mới có hiệu lực — đừng vội kết luận lỗi nếu bước thử sau báo "permission denied/401/403".

**2.4 — Cất tệp JSON an toàn**
Chép tệp `.json` vào thư mục `play-store/` của dự án (đã nằm trong `.gitignore`, cạnh khoá ký) và sao lưu nơi an toàn. Bước 4 sẽ đặt nội dung tệp này thành secret `PLAY_SERVICE_ACCOUNT_JSON` trên Supabase (và trên GitHub nếu dùng tự tải lên).

## Bước 3 — Supabase trung tâm: chạy lại script SQL
SQL Editor → chạy lại toàn bộ `supabase/central-setup.sql` mới nhất (chạy lại nhiều lần vẫn an toàn). Việc này thêm bảng `play_purchases`, `play_products`, `trial_devices`, `denied_trial_tokens`, các hàm `record_play_purchase`, `find_play_purchase_owner`, `claim_trial_use` (chỉ service_role gọi được) và cột `subscriptions.source` / `bonus_until`.

## Bước 4 — Deploy 2 Edge Function (cần Supabase CLI)
```bash
npm install -g supabase
supabase login
supabase link --project-ref <mã-dự-án-trung-tâm>
```
Đặt secret (giá trị bí mật, không nằm trong code):
```bash
supabase secrets set PLAY_PACKAGE_NAME=<PLAY_APP_ID>
supabase secrets set PLAY_SERVICE_ACCOUNT_JSON="$(cat duong-dan-file-json-buoc-2.json)"
supabase secrets set RTDN_SECRET="$(openssl rand -hex 24)"      # ghi lại giá trị này, cần ở Bước 5
```
Deploy:
```bash
supabase functions deploy verify-purchase
supabase functions deploy rtdn-webhook --no-verify-jwt
```
`rtdn-webhook` bắt buộc `--no-verify-jwt` (Pub/Sub không gửi JWT Supabase; hàm tự kiểm `RTDN_SECRET` trong đường dẫn).

## Bước 5 — Pub/Sub: nhận thông báo real-time (RTDN)
Không có bước này app không biết khi nào khách **huỷ** gói trên Google — vẫn tưởng còn hạn mãi.
1. Google Cloud → **Pub/Sub → Topics → Create topic** (vd. `play-rtdn`).
2. Play Console → app → **Monetize setup → Real-time developer notifications** → dán `projects/<project-id>/topics/play-rtdn` → Save. (Cấp quyền publish cho `google-play-developer-notifications@system.gserviceaccount.com` trên topic nếu Play yêu cầu.)
3. Pub/Sub → topic → **Create subscription**: Delivery type **Push**, Endpoint `https://<project-ref>.functions.supabase.co/rtdn-webhook?secret=<RTDN_SECRET>`.

## Bước 6 — Khoá ký + build bản Google Play
Play Billing chỉ chạy với app **đã ký** cài qua chính Play Store. Trên máy có Java:
```bash
keytool -genkey -v -keystore release.keystore -alias taphoa -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore > release.keystore.b64      # Windows: certutil -encode
```
GitHub → Secrets: `ANDROID_KEYSTORE_BASE64` (nội dung file .b64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (= `taphoa`), `ANDROID_KEY_PASSWORD`; cùng `CENTRAL_SUPABASE_URL` + `CENTRAL_SUPABASE_ANON_KEY` (khoá anon/publishable) nếu chưa có. **Giữ kỹ `release.keystore` — mất là không cập nhật được app đã phát hành.**

Actions → **Build bản Google Play (AAB)** → Run workflow → tải `tap-hoa-play-aab` ở Artifacts. (Chưa có khoá ký, workflow chỉ build APK debug để xem giao diện — Billing không chạy.) Workflow tự: vá plugin (dừng nếu vá không được), ghi cấu hình `billingMode=play` + `appId` riêng, tạo biểu tượng, ký, bật R8 (mapping.txt), nâng targetSdk 36 / minSdk 24, đặt `versionCode` = số lần chạy.

## Bước 7 — Thử ở Internal testing (KHÔNG mất tiền thật)
1. Tải `.aab` lên Play Console → **Testing → Internal testing** → tạo bản phát hành; thêm email Google của bạn vào **testers**.
2. Play Console → **Setup → License testing**: thêm tài khoản Google đang thử (giao dịch thành "giao dịch thử", không trừ tiền).
3. Cài app **qua đúng link Internal testing** (không sideload), mở **Thêm → Gói cước & tài khoản** → đăng ký/đăng nhập tài khoản lưu trữ → bấm mua từng gói → phải hiện "Đã kích hoạt gói cước" và hạn đúng.
4. Huỷ gói trong Google Play → vài phút sau xem bảng `play_purchases` / `subscriptions` trên Supabase tự cập nhật (nhờ RTDN) — đây là bước quan trọng nhất để biết cả chuỗi đã thông.
5. Dùng nút **Chẩn đoán** ở màn Gói cước nếu có lỗi (kiểm tra mạng, khoá, hàm gói cước, quyền).

## Sự cố thường gặp
| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| "Google Play Billing không khả dụng" | cài bằng APK trực tiếp; phải cài qua Play (kể cả Internal testing) |
| "Google Play trả về N gói nhưng không khớp mã gói cước" | Product ID/Base plan ID sai chữ, gói chưa Active, hoặc tài khoản Google chưa là tester |
| "Không xác minh được với Google" | `PLAY_SERVICE_ACCOUNT_JSON` dán thiếu/sai, hoặc service account chưa được **Grant access** đúng app; Play API chưa bật |
| "Giao dịch này không thuộc về tài khoản đang đăng nhập" | mua bằng tài khoản lưu trữ khác; đăng nhập đúng tài khoản đã mua |
| Huỷ gói trên Google mà app vẫn còn hạn | Pub/Sub subscription lỗi (xem *Unacked messages*) hoặc `RTDN_SECRET` sai — `supabase functions logs rtdn-webhook` |
| Không thấy "Dùng thử miễn phí" dù đã tạo ưu đãi | plugin chưa được vá (build bằng workflow Play sẽ tự vá), hoặc tài khoản Google đã dùng ưu đãi |
| `supabase functions logs verify-purchase` | xem lỗi thật từ máy chủ — các thông báo đều mô tả rõ nguyên nhân |

## Chưa làm so với BEPO
Mã quyền sử dụng **có chữ ký Ed25519** (`license-token`) — hạn gói ở đây là dữ liệu thường (đủ cho rào cản cơ bản, người rành kỹ thuật có thể sửa trên máy mình); Google Play Billing chạy ở bản app riêng nên bản APK chuyển khoản vẫn dùng cách duyệt tay.

## Tải `.aab` lên Google Play bằng dòng lệnh / CI (không cần tải về máy)
Workflow **Build bản Google Play (AAB)** có thêm ô **upload** khi bấm *Run workflow* (và chọn **track**: `internal` mặc định). Bật `upload` thì sau khi build xong, workflow tự tải `.aab` (kèm `mapping.txt`) lên Play Console ở trạng thái **bản nháp** bằng `r0adkll/upload-google-play`; bạn vào Play Console xem lại rồi bấm phát hành.
Điều kiện:
1. GitHub Secret `PLAY_SERVICE_ACCOUNT_JSON` = nội dung file JSON của tài khoản dịch vụ (cùng loại file ở Bước 2).
2. Play Console → **Users and permissions**: mời email của tài khoản dịch vụ và cấp quyền **Release to testing tracks** (và **Release apps to production** nếu dùng track `production`) cho app.
3. **Bản phát hành đầu tiên của app mới phải tạo tay trên Play Console** (tải tay một `.aab` và hoàn tất mục thiết lập app); từ lần sau CI tự tải lên được. Chưa làm được bước 3 thì API báo lỗi kiểu "package not found".
Cách chạy bằng dòng lệnh nếu máy có GitHub CLI: `gh workflow run android-play.yml -f upload=true -f track=internal`.
