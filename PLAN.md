# KẾ HOẠCH — App quản lý cửa hàng tạp hóa (tên tạm: **TẠP HÓA**)

> Tham khảo kiến trúc từ app BEPO (quản lý nhà hàng) tại `D:\Claude\android-app\android-app`.
> Tài liệu này mô tả **chức năng và kiến trúc** — chưa viết code. Mục 9 có các câu hỏi cần bạn chốt trước khi bắt đầu.

---

## 1. Rút ra gì từ app BEPO

| Thành phần của BEPO | Dùng lại cho tạp hóa? |
|---|---|
| Capacitor + giao diện web thuần (HTML/CSS/JS, không framework), build bằng `esbuild` gom thành 1 `index.html` | **Giữ** — nhẹ, dễ sửa, ra APK dễ |
| SQLite cục bộ (`@capacitor-community/sqlite`), chạy **offline hoàn toàn** | **Giữ** — tạp hóa hay mất mạng, bán hàng không được chờ mạng |
| Đồng bộ nhiều máy qua Supabase riêng của quán (bảng `records`, bản mới hơn thắng, "bia mộ" khi xoá) | **Giữ, làm ở giai đoạn sau** (chủ + nhân viên nhiều máy) |
| Phân quyền chủ quán / nhân viên, chặn ở tầng DB | **Giữ**, đơn giản hoá |
| Quét mã (ML Kit), in nhiệt Bluetooth (`capacitor-thermal-printer`), VietQR, xuất Excel (`exceljs`), chuông báo, nhật ký hoạt động | **Giữ** — quét mã vạch & in bill là cốt lõi của tạp hóa |
| Sơ đồ bàn, bếp (KDS), đặt bàn, QR gọi món cho khách, ghế/ghép tách bàn | **Bỏ** — không dùng |
| Gói cước qua Supabase trung tâm, Google Play Billing, trang admin gia hạn | **Tạm bỏ** — làm sau nếu muốn bán app |
| Kho theo nguyên liệu + công thức món | **Đổi** thành kho theo **sản phẩm có mã vạch**, quy đổi đơn vị, lô/hạn dùng |
| Kho "tồn = tồn đầu + tổng phiếu" để 2 máy không đè nhau | **Giữ nguyên nguyên tắc này** — rất hợp với kho tạp hóa |

Khác biệt nghiệp vụ lớn nhất: nhà hàng bán theo **bàn/món/bếp**; tạp hóa bán theo **quét mã vạch nhanh, nhiều mặt hàng, hàng cân, bán sỉ/lẻ, ghi nợ khách quen, nhập hàng từ nhà phân phối**.

---

## 2. Đối tượng dùng & vai trò

- **Chủ cửa hàng**: toàn quyền, xem giá vốn/lợi nhuận, báo cáo, cài đặt, quản lý nhân viên.
- **Thu ngân**: bán hàng, thu nợ, mở/chốt ca, trả hàng (có thể giới hạn: không xem giá vốn, không sửa giá, không xoá).
- **Thủ kho**: nhập hàng, kiểm kho, xuất hủy; không bán hàng/không xem doanh thu (tuỳ cấu hình).
- Quyền chi tiết theo cờ bật/tắt (giống `perms` của BEPO): sửa giá khi bán, giảm giá tối đa %, huỷ hoá đơn, xem giá vốn, xem báo cáo, xoá dữ liệu…
- Đăng nhập bằng tên + mật khẩu (băm PBKDF2, đăng nhập được offline) hoặc **mã PIN 4–6 số** để đổi ca thu ngân nhanh.

---

## 3. Danh sách chức năng chi tiết

