// ============================================================
// Gọi Google Play Developer API — dùng chung cho verify-purchase và rtdn-webhook.
// Xác thực bằng tài khoản dịch vụ (service account): tự ký một JWT bằng khoá riêng
// (KHÔNG BAO GIỜ rời khỏi máy chủ này), đổi lấy access_token từ Google, rồi dùng
// access_token đó gọi API thật.
//
// Endpoint xác nhận đúng tới ngày viết (đã tra cứu, không đoán):
//   - Xem trạng thái:  GET  .../purchases/subscriptionsv2/tokens/{token}
//   - Xác nhận mua:    POST .../purchases/subscriptions/{productId}/tokens/{token}:acknowledge
//     (endpoint "acknowledge" VẪN dùng đường dẫn v1 cũ — Google chưa chuyển hẳn sang v2
//     cho việc này, xác nhận qua tài liệu phát hành tháng 11/2025 của chính Google).
//   Chỉ các đơn mua MỚI cần xác nhận trong vòng 3 ngày (không xác nhận = Google tự hoàn
//   tiền và thu hồi) — gia hạn tự động không cần xác nhận lại.
// ============================================================

interface ServiceAccountKey { client_email: string; private_key: string; }

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = ''; for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Ký JWT bằng khoá riêng của service account (RS256), đổi lấy access_token còn hạn ~1 giờ. */
async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const enc = new TextEncoder();
  const signingInput = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(claims)))}`;

  // Khoá PEM (PKCS8) → CryptoKey để ký bằng Web Crypto chuẩn của Deno, không cần thư viện ngoài.
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Không lấy được access_token từ Google: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

export interface SubscriptionPurchaseV2 {
  subscriptionState: string;   // SUBSCRIPTION_STATE_ACTIVE | _CANCELED | _IN_GRACE_PERIOD | _ON_HOLD | _PAUSED | _EXPIRED | _PENDING
  acknowledgementState: string; // ACKNOWLEDGEMENT_STATE_PENDING | _ACKNOWLEDGED
  lineItems: Array<{ productId: string; expiryTime: string; offerDetails?: { basePlanId?: string; offerId?: string }; offerPhase?: { freeTrial?: unknown } }>;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  /** Mã giao dịch CŨ mà giao dịch này nối tiếp (đăng ký lại gói đã huỷ nhưng chưa hết hạn, đổi gói…) — dùng để tìm đúng chủ khi thiếu mã tài khoản. */
  linkedPurchaseToken?: string;
  latestOrderId?: string;
}

/** Nguồn sự thật duy nhất về trạng thái một lượt mua — luôn gọi hàm này để biết thật sự
    đơn đó có hợp lệ hay không, KHÔNG BAO GIỜ tin dữ liệu app tự gửi lên. */
export async function fetchSubscription(sa: ServiceAccountKey, packageName: string, purchaseToken: string): Promise<SubscriptionPurchaseV2> {
  const token = await getAccessToken(sa);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Google Play API báo lỗi (${r.status}): ${JSON.stringify(j)}`);
  return j as SubscriptionPurchaseV2;
}

/** Bắt buộc gọi trong vòng 3 ngày sau lần mua ĐẦU TIÊN — không gọi là Google tự hoàn tiền. */
export async function acknowledgeSubscription(sa: ServiceAccountKey, packageName: string, productId: string, purchaseToken: string): Promise<void> {
  const token = await getAccessToken(sa);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`Xác nhận giao dịch thất bại (${r.status}): ${JSON.stringify(j)}`); }
}

// CANCELED = khách đã tắt tự gia hạn nhưng đã trả tiền → vẫn được dùng tới expiryTime (SQL tự kiểm expires_at > now()).
const ACTIVE_STATES = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']);
export function isActiveState(state: string): boolean { return ACTIVE_STATES.has(state); }
