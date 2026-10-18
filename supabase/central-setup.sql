-- ============================================================================
--  TẠP HÓA — script dựng Supabase TRUNG TÂM (của nhà cung cấp phần mềm)
--  (thiết kế theo app BEPO: tài khoản chủ cửa hàng + gói cước + tự tạo Supabase cho từng cửa hàng)
-- ============================================================================
--  Dự án này CHỈ chứa: tài khoản chủ cửa hàng, gói cước, yêu cầu gia hạn, địa chỉ Supabase riêng của từng cửa hàng và phiên tự tạo Supabase tạm thời.
--  KHÔNG chứa dữ liệu bán hàng của cửa hàng nào (dữ liệu nằm ở Supabase riêng của từng cửa hàng, cần khoá riêng mới đọc được).
--
--  Cách dùng:
--   1. Tạo dự án Supabase của bạn → SQL Editor → dán toàn bộ tệp này → Run (chạy lại nhiều lần an toàn).
--   2. Authentication → Providers → Email: nên BẬT "Confirm email". Nếu để TẮT thì chủ cửa hàng đăng ký xong dùng được ngay.
--   3. Đặt chính bạn làm admin (thay email) và chạy riêng một lần:
--        insert into public.admins (user_id) select id from auth.users where email = 'email-cua-ban@example.com';
--      (đăng ký tài khoản đó trong trang admin/index.html trước)
--   4. Chép Project URL + khoá anon/publishable vào GitHub Secrets CENTRAL_SUPABASE_URL / CENTRAL_SUPABASE_ANON_KEY rồi build lại APK.
--   5. trial_days = số ngày dùng thử cấp cho tài khoản MỚI (tính từ lúc tạo tài khoản). Mặc định 14; đặt 0 = không dùng thử từ máy chủ.
--   6. Muốn dùng "Tạo kho tự động bằng OAuth": làm theo HUONG-DAN-TU-DONG-SUPABASE.md (OAuth App + triển khai 3 Edge Function provision-*).
-- ============================================================================

create table if not exists public.app_config (key text primary key, value text not null);
insert into public.app_config (key, value) values ('trial_days', '14') on conflict (key) do nothing;

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  shop_name  text,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (user_id uuid primary key references auth.users (id) on delete cascade);

create table if not exists public.subscriptions (
  owner_id    uuid primary key references auth.users (id) on delete cascade,
  plan_months int  not null default 0,
  status      text not null default 'trial' check (status in ('trial', 'active', 'expired')),
  -- 'manual' = admin duyệt tay sau chuyển khoản (request_renewal / admin_approve_renewal). 'google_play' = xác minh tự động qua Google Play Billing (verify-purchase / rtdn-webhook).
  source      text not null default 'manual' check (source in ('manual', 'google_play')),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);
-- Chạy lại trên dự án đã có bảng cũ (chưa có các cột này)
alter table public.subscriptions add column if not exists source text not null default 'manual';
-- Hạn do ADMIN cộng thêm tay cho tài khoản dùng Google Play: cập nhật từ Google không được làm mất phần này (hạn cuối = lớn hơn giữa ngày Google báo và bonus_until).
alter table public.subscriptions add column if not exists bonus_until timestamptz;
alter table public.subscriptions drop constraint if exists subscriptions_source_check;
alter table public.subscriptions add constraint subscriptions_source_check check (source in ('manual', 'google_play'));

