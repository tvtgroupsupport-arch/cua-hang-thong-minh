# Tạp Hóa – Ứng dụng quản lý cửa hàng tạp hóa

Bán hàng, kho, công nợ, ca làm việc, khuyến mãi và báo cáo cho cửa hàng tạp hóa. **Chạy hoàn toàn offline** — dữ liệu lưu ngay trên thiết bị (IndexedDB).
Làm theo kế hoạch trong [PLAN.md](PLAN.md), tham khảo kiến trúc của app BEPO (Capacitor + JS thuần).

## Chạy thử ngay (không cần cài gì thêm)
```powershell
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
```
Mở http://localhost:8080/ — lần đầu app dẫn thiết lập cửa hàng (có tuỳ chọn nạp dữ liệu mẫu 30 ngày).
Trên điện thoại: mở địa chỉ máy tính trong cùng Wi-Fi, bấm "Thêm vào màn hình chính" (PWA, dùng được khi mất mạng).

**Kiểm thử lõi nghiệp vụ:** mở http://localhost:8080/test/index.html — 48 kiểm tra (bán hàng, kho/lô/HSD, khuyến mãi, nợ, trả hàng, ca, quyền, CSV, sao lưu, bất biến sổ sách…) chạy ngay trong trình duyệt.

## Đóng gói APK (Android)
Cần Node 20+, Java 21, Android SDK — hoặc dùng GitHub Actions (đẩy lên repo → Actions → *Build APK Android* → Run workflow → tải `app-debug.apk`).
```bash
npm install
npx cap add android      # lần đầu
npm run apk              # đóng gói cầu nối native (esbuild) → cap sync → vá quyền/phiên bản Manifest → gradlew assembleDebug
```
Giao diện là tệp tĩnh trong `www/` (không bundle). Riêng cầu nối plugin Android (`src/native/bridge.js`) được esbuild đóng gói thành `www/native-bridge.js` khi chạy `npm run build` / CI, và chỉ được nạp khi chạy trong vỏ Capacitor.

## Cấu trúc
```
www/
  index.html, css/app.css, sw.js, manifest.webmanifest   giao diện + PWA
  js/store.js        kho dữ liệu trong bộ nhớ + ghi bền IndexedDB, giao dịch có hoàn tác
  js/engine/         NGHIỆP VỤ (không đụng DOM, đã có kiểm thử)
    auth · products · stockcore · inventory · people · promos · sales · cash · reports · demo
  js/views/          các màn hình (pos, products, stock, reports, people, promos, cash, settings, more, sales, login)
  js/ui.js · native.js · receipt.js · lib/(qr, vietqr)   thư viện giao diện, cầu nối thiết bị, hoá đơn, mã QR VietQR
test/                kiểm thử chạy trong trình duyệt
```

## Đã làm so với kế hoạch
| Nhóm | Trạng thái |
|---|---|
| POS: quét camera / máy quét Bluetooth-USB, tìm không dấu, giỏ, đơn vị lẻ-lốc-thùng, giá sỉ & bậc giá, hàng cân + mã cân, giảm giá dòng/đơn, đơn treo, khách, mã giảm giá, đổi điểm | ✅ |
| Thanh toán: tiền mặt (tiền thừa), VietQR, chuyển khoản, ghi nợ, hỗn hợp; làm tròn; hạn mức nợ | ✅ |
| Hoá đơn: in (HTML/in nhiệt best-effort), chia sẻ, trả hàng (nhập lại kho / hàng hỏng, trừ nợ), huỷ hoá đơn | ✅ |
| Hàng hóa: đa mã vạch, đa đơn vị, lô & HSD (xuất lô gần hạn trước), nhóm nhiều cấp, đổi giá hàng loạt, lịch sử giá, nhập/xuất CSV | ✅ |
| Kho: nhập hàng (giá vốn bình quân/gần nhất, chiết khấu, công nợ NCC), trả NCC, kiểm kho (quét), xuất hủy, điều chỉnh, thẻ kho, cảnh báo hết/sắp hết/cận date/tồn lâu, gợi ý đặt hàng | ✅ |
| Khách hàng & NCC: sổ nợ, thu/trả nợ (khoản cũ trước), tuổi nợ, nhắc nợ, tích điểm | ✅ |
| Khuyến mãi: %, tiền, mua X tặng Y, combo, mã, theo ngày/giờ/nhóm khách, giới hạn lượt | ✅ |
| Ca làm việc, sổ quỹ (tiền mặt/ngân hàng), thu chi, biên bản chốt ca | ✅ |
| Báo cáo: tổng quan, doanh thu/lãi gộp/lãi ròng, giờ cao điểm, theo thu ngân, hàng bán chạy/chậm, ABC, nhập-xuất-tồn, công nợ, hao hụt, xuất CSV | ✅ |
| Nhân viên & phân quyền chi tiết, PIN, nhật ký, sao lưu/khôi phục, giao diện sáng/tối, hướng dẫn trong app | ✅ |
| In tem mã vạch/tem giá (EAN-13, EAN-8, UPC-A, Code 128), in hoá đơn dạng ảnh (đúng dấu tiếng Việt), nút Back Android, tăng sáng khi hiện QR | ✅ |
| Đồng bộ nhiều máy qua Supabase, chuyển kho, đa ngôn ngữ, gói cước | ⏳ Giai đoạn 3 — chưa làm |

