-- One helper for the member's current week and zone (Epic 2 retro A4, D1, F5; AD-11, AD-16).
--
-- Ten functions repeated the same two-step lookup: the member's zone for the week that contains
-- now() in profiles.time_zone, then the week in that zone. It missed a pending zone whose Monday had
-- already come in the pending zone itself (a move ahead, e.g. London to Auckland) until tick step 2
-- promoted it, so in that window reads and writes still used the old zone's week while tick step 1
-- had built the new week (retro F5).
--
-- private.member_current_week(p_user_id, p_at) returns (week_start, time_zone): the pending zone
-- counts once its Monday has come in the pending zone (new) or in the current zone (the old rule,
-- kept); the week is the week containing p_at in that zone. "Has come" is
-- week_start_of(p_at, zone) >= pending_week_start, which for a Monday is the same test as tick step
-- 2's p_at >= local_start(pending_week_start, zone) and needs no grant on local_start. No profile:
-- no row, so callers get a null zone and week as before.
--
-- The helper takes the instant as a parameter and never reads the clock: callers pass now(), so
-- pgTAP's tests.freeze_time keeps working through each caller's own overridden search_path.
-- Security invoker with EXECUTE for authenticated (like member_time_zone): plan_preview (invoker)
-- and commitment_is_active (RLS, security_invoker view) call it as the client.
--
-- Additive only: one new helper; the ten functions are replaced from their latest source with the
-- same signatures, return types, volatility, security and grants (restated), and bodies unchanged
-- except the lookup. Tick step 1 keeps group_time_zone and member_time_zone per week (not this
-- lookup). The routines call now() unqualified on purpose (see 20261127000000_time_zones.sql).

-- 1. Helper.
create or replace function private.member_current_week(p_user_id uuid, p_at timestamptz)
returns table (week_start date, time_zone text)
language sql
stable
set search_path = ''
as $$
  select private.week_start_of(p_at, z.tz), z.tz
  from public.profiles p
  cross join lateral (
    select case
      when p.pending_time_zone is not null
        and (private.week_start_of(p_at, p.pending_time_zone) >= p.pending_week_start
             or private.week_start_of(p_at, p.time_zone) >= p.pending_week_start)
        then p.pending_time_zone
      else p.time_zone
    end as tz
  ) z
  where p.id = p_user_id;
$$;

revoke execute on function private.member_current_week(uuid, timestamptz) from public, anon, authenticated;
grant execute on function private.member_current_week(uuid, timestamptz) to authenticated;

-- 2. The ten callers, replaced with the lookup swapped for the helper.

-- commitment_is_active, from 20261120000000_commitments.sql.
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

  select w.time_zone into v_tz
  from private.member_current_week(c.user_id, now()) w;
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

-- add_commitment, from 20261120000000_commitments.sql.
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

  select w.time_zone into v_tz
  from private.member_current_week(v_uid, now()) w;
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

-- plan_preview, from 20261120000000_commitments.sql.
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

  select w.time_zone into v_tz
  from private.member_current_week(v_uid, now()) w;

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

