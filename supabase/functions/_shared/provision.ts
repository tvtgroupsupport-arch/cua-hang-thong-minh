// ============================================================
// Dùng chung cho 3 hàm provision-* (tự tạo Supabase cho cửa hàng qua OAuth + Management API).
// ============================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

export const API = 'https://api.supabase.com';
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
export const CLIENT_ID = Deno.env.get('SB_OAUTH_CLIENT_ID') ?? '';
export const CLIENT_SECRET = Deno.env.get('SB_OAUTH_CLIENT_SECRET') ?? '';
export const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/provision-callback`;

// App chạy trong WebView (origin https://localhost) gọi khác nguồn → cần trả lời bước kiểm tra OPTIONS.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export function adminClient() {
  return createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/** Xác định ĐÚNG chủ cửa hàng đang gọi bằng token đăng nhập của họ (không tin gì trong body). */
export async function callerInfo(req: Request): Promise<{ id: string; email: string } | null> {
  const client = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data, error } = await client.auth.getUser();
  return error || !data?.user ? null : { id: data.user.id, email: String(data.user.email ?? '').trim().toLowerCase() };
}
export async function callerId(req: Request): Promise<string | null> {
  return (await callerInfo(req))?.id ?? null;
}

export function b64url(bytes: Uint8Array): string {
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function randomB64url(n = 32): string { return b64url(crypto.getRandomValues(new Uint8Array(n))); }
export function randomHex(n: number): string {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256b64url(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

export interface MgResult { ok: boolean; status: number; data: any }
/** Gọi Supabase Management API bằng token uỷ quyền của chủ cửa hàng. Không bao giờ ném lỗi mạng ra ngoài. */
export async function mg(token: string, method: string, path: string, body?: unknown): Promise<MgResult> {
  try {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* giữ nguyên chuỗi */ }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: (e as Error).message } };
  }
}

/** Đổi lỗi kỹ thuật của Supabase sang câu tiếng Việt chủ cửa hàng hiểu được. */
export function viError(res: MgResult, what: string): string {
  const raw = typeof res.data === 'string' ? res.data : (res.data?.message ?? JSON.stringify(res.data ?? ''));
  if (/limit|maximum|quota|exceed/i.test(raw) && /project/i.test(raw)) {
    return 'Tài khoản Supabase của bạn đã đủ số dự án miễn phí. Hãy tạm dừng hoặc xoá một dự án cũ trên supabase.com (hoặc nâng cấp gói) rồi bấm "Tiếp tục".';
  }
  if (res.status === 401 || res.status === 403) {
    return `Supabase từ chối quyền (${what}). Hãy huỷ rồi thử lại từ đầu và nhớ bấm "Authorize" cho đủ quyền.`;
  }
  if (res.status === 429) return 'Supabase đang giới hạn tốc độ yêu cầu — đợi một phút rồi bấm "Tiếp tục".';
  return `${what} thất bại (${res.status}): ${String(raw).slice(0, 300)}`;
}