## Giới hạn đã biết — đọc trước khi dùng thật
- **Chưa chạy trên điện thoại/máy in thật.** Lõi nghiệp vụ và giao diện đã kiểm thử trong trình duyệt (desktop + khung hình điện thoại). Chưa build APK (máy phát triển không có Node/Java/Android SDK). Các phần phụ thuộc phần cứng cần thử thực tế trước khi tin dùng: **quét bằng camera** (ML Kit trên Android; trình duyệt dùng `BarcodeDetector`, chỉ có ở Chrome/Android), **in Bluetooth** (`capacitor-thermal-printer` — cách gọi chưa thử), lưu/chia sẻ tệp qua Filesystem/Share. Máy quét mã vạch Bluetooth/USB kiểu bàn phím và in qua hộp thoại hệ thống thì không phụ thuộc plugin.
- **Dữ liệu chỉ nằm trên thiết bị.** Mất máy/xoá dữ liệu trình duyệt là mất — hãy dùng *Cài đặt → Sao lưu ra tệp* đều đặn (app nhắc sau 7 ngày). Chưa có đồng bộ đám mây/nhiều máy.
- Nhập danh mục dùng **CSV** (Excel → Lưu thành CSV UTF-8), chưa đọc trực tiếp .xlsx.
- Mã BIN ngân hàng cho VietQR trong danh sách có sẵn nên được đối chiếu lại; hãy dùng nút *Xem thử mã QR* rồi quét bằng app ngân hàng để chắc chắn đúng tài khoản.
- Đăng nhập chỉ nhằm phân quyền thao tác trên thiết bị, không phải bảo mật chống người có máy trong tay (phiên được nhớ để khỏi phải đăng nhập lại; bấm ổ khoá để khoá).
- Doanh thu/lợi nhuận tính theo **ngày bán** của hoá đơn gốc (hàng trả được trừ vào hoá đơn đó); giá vốn là bình quân gia quyền hoặc giá nhập gần nhất tuỳ cài đặt.

## Bài học rút ra từ app BEPO (đã áp dụng)
- **In bằng ảnh, không in chữ ESC/POS**: máy in nhiệt giá rẻ thiếu bảng mã tiếng Việt nên in chữ sẽ vỡ dấu. Hoá đơn/tem được vẽ lên canvas rồi gửi ảnh; chưa có máy in thì lưu PNG để gửi/in bằng app khác (`window.print()` không dùng được trong WebView Android).
- **Plugin Capacitor phải đóng gói bằng esbuild** (import trực tiếp) rồi gọi qua `NativeBridge`; không dựa vào `Capacitor.Plugins`. Mọi lời gọi plugin có hạn chót để một plugin treo không làm treo cả thao tác; mở IndexedDB cũng có hạn chót 10 giây.
- **Quét mã (ML Kit)**: xin quyền camera và tự cài module quét của Google nếu máy chưa có.
- **Nút Back** của Android đóng hộp thoại → lùi màn hình → thu nhỏ app (không thoát hẳn khi đang bán).
- **Lưu tệp**: lưu vào thư mục riêng của app (không cần cấp quyền) hoặc chia sẻ; `adjustMarginsForEdgeToEdge`, `windowSoftInputMode=adjustResize`, `allowBackup=false`, minSdk 24 / targetSdk 36 và versionCode theo số lần chạy CI (sẵn sàng lên Google Play).
- **Xin hệ thống giữ dữ liệu** (`navigator.storage.persist`) và hiện cảnh báo to nếu ghi dữ liệu thất bại.
- Các bài kiểm thử "đối kháng" bắt lỗi sổ sách: trả hàng nhiều lần phải khớp từng đồng và hoàn đúng lô (đã bắt và sửa 1 lỗi trả hàng dồn về lô đầu).