### 3.1 Bán hàng (POS) — màn hình quan trọng nhất
1. **Quét mã vạch** bằng camera (ML Kit) — quét liên tục, mỗi lần quét cộng 1 vào giỏ, có tiếng bíp/rung. Hỗ trợ cả **máy quét Bluetooth/USB** (gõ như bàn phím).
2. **Tìm nhanh** theo tên (không dấu, gõ tắt), mã SKU, 4 số cuối mã vạch; lưới "hàng bán chạy / hay mua" để chạm chọn khi không có mã vạch (rau, kẹo lẻ…).
3. **Giỏ hàng**: tăng/giảm số lượng, nhập số lượng trực tiếp, xoá dòng, ghi chú dòng.
4. **Hàng bán theo cân/thể tích** (kg, lạng, lít, mét): nhập khối lượng thủ công hoặc bàn phím số lớn; hỗ trợ **mã vạch cân** (cân điện tử in tem có sẵn giá/khối lượng — dạng EAN-13 tiền tố 2x).
5. **Chọn đơn vị bán**: lẻ / lốc / thùng (mỗi đơn vị có giá riêng, tự quy đổi khi trừ kho). Ví dụ 1 thùng = 24 lon.
6. **Bảng giá**: giá lẻ, giá sỉ (tự áp khi mua từ N món, hoặc khi khách thuộc nhóm "khách sỉ"), giá theo bậc số lượng.
7. **Giảm giá**: theo dòng (số tiền/%), theo cả đơn (số tiền/%), có giới hạn % tối đa theo quyền; tự áp **khuyến mãi** đang chạy (xem 3.8).
8. **Nhiều hoá đơn treo** (giữ đơn, phục vụ khách khác rồi quay lại) — tối thiểu 10 đơn treo, lưu lại kể cả khi tắt app.
9. **Gắn khách hàng** vào đơn (tìm theo tên/SĐT) để tích điểm, ghi nợ, áp giá sỉ.
10. **Thanh toán**:
    - Tiền mặt: nhập tiền khách đưa, gợi ý mệnh giá nhanh (20k/50k/100k/200k/500k), tự tính **tiền thừa**.
    - Chuyển khoản **VietQR** (sinh mã QR đúng số tiền + nội dung, phóng to + tăng độ sáng màn hình như BEPO), xác nhận tay.
    - Ghi nợ (cần có khách hàng; hiện công nợ sau khi cộng).
    - **Thanh toán hỗn hợp** (một phần tiền mặt + một phần chuyển khoản + một phần nợ).
    - Làm tròn tiền (tuỳ chọn: tới 500đ/1.000đ).
11. **In hoá đơn** nhiệt 58/80mm qua Bluetooth hoặc xuất PDF / chia sẻ Zalo; tuỳ chọn không in; in lại bất kỳ lúc nào; in tem giá/mã vạch (giai đoạn sau).
12. **Trả hàng / đổi hàng**: chọn hoá đơn gốc (hoặc trả không hoá đơn), chọn món + số lượng trả, hoàn tiền mặt / trừ vào nợ; hàng trả **nhập lại kho** hoặc chuyển vào hủy (hàng hỏng).
13. **Huỷ hoá đơn** (cần quyền, bắt buộc nhập lý do, hoàn kho + ghi nhật ký).
14. Cảnh báo khi bán: **hết hàng / tồn âm** (cho phép bán âm hay chặn — tuỳ cài đặt), **hàng cận date/hết hạn**, **bán dưới giá vốn**.
15. Chế độ **tối giản một tay** cho điện thoại và bố cục **2 cột** (giỏ + lưới hàng) cho máy tính bảng.

### 3.2 Quản lý sản phẩm (hàng hóa)
- Thông tin: tên, **mã vạch (nhiều mã vạch/sản phẩm)**, SKU, nhóm hàng, thương hiệu, ảnh, mô tả, ghi chú, trạng thái (đang bán/ngừng bán).
- **Giá vốn**, giá bán lẻ, giá sỉ, giá theo bậc; hiển thị **% lãi** tự tính.
- **Đơn vị tính & quy đổi**: đơn vị cơ bản + các đơn vị lớn (lốc, thùng) với hệ số quy đổi, mỗi đơn vị có mã vạch và giá riêng.
- Hàng **cân/đo** (cho phép số lẻ) và hàng **đếm** (số nguyên).
- **Tồn kho tối thiểu / tối đa** để cảnh báo và gợi ý nhập.
- **Quản lý lô & hạn sử dụng** (bật/tắt theo từng sản phẩm — sữa, bánh, thực phẩm tươi): mỗi lần nhập tạo một lô (số lô, ngày hết hạn, SL); bán theo nguyên tắc **HSD gần nhất bán trước (FEFO)**.
- Thuế VAT theo sản phẩm (tuỳ chọn, mặc định tắt).
- **Nhóm hàng** nhiều cấp đơn giản (Đồ uống › Nước ngọt…), sắp xếp, màu/biểu tượng.
- Thêm nhanh: **quét mã vạch → nếu chưa có thì mở form tạo sản phẩm với mã đã điền sẵn**.
- **Nhập/xuất danh mục bằng Excel/CSV** (tải mẫu, nhập hàng loạt, báo dòng lỗi), vì tạp hóa thường có hàng nghìn mặt hàng.
- Sửa giá hàng loạt (theo nhóm/theo %), nhân bản sản phẩm, gộp sản phẩm trùng.
- Lịch sử đổi giá (ai đổi, lúc nào, giá cũ → mới).

