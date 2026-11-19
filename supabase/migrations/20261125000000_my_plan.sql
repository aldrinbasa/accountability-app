-- My plan: edit or end commitments (Story 2.6, FR-11, FR-9, FR-12, FR-10, AD-2, AD-6, AD-11,
-- AD-12, AD-14, AD-15, AD-16).
--
-- Four functions. get_my_plan lists the caller's commitments and tasks in a group with a
-- server-computed section and state; get_commitment reads one of the caller's commitments for the
-- Plan sheet's edit mode. update_commitment writes a version for the member's next Monday (or the
-- first week, when that is later), replacing a still-pending one; end_commitment sets
-- ends_after_week_start. Neither ever touches the current week's sessions or versions, and the
-- schedule type never changes in place. The FR-10 type lock releases through
-- private.commitment_is_active only.
--
-- Additive only: four new functions, no new private helper (so no new grant on private). The
-- functions call now() unqualified on purpose. With search_path = '' that is pg_catalog.now();
-- pgTAP re-points a function's search_path at test_overrides inside its rolled-back transaction
-- so tests.freeze_time moves the clock.

-- 1. Read: the caller's plan in a group. Stable and security invoker (commitments,
--    commitment_versions, group_activities and preset_activities RLS apply). Rows come from the
--    caller's current membership only.
--    Commitment states, first match wins:
--    - ended: not private.commitment_is_active (section past).
--    - ending: ends_after_week_start is the current week, or the latest version's end date falls
--      inside the current week; ends_on is the last day with a session (that end date, else Sunday).
--    - starts_next_week: the first version starts after the current week; starts_on = that Monday.
--    - pending_change: a started commitment with a version after the current week; starts_on = that
--      version's Monday, days / target / end_date are the new version's.
--    - active: otherwise; days / target / end_date are the version in effect this week.
--    Task states: open (deadline on or after the member's local today), else past (section past).
--    can_edit: a commitment that update_commitment accepts (active and not ended by the member), or
--    an open task. can_delete: delete_task's rule for tasks, false otherwise.
--    Order: current before past; commitments before tasks; tasks by deadline (soonest first in
--    current, latest first in past); then by title.
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

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);
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
      else x.c_state <> 'ended' and x.c_ends_after is null
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

-- 2. Read: one of the caller's own commitments, for the Plan sheet's edit mode. Stable and
--    security invoker. Anything that is not the caller's commitment (a task, another member's,
--    one of a past membership) raises not_found. days / target / end_date are the latest version's.
--    changes_from is the Monday an edit takes effect (the member's next Monday, or the first week
--    when that is later); min_end_date is that week's Sunday. state is get_my_plan's commitment
--    state; can_edit is update_commitment's rule (not ended and not ended by the member).
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

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);

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
      a.active and c.ends_after_week_start is null
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

-- 3. RPC: edit a commitment (FR-11). Checks in order: signed in, the caller's own commitment in a
--    current membership (not_found, also for a task), not ended (commitment_ended: ended by the
--    member, or no longer active), a plan of the commitment's own schedule type (invalid_plan:
--    fixed days needs p_days and no target, times per week needs p_target and no days), then the
--    end date (invalid_end_date: on or after the Sunday of the week the change takes effect).
--    Writes one version at changes_from (the member's next Monday, or the first week when that is
--    later), replacing a version already there (a pending change, or the first version of a
--    commitment that has not started). No session has used that week yet; the current week's
--    sessions and versions are never touched. The schedule type stays as it is, so no FR-10 check.
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

  if v_c.ends_after_week_start is not null or not private.commitment_is_active(v_c) then
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

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);

  select min(cv.effective_week_start) into v_first_week
  from public.commitment_versions cv
  where cv.commitment_id = v_c.id;

  v_changes_from := greatest(v_week_start + 7, v_first_week);

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

-- 4. RPC: end a commitment (FR-11). Same not_found and commitment_ended checks as
--    update_commitment. A started commitment gets ends_after_week_start = the member's current
--    week: this week's sessions stay and none are created after this Sunday. One that has not
--    started (its first version is after the current week) gets the previous Monday, so it is
--    inactive at once, moves to Past and never gets sessions. Pending changes (versions after the
--    current week) are dropped; a not-started commitment keeps its first version so Past can still
--    show what it was. The FR-10 lock releases through private.commitment_is_active.
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

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);

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

-- 5. Grants: the four functions are executable by authenticated only. No new private helper.
revoke execute on function public.get_my_plan(uuid) from public, anon;
revoke execute on function public.get_commitment(uuid) from public, anon;
revoke execute on function public.update_commitment(uuid, integer[], integer, date) from public, anon;
revoke execute on function public.end_commitment(uuid) from public, anon;
grant execute on function public.get_my_plan(uuid) to authenticated;
grant execute on function public.get_commitment(uuid) to authenticated;
grant execute on function public.update_commitment(uuid, integer[], integer, date) to authenticated;
grant execute on function public.end_commitment(uuid) to authenticated;
