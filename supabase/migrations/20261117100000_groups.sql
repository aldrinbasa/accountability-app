-- Groups and memberships (Story 1.6, FR-4, FR-8, AD-2, AD-3, AD-16, AD-18).
--
-- A group is the tenant boundary. Members belong to it through memberships, which are soft-ended
-- (ended_at, end_reason) and never deleted, except by the cascade when the group itself is deleted.
-- Clients read both tables under RLS only; every write goes through a security definer RPC.
-- This migration also opens schema private to authenticated for the three RLS helpers below, and
-- widens profile reads to people who share or once shared a group.

-- 1. Tables
create table public.groups (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  -- Trimmed, 1 to 32 characters (same rule as profiles.display_name, longer limit).
  name text not null
    constraint groups_name_check
    check (pg_catalog.char_length(name) between 1 and 32 and name !~ '^\s|\s$'),
  -- Defaults to the creating admin's profile zone (NFR11). Editing arrives with set_time_zone (2.7).
  time_zone text not null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.memberships (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  role text not null
    constraint memberships_role_check
    check (role in ('admin', 'member')),
  joined_at timestamptz not null default pg_catalog.now(),
  ended_at timestamptz null,
  end_reason text null
    constraint memberships_end_reason_check
    check (end_reason in ('left', 'removed', 'account_deleted')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  -- An ended row always says why; a current row never has a reason.
  constraint memberships_end_consistent_check
    check ((ended_at is null) = (end_reason is null))
);

-- 2. Indexes. Only-once rules live in partial unique indexes (AD-18).
create unique index memberships_one_current_per_user
  on public.memberships (group_id, user_id)
  where ended_at is null;

create unique index memberships_one_admin_per_group
  on public.memberships (group_id)
  where role = 'admin' and ended_at is null;

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_group_id_idx on public.memberships (group_id);
create index groups_created_by_idx on public.groups (created_by);

-- 3. updated_at triggers
create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function private.set_updated_at();

-- 4. RLS helpers in private. Security definer, so they read memberships without RLS (no policy
--    recursion). The actor is always auth.uid().

-- True when the caller has a current membership in the group.
create or replace function private.is_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.ended_at is null
  );
$$;

-- True when the caller is the current admin of the group.
create or replace function private.is_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.group_id = p_group_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
      and m.ended_at is null
  );
$$;

-- True when the caller and p_user_id have any membership rows (current or ended) in the same
-- group. Memberships RLS hides other people's ended rows, so profile visibility ("shares or once
-- shared a group") needs this definer helper instead of a plain subquery.
create or replace function private.shares_group(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
  );
$$;

-- The baseline closed private. authenticated gets USAGE plus EXECUTE on these three helpers only,
-- because RLS policies evaluate them as the caller. Nothing for anon.
grant usage on schema private to authenticated;
revoke execute on function private.is_member(uuid) from public, anon;
revoke execute on function private.is_admin(uuid) from public, anon;
revoke execute on function private.shares_group(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function private.shares_group(uuid) to authenticated;

-- 5. Row level security
alter table public.groups enable row level security;
alter table public.memberships enable row level security;

-- A group is readable when the caller has any membership in it, current or ended.
create policy groups_select_any_membership
  on public.groups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memberships m
      where m.group_id = groups.id
        and m.user_id = (select auth.uid())
    )
  );

-- Own memberships (including ended), plus the current memberships of groups the caller is in.
create policy memberships_select
  on public.memberships
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (ended_at is null and private.is_member(group_id))
  );

-- Profiles: profiles_select_own (Story 1.4) stays; this adds people who share or once shared a group.
create policy profiles_select_shared
  on public.profiles
  for select
  to authenticated
  using (private.shares_group(id));

-- 6. Grants (the baseline revoked all defaults). SELECT only; nothing for anon.
revoke all on table public.groups from public, anon, authenticated;
revoke all on table public.memberships from public, anon, authenticated;
grant select on table public.groups to authenticated;
grant select on table public.memberships to authenticated;

-- 7. RPC: create a group with the caller as admin, in one transaction. Returns the group id.
--    Errors are stable snake_case codes in the exception message (AD-14).
create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := pg_catalog.regexp_replace(coalesce(p_name, ''), '^\s+|\s+$', '', 'g');
  v_time_zone text;
  v_group_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if pg_catalog.char_length(v_name) not between 1 and 32 then
    raise exception 'invalid_group_name';
  end if;

  select p.time_zone into v_time_zone
  from public.profiles p
  where p.id = v_uid;

  if v_time_zone is null then
    raise exception 'profile_required';
  end if;

  insert into public.groups (name, time_zone, created_by)
  values (v_name, v_time_zone, v_uid)
  returning id into v_group_id;

  insert into public.memberships (group_id, user_id, role)
  values (v_group_id, v_uid, 'admin');

  return v_group_id;
end;
$$;

revoke execute on function public.create_group(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