### 3.3 Kho hàng
- **Tồn kho hiện tại** theo sản phẩm (và theo lô nếu bật), tổng **giá trị tồn kho** (theo giá vốn).
- **Phiếu nhập hàng** từ nhà cung cấp: quét/chọn sản phẩm, SL, đơn vị (nhập thùng), giá nhập, chiết khấu, số lô/HSD, đã thanh toán bao nhiêu (phần còn lại thành **công nợ NCC**). Ảnh chụp chứng từ đính kèm.
  - Tự cập nhật **giá vốn**: chọn *bình quân gia quyền* hoặc *giá nhập gần nhất*.
  - Nhắc cập nhật giá bán khi giá nhập đổi.
- **Phiếu trả hàng nhà cung cấp**.
- **Kiểm kho (kiểm kê)**: tạo phiên kiểm, quét từng mặt hàng + nhập số đếm thực tế, so với sổ sách, hiện chênh lệch (thừa/thiếu, giá trị), **cân bằng kho** thành phiếu điều chỉnh. Có thể kiểm theo nhóm hàng/kệ, lưu dở rồi tiếp tục.
- **Xuất hủy / hao hụt** (hết hạn, hỏng, mất, dùng nội bộ) với lý do — vào báo cáo lỗ hao.
- **Chuyển kho** (cửa hàng ↔ kho phụ) — giai đoạn sau.
- **Thẻ kho / lịch sử xuất nhập** từng sản phẩm: ngày, loại phiếu, SL, tồn sau, người làm (theo mẫu `stock_moves` của BEPO).
- **Cảnh báo**: sắp hết hàng (≤ tồn tối thiểu), hết hàng, **sắp hết hạn** (7/15/30 ngày tuỳ chỉnh), đã hết hạn chưa xử lý, **hàng tồn lâu không bán** (chết vốn).
- **Gợi ý đặt hàng**: danh sách cần nhập theo tồn tối thiểu + tốc độ bán 30 ngày, gom theo nhà cung cấp, chia sẻ qua Zalo/SMS dạng văn bản.
- Quy tắc đồng bộ như BEPO: **không đồng bộ số tồn trực tiếp**, chỉ đồng bộ tồn đầu + các phiếu → nhiều máy cùng bán không đè nhau.

### 3.4 Nhà cung cấp & công nợ phải trả
- Danh bạ NCC: tên, người liên hệ, SĐT, địa chỉ, ghi chú, sản phẩm hay nhập.
- **Sổ nợ NCC**: số nợ hiện tại, lịch sử phiếu nhập & thanh toán, **phiếu chi trả nợ** (tiền mặt/chuyển khoản, một phần hoặc toàn bộ), nhắc **đến hạn thanh toán**.
- Báo cáo mua hàng theo NCC.

