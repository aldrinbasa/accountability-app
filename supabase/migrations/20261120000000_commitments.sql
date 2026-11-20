-- Commitments (Story 2.2, FR-9, FR-10, FR-4, AD-2, AD-3, AD-6, AD-11, AD-14, AD-15, AD-16).
--
-- commitments holds a member's promise in a group: an activity (always a group_activities row) and
-- a schedule type. commitment_versions holds what the promise is from a given week on (days or a
-- target, and an optional end date); plan RPCs never edit a version in place. Story 2.3 adds
-- sessions_through and the tick, Story 2.4 the task columns, Story 2.6 the edit and end RPCs.
--
-- The shared time helpers live here: every week and day calculation in the app goes through them
-- (AD-11). Weeks are keyed by their Monday (`week_start`) in the member's IANA zone.
--
-- Additive only: two new tables, new functions, and group_activity_options replaced with the same
-- columns. The routines call now() unqualified on purpose. With search_path = '' that is
-- pg_catalog.now(); pgTAP re-points a function's search_path at test_overrides inside its
-- rolled-back transaction so tests.freeze_time moves the clock.

-- 1. Tables
create table public.commitments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- The membership the promise belongs to; a later membership (after a rejoin) starts afresh.
  membership_id uuid not null references public.memberships (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  kind text not null
    constraint commitments_kind_check
    check (kind in ('commitment', 'task')),
  group_activity_id uuid not null references public.group_activities (id),
  -- Set for every commitment, never for a task (tasks never set or lock the type, FR-10).
  schedule_type text null
    constraint commitments_schedule_type_check
    check (schedule_type in ('fixed_days', 'times_per_week')),
  -- The last week with sessions after the member ends it (Story 2.6); null while open-ended.
  ends_after_week_start date null
    constraint commitments_ends_after_monday_check
    check (extract(isodow from ends_after_week_start) = 1),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint commitments_schedule_type_kind_check
    check ((kind = 'commitment') = (schedule_type is not null))
);

create table public.commitment_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  commitment_id uuid not null references public.commitments (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  -- The Monday this version takes effect, in the owner's zone.
  effective_week_start date not null
    constraint commitment_versions_effective_monday_check
    check (extract(isodow from effective_week_start) = 1),
  -- Fixed days: ISO weekdays (Monday = 1), 1 to 7 of them, stored sorted without duplicates.
  days smallint[] null
    constraint commitment_versions_days_check
    check (
      pg_catalog.cardinality(days) between 1 and 7
      and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    ),
  -- Times per week: 1 to 7.
  target smallint null
    constraint commitment_versions_target_check
    check (target between 1 and 7),
  -- The last day with a session; on or after the first week's Sunday (add_commitment checks).
  end_date date null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint commitment_versions_days_or_target_check
    check ((days is null) <> (target is null))
);

-- 2. Indexes. Only-once rules live in unique indexes (AD-18).
create unique index commitment_versions_one_per_week
  on public.commitment_versions (commitment_id, effective_week_start);

create index commitments_group_id_idx on public.commitments (group_id);
create index commitments_membership_id_idx on public.commitments (membership_id);
create index commitments_user_id_idx on public.commitments (user_id);
create index commitments_group_activity_id_idx on public.commitments (group_activity_id);
create index commitment_versions_group_id_idx on public.commitment_versions (group_id);

-- 3. updated_at triggers
create trigger commitments_set_updated_at
  before update on public.commitments
  for each row execute function private.set_updated_at();

create trigger commitment_versions_set_updated_at
  before update on public.commitment_versions
  for each row execute function private.set_updated_at();

-- 4. Shared time helpers (AD-11). The only place week and day math is defined.

-- The Monday of the local week that contains `at` in zone `tz`.
create or replace function private.week_start_of(at timestamptz, tz text)
returns date
language sql
stable
set search_path = ''
as $$
  select pg_catalog.date_trunc('week', $1 at time zone $2)::date;
$$;

