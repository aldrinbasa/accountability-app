-- Profiles (Story 1.4, FR-1, AD-2, AD-16).
--
-- One row per member: the display name friends see, an optional avatar path (Story 3.6) and the
-- member's time zone (the default for groups they create, Story 1.6). Rows are created only by
-- public.save_profile(). Clients may read their own row and update only display_name and
-- avatar_path of it (column-level grant). Story 1.6 widens SELECT to people who share or once
-- shared a group; time zone changes come with set_time_zone (Story 2.7).

-- 1. Table
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  -- Trimmed, 1 to 24 characters. Enforced here too, because clients may UPDATE this column.
  display_name text not null
    constraint profiles_display_name_check
    check (pg_catalog.char_length(display_name) between 1 and 24 and display_name !~ '^\s|\s$'),
  avatar_path text null,
  time_zone text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- 2. Row level security: own row only
alter table public.profiles enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 3. Grants (the baseline revoked all defaults). No INSERT/DELETE for anyone; nothing for anon.
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_path) on table public.profiles to authenticated;

-- 4. RPC: create the caller's profile, or on an existing one change only the display name.
--    Errors are stable snake_case codes in the exception message (AD-14).
create or replace function public.save_profile(p_display_name text, p_time_zone text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := pg_catalog.regexp_replace(coalesce(p_display_name, ''), '^\s+|\s+$', '', 'g');
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if pg_catalog.char_length(v_name) not between 1 and 24 then
    raise exception 'invalid_display_name';
  end if;

  if p_time_zone is null
    or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'invalid_time_zone';
  end if;

  insert into public.profiles (id, display_name, time_zone)
  values (v_uid, v_name, p_time_zone)
  on conflict (id) do update
    set display_name = excluded.display_name
  returning * into v_profile;

  return v_profile;
end;
$$;

revoke execute on function public.save_profile(text, text) from public, anon;
grant execute on function public.save_profile(text, text) to authenticated;