### 3.5 Khách hàng & công nợ phải thu (sổ nợ)
- Danh bạ khách: tên, SĐT, địa chỉ, nhóm (lẻ/sỉ/thân thiết), ghi chú, **hạn mức nợ**.
- **Sổ ghi nợ**: tổng nợ, từng hoá đơn nợ, **thu nợ** (một phần/toàn bộ, phân bổ vào hoá đơn cũ nhất trước), in/gửi **phiếu đối chiếu công nợ** qua Zalo.
- Nhắc nợ quá hạn (thông báo + danh sách "ai đang nợ lâu nhất"); gọi/nhắn khách chỉ bằng một chạm.
- Lịch sử mua hàng của từng khách, mặt hàng hay mua.
- **Tích điểm** (tuỳ chọn): X đồng = 1 điểm, đổi điểm thành giảm giá; mức thành viên.

### 3.6 Ca làm việc & sổ quỹ
- **Mở ca**: nhập tiền đầu ca trong két. **Chốt ca**: hệ thống tính tiền mặt phải có = đầu ca + thu bán hàng + thu nợ − chi − hoàn trả; thu ngân nhập số đếm thực tế → hiện **chênh lệch**; in/xem biên bản chốt ca.
- **Thu / chi khác**: tiền điện, mặt bằng, lương, nhập hàng trả ngay, rút tiền cá nhân… theo **danh mục thu chi** do chủ tự đặt.
- **Sổ quỹ**: tiền mặt và tài khoản ngân hàng, dòng tiền theo ngày, số dư.
- Khóa ca đã chốt (không sửa lại sau khi chốt, trừ chủ có ghi nhật ký).

### 3.7 Báo cáo & thống kê
Chọn khoảng thời gian: hôm nay / hôm qua / 7 ngày / tháng này / tháng trước / tùy chọn; xem theo giờ/ngày/tháng.
- **Tổng quan (dashboard)**: doanh thu, số hoá đơn, giá trị trung bình/đơn, **lợi nhuận gộp**, tiền mặt vs chuyển khoản vs ghi nợ, so với kỳ trước, biểu đồ cột/đường.
- **Doanh thu**: theo ngày, theo giờ cao điểm, theo nhân viên/thu ngân, theo hình thức thanh toán.
- **Lợi nhuận**: theo sản phẩm, nhóm hàng, hoá đơn; trừ chi phí (từ sổ quỹ) ra **lãi ròng** ước tính.
- **Hàng hóa**: bán chạy / bán chậm / không bán được; ABC (nhóm tạo 80% doanh thu).
- **Tồn kho**: giá trị tồn, hàng sắp hết, hàng tồn lâu, nhập–xuất–tồn theo kỳ.
- **Hạn dùng**: danh sách sắp/đã hết hạn và giá trị rủi ro.
- **Công nợ**: phải thu (theo khách), phải trả (theo NCC), tuổi nợ.
- **Hao hụt**: hủy hàng, chênh lệch kiểm kho, trả hàng.
- **Ca/ quỹ**: tổng hợp từng ca, chênh lệch két.
- **Xuất Excel/CSV/PDF** & chia sẻ (đã có mẫu `reports.js`, `exceljs` trong BEPO); **báo cáo cuối ngày** gửi nhanh qua Zalo dạng văn bản.
- Chủ xem được báo cáo từ máy khác khi bật đồng bộ.

### 3.8 Khuyến mãi
- Giảm % / giảm số tiền theo sản phẩm, nhóm hàng hoặc cả đơn, có ngày bắt đầu–kết thúc, khung giờ (happy hour), ngày trong tuần.
- **Mua X tặng Y** (mua 2 tặng 1, mua thùng tặng lon), **combo** (nhiều món một giá), **đồng giá**, giá theo bậc số lượng.
- **Voucher / mã giảm giá** có giới hạn số lần, đơn tối thiểu (như `promos` của BEPO).
- Khuyến mãi theo nhóm khách (sỉ / thân thiết).
- Quy tắc ưu tiên rõ ràng khi nhiều KM trùng (chọn cái lợi nhất cho khách hoặc cộng dồn — cài đặt).

