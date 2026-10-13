/* Chạy sau `npx cap add android` / `cap sync`: bổ sung quyền, cấu hình Manifest và phiên bản mà Capacitor không tự thêm.
   Chạy lại nhiều lần không sao (idempotent). Rút kinh nghiệm từ app BEPO (các lỗi đã gặp khi lên Google Play). */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const file = path.join(ROOT, 'android/app/src/main/AndroidManifest.xml');
if (!fs.existsSync(file)) { console.log('Chưa có thư mục android/ — chạy "npx cap add android" trước.'); process.exit(0); }
let x = fs.readFileSync(file, 'utf8');

const perms = ['android.permission.CAMERA', 'android.permission.VIBRATE', 'android.permission.BLUETOOTH_CONNECT', 'android.permission.BLUETOOTH_SCAN'];
// Android 11 trở xuống cần BLUETOOTH/BLUETOOTH_ADMIN + vị trí để quét máy in (plugin máy in yêu cầu quyền vị trí ở mọi bản Android)
const legacy = [
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />'
];
for (const l of legacy) { const n = /android:name="([^"]+)"/.exec(l)[1]; if (!x.includes(`android:name="${n}"`)) x = x.replace('</manifest>', `    ${l}\n</manifest>`); }
for (const p of perms) if (!x.includes(`android:name="${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
// Camera không bắt buộc (máy không có camera vẫn cài được)
if (!x.includes('android.hardware.camera')) x = x.replace('</manifest>', '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>');
// Không để Android tự sao lưu dữ liệu app lên Google (tránh khôi phục lẫn dữ liệu giữa các máy); dùng chức năng Sao lưu trong app
if (!/android:allowBackup=/.test(x)) x = x.replace('<application', '<application android:allowBackup="false"');
else x = x.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
// Bàn phím ảo không che ô nhập
if (!/android:windowSoftInputMode=/.test(x)) x = x.replace('<activity', '<activity android:windowSoftInputMode="adjustResize"');
fs.writeFileSync(file, x);
console.log('✓ Đã cập nhật AndroidManifest.xml');

/* versionCode tăng dần theo số lần chạy workflow (Google Play từ chối versionCode trùng). Build trên máy riêng giữ nguyên. */
const runNo = parseInt(process.env.GITHUB_RUN_NUMBER || '', 10);
const appGradle = path.join(ROOT, 'android/app/build.gradle');
if (runNo > 0 && fs.existsSync(appGradle)) {
  let a = fs.readFileSync(appGradle, 'utf8');
  if (!/versionCode\s+\d+/.test(a)) throw new Error('build.gradle không có versionCode — cấu trúc Capacitor đã đổi, cần xem lại script này.');
  a = a.replace(/versionCode\s+\d+/, `versionCode ${runNo}`).replace(/versionName\s+"[^"]*"/, `versionName "1.1.${runNo}"`);
  fs.writeFileSync(appGradle, a);
  console.log(`✓ versionCode = ${runNo}, versionName = 1.1.${runNo}`);
}

/* Google Play yêu cầu targetSdk >= 36 và minSdk >= 24 (Capacitor 7 mặc định 35 / 23). Làm sẵn để sau này đưa lên Play không phải sửa. */
const varsFile = path.join(ROOT, 'android/variables.gradle');
if (fs.existsSync(varsFile)) {
  let v = fs.readFileSync(varsFile, 'utf8');
  for (const [key, min] of [['targetSdkVersion', 36], ['minSdkVersion', 24]]) {
    const m = v.match(new RegExp(key + '\s*=\s*(\d+)'));
    if (!m) throw new Error(`variables.gradle không có ${key} — cấu trúc Capacitor đã đổi, cần xem lại script này.`);
    if (Number(m[1]) < min) { v = v.replace(new RegExp(key + '\s*=\s*\d+'), `${key} = ${min}`); console.log(`✓ Đã nâng ${key} ${m[1]} → ${min}`); }
  }
  fs.writeFileSync(varsFile, v);
}
