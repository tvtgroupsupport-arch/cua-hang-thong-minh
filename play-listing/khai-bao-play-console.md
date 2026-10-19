# Trả lời các mục khai báo trên Play Console

Đây là câu trả lời **gợi ý** dựa trên đúng những gì app đang làm (đã đối chiếu với mã nguồn). Giao diện Play Console thay đổi thường xuyên nên tên mục có thể lệch đôi chút; nếu câu hỏi nào khác với bên dưới, hãy chọn đáp án đúng với thực tế của app. **Bạn là người chịu trách nhiệm cuối cùng với Google về các khai báo này — đọc lại kỹ trước khi gửi.**

Đường dẫn: **Play Console → chọn app → Phát triển / Chạy → Nội dung ứng dụng (App content)**.

---

## 1. Chính sách bảo mật
```
https://tvtgroupsupport-arch.github.io/cua-hang-thong-minh/chinh-sach-bao-mat.html
```
(Trang được đăng bởi workflow *Đăng trang chính sách bảo mật lên GitHub Pages* — xem README.md mục "Địa chỉ web". Mở thử trên trình duyệt trước khi điền.)

## 2. Quyền truy cập ứng dụng (App access)
Chọn: **"Tất cả chức năng đều có sẵn mà không cần quyền truy cập đặc biệt"**, nhưng nên ghi chú để người duyệt không bị lạc:

```
Ứng dụng không bắt buộc đăng nhập tài khoản trực tuyến. Lần đầu mở app sẽ hiện màn "Chào mừng đến với Tạp Hóa":
1) Điền tên cửa hàng bất kỳ, tên chủ cửa hàng, tên đăng nhập (vd. "chu") và mật khẩu (vd. "1234").
2) TÍCH ô "Nạp dữ liệu mẫu để dùng thử" rồi bấm "Bắt đầu sử dụng" — app có sẵn 30 ngày hàng hoá và hoá đơn mẫu để xem mọi chức năng.
Gói cước: vào Thêm → Gói cước & tài khoản. Để thử mua gói, tạo tài khoản lưu trữ (email + mật khẩu) rồi mua bằng tài khoản thử nghiệm giấy phép (License testing) của Google — không mất tiền.
Tài khoản lưu trữ mới có thể cần bấm liên kết xác nhận trong email; nếu cần, dùng tài khoản đã xác nhận sẵn: <EMAIL> / <MẬT KHẨU>.
```
**Việc bạn cần làm:** nếu máy chủ gói cước đang bật "Confirm email" (như ảnh chẩn đoán trước đó), hãy **tạo sẵn một tài khoản riêng cho người duyệt**, bấm xác nhận email, và điền vào dòng cuối ở trên — hoặc tắt "Confirm email" trong Supabase (Authentication → Providers → Email) trước khi gửi duyệt.

## 3. Quảng cáo (Ads)
**Không**, ứng dụng không chứa quảng cáo.

## 4. Phân loại nội dung (Content rating — IARC)
- Danh mục: **Tiện ích / Năng suất / Công cụ khác** (không phải trò chơi, không phải mạng xã hội).
- Trả lời **Không** cho: bạo lực, nội dung tình dục, ngôn từ thô tục, ma tuý, cờ bạc, nội dung do người dùng tạo được chia sẻ công khai, chia sẻ vị trí cho người khác.
- "Ứng dụng có cho phép mua hàng kỹ thuật số không?" → **Có** (gói đăng ký).
- Kết quả dự kiến: **Mọi lứa tuổi / 3+**.

## 5. Đối tượng mục tiêu và nội dung
- Nhóm tuổi mục tiêu: **18 tuổi trở lên** (ứng dụng nghiệp vụ cho chủ cửa hàng/nhân viên).
- Ứng dụng **không** hướng tới trẻ em → không phải khai báo chương trình "Dành cho gia đình".

## 6. Ứng dụng tin tức / chính phủ / sức khoẻ / tài chính
Tất cả trả lời **Không**.
- **Tính năng tài chính:** app **không** cho vay, giữ tiền hay chuyển tiền; chỉ hiển thị mã QR chuyển khoản (VietQR) để khách trả trực tiếp vào tài khoản ngân hàng của cửa hàng. Chọn "Ứng dụng của tôi không có bất kỳ tính năng tài chính nào". Nếu mục này hỏi về thanh toán, mô tả: *"Ứng dụng tạo mã VietQR để khách chuyển khoản trực tiếp tới tài khoản ngân hàng của cửa hàng; ứng dụng không xử lý, không giữ và không nhận tiền."*

## 7. Mã nhận dạng quảng cáo (Advertising ID)
**Không** sử dụng. Sau khi có `.aab`, nên kiểm tra tệp kê khai đã gộp xem có quyền `com.google.android.gms.permission.AD_ID` không (thư viện bên thứ ba đôi khi thêm vào). Nếu có mà bạn khai "không dùng", hãy báo mình để gỡ quyền đó khỏi bản build.

