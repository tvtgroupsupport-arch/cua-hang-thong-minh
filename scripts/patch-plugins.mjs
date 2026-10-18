/* Vá plugin @capgo/native-purchases (mã Java trong node_modules) để app dùng được ưu đãi DÙNG THỬ MIỄN PHÍ của Google Play:
     (a) mua gói: ưu tiên ưu đãi có giai đoạn giá 0 (Google chỉ trả ưu đãi mà người dùng đủ điều kiện) thay vì luôn lấy dòng giá gốc;
     (b) getProducts: mỗi dòng sản phẩm có thêm `pricingPhases` = [{ priceString, price, billingPeriod (ISO 8601), recurrenceMode }].
   Chạy lại nhiều lần không sao (nhận diện bằng dấu `// TAPHOA-PATCH`). KHÔNG im lặng:
     • tệp có nhưng không thấy đoạn mã gốc dự kiến (plugin đổi phiên bản) → báo lỗi rõ và thoát mã 1 (mọi chế độ);
     • không thấy tệp plugin: mặc định (postinstall, lúc npm chưa cài xong plugin) chỉ CẢNH BÁO và thoát 0 để không làm hỏng `npm install`;
       với `--strict` (npm run sync, dựng APK) thì báo lỗi và thoát mã 1, để không phát hành bản app thiếu bản vá mà không biết.
   Gọi từ CI (sau npm install) và `npm run sync`. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = process.cwd();

export const PLUGIN_JAVA = 'node_modules/@capgo/native-purchases/android/src/main/java/ee/forgr/nativepurchases/NativePurchasesPlugin.java';
export const MARK_PURCHASE = '// TAPHOA-PATCH:purchase';
export const MARK_PHASES = '// TAPHOA-PATCH:phases';

/** Vá nội dung tệp Java. Trả về { src, applied: [tên bản vá vừa áp dụng], already: [tên bản vá đã có sẵn] }. Ném lỗi nếu không tìm thấy đoạn gốc. */
export function patchPluginSource(src) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const applied = [], already = [];

  // (a) chọn ưu đãi khi mua
  if (src.includes(MARK_PURCHASE)) already.push('purchase');
  else {
    const re = /^([ \t]*)if \(offerDetails\.getBasePlanId\(\)\.equals\(planIdentifier\)\) \{\s*selectedOfferDetails = offerDetails;\s*Log\.d\(TAG, "Found matching plan: " \+ planIdentifier\);\s*break;\s*\}/m;
    if (!re.test(src)) throw new Error('Không tìm thấy đoạn chọn ưu đãi khi mua (if getBasePlanId().equals(planIdentifier)) trong NativePurchasesPlugin.java — plugin đã đổi phiên bản? Cần cập nhật scripts/patch-plugins.mjs.');
    src = src.replace(re, (m, ind) => [
      `${ind}${MARK_PURCHASE} — ưu tiên ưu đãi dùng thử miễn phí (giai đoạn giá đầu = 0) trong các ưu đãi cùng base plan`,
      `${ind}if (offerDetails.getBasePlanId().equals(planIdentifier)) {`,
      `${ind}    if (selectedOfferDetails == null) {`,
      `${ind}        selectedOfferDetails = offerDetails;`,
      `${ind}        Log.d(TAG, "Found matching plan: " + planIdentifier);`,
      `${ind}    }`,
      `${ind}    java.util.List<ProductDetails.PricingPhase> tphPhaseList = offerDetails.getPricingPhases().getPricingPhaseList();`,
      `${ind}    if (!tphPhaseList.isEmpty() && tphPhaseList.get(0).getPriceAmountMicros() == 0L) {`,
      `${ind}        selectedOfferDetails = offerDetails;`,
      `${ind}        Log.d(TAG, "TAPHOA: using free-trial offer " + offerDetails.getOfferId());`,
      `${ind}        break;`,
      `${ind}    }`,
      `${ind}}`
    ].join(eol));
    applied.push('purchase');
  }

  // (b) getProducts trả danh sách giai đoạn giá
  if (src.includes(MARK_PHASES)) already.push('phases');
  else {
    const re = /^([ \t]*)product\.put\("offerId", offerDetails\.getOfferId\(\)\);/m;
    if (!re.test(src)) throw new Error('Không tìm thấy dòng product.put("offerId", offerDetails.getOfferId()) trong getProducts của NativePurchasesPlugin.java — plugin đã đổi phiên bản? Cần cập nhật scripts/patch-plugins.mjs.');
    src = src.replace(re, (m, ind) => [
      m,
      `${ind}${MARK_PHASES} — trả cả danh sách giai đoạn giá (dùng thử miễn phí, giá gốc...)`,
      `${ind}org.json.JSONArray tphPhases = new org.json.JSONArray();`,
      `${ind}for (ProductDetails.PricingPhase tphPh : offerDetails.getPricingPhases().getPricingPhaseList()) {`,
      `${ind}    JSObject tphPhase = new JSObject();`,
      `${ind}    tphPhase.put("priceString", tphPh.getFormattedPrice());`,
      `${ind}    tphPhase.put("price", tphPh.getPriceAmountMicros() / 1000000.0);`,
      `${ind}    tphPhase.put("billingPeriod", tphPh.getBillingPeriod());`,
      `${ind}    tphPhase.put("recurrenceMode", tphPh.getRecurrenceMode());`,
      `${ind}    tphPhases.put(tphPhase);`,
      `${ind}}`,
      `${ind}product.put("pricingPhases", tphPhases);`
    ].join(eol));
    applied.push('phases');
  }
  return { src, applied, already };
}

/** Vá một tệp Java trên đĩa (ghi lại chỉ khi có thay đổi). */
export function patchPluginFile(file) {
  if (!fs.existsSync(file)) throw new Error('Không thấy tệp plugin: ' + file + ' — chạy "npm install" trước.');
  const r = patchPluginSource(fs.readFileSync(file, 'utf8'));
  if (r.applied.length) fs.writeFileSync(file, r.src, 'utf8');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const file = path.join(ROOT, PLUGIN_JAVA);
    if (!fs.existsSync(file) && !process.argv.includes('--strict')) {
      console.warn('patch-plugins: CẢNH BÁO — chưa thấy tệp plugin native-purchases (' + PLUGIN_JAVA + '). Bỏ qua; "npm run sync" (--strict) sẽ báo lỗi nếu vẫn thiếu.');
      process.exit(0);
    }
    const r = patchPluginFile(file);
    console.log(r.applied.length ? `patch-plugins: đã vá native-purchases (${r.applied.join(', ')})` : 'patch-plugins: native-purchases đã được vá từ trước');
  } catch (e) {
    console.error('patch-plugins: LỖI — ' + e.message);
    process.exit(1);
  }
}
