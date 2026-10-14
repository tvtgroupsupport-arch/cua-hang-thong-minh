/* Script SQL cho Supabase của cửa hàng. Chủ cửa hàng dán vào Supabase → SQL Editor → Run MỘT lần (chạy lại không sao).
   Thiết kế (rút kinh nghiệm từ app BEPO, đơn giản hoá cho một kho dữ liệu dùng chung):
   • Hai bảng bị khoá hoàn toàn (RLS bật, không cấp quyền cho anon/authenticated). Mọi truy cập đi qua các hàm SECURITY DEFINER, và hàm nào cũng kiểm tra
     KHOÁ THIẾT BỊ (chỉ lưu bản băm SHA-256 trên máy chủ). Khoá anon công khai của Supabase vì thế không đủ để đọc/ghi dữ liệu.
   • Mỗi thiết bị có khoá riêng, vai trò 'owner' hoặc 'staff'; chủ cửa hàng thu hồi từng thiết bị được. Máy 'staff' không được ghi tài khoản nhân viên/cài đặt và không được xoá dữ liệu.
   • Đồng bộ theo từng bản ghi (coll, id): bản có mốc updated_at MỚI HƠN thắng; mỗi lần ghi nhận máy chủ cấp số thứ tự seq tăng dần để máy khác kéo "những gì mới kể từ seq N". */
