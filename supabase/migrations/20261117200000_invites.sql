-- Invites and joining (Story 1.7, FR-5, AD-2, AD-3, AD-12, AD-14, AD-15, AD-16).
--
-- An admin shares a 6-character code (or the /join/{code} link). It works for 7 days and stops
-- working once the group has 10 current members. Only the group's current admin reads invites
-- under RLS; every write goes through a security definer RPC.
--
-- The RPCs call now() unqualified on purpose. With search_path = '' that is pg_catalog.now();
-- pgTAP re-points the function's search_path at test_overrides inside its rolled-back
-- transaction so tests.freeze_time can move the clock (see supabase/tests/invites.test.sql).

-- 1. Table
create table public.invites (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  code text not null
    constraint invites_code_key unique
    constraint invites_code_check
    check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  created_by uuid null references public.profiles (id) on delete set null,
  -- Creation + 7 days, set by create_invite.
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

-- 2. Indexes. create_invite looks up the newest unexpired invite of a group.
create index invites_group_id_expires_at_idx on public.invites (group_id, expires_at);
create index invites_created_by_idx on public.invites (created_by);

-- 3. updated_at trigger
create trigger invites_set_updated_at
  before update on public.invites
  for each row execute function private.set_updated_at();

-- 4. Row level security: only the group's current admin reads its invites.
alter table public.invites enable row level security;

create policy invites_select_admin
  on public.invites
  for select
  to authenticated
  using (private.is_admin(group_id));

-- 5. Grants (the baseline revoked all defaults). SELECT only; nothing for anon.
revoke all on table public.invites from public, anon, authenticated;
grant select on table public.invites to authenticated;

-- 6. Code generator (private, no client grant). 6 characters from a 32-character alphabet
--    without 0/O/1/I. Each character takes one byte of a v4 UUID (bytes 0-5 are fully random;
--    the version and variant bits sit in bytes 6 and 8). 256 is a multiple of 32, so byte % 32
--    has no bias. gen_random_uuid() draws from a cryptographic source; random() is never used.
create or replace function private.generate_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  v_code text := '';
  i integer;
begin
  for i in 0..5 loop
    v_code := v_code || pg_catalog.substr(v_alphabet, (pg_catalog.get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

revoke execute on function private.generate_invite_code() from public, anon, authenticated;

-- 7. RPC: the admin's current invite for a group, or a fresh one.
--    Returns the group's newest unexpired invite unless p_new is true or none exists; otherwise
--    inserts a new one (retrying on a code collision). Errors are AD-14 codes.
create or replace function public.create_invite(p_group_id uuid, p_new boolean default false)
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_attempt integer := 0;
  v_code text;
  v_expires_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_uid and m.ended_at is null
  ) then
    raise exception 'not_member';
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = p_group_id and m.user_id = v_uid and m.ended_at is null and m.role = 'admin'
  ) then
    raise exception 'not_admin';
  end if;

  if not coalesce(p_new, false) then
    select i.code, i.expires_at into v_code, v_expires_at
    from public.invites i
    where i.group_id = p_group_id
      and i.expires_at > v_now
    order by i.expires_at desc, i.created_at desc
    limit 1;
    if v_code is not null then
      code := v_code;
      expires_at := v_expires_at;
      return next;
      return;
    end if;
  end if;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.invites (group_id, code, created_by, expires_at, created_at)
      values (p_group_id, private.generate_invite_code(), v_uid, v_now + interval '7 days', v_now)
      returning invites.code, invites.expires_at into v_code, v_expires_at;
      code := v_code;
      expires_at := v_expires_at;
      return next;
      return;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.create_invite(uuid, boolean) from public, anon;
grant execute on function public.create_invite(uuid, boolean) to authenticated;

-- 8. RPC: what an invite code leads to, for the join screen. Signed-in callers only.
--    status: 'member' (caller is already a current member), 'expired' (now >= expires_at),
--    'full' (10 current members) or 'valid', checked in that order. Unknown code raises
--    invite_not_found. The code is trimmed and upper-cased first.
create or replace function public.get_invite(p_code text)
returns table (
  group_id uuid,
  group_name text,
  admin_display_name text,
  member_count integer,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  v_group_id uuid;
  v_expires_at timestamptz;
  v_group_name text;
  v_admin_name text;
  v_count integer;
  v_is_member boolean;
  v_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select i.group_id, i.expires_at into v_group_id, v_expires_at
  from public.invites i
  where i.code = v_code;

  if v_group_id is null then
    raise exception 'invite_not_found';
  end if;

  select g.name into v_group_name from public.groups g where g.id = v_group_id;

  select p.display_name into v_admin_name
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.group_id = v_group_id and m.role = 'admin' and m.ended_at is null;

  select pg_catalog.count(*)::integer into v_count
  from public.memberships m
  where m.group_id = v_group_id and m.ended_at is null;

  select exists (
    select 1 from public.memberships m
    where m.group_id = v_group_id and m.user_id = v_uid and m.ended_at is null
  ) into v_is_member;

  v_status := case
    when v_is_member then 'member'
    when now() >= v_expires_at then 'expired'
    when v_count >= 10 then 'full'
    else 'valid'
  end;

  return query select v_group_id, v_group_name, v_admin_name, v_count, v_status;
end;
$$;

revoke execute on function public.get_invite(text) from public, anon;
grant execute on function public.get_invite(text) to authenticated;

-- 9. RPC: join a group with an invite code. Returns the group id.
--    Locks the group row for update so the 10-member cap holds under concurrent joins. A caller
--    who is already a current member gets the group id back unchanged (idempotent). Anyone else
--    gets a new 'member' row, even if they left before (memberships are never reopened).
create or replace function public.join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  v_group_id uuid;
  v_expires_at timestamptz;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'profile_required';
  end if;

  select i.group_id, i.expires_at into v_group_id, v_expires_at
  from public.invites i
  where i.code = v_code;

  if v_group_id is null then
    raise exception 'invite_not_found';
  end if;

  perform 1 from public.groups g where g.id = v_group_id for update;

  if exists (
    select 1 from public.memberships m
    where m.group_id = v_group_id and m.user_id = v_uid and m.ended_at is null
  ) then
    return v_group_id;
  end if;

  if now() >= v_expires_at then
    raise exception 'invite_expired';
  end if;

  select pg_catalog.count(*)::integer into v_count
  from public.memberships m
  where m.group_id = v_group_id and m.ended_at is null;

  if v_count >= 10 then
    raise exception 'group_full';
  end if;

  insert into public.memberships (group_id, user_id, role)
  values (v_group_id, v_uid, 'member');

  return v_group_id;
end;
$$;

revoke execute on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;
