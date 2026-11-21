-- Epic 4 retro fixes (sprint-status items 17-20; spec-epic-4-retro-fixes.md; Aldrin's decisions of
-- 2026-11-21, sprint-change-proposal-2026-11-21.md).
--
--   private.goal_month_value(group, week, week_average)  new: the month value a lock of the week
--                                     would decide: the goal_average of the month's locked weeks
--                                     (whatever their goal period) plus the week's own average when
--                                     it has one; one decimal; null when there is none
--   private.goal_week_hit             a monthly goal on the closing week reads goal_month_value, so
--                                     a solo or unscored closing week can still be hit (pending seal)
--   private.lock_week                 monthly goal: the closing lock always decides the month while
--                                     the version in effect for the week is monthly, also when the
--                                     week is solo or nobody scored (goal_average stays null then);
--                                     no week with an average means no result. Team Player is
--                                     awarded on every hit to every member current at lock_at (like
--                                     Weekly Winner, one award per deciding week), no longer through
--                                     the one-time criteria insert. The lock's feed events carry the
--                                     week's lock time, not now(): the goal_result sticky at lock_at,
--                                     the weekly_winner sticky 1 ms later (newest, so on top of the
--                                     Feed), so a catch-up run never interleaves weeks
--   public.get_member_profile         badges gain award_count (the number of awards of the key;
--                                     awarded_at stays the latest)
--   public.get_group_goal             drop + create: every column kept, plus month_value_now (a
--                                     monthly goal's value if the month closed now: the month's
--                                     locked weeks plus the live week when it would get an
--                                     average); last_result is the newest decided result, shown
--                                     while it is current: a weekly one until a later week locks, a
--                                     monthly one until the month after its own has passed
--   badges                            Team Player's how_earned says it repeats
--
-- Backward compatible: one new private helper; functions replaced with the same signatures;
-- get_group_goal dropped and recreated with its arguments, every earlier column and its grants
-- (nothing in the database calls it; the running app ignores the extra column); existing
-- badge_awards rows stay valid (the unique key is already per membership, badge and week). The
-- routines call now() unqualified on purpose (see 20261204000000_misses.sql).

