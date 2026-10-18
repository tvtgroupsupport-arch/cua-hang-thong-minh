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
    const re = key === 'targetSdkVersion' ? /targetSdkVersion\s*=\s*(\d+)/ : /minSdkVersion\s*=\s*(\d+)/;
    const m = v.match(re);
    if (!m) { console.log('::warning title=variables.gradle thiếu ' + key + '::' + v.replace(/\r?\n/g, ' | ').slice(0, 600)); continue; }   // không làm hỏng bản debug; in nội dung để chẩn đoán
    if (Number(m[1]) < min) { v = v.replace(re, key + ' = ' + min); console.log('✓ Đã nâng ' + key + ' ' + m[1] + ' → ' + min); }
  }
  fs.writeFileSync(varsFile, v);
} else console.log('::warning title=Không có android/variables.gradle::' + fs.readdirSync(path.join(ROOT, 'android')).join(', '));

/* ---------- Bản phát hành Google Play (.aab): chỉ chạy khi đã có android/app/release.keystore (xem android-play.yml) — build APK debug không bị ảnh hưởng ----------
   Mật khẩu KHÔNG ghi cứng ở đây: đọc từ biến môi trường lúc Gradle chạy (GitHub Secrets).
   1) Chữ ký bản release.  2) R8 (mapping.txt) + native debug symbols (hai cảnh báo của Play Console khi tải .aab).  3) Quy tắc giữ lại cho plugin thanh toán/máy in/WebView bridge. */
const keystoreFile = path.join(ROOT, 'android/app/release.keystore');
const gradleFile = path.join(ROOT, 'android/app/build.gradle');
if (fs.existsSync(gradleFile) && fs.existsSync(keystoreFile)) {
  let g = fs.readFileSync(gradleFile, 'utf8');
  if (!g.includes('signingConfigs')) {
    const signingBlock = `    signingConfigs {
        release {
            storeFile file('release.keystore')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }
`;
    if (!g.includes('android {')) throw new Error('build.gradle không có khối "android {" — cấu trúc Capacitor đã đổi, cần xem lại script này.');
    // Vá khối release TRONG buildTypes TRƯỚC, rồi mới chèn signingConfigs — làm ngược thì regex khớp nhầm "release {" của signingConfigs.
    const buildTypesRelease = /(buildTypes\s*\{[\s\S]*?)release\s*\{/;
    if (!buildTypesRelease.test(g)) throw new Error('build.gradle không có khối "release {" trong buildTypes — không vá được chữ ký.');
    g = g.replace(buildTypesRelease, '$1release {\n            signingConfig signingConfigs.release');
    g = g.replace('android {', 'android {\n' + signingBlock);
    console.log('✓ Đã thêm cấu hình ký bản release vào build.gradle');
  }
  if (!g.includes('debugSymbolLevel')) {
    const re = /(buildTypes\s*\{[\s\S]*?release\s*\{)([\s\S]*?)(\n\s*\}\s*\n\s*\})/;
    if (!re.test(g)) throw new Error('build.gradle không có khối buildTypes/release như mong đợi — không bật được R8/biểu tượng gỡ lỗi.');
    g = g.replace(re, (m, head, body, tail) => {
      body = body.replace(/minifyEnabled\s+false/, 'minifyEnabled true');
      if (!/minifyEnabled\s+true/.test(body)) body += '\n            minifyEnabled true';
      return `${head}${body}\n            ndk { debugSymbolLevel 'SYMBOL_TABLE' }${tail}`;
    });
    console.log('✓ Đã bật R8 (mapping.txt) và native debug symbols cho bản release');
  }
  fs.writeFileSync(gradleFile, g);
  const proguardFile = path.join(ROOT, 'android/app/proguard-rules.pro');
  if (fs.existsSync(proguardFile)) {
    let r = fs.readFileSync(proguardFile, 'utf8');
    if (!r.includes('com.android.billingclient')) {
      r += `\n# Thêm bởi scripts/patch-android.mjs\n-keep class ee.forgr.nativepurchases.** { *; }\n-keep class com.android.billingclient.** { *; }\n-keep class ee.forgr.** { *; }\n-dontwarn com.google.errorprone.annotations.**\n-keep class com.rt.printerlibrary.** { *; }\n-keep class com.clj.fastble.** { *; }\n-keep class android_serialport_api.** { *; }\n-keep class com.malik12tree.** { *; }\n-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }\n-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod\n-keepattributes SourceFile,LineNumberTable\n`;
      fs.writeFileSync(proguardFile, r);
      console.log('✓ Đã thêm quy tắc giữ lại cho R8');
    }
  }
} else {
  console.log('(Chưa có khoá ký release.keystore — bỏ qua bước ký/R8, build ra bản debug như bình thường.)');
}
