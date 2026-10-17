// ============================================================
// provision-step — app gọi lặp lại (vài giây/lần) để đẩy phiên tạo Supabase đi tiếp MỘT đoạn. Mỗi lần gọi chạy
// các bước nhanh liên tiếp và dừng ở chỗ phải chờ (chờ chủ cửa hàng đồng ý, chờ dự án khởi động) — tránh một yêu cầu
// chạy quá lâu trong Edge Function.
//
// Các bước (state): awaiting_auth → authorized → org_ok → creating → healthy → keyed → sql_ok → done
//   authorized: lấy tổ chức Supabase của chủ cửa hàng      org_ok: tạo dự án mới
//   creating: chờ dự án ACTIVE_HEALTHY                  healthy: lấy khoá anon
//   keyed: chạy script SQL đồng bộ (do app gửi kèm ở provision-start, lưu trong cột store_sql)
//   sql_ok: chờ hàm đồng bộ gọi được qua REST bằng khoá anon (API cần vài giây nạp lược đồ)
// Lỗi → state='error' kèm failed_state; provision-start sẽ NỐI LẠI đúng bước đó (không tạo dự án thứ hai).
//
// Triển khai: supabase functions deploy provision-step
// ============================================================
import { CORS, adminClient, callerInfo, json, mg, randomHex, viError } from '../_shared/provision.ts';

const STEP_INDEX: Record<string, number> = {
  awaiting_auth: 1, authorized: 2, org_ok: 3, creating: 4, healthy: 5, keyed: 6, sql_ok: 7, done: 8,
};
const TOTAL_STEPS = 8;
const MESSAGES: Record<string, string> = {
  awaiting_auth: 'Đang chờ bạn đồng ý trên trang Supabase…',
  authorized: 'Đang kiểm tra tài khoản Supabase…',
  org_ok: 'Đang tạo dự án dữ liệu cho cửa hàng…',
  creating: 'Dự án đang khởi động (khoảng 1–2 phút)…',
  healthy: 'Đang lấy khoá kết nối…',
  keyed: 'Đang dựng bảng dữ liệu cho cửa hàng…',
  sql_ok: 'Đang kiểm tra hàm đồng bộ…',
  done: 'Hoàn tất',
};
const MAX_ATTEMPTS = 40;
/** Phiên done cũ hơn mốc này mới kiểm tra kho còn sống không (tránh báo nhầm do DNS của dự án vừa tạo chưa kịp lan ra). */
const RECHECK_AFTER_MS = 10 * 60 * 1000;

/** Hàm pos_ping phải gọi được qua REST bằng khoá anon (200 = hàm có trong lược đồ; khoá riêng chưa biết nên kết quả ok:false là bình thường). */
async function syncFnLive(ref: string, anonKey: string): Promise<boolean> {
  try {
    const r = await fetch(`https://${ref}.supabase.co/rest/v1/rpc/pos_ping`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_key: 'kiem-tra-ket-noi-kiem-tra-ket-noi' }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch { return false; }
}

/** Dự án còn tồn tại không? Tên miền không phân giải / 404 = đã bị xoá; có trả lời HTTP bất kỳ (kể cả 401/540) = còn. */
async function projectAlive(url: string, anonKey: string): Promise<'alive' | 'gone' | 'unknown'> {
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(8000) });
    return r.status === 404 ? 'gone' : 'alive';
  } catch (e) {
    return /dns|resolve|lookup|name or service|no such host|not known/i.test(String((e as Error).message)) ? 'gone' : 'unknown';
  }
}   // ~40 lần chờ x 5 giây của app ≈ 3–4 phút cho một bước