-- 1. The month value a lock of week D decides (or would decide now, with D's live average).
create or replace function private.goal_month_value(
  p_group_id uuid,
  p_week_start date,
  p_week_average numeric
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.round(pg_catalog.avg(x.average), 1)
  from (
    select r.goal_average as average
    from public.group_week_results r
    where r.group_id = p_group_id
      and r.week_start between p_week_start - 42 and p_week_start - 7
      and r.goal_average is not null
      and private.lock_month(p_group_id, r.week_start)
          = private.lock_month(p_group_id, p_week_start)
    union all
    select p_week_average
    where p_week_average is not null
  ) x;
$$;

-- 2. Whether the goal of week D is hit (from 20261212000000_group_goal.sql). A locked week: the
--    stored goal_hit. Otherwise the live values, for pending seals: a version in effect; weekly: 2+
--    current members and the live average reaches the target; monthly: only on the week that
--    closes the month, with goal_month_value (D's live average counts only with 2+ current
--    members), so a solo or unscored closing week is hit when the month's earlier weeks reach it.
create or replace function private.goal_week_hit(p_group_id uuid, p_week_start date)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stored boolean;
  v_members integer;
  v_target smallint;
  v_period text;
  v_live numeric;
  v_value numeric;
begin
  select coalesce(r.goal_hit, false) into v_stored
  from public.group_week_results r
  where r.group_id = p_group_id
    and r.week_start = p_week_start;
  if found then
    return v_stored;
  end if;

  select g.target_pct, g.period into v_target, v_period
  from private.goal_for_week(p_group_id, p_week_start) g;
  if v_target is null then
    return false;
  end if;

  select pg_catalog.count(*)::integer into v_members
  from public.memberships m
  where m.group_id = p_group_id
    and m.ended_at is null;

  v_live := case when v_members >= 2 then private.goal_live_average(p_group_id, p_week_start) end;

  if v_period = 'weekly' then
    return coalesce(v_live >= v_target, false);
  end if;

  if private.lock_month(p_group_id, p_week_start + 7)
     = private.lock_month(p_group_id, p_week_start) then
    return false;
  end if;

  v_value := private.goal_month_value(p_group_id, p_week_start, v_live);
  return coalesce(v_value >= v_target, false);
end;
$$;

-- 3. Lock one week (from 20261212000000_group_goal.sql): the same body, except the goal step, the
--    Team Player award and the feed events' times (see the header).
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
  end if;

  -- The goal (Story 4.7; monthly rule decided by Aldrin 2026-11-21). goal_average: a ranked week
  -- with someone with a score. Weekly: decided on that average. Monthly: decided on the lock that
  -- closes the month (the next week's lock falls in another month) from goal_month_value, also
  -- when this week has no average; a month with no average anywhere has no result.
  select g.target_pct, g.period into v_goal_target, v_goal_period
  from private.goal_for_week(p_group_id, p_week_start) g;

  if v_goal_target is not null then
    if v_ranked then
      select pg_catalog.round(pg_catalog.avg(wr.weekly_points), 1) into v_goal_average
      from public.week_results wr
      where wr.group_id = p_group_id
        and wr.week_start = p_week_start
        and wr.weekly_points is not null;
    end if;

    if v_goal_period = 'weekly' then
      if v_goal_average is not null then
        v_goal_result := v_goal_average;
        v_goal_hit := v_goal_average >= v_goal_target;
      end if;
    elsif v_members > 0
          and private.lock_month(p_group_id, p_week_start + 7)
              <> private.lock_month(p_group_id, p_week_start) then
      v_goal_result := private.goal_month_value(p_group_id, p_week_start, v_goal_average);
      if v_goal_result is not null then
        v_goal_hit := v_goal_result >= v_goal_target;
      end if;
    end if;

    if v_goal_average is null and v_goal_hit is null then
      v_goal_target := null;
      v_goal_period := null;
    end if;
  end if;

  insert into public.group_week_results
    (group_id, week_start, scored, ranked, winner_user_ids, goal_target, goal_period, goal_average,
     goal_hit, goal_result_average)
  values (p_group_id, p_week_start, v_members > 0, v_ranked, v_winners, v_goal_target,
          v_goal_period, v_goal_average, v_goal_hit, v_goal_result);

  -- Story 4.5: the Weekly Winner badge for each winner (co-winners each earn it) and one feed event
  -- (1 ms after the lock time, so it sits above the goal sticky).
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
    select p_group_id, 'weekly_winner', v_lock_at + interval '1 millisecond',
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

  -- Story 4.7: one feed event per decided goal result (no member named), at the lock time.
  if v_goal_hit is not null then
    insert into public.feed_events (group_id, kind, created_at, payload)
    values (
      p_group_id, 'goal_result', v_lock_at,
      pg_catalog.jsonb_build_object(
        'week_start', p_week_start,
        'period', v_goal_period,
        'target', v_goal_target,
        'average', v_goal_result,
        'hit', v_goal_hit
      )
    );
  end if;

  -- Team Player on every hit (Aldrin 2026-11-21): every member current at lock_at, one award per
  -- deciding week.
  if v_goal_hit then
    insert into public.badge_awards
      (group_id, membership_id, user_id, badge_key, week_start, awarded_at)
    select p_group_id, wr.membership_id, wr.user_id, 'team_player', p_week_start, now()
    from public.week_results wr
    where wr.group_id = p_group_id
      and wr.week_start = p_week_start
    on conflict (membership_id, badge_key, week_start) do nothing;
  end if;

  -- Story 4.6: the criteria badges, each earned once per membership (after the winner awards, so a
  -- third win earns Dynasty at the same lock). Weekly Winner and Team Player repeat and are awarded
  -- above.
  insert into public.badge_awards
    (group_id, membership_id, user_id, badge_key, week_start, awarded_at)
  select p_group_id, wr.membership_id, wr.user_id, k.key, p_week_start, now()
  from public.week_results wr
  cross join lateral private.badge_criteria_met(wr.membership_id, p_week_start) as k(key)
  where wr.group_id = p_group_id
    and wr.week_start = p_week_start
    and k.key not in ('weekly_winner', 'team_player')
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

-- 4. Me and the member profile (from 20261211000000_badges_titles.sql): the same body; each badge
--    gains award_count (0 when never earned).
create or replace function public.get_member_profile(p_group_id uuid, p_user_id uuid)
returns table (
  display_name text,
  avatar_path text,
  is_current_member boolean,
  all_time_points integer,
  title_key text,
  time_zone text,
  badges jsonb,
  streaks jsonb,
  plan jsonb,
  task_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_membership uuid;
  v_current boolean;
  v_week date;
  v_weeks date[];
  v_points integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  select m.id, m.ended_at is null into v_membership, v_current
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = p_user_id
  order by (m.ended_at is null) desc, m.joined_at desc
  limit 1;

  if not found then
    return;
  end if;

  if not v_current then
    return query
    select p.display_name, p.avatar_path, false, 0, null::text, null::text,
           '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 0
    from public.profiles p
    where p.id = p_user_id;
    return;
  end if;

  v_week := private.group_current_week(p_group_id, now());
  v_weeks := array[v_week];
  if exists (
    select 1 from public.group_weeks gw
    where gw.group_id = p_group_id
      and gw.week_start = v_week - 7
      and gw.locked_at is null
  ) then
    v_weeks := array[v_week - 7, v_week];
  end if;
  v_points := private.all_time_points(v_membership);

  return query
  with pending as (
    select k.key, min(private.week_lock_at(p_group_id, w.week)) as lock_at
    from pg_catalog.unnest(v_weeks) as w(week)
    cross join lateral private.badge_criteria_met(v_membership, w.week) as k(key)
    group by k.key
  ),
  earned as (
    select a.badge_key, max(a.awarded_at) as awarded_at, count(*)::integer as award_count
    from public.badge_awards a
    where a.membership_id = v_membership
    group by a.badge_key
  )
  select
    p.display_name,
    p.avatar_path,
    true,
    v_points,
    private.title_for_points(v_points),
    private.group_time_zone(p_group_id, v_week),
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'key', b.key,
          'name', b.name,
          'how_earned', b.how_earned,
          'line', b.line,
          'icon', b.icon,
          'status', case
            when e.awarded_at is not null then 'earned'
            when pd.lock_at is not null and b.key <> 'weekly_winner' then 'pending'
            else 'locked'
          end,
          'awarded_at', e.awarded_at,
          'award_count', coalesce(e.award_count, 0),
          'pending_lock_at', case
            when e.awarded_at is null and b.key <> 'weekly_winner' then pd.lock_at
          end
        )
        order by b.sort_order, b.key
      )
      from public.badges b
      left join earned e on e.badge_key = b.key
      left join pending pd on pd.key = b.key
    ),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'commitment_id', c.id,
          'activity_name', coalesce(pa.name, ga.custom_name),
          'current_streak', private.current_streak(c.id),
          'back_to_zero', private.streak_back_to_zero(c.id)
        )
        order by c.created_at, c.id
      )
      from public.commitments c
      join public.group_activities ga on ga.id = c.group_activity_id
      left join public.preset_activities pa on pa.key = ga.preset_key
      where c.membership_id = v_membership
        and c.kind = 'commitment'
        and private.commitment_is_active(c)
    ), '[]'::jsonb),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'activity_name', coalesce(pa.name, ga.custom_name),
          'schedule_type', c.schedule_type,
          'days', v.days,
          'target', v.target
        )
        order by c.created_at, c.id
      )
      from public.commitments c
      join public.group_activities ga on ga.id = c.group_activity_id
      left join public.preset_activities pa on pa.key = ga.preset_key
      left join lateral (
        select cv.days, cv.target
        from public.commitment_versions cv
        where cv.commitment_id = c.id
          and cv.effective_week_start <= v_week
        order by cv.effective_week_start desc
        limit 1
      ) v on true
      where c.membership_id = v_membership
        and c.kind = 'commitment'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = v_week
        )
    ), '[]'::jsonb),
    (
      select count(*)::integer
      from public.commitments c
      where c.membership_id = v_membership
        and c.kind = 'task'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = v_week
        )
    )
  from public.profiles p
  where p.id = p_user_id;