-- Local midnight at the start of day `d` in zone `tz`, via the IANA zone (never "+ 24 h"), so a
-- DST day is 23 or 25 hours long.
create or replace function private.local_start(d date, tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select $1::timestamp at time zone $2;
$$;

-- The member's zone for week `p_week_start`. For now always profiles.time_zone; Story 2.7 returns
-- the pending zone once p_week_start reaches pending_week_start. Security invoker: a client reads
-- only zones its profile RLS shows (its own and co-members').
create or replace function private.member_time_zone(p_user_id uuid, p_week_start date)
returns text
language sql
stable
set search_path = ''
as $$
  select p.time_zone from public.profiles p where p.id = p_user_id;
$$;

-- The pro-rated target of a week cut short to p_days days. The only definition of this rule (FR-9).
create or replace function private.prorated_target(p_target smallint, p_days smallint)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select greatest(1, pg_catalog.floor(p_target::numeric * p_days / 7))::smallint;
$$;

-- True while the membership exists and has not ended. Security definer, so commitment RLS can ask
-- about any membership without reading memberships under the caller's RLS.
create or replace function private.membership_is_current(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.id = p_membership_id
      and m.ended_at is null
  );
$$;

-- The owner's current week (Monday) and local today, in their zone.
-- A commitment is active while its membership is current, it is not ended before the owner's
-- current week, and its latest version's end date is not before the owner's local today.
-- Commitments that start next week are active. Tasks are judged the same way, but callers that
-- apply the schedule-type rule look at kind = 'commitment' only.
create or replace function private.commitment_is_active(c public.commitments)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_end_date date;
begin
  if not private.membership_is_current(c.membership_id) then
    return false;
  end if;

  v_tz := private.member_time_zone(
    c.user_id,
    private.week_start_of(now(), private.member_time_zone(c.user_id, null))
  );
  if v_tz is null then
    return false;
  end if;

  if c.ends_after_week_start is not null
     and c.ends_after_week_start < private.week_start_of(now(), v_tz) then
    return false;
  end if;

  select cv.end_date into v_end_date
  from public.commitment_versions cv
  where cv.commitment_id = c.id
  order by cv.effective_week_start desc
  limit 1;

  return v_end_date is null or v_end_date >= (now() at time zone v_tz)::date;
end;
$$;

-- Helpers called by RLS, security_invoker views or plan_preview get EXECUTE for authenticated;
-- local_start (the tick and definer RPCs only) stays closed. Nothing for anon or PUBLIC.
revoke execute on function private.week_start_of(timestamptz, text) from public, anon, authenticated;
revoke execute on function private.local_start(date, text) from public, anon, authenticated;
revoke execute on function private.member_time_zone(uuid, date) from public, anon, authenticated;
revoke execute on function private.prorated_target(smallint, smallint) from public, anon, authenticated;
revoke execute on function private.membership_is_current(uuid) from public, anon, authenticated;
revoke execute on function private.commitment_is_active(public.commitments) from public, anon, authenticated;
grant execute on function private.week_start_of(timestamptz, text) to authenticated;
grant execute on function private.member_time_zone(uuid, date) to authenticated;
grant execute on function private.prorated_target(smallint, smallint) to authenticated;
grant execute on function private.membership_is_current(uuid) to authenticated;
grant execute on function private.commitment_is_active(public.commitments) to authenticated;

-- 5. Row level security: current members of the group read the rows of current memberships.
alter table public.commitments enable row level security;
alter table public.commitment_versions enable row level security;

create policy commitments_select_member
  on public.commitments
  for select
  to authenticated
  using (private.is_member(group_id) and private.membership_is_current(membership_id));

-- A version is readable when its commitment is (the subquery runs under commitments RLS).
create policy commitment_versions_select_member
  on public.commitment_versions
  for select
  to authenticated
  using (
    private.is_member(group_id)
    and exists (select 1 from public.commitments c where c.id = commitment_versions.commitment_id)
  );

-- 6. Grants (the baseline revoked the defaults). SELECT only for authenticated; nothing for anon.
revoke all on table public.commitments from public, anon, authenticated;
revoke all on table public.commitment_versions from public, anon, authenticated;
grant select on table public.commitments to authenticated;
grant select on table public.commitment_versions to authenticated;

-- 7. RPC: add a commitment (FR-9, FR-10).
--    Checks in order: signed in, current member (not_member), a well-formed plan (invalid_plan),
--    the activity (invalid_activity, from the resolver), the end date (invalid_end_date), then the
--    schedule-type rule under the activity row lock (schedule_type_locked). Every parameter after
--    p_group_id defaults to null, so a client sends only what applies. Any exception rolls back
--    everything, a resolver insert included.
--    The first week is the member's next Monday: nothing in the current week changes, and no
--    session is created here (the tick does that, Story 2.3).
create or replace function public.add_commitment(
  p_group_id uuid,
  p_preset_key text default null,
  p_group_activity_id uuid default null,
  p_custom_name text default null,
  p_schedule_type text default null,
  p_days integer[] default null,
  p_target integer default null,
  p_end_date date default null
)
returns table (commitment_id uuid, starts_on date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
  v_days smallint[];
  v_target smallint;
  v_tz text;
  v_starts_on date;
  v_activity public.group_activities;
  v_commitment_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- FOR SHARE: a leave or removal of this membership waits until the add is done.
  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null
  for share;

  if v_membership_id is null then
    raise exception 'not_member';
  end if;

  if p_schedule_type = 'fixed_days' then
    if p_target is not null
       or p_days is null
       or pg_catalog.array_ndims(p_days) is distinct from 1
       or pg_catalog.cardinality(p_days) not between 1 and 7
       or exists (select 1 from pg_catalog.unnest(p_days) as d(v) where d.v is null or d.v not between 1 and 7)
       or (select count(distinct d.v) from pg_catalog.unnest(p_days) as d(v)) <> pg_catalog.cardinality(p_days) then
      raise exception 'invalid_plan';
    end if;
    v_days := array(select d.v::smallint from pg_catalog.unnest(p_days) as d(v) order by d.v);
  elsif p_schedule_type = 'times_per_week' then
    if p_days is not null or p_target is null or p_target not between 1 and 7 then
      raise exception 'invalid_plan';
    end if;
    v_target := p_target::smallint;
  else
    raise exception 'invalid_plan';
  end if;

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_starts_on := private.week_start_of(now(), v_tz) + 7;

  -- Locks the activity row (FOR UPDATE), so concurrent adds to one activity run one at a time.
  v_activity := private.resolve_group_activity(p_group_id, p_preset_key, p_group_activity_id, p_custom_name);

  if p_end_date is not null and p_end_date < v_starts_on + 6 then
    raise exception 'invalid_end_date';
  end if;

  -- FR-10: every active commitment of a current member to this activity shares one schedule type.
  if exists (
    select 1
    from public.commitments c
    where c.group_activity_id = v_activity.id
      and c.kind = 'commitment'
      and c.schedule_type <> p_schedule_type
      and private.commitment_is_active(c)
  ) then
    raise exception 'schedule_type_locked';
  end if;

  update public.group_activities
  set schedule_type = p_schedule_type
  where id = v_activity.id
    and schedule_type is distinct from p_schedule_type;

  insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
  values (p_group_id, v_membership_id, v_uid, 'commitment', v_activity.id, p_schedule_type)
  returning id into v_commitment_id;

  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target, end_date)
  values (v_commitment_id, p_group_id, v_starts_on, v_days, v_target, p_end_date);

  commitment_id := v_commitment_id;
  starts_on := v_starts_on;
  return next;
end;
$$;

revoke execute on function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  from public, anon;
grant execute on function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  to authenticated;

-- 8. Read: the dates the Plan sheet shows, without client week math (AD-11). Stable and security
--    invoker. member_today, week_start and week_end are the member's current week; starts_on is the
--    next Monday (a new commitment's first week); min_end_date is that week's Sunday.
--    last_week_target is the pro-rated target of the week the end date cuts short (days of that
--    week up to and including p_end_date), null when there is no target or end date, the end date
--    is a Sunday, or it is before min_end_date. A target outside 1 to 7 raises invalid_plan.
create or replace function public.plan_preview(
  p_group_id uuid,
  p_target integer default null,
  p_end_date date default null
)
returns table (
  member_today date,
  week_start date,
  week_end date,
  starts_on date,
  min_end_date date,
  last_week_target smallint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_days smallint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  if p_target is not null and p_target not between 1 and 7 then
    raise exception 'invalid_plan';
  end if;

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );

  member_today := (now() at time zone v_tz)::date;
  week_start := private.week_start_of(now(), v_tz);
  week_end := week_start + 6;
  starts_on := week_start + 7;
  min_end_date := starts_on + 6;
  last_week_target := null;

  if p_target is not null and p_end_date is not null and p_end_date >= min_end_date then
    v_days := extract(isodow from p_end_date)::smallint;
    if v_days < 7 then
      last_week_target := private.prorated_target(p_target::smallint, v_days);
    end if;
  end if;

  return next;
end;
$$;

revoke execute on function public.plan_preview(uuid, integer, date) from public, anon;
grant execute on function public.plan_preview(uuid, integer, date) to authenticated;

-- 9. The picker's read, replaced from Story 2.1 with the same columns. locked_schedule_type is the
--    activity's type while any active commitment of a current member to it exists (FR-10), else
--    null. security_invoker, so commitments RLS (current members, current memberships) applies.
create or replace view public.group_activity_options
with (security_invoker = true)
as
select
  ga.id,
  ga.group_id,
  ga.preset_key,
  ga.custom_name,
  ga.created_by,
  (
    select c.schedule_type
    from public.commitments c
    where c.group_activity_id = ga.id
      and c.kind = 'commitment'
      and private.commitment_is_active(c)
    limit 1
  ) as locked_schedule_type
from public.group_activities ga;

revoke all on table public.group_activity_options from public, anon, authenticated;
grant select on table public.group_activity_options to authenticated;
