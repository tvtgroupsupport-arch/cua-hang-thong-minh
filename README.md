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