## Giao diện & xuất Excel (bản 1.2)
- **Giao diện mới:** phong cách hiện đại, tươi sáng — nền sáng pastel, thẻ bo tròn lớn, đổ bóng mềm, thanh điều hướng nổi dạng viên thuốc, nút/tiêu đề dải màu gradient. Đổi **4 bảng màu** (Tím hoa cà, Xanh bạc hà, Xanh đại dương, Hoàng hôn) và chế độ Sáng/Tối/Tự động ngay trong *Cài đặt → Giao diện*; màu phụ sinh tự động từ 3 biến CSS (`--a1`, `--a2`, `--primary`) trong `www/css/app.css`.
- **Xuất Excel (.xlsx):** vào *Báo cáo → biểu tượng tải xuống* hoặc *Thêm → Xuất báo cáo Excel*. Chọn khoảng thời gian, tích chọn một hay nhiều trong 12 báo cáo (tổng hợp kinh doanh, hoá đơn, chi tiết hàng bán, bán theo sản phẩm, tồn kho, nhập–xuất–tồn, phiếu nhập, công nợ, sổ quỹ, hao hụt, danh mục hàng hóa, nhật ký), gộp vào **một tệp nhiều sheet** hoặc xuất riêng. Tệp có băng tiêu đề theo màu đã chọn, hàng tiêu đề tô màu + bộ lọc + cố định khi cuộn, dòng xen kẽ, định dạng tiền/ngày chuẩn, dòng **TỔNG CỘNG** (công thức SUBTOTAL — lọc là tổng tự đổi), tô đỏ/vàng hàng hết/sắp hết, mờ gạch ngang hoá đơn đã huỷ, in A4 gọn một trang ngang. Cột giá vốn/lợi nhuận chỉ có khi tài khoản có quyền xem giá vốn.
- Thư viện **ExcelJS** được đóng kèm tại `www/vendor/exceljs.min.js` (dùng offline); không nạp được thì tự rơi về CSV.

## Màn hình Bán hàng (bản 1.3)
Tách riêng **danh sách sản phẩm** và **giỏ hàng**: màn hình chính dành gần trọn cho lưới sản phẩm (Hay bán / Tất cả / theo nhóm, tìm kiếm lọc ngay trên lưới, mỗi ô hiện số lượng đã chọn và nút "−" để bớt nhanh). Khi có hàng trong giỏ, một **thanh giỏ hàng** nổi ở cuối hiện số mặt hàng và tổng tiền; **chạm vào mới mở trang giỏ hàng** (khách, mã giảm giá, chỉnh số lượng/giá, giảm giá, treo đơn, thanh toán). Trên Android nút Back đóng giỏ hàng để quay lại chọn hàng; trên màn hình rộng giỏ hàng trượt ra như ngăn kéo bên phải.

## Bản 1.4
- **Vuốt ngang để chuyển tab/danh mục** (làm theo app BEPO): vuốt trái/phải trên màn hình hoặc hộp thoại để nhảy sang tab kế bên (Kho, Báo cáo, Sổ quỹ, Hoá đơn, chi tiết khách…) và đổi danh mục hàng ở màn Bán hàng/Hàng hóa. Không bắt cử chỉ khi vuốt trong bảng/thanh chip cuộn ngang, ô nhập hoặc trang giỏ hàng. Tab/danh mục đang chọn **tự cuộn ra giữa** thanh tab.
- **Danh sách ngân hàng VietQR đầy đủ:** tải trực tiếp từ API VietQR (khoảng 47–55 ngân hàng), lưu lại để dùng offline, có danh sách rút gọn 44 ngân hàng dự phòng và nút "Thử lại"; chọn bằng hộp thoại có ô tìm theo tên/mã BIN.
- **Biểu đồ:** số liệu hiện ngay trên đầu cột (khi ít cột), nhãn trục ngay dưới biểu đồ và một khung chi tiết đặt liền dưới biểu đồ (chạm hoặc kéo ngang để xem từng cột: doanh thu, số hoá đơn, trung bình/hoá đơn, lãi gộp); tab Doanh thu có thêm bảng chi tiết từng ngày/tháng.