## 8. An toàn dữ liệu (Data safety)
Nguyên tắc của Google: "thu thập" = dữ liệu rời khỏi thiết bị tới máy chủ. Dữ liệu bán hàng nằm trên máy; **chỉ rời máy khi người dùng tự bật** tài khoản lưu trữ / đồng bộ nhiều máy.

### Câu hỏi chung
| Câu hỏi | Trả lời |
|---|---|
| Ứng dụng có thu thập hoặc chia sẻ dữ liệu người dùng? | **Có** (khi dùng tài khoản lưu trữ/đồng bộ — tuỳ chọn) |
| Mọi dữ liệu có được mã hoá khi truyền? | **Có** (HTTPS) |
| Có cung cấp cách để người dùng yêu cầu xoá dữ liệu? | **Có** |
| Liên kết xoá tài khoản | `https://tvtgroupsupport-arch.github.io/cua-hang-thong-minh/xoa-tai-khoan.html` |
| Có thể xoá một phần dữ liệu mà không xoá tài khoản? | Có (chủ cửa hàng tự xoá dữ liệu trong Supabase riêng của mình; dữ liệu trên máy xoá bằng cách xoá dữ liệu ứng dụng) |
| Ứng dụng có tuân thủ chính sách Gia đình? | Không áp dụng |
| Có xác thực độc lập bởi bên thứ ba? | Không |

### Loại dữ liệu thu thập
| Nhóm | Loại | Thu thập? | Chia sẻ với bên thứ ba? | Bắt buộc/Tuỳ chọn | Mục đích |
|---|---|---|---|---|---|
| Thông tin cá nhân | **Địa chỉ email** (tài khoản lưu trữ) | Có | Không | Tuỳ chọn | Chức năng ứng dụng, Quản lý tài khoản |
| Thông tin cá nhân | **Tên** (tên cửa hàng, tên chủ/nhân viên) | Có | Không | Tuỳ chọn | Chức năng ứng dụng, Quản lý tài khoản |
| Thông tin cá nhân | **Số điện thoại** (khách hàng/cửa hàng, nếu nhập — chỉ khi bật đồng bộ) | Có | Không | Tuỳ chọn | Chức năng ứng dụng |
| Thông tin cá nhân | **ID người dùng** (mã tài khoản lưu trữ, mã thiết bị đồng bộ) | Có | Không | Tuỳ chọn | Chức năng ứng dụng, Quản lý tài khoản |
| Thông tin tài chính | **Lịch sử mua hàng** (gói đăng ký, mã giao dịch Google Play) | Có | Không | Tuỳ chọn (bản Google Play) | Chức năng ứng dụng |
| Ảnh và video | **Ảnh** (ảnh sản phẩm do cửa hàng tải lên — chỉ khi bật đồng bộ) | Có | Không | Tuỳ chọn | Chức năng ứng dụng |
| Hoạt động trong ứng dụng | **Nội dung khác do người dùng tạo** (hàng hoá, hoá đơn, kho, công nợ — chỉ khi bật đồng bộ) | Có | Không | Tuỳ chọn | Chức năng ứng dụng |
| Mã thiết bị hoặc mã khác | **Mã thiết bị hoặc mã khác** (Android ID — chỉ lưu mã băm trên máy chủ) | Có | Không | Tuỳ chọn (bản Google Play) | **Ngăn chặn gian lận, bảo mật và tuân thủ** (mỗi máy chỉ dùng thử miễn phí một lần) |

### Loại dữ liệu **không** thu thập
Vị trí; danh bạ; tin nhắn; âm thanh/micro; tệp và tài liệu; lịch; nhật ký cuộc gọi; sức khoẻ và thể dục; lịch sử duyệt web; **thông tin thẻ/ngân hàng** (do Google Play xử lý); thông tin hiệu năng/chẩn đoán gửi đi; mã định danh quảng cáo.

### Giải thích cho các lựa chọn khó
- **Chia sẻ = Không:** dữ liệu chỉ đi tới (a) máy chủ Supabase của nhà phát triển (tài khoản/gói cước) và (b) dự án Supabase riêng của chủ cửa hàng — dịch vụ xử lý thay cho chủ cửa hàng/nhà phát triển, không phải "chia sẻ" theo định nghĩa của Google. Thanh toán do Google Play xử lý trực tiếp với người dùng.
- **Dữ liệu bán hàng nằm trong kho riêng của cửa hàng:** dù nhà phát triển không truy cập được, vì dữ liệu được gửi khỏi thiết bị nên khai là "thu thập" (tuỳ chọn) cho chắc chắn, kèm ghi chú trong chính sách bảo mật.
- **Danh sách ngân hàng (api.vietqr.io):** ứng dụng chỉ tải danh sách ngân hàng công khai, không gửi dữ liệu người dùng; bên đó chỉ thấy địa chỉ IP như mọi yêu cầu web. Không cần khai thêm.

