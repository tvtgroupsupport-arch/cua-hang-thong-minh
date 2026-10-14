/* Đường truyền tới Supabase (PostgREST RPC). Trả về hàm rpc(tênHàm, thamSố) → kết quả JSON. Dễ thay thế khi kiểm thử. */
export class SyncError extends Error {
  constructor(msg, code) { super(msg); this.name = 'SyncError'; this.code = code; }
}

/** Chuẩn hoá địa chỉ dự án: bỏ khoảng trắng, "/" cuối và "/rest/v1"; tự thêm https:// nếu người dùng chỉ dán tên miền. */
export function normalizeUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
  if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}
export function validUrl(u) { try { const x = new URL(normalizeUrl(u)); return /^https:$/.test(x.protocol) || x.hostname === 'localhost'; } catch (e) { return false; } }

export function httpTransport({ url, anon, timeoutMs = 30000 }) {
  const base = normalizeUrl(url);
  return async function rpc(fn, args) {
    const headers = { 'Content-Type': 'application/json', apikey: anon };
    if (/^eyJ/.test(anon)) headers.Authorization = 'Bearer ' + anon;           // khoá kiểu JWT cũ; khoá "publishable" mới chỉ cần apikey
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = setTimeout(() => ctl && ctl.abort(), timeoutMs);
    let res;
    try { res = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args || {}), signal: ctl ? ctl.signal : undefined }); }
    catch (e) { throw new SyncError(e && e.name === 'AbortError' ? 'Máy chủ không phản hồi (quá ' + Math.round(timeoutMs / 1000) + ' giây)' : 'Không kết nối được máy chủ (kiểm tra mạng và địa chỉ dự án)', 'network'); }
    finally { clearTimeout(t); }
    let body = null; try { body = await res.json(); } catch (e) { /* thân rỗng */ }
    if (!res.ok) {
      const code = body && (body.code || body.error_code), msg = body && (body.message || body.error_description || body.msg) || '';
      if (code === 'PGRST202' || res.status === 404) throw new SyncError('Dự án chưa có các hàm đồng bộ — hãy chạy script SQL trong Supabase → SQL Editor (hoặc địa chỉ dự án sai).', 'nofn');
      if (res.status === 401 || res.status === 403 || /apikey|JWT|api key/i.test(msg)) throw new SyncError('Khoá anon/publishable của dự án không đúng.', 'anon');
      if (res.status === 503 || res.status === 502 || res.status === 504 || /paused|timeout/i.test(msg)) throw new SyncError('Dự án Supabase đang tạm dừng hoặc quá tải — mở dashboard Supabase để bật lại (gói miễn phí tự tạm dừng sau 7 ngày không hoạt động).', 'paused');
      throw new SyncError('Lỗi máy chủ (' + res.status + '): ' + (msg || 'không rõ'), 'server');
    }
    return body;
  };
}
