-- Today: Due today and This week (Story 2.5, FR-9, FR-12, FR-35, FR-4, AD-4, AD-11, AD-12, AD-14,
-- AD-15, AD-16).
--
-- Two reads for the Today screen. get_today_items returns the caller's rows for the focused group,
-- already placed in a section and in display order; get_today_summary returns the member-local
-- day, the week number and the week's counts. All day and week math happens here through the
-- shared helpers (AD-11); the client only formats.
--
-- Until check-ins exist (Epic 3) every session is open and `counted` / `done` are 0. Epic 3
-- switches those columns to the AD-4 scoring functions.
--
-- Additive only: two new functions, no new private helper (so no new grant on private). The
-- functions call now() unqualified on purpose. With search_path = '' that is pg_catalog.now();
-- pgTAP re-points a function's search_path at test_overrides inside its rolled-back transaction
-- so tests.freeze_time moves the clock.

-- 1. Read: the caller's Today rows for a group. Stable and security invoker (commitments,
--    commitment_versions, sessions, group_activities and preset_activities RLS apply).
--    Rows come from the caller's current membership only:
--    - Fixed days: the commitment's session for the member's local today, as `due_today`. Sessions
--      on other days are not listed.
--    - Times per week: every commitment with an open session this week, as `this_week`, or as
--      `due_today` once it is at risk: check-ins still needed (target - counted) are at least the
--      days left, counted in member-local days from today through the local day of the
--      commitment's last session end this week (a mid-week end date shortens it). The target is
--      the number of sessions this week (already pro-rated by the tick).
--    - Tasks: deadline today as `due_today`, later this week as `this_week`; a task whose deadline
--      day has passed is not listed.
--    - Commitments whose first version starts after the current week (and are still active), as
--      `starts_next_week` with `starts_on` = that Monday. No sessions yet.
--    `target` is the sessions owed this week for the first three (1 for a task); for a
--    `starts_next_week` row it is the first version's target (null for fixed days). `days` is the
--    version in effect for the row's week. `can_delete` is delete_task's rule for tasks, false
--    otherwise. Order: due_today, this_week, starts_next_week; open before done; fixed days, then
--    times per week, then tasks; tasks by deadline; then by title (task name or activity name).
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

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);
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

-- 2. Read: the Today summary for a group. Stable and security invoker. member_today and
--    week_start are the caller's local today and current week (profile zone). week_number counts
--    weeks since the caller joined this group (the week of joining is week 1). planned is the
--    caller's sessions this week in this group, done the ones counted (0 until Epic 3), left the
--    rest. Non-members get not_member.
create or replace function public.get_today_summary(p_group_id uuid)
returns table (
  member_today date,
  week_start date,
  week_number integer,
  planned integer,
  done integer,
  "left" integer
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

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);
  v_today := (now() at time zone v_tz)::date;

  return query
  select
    v_today,
    v_week_start,
    greatest(1, (v_week_start - private.week_start_of(m.joined_at, v_tz)) / 7 + 1)::integer,
    x.planned,
    x.done,
    x.planned - x.done
  from public.memberships m
  cross join lateral (
    select count(*)::integer as planned, 0::integer as done
    from public.sessions s
    where s.membership_id = m.id
      and s.week_start = v_week_start
  ) x
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;
end;
$$;

-- 3. Grants: both reads are executable by authenticated only. No new private helper.
revoke execute on function public.get_today_items(uuid) from public, anon;
revoke execute on function public.get_today_summary(uuid) from public, anon;
grant execute on function public.get_today_items(uuid) to authenticated;
grant execute on function public.get_today_summary(uuid) to authenticated;