create table if not exists public.store_links (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  url        text not null,
  anon_key   text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.renewal_requests (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  plan_months int  not null check (plan_months in (1, 6, 12)),
  note        text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid
);
create index if not exists renewal_requests_owner_idx on public.renewal_requests (owner_id, created_at desc);

/* ============================================================
   GÓI CƯỚC QUA GOOGLE PLAY BILLING
   Chỉ dùng cho bản app riêng "Google Play" (package name khác bản chuyển khoản).
   Luồng: app mua gói → Google trả về purchaseToken → app gửi token đó (KHÔNG gửi gì
   khác, token không phải bí mật nhưng cũng không nên qua tay ai khác ngoài máy chủ
   của chính bạn) tới Edge Function verify-purchase → Edge Function tự gọi Google Play
   Developer API (bằng tài khoản dịch vụ, chỉ máy chủ giữ, KHÔNG BAO GIỜ đưa vào app)
   để XÁC MINH ĐỘC LẬP token đó thật hay giả → mới ghi nhận gói cước.
   Lý do bắt buộc phải xác minh ở máy chủ: client purchaseToken gửi lên là CHƯA ĐÁNG TIN
   — ai đó sửa app hoàn toàn có thể tự bịa một token giả nếu không có bước xác minh độc
   lập này với chính Google.
   ============================================================ */
create table if not exists public.play_purchases (
  purchase_token text primary key,          -- định danh duy nhất Google cấp cho mỗi giao dịch
  owner_id       uuid not null references auth.users (id) on delete cascade,
  product_id     text not null,              -- vd. goi_1_thang / goi_6_thang / goi_12_thang
  plan_months    int  not null,
  state          text not null default 'active' check (state in ('active', 'canceled', 'expired', 'revoked', 'refunded')),
  expires_at     timestamptz not null,
  last_verified  timestamptz not null default now(),
  raw_notification jsonb,                    -- lưu nguyên văn lần RTDN gần nhất, để tra cứu khi cần
  created_at     timestamptz not null default now()
);
create index if not exists play_purchases_owner_idx on public.play_purchases (owner_id);

-- Mã gói (product ID trên Play Console) → số tháng. Sửa lại đúng mã bạn đặt lúc tạo gói trên Play Console.
create table if not exists public.play_products (
  product_id  text primary key,
  plan_months int not null check (plan_months in (1, 6, 12))
);
insert into public.play_products (product_id, plan_months) values
  ('goi_1_thang', 1), ('goi_6_thang', 6), ('goi_12_thang', 12)
  on conflict (product_id) do nothing;

alter table public.play_purchases enable row level security;
alter table public.play_products  enable row level security;
-- Không có policy nào cho client — chỉ Edge Function (dùng service_role, tự bỏ qua RLS) được ghi/đọc thẳng.
-- Chủ cửa hàng xem gói của MÌNH qua get_my_subscription() như cũ (đã tự gồm cả nguồn Google Play).
revoke all on public.play_purchases, public.play_products from anon, authenticated;

/** Edge Function gọi hàm này SAU KHI đã tự xác minh purchaseToken với Google — hàm không tự gọi Google,
    chỉ ghi nhận kết quả đã xác minh. Chỉ service_role gọi được (không grant cho authenticated/anon). */
create or replace function public.record_play_purchase(
  p_owner uuid, p_purchase_token text, p_product_id text,
  p_expires_at timestamptz, p_state text, p_raw jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_months int; v_best_months int; v_best_expiry timestamptz; v_has_active boolean;
        v_bonus timestamptz; v_final timestamptz; v_active boolean; v_store timestamptz;
begin
  if exists (select 1 from public.denied_trial_tokens where purchase_token = p_purchase_token) then
    raise exception 'Máy này đã dùng thử miễn phí rồi' using errcode = '42501';
  end if;
  select plan_months into v_months from public.play_products where product_id = p_product_id;
  if v_months is null then raise exception 'Không nhận ra mã gói: %', p_product_id using errcode = '22023'; end if;

  -- Token đã thuộc về người khác → không cho chuyển chủ (chống nhận trộm token).
  if exists (select 1 from public.play_purchases where purchase_token = p_purchase_token and owner_id <> p_owner) then
    raise exception 'Token này đã thuộc về tài khoản khác' using errcode = '42501';
  end if;

  insert into public.play_purchases (purchase_token, owner_id, product_id, plan_months, state, expires_at, last_verified, raw_notification)
  values (p_purchase_token, p_owner, p_product_id, v_months, p_state, p_expires_at, now(), p_raw)
  on conflict (purchase_token) do update
    set state = excluded.state, expires_at = excluded.expires_at, last_verified = now(), raw_notification = excluded.raw_notification;

  -- Gói cước THẬT theo đúng ngày Google báo. Lấy token đang hiệu lực có hạn xa nhất của chủ cửa hàng,
  -- để token CŨ (đổi gói / đăng ký lại) báo hết hạn không ghi đè gói mới còn hạn.
  select plan_months, expires_at into v_best_months, v_best_expiry
    from public.play_purchases
   where owner_id = p_owner and state = 'active' and expires_at > now()
   order by expires_at desc limit 1;

  v_has_active := v_best_expiry is not null;
  if not v_has_active then   -- không còn token nào hiệu lực → phản ánh token vừa ghi (hết hạn)
    v_best_months := v_months; v_best_expiry := p_expires_at;
  end if;

  -- Giữ phần admin cộng thêm tay (nếu có): hạn cuối là ngày xa hơn giữa Google và bonus_until.
  select bonus_until into v_bonus from public.subscriptions where owner_id = p_owner;
  v_final  := greatest(v_best_expiry, coalesce(v_bonus, v_best_expiry));
  v_active := v_final > now() and (v_has_active or coalesce(v_bonus > now(), false));
  -- Không còn quyền lợi (bị thu hồi/hoàn tiền, tạm giữ do thanh toán lỗi, tạm dừng, hết hạn…) thì hạn lưu cho app KHÔNG được ở tương lai:
  -- app (license.js) tính trạng thái chỉ từ expires_at, nên một gói bị thu hồi mà expires_at còn xa sẽ vẫn hiện "còn hạn".
  v_store := case when v_active then v_final else least(v_final, now()) end;

  insert into public.subscriptions (owner_id, plan_months, status, source, started_at, expires_at)
  values (p_owner, v_best_months, case when v_active then 'active' else 'expired' end,
          'google_play', now(), v_store)
  on conflict (owner_id) do update
    set plan_months = v_best_months, source = 'google_play', expires_at = v_store,
        status = case when v_active then 'active' else 'expired' end,
        updated_at = now()
    -- Không cho một token HẾT HẠN ghi đè gói đang còn hiệu lực từ nguồn khác (dùng thử / admin gia hạn tay).
    where v_active or public.subscriptions.source = 'google_play' or public.subscriptions.expires_at <= now();
end $$;

/** Edge Function tra owner_id từ purchaseToken khi nhận RTDN (Google chỉ gửi kèm token, không gửi owner_id). */
create or replace function public.find_play_purchase_owner(p_purchase_token text) returns uuid
language sql stable security definer set search_path = public as $$
  select owner_id from public.play_purchases where purchase_token = p_purchase_token;
$$;

revoke execute on function public.record_play_purchase(uuid, text, text, timestamptz, text, jsonb),
  public.find_play_purchase_owner(text) from public, anon, authenticated;
-- Không grant cho ai cả — chỉ service_role (Edge Function) gọi được, service_role luôn có toàn quyền mặc định.

-- ---------- Dùng thử miễn phí của Google Play: chỉ 1 lần cho mỗi máy ----------
create table if not exists public.trial_devices (
  device_hash text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  first_seen  timestamptz not null default now()
);
alter table public.trial_devices enable row level security;
revoke all on public.trial_devices from anon, authenticated;

-- Google chỉ cấp ưu đãi dùng thử 1 lần cho mỗi TÀI KHOẢN GOOGLE; người dùng đổi tài khoản Google (hoặc tạo tài khoản mới) trên cùng một máy vẫn lấy lại được.
-- verify-purchase gọi hàm này khi giao dịch là dùng thử: máy đã dùng thử bằng một giao dịch KHÁC thì từ chối, không ghi nhận và không xác nhận với Google
-- (giao dịch không xác nhận sau 3 ngày Google tự huỷ). Chỉ lưu mã băm của Android ID.
alter table public.trial_devices add column if not exists trial_token text;
create table if not exists public.denied_trial_tokens (
  purchase_token text primary key,
  created_at     timestamptz not null default now()
);
alter table public.denied_trial_tokens enable row level security;
revoke all on public.denied_trial_tokens from anon, authenticated;

create or replace function public.claim_trial_use(p_owner uuid, p_device_id text, p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare v_hash text; v_tok text;
begin
  if exists (select 1 from public.denied_trial_tokens where purchase_token = p_token) then return 'used'; end if;
  if p_device_id is null or length(btrim(p_device_id)) < 8 then return 'skipped'; end if;
  v_hash := encode(sha256(convert_to('taphoa:' || btrim(p_device_id), 'UTF8')), 'hex');
  insert into public.trial_devices (device_hash, owner_id) values (v_hash, p_owner) on conflict do nothing;
  select trial_token into v_tok from public.trial_devices where device_hash = v_hash for update;
  if v_tok is not null and v_tok <> p_token then
    insert into public.denied_trial_tokens (purchase_token) values (p_token) on conflict do nothing;
    return 'used';
  end if;
  update public.trial_devices set trial_token = p_token where device_hash = v_hash and trial_token is null;
  return 'ok';
end $$;
revoke execute on function public.claim_trial_use(uuid, text, text) from public, anon, authenticated;

/* ============================================================
   TỰ TẠO SUPABASE CHO CỬA HÀNG (OAuth + Management API)
   Chủ cửa hàng bấm "Tạo tự động" trong app → đồng ý một lần trên trang Supabase → các Edge Function provision-start / provision-callback /
   provision-step tạo dự án, chạy script SQL đồng bộ (do app gửi kèm khi bắt đầu) rồi trả địa chỉ + khoá anon cho app.
   Bảng này giữ TẠM trạng thái từng bước và token uỷ quyền của Supabase. Token chỉ tồn tại tới khi xong (xoá ngay khi state = 'done').
   Không client nào đọc/ghi được — chỉ Edge Function (service_role).
   ============================================================ */
create table if not exists public.provision_jobs (
  owner_id      uuid primary key references auth.users (id) on delete cascade,
  state         text not null default 'awaiting_auth',
  nonce         text unique,            -- = tham số "state" của OAuth, dùng MỘT lần để gắn lời đồng ý với đúng chủ cửa hàng
  code_verifier text,                   -- PKCE
  access_token  text,
  refresh_token text,
  org_slug      text,
  project_ref   text,
  project_url   text,
  anon_key      text,
  store_sql     text,                   -- script SQL đồng bộ (chứa khoá riêng của cửa hàng) — xoá khi xong
  failed_state  text,                   -- bước đang chạy khi lỗi, để "Tiếp tục" làm lại đúng bước đó (không tạo dự án thứ hai)
  error         text,
  attempts      int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.provision_jobs add column if not exists store_sql text;
alter table public.provision_jobs enable row level security;
revoke all on public.provision_jobs from anon, authenticated;

-- ---------- Tài khoản mới: tự tạo hồ sơ + gói dùng thử ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_days int := coalesce((select value::int from public.app_config where key = 'trial_days'), 0);
begin
  insert into public.profiles (id, email, shop_name)
  values (new.id, new.email, left(coalesce(new.raw_user_meta_data ->> 'shop_name', ''), 120))
  on conflict do nothing;

  insert into public.subscriptions (owner_id, plan_months, status, expires_at)
  values (new.id, 0, 'trial', now() + make_interval(days => v_days))
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS: chủ cửa hàng chỉ thấy dữ liệu của chính mình ----------
alter table public.app_config       enable row level security;
alter table public.profiles         enable row level security;
alter table public.admins           enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.store_links      enable row level security;
alter table public.renewal_requests enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions for select to authenticated using (owner_id = auth.uid());
drop policy if exists store_links_own on public.store_links;
create policy store_links_own on public.store_links for select to authenticated using (owner_id = auth.uid());
drop policy if exists requests_own on public.renewal_requests;
create policy requests_own on public.renewal_requests for select to authenticated using (owner_id = auth.uid());

-- Không ai (kể cả chủ cửa hàng) ghi trực tiếp được: mọi thay đổi đi qua hàm bên dưới
revoke all on public.app_config, public.profiles, public.admins, public.subscriptions,
              public.store_links, public.renewal_requests from anon, authenticated;
grant select on public.profiles, public.subscriptions, public.store_links, public.renewal_requests to authenticated;

-- ---------- Hàm cho chủ cửa hàng ----------
create or replace function public.get_my_subscription() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'plan_months', s.plan_months,
    'status', case when s.expires_at > now() then s.status else 'expired' end,
    'source', s.source,
    'started_at', s.started_at,
    'expires_at', s.expires_at,
    'server_now', now()
  ) from public.subscriptions s where s.owner_id = auth.uid();
$$;

create or replace function public.get_my_requests() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'plan_months', r.plan_months, 'status', r.status, 'note', r.note, 'created_at', r.created_at)
                            order by r.created_at desc), '[]'::jsonb)
    from public.renewal_requests r where r.owner_id = auth.uid();