### 3.9 Cài đặt & hệ thống
- **Thông tin cửa hàng**: tên, địa chỉ, SĐT, logo, lời chào cuối bill, thông tin ngân hàng cho VietQR.
- **Mẫu hoá đơn**: khổ giấy 58/80mm, hiện/ẩn logo, mã vạch/QR, ghi chú.
- **Máy in**: ghép đôi máy in Bluetooth, in thử.
- Tuỳ chọn bán hàng: cho phép bán âm kho, làm tròn, bắt buộc chọn khách khi ghi nợ, giá sỉ tự động, âm báo, rung.
- **Sao lưu & khôi phục**: xuất file `.db`/JSON ra bộ nhớ hoặc chia sẻ (Google Drive/Zalo), tự nhắc sao lưu hằng tuần, khôi phục từ file — **rất quan trọng vì dữ liệu nằm trên điện thoại**.
- **Nhật ký hoạt động**: ai làm gì lúc nào (đổi giá, huỷ bill, xoá, điều chỉnh kho…).
- **Đa ngôn ngữ**: Tiếng Việt mặc định, thêm tiếng Anh (khung `i18n.js` của BEPO).
- Giao diện sáng/tối, cỡ chữ lớn cho người lớn tuổi.
- Hướng dẫn nhanh ban đầu (wizard): tên cửa hàng → nhóm hàng → nhập sản phẩm (Excel hoặc quét) → máy in → xong.
- **Đồng bộ nhiều máy** (giai đoạn 3): liên kết Supabase riêng của cửa hàng, thêm máy nhân viên bằng QR (cơ chế từ BEPO `sync.js`, `records.js`, `cloud.js`).
- **Dữ liệu mẫu** để dùng thử (có script xóa sạch).

---

## 4. Các màn hình chính (điều hướng)

Thanh dưới: **Bán hàng · Hàng hóa · Kho · Báo cáo · Thêm**

```
Bán hàng      → POS (quét/tìm, giỏ, đơn treo) → Thanh toán → Hóa đơn
              → Lịch sử hóa đơn (xem lại, in lại, trả hàng, huỷ)
Hàng hóa      → Danh sách sản phẩm → Chi tiết/sửa → Nhóm hàng → Nhập Excel
Kho           → Tồn kho → Nhập hàng → Kiểm kho → Xuất hủy → Thẻ kho → Cảnh báo (hết/ hạn)
Báo cáo       → Tổng quan → Doanh thu → Lợi nhuận → Hàng hóa → Tồn kho → Công nợ
Thêm          → Khách hàng & nợ · Nhà cung cấp & nợ · Khuyến mãi · Sổ quỹ/Thu chi · Ca làm việc
              → Nhân viên & quyền · Cài đặt · Sao lưu · Nhật ký · Hướng dẫn
```

Nguyên tắc UI: ít chạm nhất khi bán (quét → thanh toán ≤ 3 chạm), nút to, chạy tốt một tay, chữ rõ ràng ngoài sáng, không bao giờ chặn bán hàng vì mạng.

---

## 5. Mô hình dữ liệu (SQLite)

