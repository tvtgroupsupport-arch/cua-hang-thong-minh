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
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  updated_at  timestamptz not null default now()
);

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