end;
$$;

-- 5. The Goal panel's read (from 20261212000000_group_goal.sql), every column kept, plus:
--      month_value_now  monthly goal: goal_month_value for the current week with its live average
--                       (counted only with 2+ current members); null for a weekly goal or none
--    and last_result is the newest decided result ({week_start, period, target, average, hit}),
--    else null: a weekly result only while its week is the newest locked week; a monthly result
--    while the newest locked week's lock month is its own month or the next.
drop function public.get_group_goal(uuid);

create function public.get_group_goal(p_group_id uuid)
returns table (
  week_start date,
  member_count integer,
  target_pct integer,
  period text,
  live_average numeric,
  month_weeks jsonb,
  month_average numeric,
  contributions jsonb,
  last_result jsonb,
  month_value_now numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_week date;
  v_members integer;
  v_target smallint;
  v_period text;
  v_live numeric;
  v_month date;
  v_month_weeks jsonb := '[]'::jsonb;
  v_month_average numeric;
  v_month_now numeric;
  v_last record;
  v_newest date;
  v_show_last boolean := false;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  v_week := private.group_current_week(p_group_id, now());

  select pg_catalog.count(*)::integer into v_members
  from public.memberships m
  where m.group_id = p_group_id
    and m.ended_at is null;

  select g.target_pct, g.period into v_target, v_period
  from private.goal_for_week(p_group_id, v_week) g;

  v_live := private.goal_live_average(p_group_id, v_week);

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

    v_month_now := private.goal_month_value(
      p_group_id, v_week, case when v_members >= 2 then v_live end
    );
  end if;

  select r.week_start, r.goal_period, r.goal_target, r.goal_result_average, r.goal_hit
    into v_last
  from public.group_week_results r
  join public.group_weeks gw
    on gw.group_id = r.group_id
   and gw.week_start = r.week_start
  where r.group_id = p_group_id
    and gw.locked_at is not null
    and r.goal_hit is not null
  order by r.week_start desc
  limit 1;

  if v_last.week_start is not null then
    select max(gw.week_start) into v_newest
    from public.group_weeks gw
    where gw.group_id = p_group_id
      and gw.locked_at is not null;

    v_show_last := case
      when v_last.goal_period = 'weekly' then v_newest = v_last.week_start
      else private.lock_month(p_group_id, v_newest)
           <= (private.lock_month(p_group_id, v_last.week_start) + interval '1 month')::date
    end;
  end if;

  return query
  select
    v_week,
    v_members,
    v_target::integer,
    v_period,
    v_live,
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
      when v_show_last then pg_catalog.jsonb_build_object(
        'week_start', v_last.week_start,
        'period', v_last.goal_period,
        'target', v_last.goal_target,
        'average', v_last.goal_result_average,
        'hit', v_last.goal_hit
      )
    end,
    v_month_now;
end;
$$;

-- 6. The catalog: Team Player repeats (line and icon unchanged).
update public.badges
set how_earned = 'Each time the group hits its goal (everyone gets it)'
where key = 'team_player';

-- 7. Grants (AD-16): the helper and the replaced private routines closed to clients; the two RPCs
--    for signed-in members only.
revoke execute on function private.goal_month_value(uuid, date, numeric) from public, anon, authenticated;
revoke execute on function private.goal_week_hit(uuid, date) from public, anon, authenticated;
revoke execute on function private.lock_week(uuid, date) from public, anon, authenticated;
revoke execute on function public.get_member_profile(uuid, uuid) from public, anon;
grant execute on function public.get_member_profile(uuid, uuid) to authenticated;
revoke execute on function public.get_group_goal(uuid) from public, anon;
grant execute on function public.get_group_goal(uuid) to authenticated;