const DB_PASS_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomPassword(n = 28): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => DB_PASS_CHARS[b % DB_PASS_CHARS.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Chỉ nhận POST' }, 405);

  const caller = await callerInfo(req);
  if (!caller) return json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' }, 401);
  const owner = caller.id;
  const ownerEmail = caller.email;   // email chủ cửa hàng đã nhập trong app — tài khoản Supabase PHẢI dùng đúng email này

  const admin = adminClient();
  const { data: loaded } = await admin.from('provision_jobs').select('*').eq('owner_id', owner).maybeSingle();
  if (!loaded) return json({ error: 'Chưa có phiên tạo Supabase — hãy bấm "Tạo tự động" trước' }, 404);
  const job = loaded as Record<string, any>;

  const save = async (patch: Record<string, unknown>) => {
    Object.assign(job, patch);
    job.updated_at = new Date().toISOString();
    await admin.from('provision_jobs').update({ ...patch, updated_at: job.updated_at }).eq('owner_id', owner);
  };
  /** Dự án đã bị xoá trên Supabase → xoá phiên để bấm "Tạo tự động" lại sẽ tạo kho MỚI thay vì nối lại kho đã mất. */
  const gone = async () => {
    await admin.from('provision_jobs').delete().eq('owner_id', owner);
    return json({ state: 'error', step: STEP_INDEX[job.state] ?? 0, total: TOTAL_STEPS,
      message: 'Kho dữ liệu đã tạo trước đó không còn tồn tại (có thể đã bị xoá trên Supabase). Bấm "Tiếp tục / thử lại" để tạo một kho mới.' });
  };
  const reply = (extra: Record<string, unknown> = {}) =>
    json({ state: job.state, step: STEP_INDEX[job.state] ?? 0, total: TOTAL_STEPS, message: MESSAGES[job.state] ?? '', ...extra });
  const fail = async (message: string) => {
    await save({ state: 'error', failed_state: job.state === 'error' ? job.failed_state : job.state, error: message });
    return json({ state: 'error', step: STEP_INDEX[job.failed_state] ?? 0, total: TOTAL_STEPS, message });
  };
  /** Chưa xong ở bước này (đang chờ) — đếm số lần để không chờ vô hạn. */
  const waiting = async (why: string) => {
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) return await fail(`Chờ quá lâu ở bước: ${why}. Bấm "Tiếp tục" để thử lại.`);
    await save({ attempts });
    return reply();
  };

  try {
    for (let guard = 0; guard < 12; guard++) {
      const token: string = job.access_token ?? '';
      switch (job.state) {
        case 'awaiting_auth':
          return reply();

        case 'done': {
          // Phiên đã xong từ lâu mà chưa được liên kết: kiểm tra kho còn sống không, nếu đã bị xoá thì không trả địa chỉ chết về cho app.
          const age = Date.now() - Date.parse(job.updated_at ?? '');
          if (age > RECHECK_AFTER_MS && job.project_url && job.anon_key) {
            if (await projectAlive(job.project_url, job.anon_key) === 'gone') return await gone();
          }
          return reply({ url: job.project_url, anon_key: job.anon_key });
        }

        case 'error':
          return json({ state: 'error', step: STEP_INDEX[job.failed_state] ?? 0, total: TOTAL_STEPS, message: job.error ?? 'Có lỗi xảy ra' });

        case 'authorized': {
          const orgs = await mg(token, 'GET', '/v1/organizations');
          if (!orgs.ok) return await fail(viError(orgs, 'Đọc tổ chức Supabase'));
          const list = Array.isArray(orgs.data) ? orgs.data : [];
          if (!list.length) return await fail('Tài khoản Supabase của bạn chưa có tổ chức nào. Hãy tạo một tổ chức trên supabase.com rồi bấm "Tiếp tục".');

          // Trình duyệt dùng tài khoản Supabase ĐANG ĐĂNG NHẬP sẵn (có thể là tài khoản GitHub với email khác). Chỉ chấp nhận
          // tổ chức mà email chủ cửa hàng là chủ/quản trị — không khớp thì dừng TRƯỚC khi tạo dự án và cho làm lại từ đầu.
          let chosen: string | null = null;
          for (const o of list.slice(0, 10)) {
            const slug = o.slug ?? o.id;
            const m = await mg(token, 'GET', `/v1/organizations/${encodeURIComponent(slug)}/members`);
            if (!m.ok) continue;
            const mine = (Array.isArray(m.data) ? m.data : []).find((x: any) =>
              String(x?.email ?? x?.primary_email ?? '').trim().toLowerCase() === ownerEmail);
            if (mine && /owner|admin/i.test(String(mine.role_name ?? 'owner'))) { chosen = slug; break; }
          }
          if (!chosen) {
            // Xoá phiên (kèm token vừa nhận) để bấm "Tạo tự động" lại sẽ xin uỷ quyền mới, không dùng lại tài khoản sai.
            await admin.from('provision_jobs').delete().eq('owner_id', owner);
            return json({
              state: 'error', step: 2, total: TOTAL_STEPS,
              message: `Tài khoản Supabase bạn vừa đồng ý không dùng email ${ownerEmail}. Hãy đăng xuất Supabase trong trình duyệt (hoặc mở cửa sổ ẩn danh), `
                + `đăng nhập hoặc đăng ký Supabase bằng đúng email ${ownerEmail}, rồi bấm "Tạo tự động" lại.`,
            });
          }
          await save({ org_slug: chosen, state: 'org_ok', attempts: 0 });
          continue;
        }

        case 'org_ok': {
          // API đang đổi cách chọn vùng: thử lần lượt các kiểu khai báo vùng, chỉ lùi khi báo 400 (sai định dạng).
          const base = { name: `taphoa-${randomHex(3)}`, organization_slug: job.org_slug, db_pass: randomPassword() };
          const attempts = [
            { ...base, region_selection: { type: 'specific', code: 'ap-southeast-1' } },
            { ...base, region: 'ap-southeast-1' },
            base,
          ];
          let res = null as Awaited<ReturnType<typeof mg>> | null;
          for (const body of attempts) {
            res = await mg(token, 'POST', '/v1/projects', body);
            if (res.ok || res.status !== 400) break;
          }
          if (!res || !res.ok) return await fail(viError(res!, 'Tạo dự án Supabase'));
          const ref = res.data?.ref ?? res.data?.id;
          if (!ref) return await fail('Supabase không trả về mã dự án vừa tạo');
          await save({ project_ref: ref, state: 'creating', attempts: 0 });
          continue;
        }

        case 'creating': {
          const p = await mg(token, 'GET', `/v1/projects/${job.project_ref}`);
          if (p.status === 404) return await gone();
          if (!p.ok) {
            if (p.status === 401 || p.status === 403) return await fail(viError(p, 'Đọc trạng thái dự án'));
            return await waiting('chờ dự án khởi động');
          }
          const status = String(p.data?.status ?? '');
          if (status === 'ACTIVE_HEALTHY') { await save({ state: 'healthy', attempts: 0 }); continue; }
          if (/FAILED|REMOVED|GOING_DOWN/.test(status)) return await fail(`Dự án khởi động không thành công (${status}). Hãy xoá dự án đó trên supabase.com rồi thử lại.`);
          return await waiting('chờ dự án khởi động');
        }

        case 'healthy': {
          const k = await mg(token, 'GET', `/v1/projects/${job.project_ref}/api-keys?reveal=true`);
          if (!k.ok) {
            if (k.status === 401 || k.status === 403) return await fail(viError(k, 'Đọc khoá API'));
            return await waiting('lấy khoá API');
          }
          const keys: any[] = Array.isArray(k.data) ? k.data : [];
          // Ưu tiên khoá "anon" (dạng JWT); không có thì dùng khoá "publishable". TUYỆT ĐỐI không lấy service_role/secret.
          const anon = keys.find((x) => x?.name === 'anon' && x?.api_key) ?? keys.find((x) => x?.type === 'publishable' && x?.api_key);
          if (!anon) return await waiting('khoá API chưa sẵn sàng');
          await save({ anon_key: anon.api_key, state: 'keyed', attempts: 0 });
          continue;
        }

        case 'keyed': {
          if (!job.store_sql) return await fail('Thiếu script SQL đồng bộ của cửa hàng — hãy bấm "Tạo tự động" lại từ đầu (sẽ dùng lại dự án đã tạo).');
          const q = await mg(token, 'POST', `/v1/projects/${job.project_ref}/database/query`, { query: job.store_sql });
          if (!q.ok) {
            if (q.status === 401 || q.status === 403) return await fail(viError(q, 'Dựng bảng dữ liệu'));
            // Vừa "healthy" nhưng cơ sở dữ liệu có thể chưa nhận kết nối → thử lại ở lần gọi sau.
            if (q.status === 0 || q.status >= 500 || q.status === 429) return await waiting('dựng bảng dữ liệu');
            return await fail(viError(q, 'Dựng bảng dữ liệu'));
          }
          await save({ state: 'sql_ok', attempts: 0 });
          continue;
        }

        case 'sql_ok': {
          if (!(await syncFnLive(job.project_ref, job.anon_key))) return await waiting('chờ hàm đồng bộ sẵn sàng');
          // Xong: xoá token uỷ quyền và script (chứa khoá riêng của cửa hàng) ngay, chỉ giữ địa chỉ + khoá anon (công khai) cho app lấy.
          await save({
            state: 'done', project_url: `https://${job.project_ref}.supabase.co`,
            access_token: null, refresh_token: null, store_sql: null, failed_state: null, error: null, attempts: 0,
          });
          continue;
        }

        default:
          return await fail(`Trạng thái không hợp lệ: ${job.state}`);
      }
    }
    return reply();
  } catch (e) {
    console.error('provision-step: lỗi không mong đợi:', (e as Error).message);
    return json({ error: `Lỗi máy chủ: ${(e as Error).message}` }, 500);
  }
});
