-- Activities (Story 2.1, FR-9, FR-10, AD-2, AD-3, AD-6, AD-15, AD-16).
--
-- preset_activities is the global list of 20 presets. group_activities holds one row per preset a
-- group has used and one row per member's free-typed custom activity, so commitments and tasks
-- (Stories 2.2, 2.4) always reference a row here, never free text. Clients read both under RLS;
-- the only writer is private.resolve_group_activity, called from later plan RPCs.
-- group_activity_options is the picker's read; Story 2.2 replaces it to fill locked_schedule_type.

-- 1. Tables
create table public.preset_activities (
  key text primary key,
  name text not null,
  category text not null
    constraint preset_activities_category_check
    check (category in ('fitness', 'mind', 'creative', 'life_work')),
  -- Display order across the whole list (categories in order, then the order within each).
  sort smallint not null
    constraint preset_activities_sort_key unique
);

create table public.group_activities (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  preset_key text null references public.preset_activities (key),
  -- Trimmed, 1 to 24 characters (same rule as resolve_group_activity).
  custom_name text null
    constraint group_activities_custom_name_check
    check (pg_catalog.char_length(custom_name) between 1 and 24 and custom_name !~ '^\s|\s$'),
  -- Who first used it: the member who typed a custom name, or the first to pick a preset.
  created_by uuid not null references public.profiles (id),
  -- Null until a commitment sets it (Story 2.2, FR-10 schedule-type rule).
  schedule_type text null
    constraint group_activities_schedule_type_check
    check (schedule_type in ('fixed_days', 'times_per_week')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint group_activities_exactly_one_check
    check ((preset_key is null) <> (custom_name is null))
);

-- 2. Indexes. Only-once rules live in unique indexes (AD-18). NULLs are distinct, so the preset
--    index ignores custom rows and the custom index ignores preset rows.
create unique index group_activities_one_per_preset
  on public.group_activities (group_id, preset_key);

-- FR-10: free-typed matches stay separate, so custom names are unique per creator, not per group.
create unique index group_activities_custom_per_creator
  on public.group_activities (group_id, created_by, pg_catalog.lower(custom_name));

create index group_activities_preset_key_idx on public.group_activities (preset_key);
create index group_activities_created_by_idx on public.group_activities (created_by);

-- 3. updated_at trigger
create trigger group_activities_set_updated_at
  before update on public.group_activities
  for each row execute function private.set_updated_at();

-- 4. The 20 presets (exact display names and order from the story).
insert into public.preset_activities (key, name, category, sort) values
  ('gym', 'Gym', 'fitness', 1),
  ('run', 'Run', 'fitness', 2),
  ('walk', 'Walk', 'fitness', 3),
  ('yoga', 'Yoga', 'fitness', 4),
  ('sports', 'Sports', 'fitness', 5),
  ('study', 'Study', 'mind', 6),
  ('read', 'Read', 'mind', 7),
  ('meditate', 'Meditate', 'mind', 8),
  ('journal', 'Journal', 'mind', 9),
  ('language_practice', 'Language practice', 'mind', 10),
  ('paint', 'Paint', 'creative', 11),
  ('draw', 'Draw', 'creative', 12),
  ('music_practice', 'Music practice', 'creative', 13),
  ('write', 'Write', 'creative', 14),
  ('photography', 'Photography', 'creative', 15),
  ('side_business', 'Side business', 'life_work', 16),
  ('cook_at_home', 'Cook at home', 'life_work', 17),
  ('clean', 'Clean', 'life_work', 18),
  ('groceries', 'Groceries', 'life_work', 19),
  ('sleep_early', 'Sleep early', 'life_work', 20);

-- 5. Row level security
alter table public.preset_activities enable row level security;
alter table public.group_activities enable row level security;

create policy preset_activities_select_all
  on public.preset_activities
  for select
  to authenticated
  using (true);

-- Current members of the group only (ended memberships see nothing).
create policy group_activities_select_member
  on public.group_activities
  for select
  to authenticated
  using (private.is_member(group_id));

-- 6. Grants (the baseline revoked the defaults). SELECT only for authenticated; nothing for anon.
--    No role writes presets; service_role's Supabase default write grants are taken away too.
revoke all on table public.preset_activities from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.preset_activities from service_role;
revoke all on table public.group_activities from public, anon, authenticated;
grant select on table public.preset_activities to authenticated;
grant select on table public.group_activities to authenticated;

-- 7. private.resolve_group_activity: the group_activities row a plan RPC should use, found or
--    created, and locked with FOR UPDATE so the caller can enforce the schedule-type rule (AD-6).
--    Exactly one input: a preset key (the group's single row for it), a group_activity_id of this
--    group, or a custom name (trimmed, 1-24; the caller's own row with the same case-insensitive
--    name, else a new row of theirs). Anything else raises invalid_activity.
--    Safe under concurrent calls: insert ... on conflict do nothing waits for a racing insert of the
--    same key, then the select reads (and locks) whichever row won.
--    No membership check here: the calling RPC checks not_member first.
create or replace function private.resolve_group_activity(
  p_group_id uuid,
  p_preset_key text,
  p_group_activity_id uuid,
  p_custom_name text
)
returns public.group_activities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_row public.group_activities;
begin
  if (p_preset_key is not null)::integer
     + (p_group_activity_id is not null)::integer
     + (p_custom_name is not null)::integer <> 1 then
    raise exception 'invalid_activity';
  end if;

  if p_group_activity_id is not null then
    select ga.* into v_row
    from public.group_activities ga
    where ga.id = p_group_activity_id
      and ga.group_id = p_group_id
    for update;
    if not found then
      raise exception 'invalid_activity';
    end if;
    return v_row;
  end if;

  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_preset_key is not null then
    if not exists (select 1 from public.preset_activities pa where pa.key = p_preset_key) then
      raise exception 'invalid_activity';
    end if;

    insert into public.group_activities (group_id, preset_key, created_by)
    values (p_group_id, p_preset_key, v_uid)
    on conflict do nothing;

    select ga.* into v_row
    from public.group_activities ga
    where ga.group_id = p_group_id
      and ga.preset_key = p_preset_key
    for update;
    return v_row;
  end if;

  v_name := pg_catalog.regexp_replace(p_custom_name, '^\s+|\s+$', '', 'g');
  if pg_catalog.char_length(v_name) not between 1 and 24 then
    raise exception 'invalid_activity';
  end if;

  insert into public.group_activities (group_id, custom_name, created_by)
  values (p_group_id, v_name, v_uid)
  on conflict do nothing;

  select ga.* into v_row
  from public.group_activities ga
  where ga.group_id = p_group_id
    and ga.created_by = v_uid
    and pg_catalog.lower(ga.custom_name) = pg_catalog.lower(v_name)
  for update;
  return v_row;
end;
$$;

-- Not client-executable: only security definer plan RPCs call it.
revoke execute on function private.resolve_group_activity(uuid, text, uuid, text)
  from public, anon, authenticated;

-- 8. The picker's read. security_invoker, so group_activities RLS applies to the caller.
--    locked_schedule_type stays null until Story 2.2 replaces this view.
create view public.group_activity_options
with (security_invoker = true)
as
select
  ga.id,
  ga.group_id,
  ga.preset_key,
  ga.custom_name,
  ga.created_by,
  null::text as locked_schedule_type
from public.group_activities ga;

revoke all on table public.group_activity_options from public, anon, authenticated;
grant select on table public.group_activity_options to authenticated;