$$;

create or replace function public.save_store_link(p_url text, p_anon text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập' using errcode = '28000'; end if;
  if p_url !~ '^https://[A-Za-z0-9._-]+(:[0-9]+)?$' then
    raise exception 'Địa chỉ Supabase không hợp lệ' using errcode = '22023';
  end if;
  if length(coalesce(p_anon, '')) not between 20 and 2000 then
    raise exception 'Khoá API không hợp lệ' using errcode = '22023';
  end if;
  insert into public.store_links (owner_id, url, anon_key) values (auth.uid(), p_url, p_anon)
  on conflict (owner_id) do update set url = excluded.url, anon_key = excluded.anon_key, updated_at = now();
end $$;

create or replace function public.get_store_link() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('url', url, 'anon_key', anon_key) from public.store_links where owner_id = auth.uid();
$$;

-- Gỡ liên kết kho cũ để tạo kho mới. Đồng thời xoá phiên tự tạo Supabase (provision_jobs), nếu không provision-start sẽ "nối lại" phiên cũ đã xong.
create or replace function public.clear_store_link() returns void
language sql security definer set search_path = public as $$
  delete from public.store_links where owner_id = auth.uid();
  delete from public.provision_jobs where owner_id = auth.uid();
$$;

create or replace function public.request_renewal(p_months int, p_note text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập' using errcode = '28000'; end if;
  if p_months not in (1, 6, 12) then raise exception 'Gói không hợp lệ' using errcode = '22023'; end if;
  select id into v_id from public.renewal_requests where owner_id = auth.uid() and status = 'pending' limit 1;
  if v_id is not null then
    update public.renewal_requests set plan_months = p_months, note = left(p_note, 500), created_at = now() where id = v_id;
    return v_id;
  end if;
  insert into public.renewal_requests (owner_id, plan_months, note)
  values (auth.uid(), p_months, left(p_note, 500)) returning id into v_id;
  return v_id;
end $$;

-- Chủ cửa hàng tự xoá tài khoản lưu trữ của mình (các bảng khác xoá theo nhờ on delete cascade). Không đụng tới Supabase riêng của cửa hàng.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'Chưa đăng nhập' using errcode = '28000'; end if;
  if exists (select 1 from public.admins where user_id = v) then
    raise exception 'Không xoá tài khoản quản trị bằng cách này' using errcode = '42501';
  end if;
  delete from auth.users where id = v;
end $$;

-- ---------- Hàm cho admin (bạn) ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Nội bộ: cộng dồn gói — gia hạn sớm không mất phần còn lại
create or replace function public._extend_subscription(p_owner uuid, p_months int) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (owner_id, plan_months, status, expires_at)
  values (p_owner, p_months, 'active', now() + make_interval(months => p_months))
  on conflict (owner_id) do update
    set expires_at  = greatest(now(), public.subscriptions.expires_at) + make_interval(months => p_months),
        -- Tài khoản đang dùng Google Play: ghi nhớ hạn mới làm "bonus" để lần cập nhật từ Google không ghi đè mất.
        bonus_until = case when public.subscriptions.source = 'google_play'
                           then greatest(now(), public.subscriptions.expires_at) + make_interval(months => p_months)
                           else null end,
        plan_months = p_months, status = 'active', updated_at = now();
end $$;

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'owner_id', p.id, 'email', p.email, 'shop_name', p.shop_name,
      'plan_months', s.plan_months,
      'status', case when s.expires_at > now() then s.status else 'expired' end,
      'expires_at', s.expires_at, 'linked', (l.owner_id is not null)
    ) order by s.expires_at)
    from public.profiles p
    left join public.subscriptions s on s.owner_id = p.id
    left join public.store_links l on l.owner_id = p.id
    -- Loại tài khoản ADMIN khỏi danh sách chủ cửa hàng (trigger tạo hồ sơ + gói dùng thử cho mọi tài khoản mới, kể cả admin)
    where not exists (select 1 from public.admins a where a.user_id = p.id)
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_pending_requests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'owner_id', r.owner_id, 'email', p.email, 'shop_name', p.shop_name,
      'plan_months', r.plan_months, 'note', r.note, 'created_at', r.created_at
    ) order by r.created_at)
    -- LEFT JOIN: thiếu hồ sơ phụ cũng không được làm mất yêu cầu gia hạn thật
    from public.renewal_requests r left join public.profiles p on p.id = r.owner_id
    where r.status = 'pending'
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_approve_renewal(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare r public.renewal_requests;
begin
  if not public.is_admin() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  select * into r from public.renewal_requests where id = p_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'Yêu cầu không còn ở trạng thái chờ' using errcode = '22023';
  end if;
  perform public._extend_subscription(r.owner_id, r.plan_months);
  update public.renewal_requests set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = p_id;
  return true;
end $$;

create or replace function public.admin_reject_renewal(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  update public.renewal_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid()
   where id = p_id and status = 'pending';
  return found;
end $$;

create or replace function public.admin_extend(p_owner uuid, p_months int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Không có quyền' using errcode = '42501'; end if;
  if p_months not between 1 and 36 then raise exception 'Số tháng không hợp lệ' using errcode = '22023'; end if;
  perform public._extend_subscription(p_owner, p_months);
  return true;
end $$;

create or replace function public.admin_status() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

-- ---------- Quyền thực thi ----------
revoke execute on all functions in schema public from public, anon;
revoke execute on function public._extend_subscription(uuid, int) from authenticated;
grant execute on function
  public.get_my_subscription(), public.get_my_requests(), public.save_store_link(text, text), public.get_store_link(),
  public.clear_store_link(), public.delete_my_account(), public.request_renewal(int, text), public.is_admin(),
  public.admin_overview(), public.admin_pending_requests(), public.admin_approve_renewal(bigint),
  public.admin_reject_renewal(bigint), public.admin_extend(uuid, int), public.admin_status()
  to authenticated;

notify pgrst, 'reload schema';
