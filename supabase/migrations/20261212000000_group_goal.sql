-- Group goal (Story 4.7, FR-29, FR-31, AD-2, AD-4, AD-5, AD-10, AD-11, AD-14, AD-15, AD-16).
--
-- An admin sets a weekly or monthly target (50-100 in steps of 5) for the average weekly points of
-- the members with a score. Goals are versioned; the lock decides the result:
--   public.group_goals                        one row per edit; the version for week D is the one
--                                             with the greatest effective_week_start <= D, latest
--                                             created_at breaking ties
--   group_week_results.goal_result_average    new: the value goal_hit was decided on (weekly: the
--                                             week's goal_average; monthly: the month's average)
--   private.goal_for_week(group, week)        the version in effect for a week
--   private.lock_month(group, week)           the calendar month (group time) of the week's lock
--   private.goal_live_average(group, week)    the live average of the current members with a score
--   private.goal_week_hit(group, week)        whether the week's goal is hit: the stored result of a
--                                             locked week, else the live values (pending seals)
--   public.set_group_goal(group, target, period)  admin only; a new version from the current week
--   private.lock_week                         writes the goal values and, when decided, one
--                                             goal_result feed event; Team Player follows from the
--                                             criteria awards
--   private.badge_criteria_met                the Team Player section (every other section verbatim)
--   public.get_group_goal(group)              the Goal panel's read
--
-- A group of one scores its own plan (Aldrin, 2026-11-20), but a goal stays a group thing (Story 4.7
-- decision): a goal result is decided only on a ranked lock (2+ members current at lock_at). A solo
-- or unscored week, or a ranked week where nobody has a score, gets no goal values, no feed event and
-- no Team Player, and is left out of a monthly average.
--
-- Backward compatible: one new table, one new nullable column, new functions; lock_week and
-- badge_criteria_met are replaced with the same signatures; feed_events_kind_check gains a kind.
-- The routines call now() unqualified on purpose (see 20261204000000_misses.sql).

-- 1. Versioned goals (AD-5). Every edit is a row; nothing updates or deletes one.
create table public.group_goals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  target_pct smallint not null
    constraint group_goals_target_pct_check
    check (target_pct between 50 and 100 and target_pct % 5 = 0),
  period text not null
    constraint group_goals_period_check
    check (period in ('weekly', 'monthly')),
  effective_week_start date not null
    constraint group_goals_effective_week_start_monday_check
    check (extract(isodow from effective_week_start) = 1),
  created_by uuid not null references public.profiles (id),
  -- clock_timestamp: two edits in one transaction still order.
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index group_goals_group_week_idx
  on public.group_goals (group_id, effective_week_start desc, created_at desc);
create index group_goals_created_by_idx on public.group_goals (created_by);

create trigger group_goals_set_updated_at
  before update on public.group_goals
  for each row execute function private.set_updated_at();

