// ============================================================
// provision-callback — Supabase chuyển trình duyệt của chủ cửa hàng về đây sau khi họ bấm "Authorize".
// Hàm đổi mã (code) lấy token uỷ quyền — bằng client secret CHỈ nằm trên máy chủ — rồi cất vào phiên
// tạm của đúng chủ cửa hàng (tra theo tham số state một lần dùng).
//
// Triển khai: supabase functions deploy provision-callback --no-verify-jwt
//   (bắt buộc --no-verify-jwt: trình duyệt quay về từ Supabase không mang JWT của app. Bảo vệ bằng `state`
//   ngẫu nhiên dùng một lần + PKCE, giống cách rtdn-webhook dùng secret riêng.)
// Trả về VĂN BẢN THUẦN (Supabase không cho trang HTML chạy từ domain mặc định của Edge Function).
// ============================================================
import { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, adminClient, API } from '../_shared/provision.ts';

const MAX_AGE_MS = 30 * 60 * 1000;
const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    if (oauthError) return text(`Bạn đã từ chối hoặc Supabase báo lỗi (${oauthError}). Quay lại ứng dụng và thử lại nếu muốn.`, 400);
    if (!code || !state) return text('Liên kết không hợp lệ.', 400);

    const admin = adminClient();
    const { data: job } = await admin.from('provision_jobs').select('*').eq('nonce', state).maybeSingle();
    if (!job || job.state !== 'awaiting_auth' || !job.code_verifier || Date.now() - Date.parse(job.created_at) > MAX_AGE_MS) {
      return text('Phiên đã hết hạn hoặc không hợp lệ. Quay lại ứng dụng và bấm "Tạo tự động" lại.', 400);
    }

    const r = await fetch(`${API}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        Authorization: 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`),
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: job.code_verifier }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.access_token) {
      console.error('provision-callback: đổi token thất bại', r.status, JSON.stringify(tok).slice(0, 300));
      return text('Không đổi được mã uỷ quyền với Supabase. Quay lại ứng dụng và thử lại.', 502);
    }

    // nonce chỉ dùng MỘT lần: xoá ngay để link này không dùng lại được.
    const { error } = await admin.from('provision_jobs').update({
      state: 'authorized', access_token: tok.access_token, refresh_token: tok.refresh_token ?? null,
      nonce: null, code_verifier: null, updated_at: new Date().toISOString(),
    }).eq('owner_id', job.owner_id);
    if (error) { console.error('provision-callback: ghi phiên thất bại', error.message); return text('Lỗi máy chủ khi lưu phiên. Thử lại sau.', 500); }

    return text('Đã kết nối Supabase thành công. Hãy quay lại ứng dụng — app sẽ tự tạo kho dữ liệu cho cửa hàng của bạn.');
  } catch (e) {
    console.error('provision-callback: lỗi không mong đợi:', (e as Error).message);
    return text('Lỗi không mong đợi. Quay lại ứng dụng và thử lại.', 500);
  }
});
