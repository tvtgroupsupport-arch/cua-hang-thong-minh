/* Tạo khoá ký (upload key) cho bản Google Play bằng Node — không cần cài Java/keytool. Chạy: `node scripts/make-release-keystore.mjs`
   Ra thư mục play-store/ (đã nằm trong .gitignore): release.keystore, release.keystore.b64 và THONG-TIN-KHOA-KY.txt (mật khẩu + hướng dẫn điền GitHub Secrets).
   Định dạng PKCS12, RSA 2048, hiệu lực ~27 năm — đúng yêu cầu của Play Console. KHÔNG đưa các tệp này lên git/chat; sao lưu ở nơi an toàn.
   Biến tuỳ chọn: KS_DIR (thư mục ra), KS_PASS (mật khẩu; bỏ trống = sinh ngẫu nhiên), KS_ALIAS (mặc định taphoa). */
import forge from 'node-forge';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.env.KS_DIR || 'play-store', alias = process.env.KS_ALIAS || 'taphoa';
const rnd = n => crypto.randomBytes(n * 2).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
const pass = process.env.KS_PASS || rnd(24);
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'release.keystore');
if (fs.existsSync(file) && !process.env.KS_FORCE) { console.error('Đã có ' + file + ' — không ghi đè (đặt KS_FORCE=1 nếu thật sự muốn tạo khoá mới; khoá cũ mất là không cập nhật được app đã phát hành!).'); process.exit(1); }

const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey; cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 10000 * 86400000);
const attrs = [{ name: 'commonName', value: 'Tap Hoa' }, { name: 'organizationName', value: 'Tap Hoa' }, { name: 'countryName', value: 'VN' }];
cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey, forge.md.sha256.create());
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { algorithm: '3des', friendlyName: alias, generateLocalKeyId: true });
const buf = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
fs.writeFileSync(file, buf);
fs.writeFileSync(path.join(outDir, 'release.keystore.b64'), buf.toString('base64'));
const sha1 = forge.md.sha1.create().update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()).digest().toHex().toUpperCase().match(/../g).join(':');
fs.writeFileSync(path.join(outDir, 'THONG-TIN-KHOA-KY.txt'), [
  'KHOÁ KÝ BẢN GOOGLE PLAY — GIỮ KÍN, SAO LƯU Ở NƠI AN TOÀN, KHÔNG ĐƯA LÊN GIT/CHAT', '(Thư mục này nằm trong .gitignore.)', '',
  'Điền 4 GitHub Secrets (repo → Settings → Secrets and variables → Actions → Secrets → New repository secret):', '',
  'ANDROID_KEYSTORE_BASE64   = toàn bộ nội dung tệp release.keystore.b64 (một dòng dài)',
  'ANDROID_KEYSTORE_PASSWORD = ' + pass, 'ANDROID_KEY_ALIAS         = ' + alias, 'ANDROID_KEY_PASSWORD      = ' + pass, '',
  'Dấu vân tay SHA-1: ' + sha1, '',
  'Khi tải bản .aab đầu tiên lên Play Console, bật "Play App Signing" — Google giữ khoá phát hành thật; khoá này chỉ là khoá TẢI LÊN',
  '(mất khoá tải lên vẫn xin Google đặt lại được, nhưng nên sao lưu).'].join('\n') + '\n');
console.log('✓ Đã tạo ' + file + ' (SHA-1 ' + sha1 + ')');
