// ============================================================
// provision-start — chủ cửa hàng bấm "Tạo tự động" trong app → hàm này tạo (hoặc nối lại) một "phiên" tạo
// Supabase và trả về đường dẫn uỷ quyền của Supabase để app mở trong trình duyệt.
//
// Chống tạo trùng: nếu đã có phiên đang dở (đã tạo dự án hoặc đã xong) thì NỐI LẠI phiên đó, tuyệt đối không
// tạo dự án thứ hai (mỗi tài khoản miễn phí chỉ có vài dự án).
//
// Triển khai: supabase functions deploy provision-start
// Cần secret: SB_OAUTH_CLIENT_ID, SB_OAUTH_CLIENT_SECRET (xem HUONG-DAN-TU-DONG-SUPABASE.md)
// ============================================================
import { CLIENT_ID, CLIENT_SECRET, CORS, REDIRECT_URI, adminClient, callerId, json, randomB64url, sha256b64url, API } from '../_shared/provision.ts';

const AUTH_MAX_AGE_MS = 15 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Chỉ nhận POST' }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ error: 'Máy chủ chưa cấu hình kết nối Supabase (thiếu SB_OAUTH_CLIENT_ID/SB_OAUTH_CLIENT_SECRET)' }, 500);

  const owner = await callerId(req);
  if (!owner) return json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' }, 401);

  // Script SQL đồng bộ do app tạo (chứa khoá riêng của cửa hàng); chỉ chạy trên dự án Supabase CỦA CHÍNH chủ cửa hàng, không đụng tới máy chủ trung tâm.
  let storeSql = '';
  try { const b = await req.json(); storeSql = typeof b?.sql === 'string' ? b.sql : ''; } catch { /* không có body */ }
  if (storeSql.length < 500 || storeSql.length > 300000 || !storeSql.includes('pos_records')) return json({ error: 'Thiếu hoặc sai script SQL đồng bộ — hãy cập nhật app lên bản mới nhất' }, 400);

  const admin = adminClient();


  // Dọn phiên cũ bỏ dở quá 1 ngày (chưa xong) của mọi người — không để token uỷ quyền nằm lại lâu.
  await admin.from('provision_jobs').delete().neq('state', 'done').lt('updated_at', new Date(Date.now() - 86400000).toISOString());

  const { data: job } = await admin.from('provision_jobs').select('*').eq('owner_id', owner).maybeSingle();
  if (job) {
    const hasProject = !!job.project_ref;
    if (job.state !== 'done' && job.state !== 'awaiting_auth') await admin.from('provision_jobs').update({ store_sql: storeSql }).eq('owner_id', owner);
    if (job.state === 'done') return json({ resume: true });
    if (job.state === 'error') {
      // Lỗi SAU khi đã tạo dự án và còn token → làm lại đúng bước lỗi, không tạo dự án mới.
      if (hasProject && job.access_token && job.failed_state) {
        await admin.from('provision_jobs').update({ state: job.failed_state, error: null, failed_state: null, attempts: 0, updated_at: new Date().toISOString() }).eq('owner_id', owner);
        return json({ resume: true });
      }
    } else if (job.state !== 'awaiting_auth') {
      return json({ resume: true });
    } else if (Date.now() - Date.parse(job.created_at) < AUTH_MAX_AGE_MS && job.nonce && job.code_verifier) {
      // Đang chờ đồng ý và chưa quá cũ → dùng lại đúng đường dẫn uỷ quyền đó.
      return json({ authorize_url: await authorizeUrl(job.nonce, job.code_verifier) });
    }
    await admin.from('provision_jobs').delete().eq('owner_id', owner);
  }

  const nonce = randomB64url(24);
  const verifier = randomB64url(48);
  const { error } = await admin.from('provision_jobs').insert({ owner_id: owner, state: 'awaiting_auth', nonce, code_verifier: verifier, store_sql: storeSql });
  if (error) return json({ error: `Không tạo được phiên: ${error.message}` }, 500);

  return json({ authorize_url: await authorizeUrl(nonce, verifier) });
});

async function authorizeUrl(nonce: string, verifier: string): Promise<string> {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', state: nonce,
    code_challenge: await sha256b64url(verifier), code_challenge_method: 'S256',
  });
  return `${API}/v1/oauth/authorize?${p}`;
}
