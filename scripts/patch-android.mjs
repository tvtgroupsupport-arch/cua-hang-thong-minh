/* Chạy sau `npx cap add android` / `cap sync`: bổ sung quyền Camera/Bluetooth/Rung vào AndroidManifest. Chạy lại nhiều lần không sao. */
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml');
if (!fs.existsSync(file)) { console.log('Chưa có thư mục android/ — chạy "npx cap add android" trước.'); process.exit(0); }
let x = fs.readFileSync(file, 'utf8');
const perms = ['android.permission.CAMERA', 'android.permission.VIBRATE', 'android.permission.BLUETOOTH_CONNECT', 'android.permission.BLUETOOTH_SCAN'];
const legacy = [
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />'
];
for (const l of legacy) { const n = /android:name="([^"]+)"/.exec(l)[1]; if (!x.includes(`android:name="${n}"`)) x = x.replace('</manifest>', `    ${l}\n</manifest>`); }
for (const p of perms) if (!x.includes(`android:name="${p}"`)) x = x.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
if (!x.includes('android.hardware.camera')) x = x.replace('</manifest>', '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>');
if (!/android:windowSoftInputMode=/.test(x)) x = x.replace('<activity', '<activity android:windowSoftInputMode="adjustResize"');
fs.writeFileSync(file, x);
console.log('✓ Đã cập nhật AndroidManifest.xml');