## Đồng bộ nhiều máy bằng Supabase miễn phí (bản 1.5)
Dùng chung dữ liệu giữa điện thoại chủ, thu ngân, thủ kho… trên **dự án Supabase gói Free của chính bạn**. Mất mạng vẫn bán bình thường (mọi thay đổi xếp hàng đợi, lưu bền), có mạng thì tự đồng bộ nền (mỗi 30 giây, khi mở lại app, khi có mạng trở lại, 4 giây sau mỗi thay đổi). Biểu tượng đám mây trên thanh trên báo trạng thái (xanh = đã đồng bộ, vàng = chờ gửi, đỏ = lỗi).

**Thiết lập (chủ cửa hàng, ~5 phút):** *Thêm → Đồng bộ nhiều máy* — (1) tạo dự án Supabase miễn phí; (2) bấm *Sao chép script SQL* rồi dán vào Supabase → SQL Editor → Run; (3) nhập Project URL + khoá anon/publishable → *Kết nối & đồng bộ lần đầu*. **Thêm máy:** bấm *Thêm máy* → app cho một mã (và mã QR) → trên máy mới chọn *Máy thứ hai (có mã)* (hoặc ở màn thiết lập lần đầu: "Đã có cửa hàng?") quét/dán mã. Thu hồi từng máy ngay trong màn này.