| Bảng | Nội dung chính |
|---|---|
| `store` / `settings` | thông tin cửa hàng, cấu hình bán hàng, in, VietQR |
| `staff` | tên, username, vai trò, `pw` (PBKDF2), PIN, `perms` JSON, active |
| `categories` | tên, cha (cấp), thứ tự |
| `products` | tên, sku, nhóm, ảnh, loại (đếm/cân), giá vốn, giá lẻ, giá sỉ, tồn tối thiểu, bật lô/HSD, VAT, active |
| `product_units` | sản phẩm, tên đơn vị, hệ số quy đổi, giá, là đơn vị cơ bản |
| `barcodes` | mã vạch → (sản phẩm, đơn vị) — duy nhất |
| `price_tiers` | bậc giá theo số lượng / nhóm khách |
| `batches` | sản phẩm, số lô, HSD, SL còn lại, giá vốn lô, phiếu nhập |
| `stock_moves` | sản phẩm, lô, loại (nhập/bán/trả/hủy/điều chỉnh/kiểm kho), SL (+/−), tồn sau, tham chiếu chứng từ, người, lý do |
| `customers` | tên, SĐT, nhóm, hạn mức nợ, điểm |
| `suppliers` | tên, liên hệ, ghi chú |
| `sales` | mã HĐ, thời gian, khách, thu ngân, ca, tổng hàng, giảm giá, làm tròn, tổng, trạng thái (hoàn thành/treo/huỷ), ghi chú |
| `sale_items` | HĐ, sản phẩm, đơn vị, SL, giá, giá vốn tại thời điểm bán, giảm giá dòng, KM áp dụng |
| `sale_payments` | HĐ, phương thức (tiền mặt/VietQR/chuyển khoản/ghi nợ), số tiền, trạng thái |
| `returns`, `return_items` | trả hàng: HĐ gốc, món, SL, hoàn tiền/trừ nợ, nhập lại kho hay hủy |
| `purchases`, `purchase_items` | phiếu nhập: NCC, ngày, giá nhập, chiết khấu, đã trả, còn nợ |
| `stocktakes`, `stocktake_items` | phiên kiểm: số sổ sách vs thực đếm, chênh lệch, trạng thái |
| `write_offs` | xuất hủy: sản phẩm, lô, SL, lý do |
| `debts` / `debt_payments` | công nợ khách (phải thu) và NCC (phải trả), phiếu thu/chi nợ |
| `shifts` | thu ngân, giờ mở/chốt, tiền đầu ca, kỳ vọng, thực đếm, chênh lệch |
| `cash_entries` | thu/chi khác: danh mục, số tiền, ghi chú, quỹ (tiền mặt/ngân hàng) |
| `promos` | loại (%, tiền, X tặng Y, combo, voucher), phạm vi, điều kiện, thời gian, giới hạn, đã dùng |
| `logs` | nhật ký hoạt động |

Nguyên tắc chung:
- Tiền lưu **số nguyên đồng**; số lượng lưu số thực 3 chữ số thập phân (hàng cân).
- **Chụp lại giá, giá vốn, tên** trên dòng hoá đơn (snapshot) để sửa giá sau này không làm sai báo cáo cũ.
- Khóa chính UUID, mọi bản ghi có `updated_at`, `deleted_at` (bia mộ) → sẵn sàng đồng bộ.
- Trừ kho/lô và ghi `stock_moves` **trong một transaction** cùng lúc lưu hoá đơn.
- Chỉ mục trên `barcodes.code`, `products.name_norm` (tên không dấu), `sales.created_at` để quét/tìm trong 10.000+ mặt hàng vẫn tức thì.

---

## 6. Kiến trúc kỹ thuật (đề xuất)

```
quan ly cua hang tap hoa/
├─ src/
│  ├─ web/        giao diện + nghiệp vụ chạy cục bộ
│  │   ├─ db.js           lớp SQLite + migration phiên bản
│  │   ├─ engine/         sales.js · products.js · inventory.js · purchases.js
│  │   │                  customers.js · suppliers.js · debts.js · shifts.js
│  │   │                  promos.js · reports.js · backup.js
│  │   ├─ views/          pos.js · products.js · stock.js · reports.js · ... 
│  │   ├─ lib/            barcode.js · vietqr.js · receipt.js · excel.js · i18n.js
│  │   └─ styles.css
│  ├─ native/bridge.js   cầu nối plugin (SQLite, camera quét mã, máy in, chia sẻ file)
│  └─ cloud/            (giai đoạn 3) sync.js · records.js — lấy lại từ BEPO
├─ test/                 kiểm thử nghiệp vụ chạy bằng Node SQLite (như BEPO)
├─ scripts/ build.mjs    gom thành www/index.html bằng esbuild
└─ capacitor.config.json
```

- **Giữ stack của BEPO** (Capacitor 7, JS thuần, SQLite, ML Kit quét mã, thermal printer, exceljs, esbuild) → tận dụng được code và kinh nghiệm sẵn có, build APK bằng GitHub Actions như BEPO.
- **Tách nghiệp vụ khỏi giao diện** (như `local-engine.js` của BEPO) để kiểm thử tự động không cần thiết bị.
- Giữ nguyên tắc: **mọi thao tác không chờ mạng**.
- Hiệu năng: tải danh mục vào bộ nhớ + chỉ mục mã vạch (Map) để quét tức thời; phân trang danh sách dài; báo cáo tính bằng truy vấn SQL tổng hợp.

