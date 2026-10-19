# Bộ hồ sơ đưa app Tạp Hóa lên Google Play

Thư mục này gom mọi thứ cần có để điền Play Console (làm theo mẫu của app BEPO). Làm theo thứ tự dưới đây.

## Các tệp
| Tệp / thư mục | Dùng để làm gì |
|---|---|
| `bai-dang-cua-hang.md` | Tên, mô tả ngắn/đầy đủ, "có gì mới" (tiếng Việt + Anh), thông tin trang cửa hàng — dán vào Play Console |
| `khai-bao-play-console.md` | Câu trả lời gợi ý cho **An toàn dữ liệu**, Phân loại nội dung, Quyền truy cập, Quảng cáo, Tài chính, Gói đăng ký, checklist gửi duyệt |
| `kich-ban-video.md` | Kịch bản video giới thiệu 60 giây (tuỳ chọn, để dán link YouTube vào trang cửa hàng) |
| `../docs/chinh-sach-bao-mat.html` | Chính sách bảo mật (bắt buộc có địa chỉ web công khai) |
| `../docs/xoa-tai-khoan.html` | Trang hướng dẫn xoá tài khoản (bắt buộc với app cho tạo tài khoản) |
| `bieu-tuong-512.png`, `bieu-tuong-1024.png` | Biểu tượng cho trang cửa hàng |
| `anh-bia-1024x500.png` | Ảnh bìa (Feature graphic) |
| `anh-chup-man-hinh/` | 7 ảnh chụp màn hình điện thoại (900×1800) từ giao diện thật + dữ liệu mẫu |
| `tools/` | Công cụ làm lại ảnh khi giao diện đổi (mục cuối) |

## Địa chỉ web cần có (điền vào Play Console)
Bật **GitHub Pages một lần**: repo → Settings → Pages → *Build and deployment* → Source: **GitHub Actions**. Sau đó workflow **"Đăng trang chính sách bảo mật lên GitHub Pages"** (`.github/workflows/pages.yml`) tự chạy khi thư mục `docs/` thay đổi (hoặc bấm *Run workflow*) và đăng:
- Trang chủ: `https://tvtgroupsupport-arch.github.io/cua-hang-thong-minh/`
- Chính sách bảo mật: `https://tvtgroupsupport-arch.github.io/cua-hang-thong-minh/chinh-sach-bao-mat.html`
- Xoá tài khoản: `https://tvtgroupsupport-arch.github.io/cua-hang-thong-minh/xoa-tai-khoan.html`

Mở thử cả ba địa chỉ trên trình duyệt trước khi điền vào Play Console. Trước khi đăng, **kiểm tra email liên hệ và tên nhà phát triển** trong hai trang (tìm "TVT Group", "tvtgroup.support@gmail.com").

## Thứ tự làm
1. **Đăng các trang web** (mục trên) và kiểm tra mở được.
2. **Tạo app** trên Play Console: tên, ngôn ngữ mặc định tiếng Việt, loại Ứng dụng, Miễn phí; package `com.cuahangthongminh` (đã khai báo ở `PLAY_APP_ID`).
3. **Trang cửa hàng:** dán chữ từ `bai-dang-cua-hang.md`, tải biểu tượng / ảnh bìa / ảnh chụp.
4. **Nội dung ứng dụng:** làm từng mục theo `khai-bao-play-console.md`.
5. **Gói đăng ký:** tạo 3 gói `goi_1_thang`, `goi_6_thang`, `goi_12_thang` với base plan tự gia hạn (xem `../HUONG-DAN-GOOGLE-PLAY.md`).
6. **Tải AAB đã ký** (workflow *Build bản Google Play (AAB)*) lên Kiểm thử nội bộ, thử mua gói bằng tài khoản License tester.
7. Mời tester vào **Kiểm thử kín** (xem mục 11 của `khai-bao-play-console.md` về yêu cầu số người/số ngày), sau đó tạo **bản phát hành chính thức**.

## Việc nên làm thêm (không bắt buộc ngay)
- **Video giới thiệu** (xem `kich-ban-video.md`) — đăng YouTube rồi dán link vào trang cửa hàng.
- **Ảnh chụp máy tính bảng 7"/10"** nếu muốn app hiện tốt trên mục máy tính bảng.
- **Đổi tên hàng mẫu** trong `www/js/engine/demo.js` nếu không muốn ảnh có tên thương hiệu thật, rồi chụp lại.

## Làm lại ảnh / biểu tượng khi giao diện đổi
Cần Node 22+ và Microsoft Edge (Windows); máy chủ cục bộ đang chạy (`powershell -File scripts/serve.ps1`, cổng 8080):
```bash
node play-listing/tools/make-shots.mjs      # 7 ảnh chụp màn hình vào anh-chup-man-hinh/  (thêm "tối" để chụp giao diện tối)
node play-listing/tools/make-graphics.mjs   # biểu tượng 512/1024 (từ www/icon.svg) + ảnh bìa 1024x500 (từ tools/feature.html)
```
`tools/shots.html` là trang phụ dựng cửa hàng mẫu + dữ liệu demo vào trình duyệt chụp ảnh tạm — **không** nằm trong app.