## 9. Khai báo quyền nhạy cảm
- **CAMERA:** chỉ để quét mã vạch/QR; xử lý ngay trên máy (ML Kit), không lưu/gửi hình ảnh.
- **ACCESS_FINE_LOCATION:** **chỉ vì Android bắt buộc** để quét thiết bị Bluetooth (máy in); không đọc/lưu/gửi vị trí → ở An toàn dữ liệu vẫn chọn **không thu thập Vị trí**. Là quyền lúc đang dùng (không nền) nên không cần mẫu khai báo vị trí nền.
- **BLUETOOTH_SCAN / BLUETOOTH_CONNECT:** kết nối máy in hoá đơn Bluetooth.
- **VIBRATE, INTERNET:** thông thường (không cần khai).
- **BILLING (com.android.vending.BILLING):** thanh toán gói đăng ký — do thư viện thêm tự động.
- Không dùng quyền SMS, cuộc gọi, vị trí nền, danh bạ, dịch vụ trợ năng, toàn bộ tệp, dịch vụ chạy nền (foreground service).

## 10. Gói đăng ký (Subscriptions) — các điểm Google kiểm tra
- Giá, chu kỳ gia hạn và cách huỷ phải hiển thị rõ **trước khi** mua: màn *Gói cước* hiện giá lấy trực tiếp từ Google Play và có nút **Quản lý gói trên Google Play**. ✔
- Mô tả trên trang cửa hàng nêu rõ: đăng ký 1/6/12 tháng, dùng thử miễn phí gói 1 tháng, huỷ trong Google Play, hết hạn vẫn xem/xuất báo cáo. ✔
- Gói cơ bản đặt **tự động gia hạn**, mã gói `goi_1_thang`, `goi_6_thang`, `goi_12_thang` với base plan `goi-1-thang`, `goi-6-thang`, `goi-12-thang` (khớp với mã trong app).
- Ưu đãi dùng thử miễn phí (nếu dùng) tạo trong gói 1 tháng với mã ưu đãi `free-trial`. Màn *Gói cước* hiện "Dùng thử miễn phí N ngày", "Sau đó <giá>/1 tháng" và nhắc huỷ trước khi hết dùng thử. ✔
- Phiên bản Google Play **không** có đường chuyển khoản/duyệt tay (đúng chính sách thanh toán của Google).
- Có chức năng **xoá tài khoản trong ứng dụng** (Thêm → Gói cước & tài khoản → Xoá tài khoản) và trang web hướng dẫn xoá. ✔

## 11. Lịch phát hành — đọc kỹ
- Tài khoản nhà phát triển **cá nhân mới tạo** thường phải chạy **kiểm thử kín với tối thiểu 12 người trong ít nhất 14 ngày liên tục** trước khi xin phát hành công khai (con số có thể thay đổi — xem mục *Kiểm thử và phát hành* trong Play Console để biết yêu cầu chính xác). Hãy mời tester sớm (Kiểm thử kín → Danh sách tester → email Google của họ → gửi link tham gia).
- Tài khoản tổ chức thường không bị áp dụng điều kiện này.
- Sau khi gửi duyệt, Google xét từ vài giờ tới vài ngày.

## 12. Checklist nhanh trước khi gửi duyệt
- [ ] Bật GitHub Pages (Settings → Pages → Source: GitHub Actions), chạy workflow, mở thử 3 địa chỉ (trang chủ, chính sách, xoá tài khoản)
- [ ] Sửa email liên hệ / tên nhà phát triển trong hai trang web nếu khác (tìm "TVT Group", "tvtgroup.support@gmail.com")
- [ ] Chuẩn bị tài khoản cho người duyệt (mục 2) hoặc tắt "Confirm email"
- [ ] Thêm tài khoản thử nghiệm giấy phép (Setup → License testing)
- [ ] Tạo 3 gói đăng ký + base plan đúng mã, trạng thái Active
- [ ] Tải biểu tượng 512, ảnh bìa 1024×500, ≥ 2 ảnh chụp điện thoại
- [ ] Điền An toàn dữ liệu, Phân loại nội dung, Đối tượng mục tiêu, Quảng cáo, Quyền truy cập
- [ ] Tải `.aab` đã ký lên (kiểm thử nội bộ → kín → sản phẩm); xem trang "Xem trước và xác nhận" không còn lỗi
- [ ] Thử mua gói thật bằng License tester; huỷ gói; kiểm tra hạn cập nhật