-- 2. The decided value (weekly: goal_average; monthly: the month's average), set with goal_hit.
alter table public.group_week_results add column goal_result_average numeric(4, 1) null;

-- 3. The goal version in effect for week D (none: no row).
create or replace function private.goal_for_week(p_group_id uuid, p_week_start date)
returns table (target_pct smallint, period text)
language sql
stable
security definer
set search_path = ''
as $$
  select g.target_pct, g.period
  from public.group_goals g
  where g.group_id = p_group_id
    and g.effective_week_start <= p_week_start
  order by g.effective_week_start desc, g.created_at desc, g.id desc
  limit 1;
$$;

-- 4. The first day of the calendar month the week's lock falls in, in the group's zone for that
--    week (the zone its lock was computed in). A lock on Thu 1 Apr 00:00 belongs to April.
create or replace function private.lock_month(p_group_id uuid, p_week_start date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.date_trunc(
    'month',
    private.week_lock_at(p_group_id, p_week_start)
      at time zone private.group_time_zone(p_group_id, p_week_start)
  )::date;
$$;

-- 5. The live goal average of a week: the current members with a score (private.group_ranking),
--    one decimal; null when nobody has a score.
create or replace function private.goal_live_average(p_group_id uuid, p_week_start date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.round(pg_catalog.avg(r.weekly_points), 1)
  from private.group_ranking(p_group_id, p_week_start) r
  where r.weekly_points is not null;
$$;

-- 6. Whether the goal of week D is hit. A locked week (its group_week_results row exists, also while
--    the lock step runs): the stored goal_hit. Otherwise the live values, for pending seals: 2+
--    current members, a version in effect, someone with a score; weekly: the live average reaches the
--    target; monthly: only on the week that closes the month (the next week's lock falls in another
--    month), with the month's locked averages plus D's live one.
create or replace function private.goal_week_hit(p_group_id uuid, p_week_start date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stored boolean;
  v_target smallint;
  v_period text;
  v_live numeric;
  v_month date;
  v_value numeric;
begin
  select coalesce(r.goal_hit, false) into v_stored
  from public.group_week_results r
  where r.group_id = p_group_id
    and r.week_start = p_week_start;
  if found then
    return v_stored;
  end if;

  if (select pg_catalog.count(*) from public.memberships m
      where m.group_id = p_group_id and m.ended_at is null) < 2 then
    return false;
  end if;

  select g.target_pct, g.period into v_target, v_period
  from private.goal_for_week(p_group_id, p_week_start) g;
  if v_target is null then
    return false;
  end if;

  v_live := private.goal_live_average(p_group_id, p_week_start);
  if v_live is null then
    return false;
  end if;

  if v_period = 'weekly' then
    return v_live >= v_target;
  end if;

  v_month := private.lock_month(p_group_id, p_week_start);
  if private.lock_month(p_group_id, p_week_start + 7) = v_month then
    return false;
  end if;

  select pg_catalog.round(pg_catalog.avg(x.average), 1) into v_value
  from (
    select r.goal_average as average
    from public.group_week_results r
    where r.group_id = p_group_id
      and r.week_start between p_week_start - 42 and p_week_start - 7
      and r.goal_average is not null
      and private.lock_month(p_group_id, r.week_start) = v_month
    union all
    select v_live
  ) x;
  return v_value >= v_target;
end;
$$;

-- 7. Set the goal (admin only): a new version effective from the group's current week, so an edit
--    applies to the current week until it locks and never touches a locked week.
create or replace function public.set_group_goal(
  p_group_id uuid,
  p_target_pct integer,
  p_period text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  if not private.is_admin(p_group_id) then
    raise exception 'not_admin';
  end if;

  if p_target_pct is null or p_target_pct < 50 or p_target_pct > 100 or p_target_pct % 5 <> 0
     or p_period is null or p_period not in ('weekly', 'monthly') then
    raise exception 'invalid_goal';
  end if;

  insert into public.group_goals (group_id, target_pct, period, effective_week_start, created_by)
  values (p_group_id, p_target_pct, p_period, private.group_current_week(p_group_id, now()), v_uid);
end;
$$;

-- 8. The feed log gains goal_result (keeps every kind).
alter table public.feed_events drop constraint feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check
  check (kind in ('member_joined', 'member_left', 'member_removed', 'admin_handover', 'miss',
                  'weekly_winner', 'goal_result'));

-- 9. AD-4: the badge criteria (from 20261211000000_badges_titles.sql), every section verbatim except
--    Team Player: the group's goal for week D is hit (private.goal_week_hit: the stored result of a
--    locked week, or the live values, so a pending seal shows while the live average meets it).
create or replace function private.badge_criteria_met(p_membership_id uuid, p_week_start date)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with
  week_d as (
    select t.planned - t.frozen > 0 and t.done >= t.planned - t.frozen as perfect
    from private.member_week_tally(p_membership_id, p_week_start) t
  ),
  week_before as (
    select
      t.planned - t.frozen > 0 and t.done >= t.planned - t.frozen as perfect,
      t.weekly_points
    from private.member_week_tally(p_membership_id, p_week_start - 7) t
  ),
  streaks as (
    select c.schedule_type, private.streak_through_week(c.id, p_week_start) as streak
    from public.commitments c
    where c.membership_id = p_membership_id
      and c.kind = 'commitment'
  ),
  -- Counted check-ins (they completed a session) in weeks up to D, with the hour they were taken
  -- in the zone the member's sessions of that week were built with.
  counted as (
    select
      extract(
        hour from k.captured_at at time zone private.member_time_zone(s.user_id, s.week_start)
      ) as local_hour
    from public.sessions s
    join public.checkins k on k.session_id = s.id
    where s.membership_id = p_membership_id
      and s.week_start <= p_week_start
  )
  -- First Proof: at least 1 check-in.
  select 'first_proof'::text
  where exists (select 1 from counted)
  union all
  -- Hat Trick: any streak at least 3.
  select 'hat_trick'
  where exists (select 1 from streaks where streak >= 3)
  union all
  -- On a Roll: any streak at least 10.
  select 'on_a_roll'
  where exists (select 1 from streaks where streak >= 10)
  union all
  -- Unbreakable: any streak at least 25.
  select 'unbreakable'
  where exists (select 1 from streaks where streak >= 25)
  union all
  -- Clean Sheet: D has non-frozen sessions and all of them are done.
  select 'clean_sheet'
  where coalesce((select w.perfect from week_d w), false)
  union all
  -- Back-to-Back: D and D-1 both perfect.
  select 'back_to_back'
  where coalesce((select w.perfect from week_d w), false)
    and coalesce((select b.perfect from week_before b), false)
  union all
  -- Monthly Machine: a times-per-week streak (target-met weeks) at least 4.
  select 'monthly_machine'
  where exists (select 1 from streaks where schedule_type = 'times_per_week' and streak >= 4)
  union all
  -- Comeback: D perfect and D-1's weekly points under 50 (a D-1 without a score does not count).
  select 'comeback'
  where coalesce((select w.perfect from week_d w), false)
    and coalesce((select b.weekly_points < 50 from week_before b), false)
  union all
  -- Dynasty: at least 3 Weekly Winner awards up to D.
  select 'dynasty'
  where (
    select pg_catalog.count(*)
    from public.badge_awards a
    where a.membership_id = p_membership_id
      and a.badge_key = 'weekly_winner'
      and a.week_start <= p_week_start
  ) >= 3
  union all
  -- Team Player (Story 4.7): the group's goal for D is hit (every member current at the lock).
  select 'team_player'
  where coalesce((
    select private.goal_week_hit(m.group_id, p_week_start)
    from public.memberships m
    where m.id = p_membership_id
  ), false)
  union all
  -- Fair Judge: Epic 5 (final ballots).
  select 'fair_judge'
  where false
  union all
  -- Early Bird: at least 5 counted check-ins taken before 07:00.
  select 'early_bird'
  where (select pg_catalog.count(*) from counted where local_hour < 7) >= 5
  union all
  -- Night Owl: at least 5 counted check-ins taken at or after 22:00.
  select 'night_owl'
  where (select pg_catalog.count(*) from counted where local_hour >= 22) >= 5
  union all
  -- Task Slayer: at least 10 task sessions done.
  select 'task_slayer'
  where (
    select pg_catalog.count(*)
    from public.sessions s
    join public.commitments c on c.id = s.commitment_id
    where s.membership_id = p_membership_id
      and s.week_start <= p_week_start
      and c.kind = 'task'
      and private.session_status(s) = 'done'
  ) >= 10;
$$;

-- 10. Lock one week (from 20261211000000_badges_titles.sql): the same body, plus the goal. On a
--     ranked week with a goal version in effect and someone with a score, group_week_results gets
--     goal_target, goal_period and goal_average (the members with a score, one decimal); a weekly
--     goal is decided at once, a monthly one on the lock that closes the month (the average of the
--     month's goal_average values, this week's included). A decided result writes one goal_result
--     feed event after the winner's; the criteria awards that follow then give Team Player to every
--     member current at lock_at (goal_week_hit reads this week's stored row). Re-runs stay no-ops.
create or replace function private.lock_week(p_group_id uuid, p_week_start date)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_lock_at timestamptz;
  v_locked_at timestamptz;
  v_members integer;
  v_ranked boolean;
  v_winners uuid[] := '{}'::uuid[];
  v_top integer;
  v_goal_target smallint;
  v_goal_period text;
  v_goal_average numeric;
  v_goal_hit boolean;
  v_goal_result numeric;
  v_month date;
begin
  select gw.lock_at, gw.locked_at into v_lock_at, v_locked_at
  from public.group_weeks gw
  where gw.group_id = p_group_id
    and gw.week_start = p_week_start
  for update;

  if not found or v_locked_at is not null or v_lock_at > now() then
    return false;
  end if;

  perform c.id
  from public.commitments c
  where c.group_id = p_group_id
  for share;

  insert into public.week_results
    (group_id, membership_id, user_id, week_start, weekly_points, sessions_done,
     sessions_planned, sessions_frozen, rank)
  select p_group_id, r.membership_id, r.user_id, p_week_start, r.weekly_points, r.sessions_done,
         r.sessions_planned, r.sessions_frozen, r.rank
  from private.week_ranking(p_group_id, p_week_start, v_lock_at) r;
  get diagnostics v_members = row_count;
  v_ranked := v_members >= 2;

  -- streak_through_week reads stored rows of earlier weeks only: this statement's own rows are not
  -- visible to it.
  insert into public.week_commitment_results
    (group_id, commitment_id, membership_id, week_start, planned, done, frozen, target_met,
     streak_after)
  select c.group_id, c.id, c.membership_id, p_week_start, x.planned, x.done, x.frozen,
         x.planned - x.frozen > 0 and x.done >= x.planned - x.frozen,
         private.streak_through_week(c.id, p_week_start)
  from public.commitments c
  join public.week_results wr
    on wr.membership_id = c.membership_id
   and wr.week_start = p_week_start
  cross join lateral (
    select
      count(*)::integer as planned,
      (count(*) filter (where z.status = 'done'))::integer as done,
      (count(*) filter (where z.status = 'frozen'))::integer as frozen
    from public.sessions s
    cross join lateral (select private.session_status(s) as status) z
    where s.commitment_id = c.id
      and s.week_start = p_week_start
  ) x
  where c.group_id = p_group_id
    and x.planned > 0;

  if v_ranked then
    select coalesce(pg_catalog.array_agg(wr.user_id order by wr.user_id), '{}'::uuid[])
      into v_winners
    from public.week_results wr
    where wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.rank is not null
      and wr.weekly_points > 0
      and wr.weekly_points = (
        select max(w2.weekly_points)
        from public.week_results w2
        where w2.group_id = p_group_id
          and w2.week_start = p_week_start
          and w2.rank is not null
      );

    -- Story 4.7: the goal values (a ranked week with a version in effect and someone with a score).
    select g.target_pct, g.period into v_goal_target, v_goal_period
    from private.goal_for_week(p_group_id, p_week_start) g;

    if v_goal_target is not null then
      select pg_catalog.round(pg_catalog.avg(wr.weekly_points), 1) into v_goal_average
      from public.week_results wr
      where wr.group_id = p_group_id
        and wr.week_start = p_week_start
        and wr.weekly_points is not null;
    end if;

    if v_goal_average is null then
      v_goal_target := null;
      v_goal_period := null;
    elsif v_goal_period = 'weekly' then
      v_goal_result := v_goal_average;
      v_goal_hit := v_goal_average >= v_goal_target;
    else
      v_month := private.lock_month(p_group_id, p_week_start);
      if private.lock_month(p_group_id, p_week_start + 7) <> v_month then
        select pg_catalog.round(pg_catalog.avg(x.average), 1) into v_goal_result
        from (
          select r.goal_average as average
          from public.group_week_results r
          where r.group_id = p_group_id
            and r.week_start between p_week_start - 42 and p_week_start - 7
            and r.goal_average is not null
            and private.lock_month(p_group_id, r.week_start) = v_month
          union all
          select v_goal_average
        ) x;
        v_goal_hit := v_goal_result >= v_goal_target;
      end if;
    end if;
  end if;

  insert into public.group_week_results
    (group_id, week_start, scored, ranked, winner_user_ids, goal_target, goal_period, goal_average,
     goal_hit, goal_result_average)
  values (p_group_id, p_week_start, v_members > 0, v_ranked, v_winners, v_goal_target,
          v_goal_period, v_goal_average, v_goal_hit, v_goal_result);

  -- Story 4.5: the Weekly Winner badge for each winner (co-winners each earn it) and one feed event.
  if pg_catalog.cardinality(v_winners) > 0 then
    insert into public.badge_awards
      (group_id, membership_id, user_id, badge_key, week_start, awarded_at)
    select p_group_id, wr.membership_id, wr.user_id, 'weekly_winner', p_week_start, now()
    from public.week_results wr
    where wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.user_id = any (v_winners)
    on conflict (membership_id, badge_key, week_start) do nothing;

    select max(wr.weekly_points) into v_top
    from public.week_results wr
    where wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.user_id = any (v_winners);

    insert into public.feed_events (group_id, kind, created_at, payload)
    select p_group_id, 'weekly_winner', now(),
           pg_catalog.jsonb_build_object(
             'week_start', p_week_start,
             'weekly_points', v_top,
             'winner_user_ids', pg_catalog.to_jsonb(v_winners),
             'winners', coalesce(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('user_id', p.id, 'name', p.display_name)
               order by p.display_name, p.id
             ), '[]'::jsonb)
           )
    from public.profiles p
    where p.id = any (v_winners);
  end if;

  -- Story 4.7: one feed event per decided goal result (no member named).
  if v_goal_hit is not null then
    insert into public.feed_events (group_id, kind, created_at, payload)
    values (
      p_group_id, 'goal_result', now(),
      pg_catalog.jsonb_build_object(
        'week_start', p_week_start,
        'period', v_goal_period,
        'target', v_goal_target,
        'average', v_goal_result,
        'hit', v_goal_hit
      )
    );
  end if;

  -- Story 4.6: the criteria badges, each earned once per membership (after the winner awards, so a
  -- third win earns Dynasty at the same lock; after the goal values, so a hit goal earns Team
  -- Player for every member current at lock_at).
  insert into public.badge_awards
    (group_id, membership_id, user_id, badge_key, week_start, awarded_at)
  select p_group_id, wr.membership_id, wr.user_id, k.key, p_week_start, now()
  from public.week_results wr
  cross join lateral private.badge_criteria_met(wr.membership_id, p_week_start) as k(key)
  where wr.group_id = p_group_id
    and wr.week_start = p_week_start
    and k.key <> 'weekly_winner'
    and not exists (
      select 1 from public.badge_awards a
      where a.membership_id = wr.membership_id
        and a.badge_key = k.key
    )
  on conflict (membership_id, badge_key, week_start) do nothing;

  update public.group_weeks
  set locked_at = now()
  where group_id = p_group_id
    and week_start = p_week_start;

  return true;
end;
$$;

-- 11. The Goal panel's read (AD-12). Raises not_member unless the caller is a current member. One
--     row:
--       week_start      the group's current week
--       member_count    current members (the panel hides in a group of one)
--       target_pct, period   the version in effect for the current week (null: no goal)
--       live_average    the current week's average of the members with a score (one decimal)
--       month_weeks     monthly goal: each locked week whose lock falls in the current week's lock
--                       month and that has a goal_average, [{week_start, goal_average}], oldest first
--       month_average   their average (one decimal); null before the month's first lock
--       contributions   every current member in ranking order: [{user_id, name, weekly_points}]
--                       (weekly_points null: no score)
--       last_result     the most recent locked week's decided result, else null:
--                       {week_start, period, target, average, hit}
create or replace function public.get_group_goal(p_group_id uuid)
returns table (
  week_start date,
  member_count integer,
  target_pct integer,
  period text,
  live_average numeric,
  month_weeks jsonb,
  month_average numeric,
  contributions jsonb,
  last_result jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_week date;
  v_target smallint;
  v_period text;
  v_month date;
  v_month_weeks jsonb := '[]'::jsonb;
  v_month_average numeric;
  v_last record;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  v_week := private.group_current_week(p_group_id, now());

  select g.target_pct, g.period into v_target, v_period
  from private.goal_for_week(p_group_id, v_week) g;

  if v_period = 'monthly' then
    v_month := private.lock_month(p_group_id, v_week);
    select
      coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('week_start', r.week_start, 'goal_average', r.goal_average)
        order by r.week_start
      ), '[]'::jsonb),
      pg_catalog.round(pg_catalog.avg(r.goal_average), 1)
      into v_month_weeks, v_month_average
    from public.group_week_results r
    where r.group_id = p_group_id
      and r.week_start between v_week - 42 and v_week - 7
      and r.goal_average is not null
      and private.lock_month(p_group_id, r.week_start) = v_month;
  end if;

  select r.week_start, r.goal_period, r.goal_target, r.goal_result_average, r.goal_hit
    into v_last
  from public.group_week_results r
  join public.group_weeks gw
    on gw.group_id = r.group_id
   and gw.week_start = r.week_start
  where r.group_id = p_group_id
    and gw.locked_at is not null
  order by r.week_start desc
  limit 1;

  return query
  select
    v_week,
    (select pg_catalog.count(*)::integer from public.memberships m
     where m.group_id = p_group_id and m.ended_at is null),
    v_target::integer,
    v_period,
    private.goal_live_average(p_group_id, v_week),
    v_month_weeks,
    v_month_average,
    (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'user_id', r.user_id, 'name', p.display_name, 'weekly_points', r.weekly_points
        )
        order by r.rank nulls last, r.weekly_points desc nulls last, p.display_name, r.user_id
      ), '[]'::jsonb)
      from private.group_ranking(p_group_id, v_week) r
      join public.profiles p on p.id = r.user_id
    ),
    case
      when v_last.goal_hit is not null then pg_catalog.jsonb_build_object(
        'week_start', v_last.week_start,
        'period', v_last.goal_period,
        'target', v_last.goal_target,
        'average', v_last.goal_result_average,
        'hit', v_last.goal_hit
      )
    end;
end;
$$;

-- 12. Grants (AD-16): helpers closed to clients; the two RPCs for signed-in members only.
revoke execute on function private.goal_for_week(uuid, date) from public, anon, authenticated;
revoke execute on function private.lock_month(uuid, date) from public, anon, authenticated;
revoke execute on function private.goal_live_average(uuid, date) from public, anon, authenticated;
revoke execute on function private.goal_week_hit(uuid, date) from public, anon, authenticated;
revoke execute on function private.badge_criteria_met(uuid, date) from public, anon, authenticated;
revoke execute on function private.lock_week(uuid, date) from public, anon, authenticated;
revoke execute on function public.set_group_goal(uuid, integer, text) from public, anon;
grant execute on function public.set_group_goal(uuid, integer, text) to authenticated;
revoke execute on function public.get_group_goal(uuid) from public, anon;
grant execute on function public.get_group_goal(uuid) to authenticated;

-- 13. Row level security: current members read their group's goals (AD-3); no client writes.
alter table public.group_goals enable row level security;

create policy group_goals_select_member
  on public.group_goals
  for select
  to authenticated
  using (private.is_member(group_id));

revoke all on table public.group_goals from public, anon, authenticated;
grant select on table public.group_goals to authenticated;