-- add_task, from 20261122000000_tasks.sql.
create or replace function public.add_task(
  p_group_id uuid,
  p_preset_key text default null,
  p_group_activity_id uuid default null,
  p_custom_name text default null,
  p_name text default null,
  p_deadline date default null
)
returns table (commitment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
  v_name text;
  v_tz text;
  v_week_start date;
  v_today date;
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

  v_name := pg_catalog.regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 40 then
    raise exception 'invalid_plan';
  end if;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;
  v_today := (now() at time zone v_tz)::date;

  if p_deadline is null or p_deadline < v_today or p_deadline > v_week_start + 6 then
    raise exception 'invalid_deadline';
  end if;

  v_activity := private.resolve_group_activity(p_group_id, p_preset_key, p_group_activity_id, p_custom_name);

  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, schedule_type, name, deadline,
     deadline_day_starts_at)
  values
    (p_group_id, v_membership_id, v_uid, 'task', v_activity.id, null, v_name, p_deadline,
     private.local_start(p_deadline, v_tz))
  returning id into v_commitment_id;

  perform private.ensure_group_week(p_group_id, v_week_start);

  insert into public.sessions
    (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
  values
    (p_group_id, v_membership_id, v_uid, v_commitment_id, v_week_start, 0, now(),
     private.local_start(p_deadline + 1, v_tz));

  commitment_id := v_commitment_id;
  return next;
end;
$$;

-- get_today_items, from 20261123000000_today.sql.
create or replace function public.get_today_items(p_group_id uuid)
returns table (
  commitment_id uuid,
  kind text,
  section text,
  preset_key text,
  custom_name text,
  activity_name text,
  name text,
  schedule_type text,
  days smallint[],
  target smallint,
  counted smallint,
  deadline date,
  starts_on date,
  can_delete boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
  v_tz text;
  v_week_start date;
  v_today date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;
  v_today := (now() at time zone v_tz)::date;

  return query
  with week_sessions as (
    select
      s.commitment_id as cid,
      count(*)::smallint as session_count,
      bool_or(s.ends_at > now()) as has_open,
      bool_or(s.slot = extract(isodow from v_today) and s.ends_at > now()) as has_open_today_slot,
      max(s.ends_at) as last_ends_at
    from public.sessions s
    where s.membership_id = v_membership_id
      and s.week_start = v_week_start
    group by s.commitment_id
  ),
  current_rows as (
    select
      c.id as cid,
      c.kind as c_kind,
      c.group_activity_id as ga_id,
      c.name as c_name,
      c.schedule_type as c_schedule_type,
      c.deadline as c_deadline,
      c.deadline_day_starts_at as c_deadline_day_starts_at,
      w.session_count as c_target,
      0::smallint as c_counted,
      -- Member-local days from today through the local day of the last session end.
      (((w.last_ends_at - interval '1 microsecond') at time zone v_tz)::date - v_today + 1) as days_left,
      v_week_start as version_week
    from public.commitments c
    join week_sessions w on w.cid = c.id
    where c.group_id = p_group_id
      and c.membership_id = v_membership_id
      and w.has_open
      and (
        (c.kind = 'task' and c.deadline >= v_today)
        or (c.kind = 'commitment' and c.schedule_type = 'times_per_week')
        or (c.kind = 'commitment' and c.schedule_type = 'fixed_days' and w.has_open_today_slot)
      )
  ),
  placed as (
    select
      r.*,
      case
        when r.c_kind = 'task' and r.c_deadline = v_today then 'due_today'
        when r.c_kind = 'task' then 'this_week'
        when r.c_schedule_type = 'fixed_days' then 'due_today'
        when r.c_target - r.c_counted > 0 and r.c_target - r.c_counted >= r.days_left then 'due_today'
        else 'this_week'
      end as c_section,
      null::date as c_starts_on
    from current_rows r
  ),
  next_rows as (
    select
      c.id as cid,
      c.kind as c_kind,
      c.group_activity_id as ga_id,
      c.name as c_name,
      c.schedule_type as c_schedule_type,
      c.deadline as c_deadline,
      c.deadline_day_starts_at as c_deadline_day_starts_at,
      null::smallint as c_target,
      0::smallint as c_counted,
      null::integer as days_left,
      f.first_week as version_week,
      'starts_next_week' as c_section,
      f.first_week as c_starts_on
    from public.commitments c
    cross join lateral (
      select min(cv.effective_week_start) as first_week
      from public.commitment_versions cv
      where cv.commitment_id = c.id
    ) f
    where c.group_id = p_group_id
      and c.membership_id = v_membership_id
      and c.kind = 'commitment'
      and f.first_week > v_week_start
      and private.commitment_is_active(c)
  ),
  all_rows as (
    select * from placed
    union all
    select * from next_rows
  )
  select
    a.cid,
    a.c_kind,
    a.c_section,
    ga.preset_key,
    ga.custom_name,
    coalesce(pa.name, ga.custom_name),
    a.c_name,
    a.c_schedule_type,
    v.days,
    case
      when a.c_section = 'starts_next_week' then v.target
      else a.c_target
    end,
    a.c_counted,
    a.c_deadline,
    a.c_starts_on,
    coalesce(a.c_kind = 'task' and now() < a.c_deadline_day_starts_at, false)
  from all_rows a
  join public.group_activities ga on ga.id = a.ga_id
  left join public.preset_activities pa on pa.key = ga.preset_key
  left join lateral (
    select cv.days, cv.target
    from public.commitment_versions cv
    where cv.commitment_id = a.cid
      and cv.effective_week_start <= a.version_week
    order by cv.effective_week_start desc
    limit 1
  ) v on true
  order by
    case a.c_section when 'due_today' then 0 when 'this_week' then 1 else 2 end,
    -- Open before done (counted reaches the target). Nothing is done until Epic 3.
    coalesce(a.c_counted >= a.c_target, false),
    case
      when a.c_kind = 'commitment' and a.c_schedule_type = 'fixed_days' then 0
      when a.c_kind = 'commitment' then 1
      else 2
    end,
    a.c_deadline nulls first,
    pg_catalog.lower(coalesce(a.c_name, pa.name, ga.custom_name)),
    a.cid;
end;
$$;

-- get_today_summary, from 20261129000000_today_has_plan.sql.
create or replace function public.get_today_summary(p_group_id uuid)
returns table (
  member_today date,
  week_start date,
  week_number integer,
  planned integer,
  done integer,
  "left" integer,
  has_plan boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_week_start date;
  v_today date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;
  v_today := (now() at time zone v_tz)::date;

  return query
  select
    v_today,
    v_week_start,
    greatest(1, (v_week_start - private.week_start_of(m.joined_at, v_tz)) / 7 + 1)::integer,
    x.planned,
    x.done,
    x.open_not_counted,
    exists (
      select 1
      from public.commitments c
      where c.membership_id = m.id
        and (
          (c.kind = 'commitment' and private.commitment_is_active(c))
          or (c.kind = 'task' and c.deadline >= v_today)
        )
    )
  from public.memberships m
  cross join lateral (
    select
      count(*)::integer as planned,
      0::integer as done,
      -- Open sessions; none is counted until Epic 3.
      (count(*) filter (where s.ends_at > now()))::integer as open_not_counted
    from public.sessions s
    where s.membership_id = m.id
      and s.week_start = v_week_start
  ) x
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;
end;
$$;

-- get_my_plan, from 20261126000000_my_plan_fixes.sql.
create or replace function public.get_my_plan(p_group_id uuid)
returns table (
  commitment_id uuid,
  kind text,
  section text,
  state text,
  preset_key text,
  custom_name text,
  activity_name text,
  name text,
  schedule_type text,
  days smallint[],
  target smallint,
  end_date date,
  deadline date,
  starts_on date,
  ends_on date,
  can_edit boolean,
  can_delete boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
  v_tz text;
  v_week_start date;
  v_today date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;
  v_today := (now() at time zone v_tz)::date;

  return query
  with base as (
    select
      c.id as cid,
      c.kind as c_kind,
      c.group_activity_id as ga_id,
      c.name as c_name,
      c.schedule_type as c_schedule_type,
      c.ends_after_week_start as c_ends_after,
      c.deadline as c_deadline,
      c.deadline_day_starts_at as c_deadline_day_starts_at,
      case when c.kind = 'commitment' then private.commitment_is_active(c) else null end as c_active,
      f.first_week,
      l.latest_week,
      l.latest_end_date
    from public.commitments c
    cross join lateral (
      select min(cv.effective_week_start) as first_week
      from public.commitment_versions cv
      where cv.commitment_id = c.id
    ) f
    left join lateral (
      select cv.effective_week_start as latest_week, cv.end_date as latest_end_date
      from public.commitment_versions cv
      where cv.commitment_id = c.id
      order by cv.effective_week_start desc
      limit 1
    ) l on true
    where c.group_id = p_group_id
      and c.membership_id = v_membership_id
  ),
  stated as (
    select
      b.*,
      case
        when b.c_kind = 'task' and b.c_deadline >= v_today then 'open'
        when b.c_kind = 'task' then 'past'
        when not b.c_active then 'ended'
        when b.c_ends_after = v_week_start then 'ending'
        when b.latest_end_date between v_week_start and v_week_start + 6 then 'ending'
        when b.first_week > v_week_start then 'starts_next_week'
        when b.latest_week > v_week_start then 'pending_change'
        else 'active'
      end as c_state
    from base b
  ),
  shown as (
    select
      s.*,
      case when s.c_state in ('ended', 'past') then 'past' else 'current' end as c_section,
      -- The version the row shows: the new one for a pending change or a commitment that starts
      -- next week, the latest for an ended one, else the one in effect this week.
      case
        when s.c_state in ('pending_change', 'starts_next_week', 'ended') then s.latest_week
        else v_week_start
      end as version_week
    from stated s
  )
  select
    x.cid,
    x.c_kind,
    x.c_section,
    x.c_state,
    ga.preset_key,
    ga.custom_name,
    coalesce(pa.name, ga.custom_name),
    x.c_name,
    x.c_schedule_type,
    v.days,
    v.target,
    v.end_date,
    x.c_deadline,
    case
      when x.c_state in ('starts_next_week', 'pending_change') then x.latest_week
      else null
    end,
    case
      when x.c_state = 'ending' then least(v_week_start + 6, coalesce(x.latest_end_date, v_week_start + 6))
      else null
    end,
    case
      when x.c_kind = 'task' then x.c_state = 'open'
      else x.c_state <> 'ended'
        and x.c_ends_after is null
        and (x.latest_end_date is null
             or x.latest_end_date >= greatest(v_week_start + 7, x.first_week))
    end,
    coalesce(x.c_kind = 'task' and now() < x.c_deadline_day_starts_at, false)
  from shown x
  join public.group_activities ga on ga.id = x.ga_id
  left join public.preset_activities pa on pa.key = ga.preset_key
  left join lateral (
    select cv.days, cv.target, cv.end_date
    from public.commitment_versions cv
    where cv.commitment_id = x.cid
      and cv.effective_week_start <= x.version_week
    order by cv.effective_week_start desc
    limit 1
  ) v on true
  order by
    case x.c_section when 'current' then 0 else 1 end,
    case x.c_kind when 'commitment' then 0 else 1 end,
    case when x.c_section = 'current' then x.c_deadline end asc nulls first,
    case when x.c_section = 'past' then x.c_deadline end desc nulls last,
    pg_catalog.lower(coalesce(x.c_name, pa.name, ga.custom_name)),
    x.cid;
end;
$$;

-- get_commitment, from 20261126000000_my_plan_fixes.sql.
create or replace function public.get_commitment(p_commitment_id uuid)
returns table (
  commitment_id uuid,
  group_id uuid,
  preset_key text,
  custom_name text,
  activity_name text,
  schedule_type text,
  days smallint[],
  target smallint,
  end_date date,
  changes_from date,
  min_end_date date,
  state text,
  can_edit boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_week_start date;
  v_found boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;

  for commitment_id, group_id, preset_key, custom_name, activity_name, schedule_type, days, target,
      end_date, changes_from, min_end_date, state, can_edit in
    select
      c.id,
      c.group_id,
      ga.preset_key,
      ga.custom_name,
      coalesce(pa.name, ga.custom_name),
      c.schedule_type,
      l.days,
      l.target,
      l.end_date,
      greatest(v_week_start + 7, f.first_week),
      greatest(v_week_start + 7, f.first_week) + 6,
      case
        when not a.active then 'ended'
        when c.ends_after_week_start = v_week_start then 'ending'
        when l.end_date between v_week_start and v_week_start + 6 then 'ending'
        when f.first_week > v_week_start then 'starts_next_week'
        when l.effective_week_start > v_week_start then 'pending_change'
        else 'active'
      end,
      a.active
        and c.ends_after_week_start is null
        and (l.end_date is null or l.end_date >= greatest(v_week_start + 7, f.first_week))
    from public.commitments c
    join public.group_activities ga on ga.id = c.group_activity_id
    left join public.preset_activities pa on pa.key = ga.preset_key
    cross join lateral (select private.commitment_is_active(c) as active) a
    cross join lateral (
      select min(cv.effective_week_start) as first_week
      from public.commitment_versions cv
      where cv.commitment_id = c.id
    ) f
    left join lateral (
      select cv.effective_week_start, cv.days, cv.target, cv.end_date
      from public.commitment_versions cv
      where cv.commitment_id = c.id
      order by cv.effective_week_start desc
      limit 1
    ) l on true
    where c.id = p_commitment_id
      and c.user_id = v_uid
      and c.kind = 'commitment'
  loop
    v_found := true;
    return next;
  end loop;

  if not v_found then
    raise exception 'not_found';
  end if;
end;
$$;

-- update_commitment, from 20261126000000_my_plan_fixes.sql.
create or replace function public.update_commitment(
  p_commitment_id uuid,
  p_days integer[] default null,
  p_target integer default null,
  p_end_date date default null
)
returns table (changes_from date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_c public.commitments;
  v_days smallint[];
  v_target smallint;
  v_tz text;
  v_week_start date;
  v_first_week date;
  v_changes_from date;
  v_latest_end_date date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_c
  from public.commitments c
  where c.id = p_commitment_id
    and c.user_id = v_uid
    and c.kind = 'commitment'
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  -- FOR SHARE: a leave or removal of this membership waits until the edit is done.
  perform 1
  from public.memberships m
  where m.id = v_c.membership_id
    and m.ended_at is null
  for share;

  if not found then
    raise exception 'not_found';
  end if;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;

  select min(cv.effective_week_start) into v_first_week
  from public.commitment_versions cv
  where cv.commitment_id = v_c.id;

  v_changes_from := greatest(v_week_start + 7, v_first_week);

  select cv.end_date into v_latest_end_date
  from public.commitment_versions cv
  where cv.commitment_id = v_c.id
  order by cv.effective_week_start desc
  limit 1;

  -- Ended by the member, no longer active, or ending by its end date before the change would start
  -- (an edit must never extend or restart it).
  if v_c.ends_after_week_start is not null
     or not private.commitment_is_active(v_c)
     or v_latest_end_date < v_changes_from then
    raise exception 'commitment_ended';
  end if;

  if v_c.schedule_type = 'fixed_days' then
    if p_target is not null
       or p_days is null
       or pg_catalog.array_ndims(p_days) is distinct from 1
       or pg_catalog.cardinality(p_days) not between 1 and 7
       or exists (select 1 from pg_catalog.unnest(p_days) as d(v) where d.v is null or d.v not between 1 and 7)
       or (select count(distinct d.v) from pg_catalog.unnest(p_days) as d(v)) <> pg_catalog.cardinality(p_days) then
      raise exception 'invalid_plan';
    end if;
    v_days := array(select d.v::smallint from pg_catalog.unnest(p_days) as d(v) order by d.v);
  else
    if p_days is not null or p_target is null or p_target not between 1 and 7 then
      raise exception 'invalid_plan';
    end if;
    v_target := p_target::smallint;
  end if;

  if p_end_date is not null and p_end_date < v_changes_from + 6 then
    raise exception 'invalid_end_date';
  end if;

  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target, end_date)
  values (v_c.id, v_c.group_id, v_changes_from, v_days, v_target, p_end_date)
  on conflict (commitment_id, effective_week_start) do update
  set days = excluded.days,
      target = excluded.target,
      end_date = excluded.end_date;

  changes_from := v_changes_from;
  return next;
end;
$$;

-- end_commitment, from 20261125000000_my_plan.sql.
create or replace function public.end_commitment(p_commitment_id uuid)
returns table (ends_after_week_start date)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_c public.commitments;
  v_tz text;
  v_week_start date;
  v_first_week date;
  v_ends_after date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_c
  from public.commitments c
  where c.id = p_commitment_id
    and c.user_id = v_uid
    and c.kind = 'commitment'
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  -- FOR SHARE: a leave or removal of this membership waits until the end is done.
  perform 1
  from public.memberships m
  where m.id = v_c.membership_id
    and m.ended_at is null
  for share;

  if not found then
    raise exception 'not_found';
  end if;

  if v_c.ends_after_week_start is not null or not private.commitment_is_active(v_c) then
    raise exception 'commitment_ended';
  end if;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;

  select min(cv.effective_week_start) into v_first_week
  from public.commitment_versions cv
  where cv.commitment_id = v_c.id;

  if v_first_week > v_week_start then
    v_ends_after := v_week_start - 7;
  else
    v_ends_after := v_week_start;
  end if;

  delete from public.commitment_versions cv
  where cv.commitment_id = v_c.id
    and cv.effective_week_start > v_week_start
    and cv.effective_week_start > v_first_week;

  update public.commitments c
  set ends_after_week_start = v_ends_after
  where c.id = v_c.id;

  ends_after_week_start := v_ends_after;
  return next;
end;
$$;

-- 3. Grants as before.
revoke execute on function private.commitment_is_active(public.commitments) from public, anon, authenticated;
revoke execute on function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date) from public, anon;
revoke execute on function public.plan_preview(uuid, integer, date) from public, anon;
revoke execute on function public.add_task(uuid, text, uuid, text, text, date) from public, anon;
revoke execute on function public.get_today_items(uuid) from public, anon;
revoke execute on function public.get_today_summary(uuid) from public, anon;
revoke execute on function public.get_my_plan(uuid) from public, anon;
revoke execute on function public.get_commitment(uuid) from public, anon;
revoke execute on function public.update_commitment(uuid, integer[], integer, date) from public, anon;
revoke execute on function public.end_commitment(uuid) from public, anon;
grant execute on function private.commitment_is_active(public.commitments) to authenticated;
grant execute on function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date) to authenticated;
grant execute on function public.plan_preview(uuid, integer, date) to authenticated;
grant execute on function public.add_task(uuid, text, uuid, text, text, date) to authenticated;
grant execute on function public.get_today_items(uuid) to authenticated;
grant execute on function public.get_today_summary(uuid) to authenticated;
grant execute on function public.get_my_plan(uuid) to authenticated;
grant execute on function public.get_commitment(uuid) to authenticated;
grant execute on function public.update_commitment(uuid, integer[], integer, date) to authenticated;
grant execute on function public.end_commitment(uuid) to authenticated;