**Thiết kế (rút kinh nghiệm từ BEPO):**
- Hai bảng trên Supabase bị khoá hoàn toàn (RLS), chỉ truy cập qua các hàm SQL kiểm tra **khoá riêng của từng thiết bị** (máy chủ chỉ giữ bản băm SHA-256) — khoá anon công khai không đủ để đọc/ghi dữ liệu. Máy "nhân viên" không ghi được tài khoản nhân viên/cài đặt và không xoá được dữ liệu; máy chủ trả lại bản đúng để máy đó tự sửa lại.
- Đồng bộ theo từng bản ghi, bản có mốc `updatedAt` mới hơn thắng; xoá được truyền bằng "bia mộ".
- **Tồn kho, tồn theo lô, công nợ, điểm, lượt dùng khuyến mãi không đồng bộ trực tiếp** mà mỗi máy tự tính lại từ sổ biến động kho / sổ nợ / hoá đơn (chỉ-thêm) → hai máy cùng bán một mặt hàng khi mất mạng vẫn ra đúng tồn, không ghi đè nhau.
- Mã hoá đơn/phiếu/SKU gắn mã máy (VD `HD261014-B003`) để không trùng giữa các máy.
- Nhật ký hoạt động và đơn treo là của riêng từng máy. Khoá kết nối không nằm trong tệp sao lưu; khi đang đồng bộ, *Khôi phục sao lưu* và *Xoá toàn bộ dữ liệu* bị chặn.
- Giữ Supabase Free không bị tạm dừng (7 ngày không hoạt động): app tự gọi mỗi lần đồng bộ; thêm workflow `.github/workflows/keepalive.yml` (đặt Secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`) nếu cửa hàng có thể nghỉ dài ngày.

**Kiểm thử:** `test/sync.html` chạy **script SQL thật trên Postgres (PGlite/WebAssembly)** cùng 2–3 "thiết bị" giả lập: cài script (2 lần), khoá sai/anon bị chặn, đẩy–kéo nhiều trang, bán đồng thời trên hai máy, sửa trùng bản ghi, xoá lan truyền, giới hạn quyền máy nhân viên, thu hồi/cấp lại, mất mạng rồi phục hồi, tắt mở app giữa chừng (12 kiểm tra, cần mạng để tải PGlite).
**Chưa kiểm chứng:** chưa chạy với dự án Supabase thật qua mạng (đường truyền HTTP `/rest/v1/rpc/*` và cách xử lý lỗi 401/404/tạm dừng viết theo tài liệu PostgREST); lệch đồng hồ giữa các máy lớn có thể làm "bản mới hơn" chọn sai — hãy để điện thoại tự cập nhật giờ.

### Tự động liên kết Supabase (bản 1.6)
*Thêm → Đồng bộ nhiều máy → "Tự động tạo & liên kết"*: dán **mã truy cập cá nhân** của Supabase (Account → Access Tokens, dạng `sbp_…`) và bấm *Bắt đầu*. App gọi Management API của Supabase để tạo dự án (mật khẩu CSDL sinh ngẫu nhiên, không lưu), chờ khởi động (1–2 phút), lấy khoá **anon/publishable** (không bao giờ lấy service_role), chạy script SQL, kiểm tra hàm đồng bộ rồi liên kết máy này làm máy chủ cửa hàng và đẩy dữ liệu lên. Lỗi giữa chừng → *Thử lại* dùng lại đúng dự án đã tạo (không tạo trùng). Mã truy cập chỉ nằm trong bộ nhớ, nên thu hồi (Revoke) sau khi xong. Khác BEPO (đăng nhập OAuth qua máy chủ trung tâm): app này không có máy chủ trung tâm nên dùng mã cá nhân. Trên Android gọi qua HTTP native (không bị chặn CORS); trên trình duyệt có thể bị chặn.
**Chưa kiểm chứng:** logic được kiểm thử với Management API giả + Postgres thật (test/sync.html, 14 test); chưa chạy với Supabase thật (tên trường/định dạng phản hồi viết theo tài liệu API).

## Gói cước & tự tạo Supabase theo phương pháp BEPO (bản 1.7)
- **Thêm → Gói cước & tài khoản**: đăng ký/đăng nhập tài khoản lưu trữ trên Supabase *trung tâm* của nhà cung cấp, xem hạn, gửi yêu cầu gia hạn 1/6/12 tháng; nhà cung cấp duyệt ở `admin/index.html`. Hết hạn → **khoá mềm** (vẫn xem/xuất báo cáo, chặn bán/nhập kho/thu chi…). Không cấu hình trung tâm → bản miễn phí, không khoá gì.
- **Tạo kho tự động (OAuth)**: bấm *Authorize* một lần trên Supabase, Edge Function `provision-*` tự tạo dự án + cài script + trả khoá anon, app liên kết luôn. Vẫn giữ cách "mã truy cập cá nhân" và cách thủ công.
- Thiết lập phía nhà cung cấp (SQL trung tâm, OAuth App, deploy 3 hàm, GitHub Secrets): xem **HUONG-DAN-TU-DONG-SUPABASE.md**. Kiểm thử: `test/plan.html` (11 kiểm tra, SQL trung tâm chạy trên Postgres thật). **Chưa** chạy với Supabase thật / chưa deploy Edge Function; chưa có chữ ký Ed25519 và Google Play Billing như BEPO.

## Gia hạn gói cước bằng Google Play (bản 1.8)
Bản app **Google Play** riêng (package name `PLAY_APP_ID`, `billingMode=play`): mua/gia hạn gói 1/6/12 tháng ngay trong **Thêm → Gói cước & tài khoản**; máy chủ (`verify-purchase`) tự hỏi lại Google rồi mới ghi nhận, `rtdn-webhook` cập nhật khi gia hạn/huỷ/hoàn tiền; chặn mua trùng, mua khi đang có gói khác, dùng thử miễn phí chỉ 1 lần/máy. Bản APK chuyển khoản vẫn dùng cách duyệt tay. Workflow `Build bản Google Play (AAB)` ký + R8 + vá plugin. Hướng dẫn từng bước: **HUONG-DAN-GOOGLE-PLAY.md**. Kiểm thử `test/plan.html` (16 kiểm tra: SQL thật trên Postgres, Google Play giả lập). **Chưa** chạy với Google thật / chưa deploy Edge Function / chưa có chữ ký Ed25519 như BEPO.