export function storeSql(ownerKey) {
  if (!/^[0-9a-f]{32,128}$/.test(ownerKey || '')) throw new Error('Khoá chủ cửa hàng không hợp lệ');
  return `-- ===== Tạp Hóa — đồng bộ nhiều máy (Supabase) =====
-- Cách dùng: Supabase → SQL Editor → New query → dán toàn bộ → Run. Chạy lại nhiều lần không sao.
-- Dòng "insert into public.pos_devices" bên dưới chứa KHOÁ CHỦ CỬA HÀNG của riêng bạn — đừng gửi script này cho người khác.

create table if not exists public.pos_devices (
  key_hash   text primary key,
  name       text not null,
  role       text not null check (role in ('owner', 'staff')),
  revoked    boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen  timestamptz
);

create sequence if not exists public.pos_seq;

create table if not exists public.pos_records (
  coll       text not null,
  id         text not null,
  data       jsonb,
  updated_at bigint not null,
  deleted    boolean not null default false,
  seq        bigint not null default nextval('public.pos_seq'),
  device     text,
  primary key (coll, id)
);
create index if not exists pos_records_seq_idx on public.pos_records (seq);

alter table public.pos_devices enable row level security;
alter table public.pos_records enable row level security;
revoke all on public.pos_devices from anon, authenticated;
revoke all on public.pos_records from anon, authenticated;
revoke all on sequence public.pos_seq from anon, authenticated;

-- Kiểm tra khoá thiết bị: trả về vai trò ('owner' | 'staff') hoặc null. Chỉ các hàm bên dưới gọi được.
create or replace function public.pos_auth(p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_hash text;
  v_role text;
begin
  if p_key is null or length(p_key) < 16 then return null; end if;
  v_hash := encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  select d.role into v_role from public.pos_devices d where d.key_hash = v_hash and not d.revoked;
  if v_role is not null then
    update public.pos_devices set last_seen = now() where key_hash = v_hash;
  end if;
  return v_role;
end $$;
revoke all on function public.pos_auth(text) from public, anon, authenticated;

-- Kiểm tra kết nối + khoá; trả về vai trò, giờ máy chủ, số bản ghi
create or replace function public.pos_ping(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.pos_auth(p_key);
begin
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  return jsonb_build_object('ok', true, 'role', v_role,
    'now', (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'max_seq', (select coalesce(max(seq), 0) from public.pos_records),
    'records', (select count(*) from public.pos_records));
end $$;

-- Đẩy các bản ghi lên: mỗi phần tử {c: bộ sưu tập, i: id, d: dữ liệu, u: mốc sửa (ms), x: đã xoá?}
create or replace function public.pos_push(p_key text, p_items jsonb, p_device text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.pos_auth(p_key);
  it jsonb;
  v_del boolean;
  n int := 0;
  skipped int := 0;
  v_rej jsonb := '[]'::jsonb;
begin
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_del := coalesce((it ->> 'x')::boolean, false);
    -- máy nhân viên: không ghi tài khoản nhân viên/cài đặt; chỉ được xoá phiếu kiểm kho nháp
    if v_role = 'staff' and ((it ->> 'c') in ('staff', '_meta') or (v_del and (it ->> 'c') <> 'stocktakes')) then
      skipped := skipped + 1;
      v_rej := v_rej || jsonb_build_array(jsonb_build_object('c', it ->> 'c', 'i', it ->> 'i', 'row',
        (select jsonb_build_object('d', r0.data, 'u', r0.updated_at, 'x', r0.deleted) from public.pos_records r0 where r0.coll = it ->> 'c' and r0.id = it ->> 'i')));
      continue;
    end if;
    insert into public.pos_records as r (coll, id, data, updated_at, deleted, device)
    values (it ->> 'c', it ->> 'i', case when v_del then null else it -> 'd' end, (it ->> 'u')::bigint, v_del, p_device)
    on conflict (coll, id) do update
      set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted,
          seq = nextval('public.pos_seq'), device = excluded.device
      where r.updated_at <= excluded.updated_at;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'accepted', n, 'skipped', skipped, 'rejected', v_rej,
    'max_seq', (select coalesce(max(seq), 0) from public.pos_records));
end $$;

-- Kéo các bản ghi mới kể từ seq p_since (phân trang)
create or replace function public.pos_pull(p_key text, p_since bigint default 0, p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.pos_auth(p_key);
  v_rows jsonb;
  v_max bigint;
  v_since bigint := coalesce(p_since, 0);
begin
  if v_role is null then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  with page as (
    select coll, id, data, updated_at, deleted, seq
    from public.pos_records
    where seq > v_since
    order by seq
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  )
  select coalesce(jsonb_agg(jsonb_build_object('c', coll, 'i', id, 'd', data, 'u', updated_at, 'x', deleted, 's', seq) order by seq), '[]'::jsonb),
         coalesce(max(seq), v_since)
    into v_rows, v_max
    from page;
  return jsonb_build_object('ok', true, 'rows', v_rows, 'max_seq', v_max,
    'more', exists (select 1 from public.pos_records where seq > v_max));
end $$;

-- Chủ cửa hàng cấp khoá cho một thiết bị mới. Khoá chỉ trả về MỘT lần (máy chủ chỉ giữ bản băm).
create or replace function public.pos_register_device(p_key text, p_name text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_new text;
begin
  if public.pos_auth(p_key) is distinct from 'owner' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_role is null or p_role not in ('owner', 'staff') then return jsonb_build_object('ok', false, 'error', 'role'); end if;
  v_new := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.pos_devices (key_hash, name, role)
  values (encode(sha256(convert_to(v_new, 'UTF8')), 'hex'), left(coalesce(nullif(trim(p_name), ''), 'Thiết bị'), 60), p_role);
  return jsonb_build_object('ok', true, 'key', v_new, 'index', (select count(*) from public.pos_devices));
end $$;

create or replace function public.pos_list_devices(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.pos_auth(p_key) is distinct from 'owner' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  return jsonb_build_object('ok', true,
    'me', encode(sha256(convert_to(p_key, 'UTF8')), 'hex'),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('hash', key_hash, 'name', name, 'role', role, 'revoked', revoked,
                 'created_at', created_at, 'last_seen', last_seen) order by created_at), '[]'::jsonb) from public.pos_devices));
end $$;

create or replace function public.pos_revoke_device(p_key text, p_hash text, p_revoked boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.pos_auth(p_key) is distinct from 'owner' then return jsonb_build_object('ok', false, 'error', 'auth'); end if;
  if p_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex') then return jsonb_build_object('ok', false, 'error', 'self'); end if;
  update public.pos_devices set revoked = coalesce(p_revoked, true) where key_hash = p_hash;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.pos_ping(text) from public;
revoke all on function public.pos_push(text, jsonb, text) from public;
revoke all on function public.pos_pull(text, bigint, int) from public;
revoke all on function public.pos_register_device(text, text, text) from public;
revoke all on function public.pos_list_devices(text) from public;
revoke all on function public.pos_revoke_device(text, text, boolean) from public;
grant execute on function public.pos_ping(text) to anon, authenticated;
grant execute on function public.pos_push(text, jsonb, text) to anon, authenticated;
grant execute on function public.pos_pull(text, bigint, int) to anon, authenticated;
grant execute on function public.pos_register_device(text, text, text) to anon, authenticated;
grant execute on function public.pos_list_devices(text) to anon, authenticated;
grant execute on function public.pos_revoke_device(text, text, boolean) to anon, authenticated;

-- Thiết bị chủ cửa hàng đầu tiên (chỉ lưu bản băm của khoá)
insert into public.pos_devices (key_hash, name, role)
values (encode(sha256(convert_to('${ownerKey}', 'UTF8')), 'hex'), 'Máy chủ cửa hàng', 'owner')
on conflict (key_hash) do nothing;

notify pgrst, 'reload schema';
`;
}
