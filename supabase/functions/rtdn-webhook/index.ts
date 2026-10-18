// ============================================================
// rtdn-webhook — Google gọi tới đây MỖI KHI một gói cước đổi trạng thái (tự gia hạn,
// khách huỷ, hết hạn, vào thời gian ân hạn do thẻ bị từ chối...). Không có bước này,
// app sẽ không biết khi nào khách HUỶ gói trên Google — vẫn tưởng còn hạn mãi.
//
// Luồng: Google Play → Google Cloud Pub/Sub (topic bạn tạo) → Pub/Sub "push" tới đúng
// URL của hàm này. KHÔNG đọc thẳng thông báo để quyết định — luôn gọi lại Google hỏi
// trạng thái THẬT (đúng khuyến cáo chính thức), vì nội dung thông báo có thể đến trễ/cũ.
//
// Triển khai: supabase functions deploy rtdn-webhook --no-verify-jwt
//   (bắt buộc --no-verify-jwt vì Pub/Sub không gửi JWT người dùng Supabase — thay vào đó
//   hàm tự kiểm một mã bí mật riêng trong đường dẫn, xem RTDN_SECRET bên dưới)
// Sau khi deploy, tạo Pub/Sub push subscription trỏ về:
//   https://<project-ref>.functions.supabase.co/rtdn-webhook?secret=<RTDN_SECRET>
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchSubscription, acknowledgeSubscription, isActiveState } from '../_shared/google-play.ts';

const PACKAGE_NAME = Deno.env.get('PLAY_PACKAGE_NAME') ?? '';
const SA_JSON = Deno.env.get('PLAY_SERVICE_ACCOUNT_JSON') ?? '';
const RTDN_SECRET = Deno.env.get('RTDN_SECRET') ?? '';

Deno.serve(async (req) => {
  // Pub/Sub chỉ cần nhận HTTP 200 là coi như đã giao — mọi lỗi dưới đây vẫn trả 200 để
  // Google không lặp lại gửi vô tận, nhưng ghi log rõ để bạn tự biết nếu có vấn đề.
  const ok = (extra?: unknown) => new Response(JSON.stringify({ ok: true, ...(extra as object) }), { status: 200 });

  try {
    if (req.method !== 'POST') return ok({ skipped: 'not POST' });
    const url = new URL(req.url);
    if (!RTDN_SECRET || url.searchParams.get('secret') !== RTDN_SECRET) {
      console.error('rtdn-webhook: sai hoặc thiếu secret — có thể không phải Google gọi tới');
      return new Response('forbidden', { status: 403 });
    }
    if (!PACKAGE_NAME || !SA_JSON) { console.error('rtdn-webhook: thiếu cấu hình PLAY_PACKAGE_NAME/PLAY_SERVICE_ACCOUNT_JSON'); return ok(); }

    const envelope = await req.json();
    const dataB64 = envelope?.message?.data;
    if (!dataB64) return ok({ skipped: 'không có message.data' });
    const payload = JSON.parse(atob(dataB64));
    if (payload.packageName && payload.packageName !== PACKAGE_NAME) return ok({ skipped: 'sai packageName' });

    // Gói có log test "chào hỏi" riêng (testNotification), không phải sự kiện thật — bỏ qua êm
    const n = payload.subscriptionNotification;
    if (!n?.purchaseToken) return ok({ skipped: 'không phải thông báo gói cước' });

    const sa = JSON.parse(SA_JSON);
    const sub = await fetchSubscription(sa, PACKAGE_NAME, n.purchaseToken);
    const line = sub.lineItems?.[0];
    if (!line) return ok({ skipped: 'không có lineItem' });

    // Giao dịch tạo thẳng trên Google Play (nút "Đăng ký lại"…) chưa ai xác nhận: Google tự HOÀN TIỀN sau 3 ngày nếu không xác nhận.
    // Xác nhận ngay tại đây, không phụ thuộc đã biết chủ hay chưa (quyền lợi được cấp khi app gửi mã lên qua verify-purchase).
    if (sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' && isActiveState(sub.subscriptionState)) {
      try { await acknowledgeSubscription(sa, PACKAGE_NAME, line.productId, n.purchaseToken); }
      catch (e) { console.error('rtdn-webhook: xác nhận giao dịch thất bại:', (e as Error).message); }
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // RTDN của lần mua ĐẦU TIÊN có thể tới TRƯỚC cả khi verify-purchase (do máy khách) kịp chạy
    // xong — lúc đó record chưa có owner_id. Tra theo obfuscatedExternalAccountId để vẫn ghi nhận
    // đúng người, không bỏ sót.
    let owner: string | null = null;
    const { data: found } = await admin.rpc('find_play_purchase_owner', { p_purchase_token: n.purchaseToken });
    owner = found ?? sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null;
    // Đăng ký lại gói đã huỷ nhưng chưa hết hạn: mã mới không mang mã tài khoản, nhưng nối tiếp mã cũ đã có chủ.
    if (!owner && sub.linkedPurchaseToken) {
      const { data: lineage } = await admin.rpc('find_play_purchase_owner', { p_purchase_token: sub.linkedPurchaseToken });
      owner = lineage ?? null;
    }
    // Vẫn không rõ (đăng ký lại sau khi hết hạn): bỏ qua, app sẽ gửi mã lên khi chủ cửa hàng mở màn Gói cước.
    if (!owner) { console.error('rtdn-webhook: chưa tra được chủ sở hữu, chờ app gửi mã lên:', n.purchaseToken); return ok({ skipped: 'chưa rõ chủ sở hữu — chờ app gửi lên' }); }

    const { error } = await admin.rpc('record_play_purchase', {
      p_owner: owner, p_purchase_token: n.purchaseToken, p_product_id: line.productId,
      p_expires_at: line.expiryTime, p_state: isActiveState(sub.subscriptionState) ? 'active' : 'expired',
      p_raw: { ...sub, _rtdn_notificationType: n.notificationType },
    });
    if (error) {
      // Lỗi tạm thời (DB/mạng) → 500 để Pub/Sub gửi lại; lỗi dữ liệu vĩnh viễn (sai mã gói, token của người khác) → 200 để khỏi lặp vô tận.
      console.error('rtdn-webhook: ghi nhận thất bại:', error.message);
      if (error.code === '22023' || error.code === '42501') return ok({ skipped: error.message });
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return ok({ state: sub.subscriptionState });
  } catch (e) {
    // Lỗi gọi Google / mạng → trả 500 để Pub/Sub tự gửi lại; chỉ riêng JSON hỏng (không bao giờ thành công) mới trả 200.
    console.error('rtdn-webhook: lỗi không mong đợi:', (e as Error).message);
    if (e instanceof SyntaxError) return ok({ error: (e as Error).message });
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