---

## 7. Lộ trình triển khai

**Giai đoạn 0 — Khung dự án** (nền tảng)
Khởi tạo Capacitor + build, lớp SQLite + migration, đăng nhập/vai trò, cài đặt cơ bản, thanh điều hướng. *Hoàn thành khi:* chạy được APK trống, đăng nhập được, lưu cài đặt.

**Giai đoạn 1 — MVP bán được hàng** (ưu tiên cao nhất)
Hàng hóa (CRUD, nhóm, mã vạch, đơn vị quy đổi) + nhập Excel · POS đầy đủ (quét, giỏ, đơn treo, giảm giá, tiền mặt/VietQR) · in bill · lịch sử hóa đơn · tồn kho tự trừ + nhập hàng cơ bản + điều chỉnh · báo cáo doanh thu/lãi hôm nay · sao lưu/khôi phục.
*Hoàn thành khi:* một cửa hàng thật bán trọn một ngày chỉ bằng app.

**Giai đoạn 2 — Quản lý đầy đủ**
Khách hàng + ghi nợ/thu nợ · NCC + công nợ · phiếu nhập đầy đủ (lô/HSD, cập nhật giá vốn) · kiểm kho · xuất hủy · trả hàng · ca làm việc + sổ quỹ thu chi · khuyến mãi · cảnh báo tồn/hạn · báo cáo đầy đủ + xuất Excel · nhân viên & phân quyền chi tiết · nhật ký.

**Giai đoạn 3 — Nhiều máy & mở rộng**
Đồng bộ Supabase (chủ xem từ xa, nhiều thu ngân) · tích điểm · gợi ý đặt hàng · in tem mã vạch · chuyển kho · đa ngôn ngữ · (tuỳ chọn) gói cước/Google Play.

---

## 8. Kiểm thử & chất lượng
- Bộ kiểm thử Node như BEPO (`npm test`): bán hàng, trừ kho theo lô FEFO, quy đổi đơn vị, khuyến mãi, trả hàng, công nợ, ca/quỹ, làm tròn tiền, quyền, backup/restore.
- Kiểm thử **số liệu**: tổng doanh thu = tổng thanh toán; tồn = tồn đầu + Σ phiếu; lãi = doanh thu − giá vốn đã chụp.
- Thử trên máy thật: quét mã trong điều kiện thiếu sáng, in bill Bluetooth, 10.000 sản phẩm, tắt app giữa lúc đang thanh toán (không mất/không trùng hoá đơn).
- Dữ liệu mẫu ~ 500 mặt hàng + 1 năm bán hàng để thử báo cáo.

## 9. Điểm cần bạn quyết định (mặc định đề xuất in đậm)
1. **Nền tảng**: **Android (Capacitor) như BEPO** / thêm bản chạy trên web–PC cho máy tính tiền?
2. **Dùng một cửa hàng một máy** hay cần **nhiều máy/nhiều thu ngân** ngay từ đầu? (đề xuất: **một máy trước, đồng bộ ở giai đoạn 3**)
3. **Có máy in hoá đơn** và **máy quét mã vạch** chưa? (đề xuất: **hỗ trợ cả camera lẫn máy quét Bluetooth; in nhiệt 58mm**)
4. **Quản lý hạn sử dụng/lô** có cần ngay từ MVP không? (đề xuất: **đưa vào giai đoạn 2, bật theo từng sản phẩm**)
5. **Có bán cân (rau, gạo, thịt) bằng cân điện tử in tem** không? (ảnh hưởng mã vạch cân)
6. **Ghi nợ khách quen** có phổ biến không? (đề xuất: **có, làm ở giai đoạn 2 vì rất đặc thù tạp hóa Việt Nam**)
7. **Có định bán/phát hành app** (cần gói cước, Google Play) hay chỉ **dùng riêng**? (đề xuất: **dùng riêng trước**, bỏ phần billing)
8. **Tên app** và giao diện/màu chủ đạo?

---
Khi bạn chốt các câu hỏi ở mục 9 (hoặc đồng ý với mặc định), bước tiếp theo là **Giai đoạn 0 → 1**.
