-- Badges and titles (Story 4.6, FR-24, FR-30, AD-3, AD-4, AD-5, AD-12, AD-14, AD-15, AD-16).
--
-- The badge catalog gains the other 14 badges (15 in display order), a `titles` table holds the 6
-- titles by all-time points, and badges are awarded from locked weeks only, never revoked:
--   private.badge_criteria_met(membership, week)  AD-4: the one definition of every badge rule, one
--                                                  named section per badge, used by the lock step
--                                                  (awards) and by get_member_profile (pending)
--   private.member_week_tally(membership, week)    a member week's sessions and points: the stored
--                                                  week_results row of a locked week, else live
--   private.title_for_points(points)               the title key for an all-time points total
--   private.lock_week                              after the winner awards, each member current at
--                                                  lock_at earns every met badge not earned before
--                                                  in that membership (Weekly Winner stays per week)
--   public.get_member_profile(group, user)         Me and the member profile: name, avatar,
--                                                  membership, all-time points, title, the 15 badges
--                                                  (earned / pending / locked), streaks, plan
--   public.get_winner_week                         gains badge_name and badge_line (the catalog is
--                                                  the one place the Weekly Winner copy lives)
--
-- A group of one scores its own plan (Aldrin, 2026-11-20): a solo week (ranked = false) awards
-- every badge that does not depend on rank. Weekly Winner and Dynasty come only from weekly_winner
-- awards, which need a ranked week; Team Player (Story 4.7) and Fair Judge (Epic 5) are seeded but
-- never met here.
--
-- Backward compatible: new rows, one new table, new functions; private.lock_week is replaced with
-- the same signature and the 4.5 body plus the criteria awards; weekly_winner's sort order and icon
-- change (display only). get_winner_week is dropped and recreated (new output columns) with its
-- arguments, every column and its grants; nothing in the database calls it and the running app
-- ignores the extra columns. The routines call now() unqualified on purpose (see
-- 20261204000000_misses.sql).

-- 1. The catalog: 15 badges in display order (EXPERIENCE.md Gamification Content; icons from
--    mockups/badges-names-1.html).
update public.badges
set sort_order = 9,
    icon = 'trophy'
where key = 'weekly_winner';

insert into public.badges (key, name, how_earned, line, icon, sort_order)
values
  ('first_proof', 'First Proof', 'Your first check-in',
   'Pics or it didn''t happen. It happened.', 'camera', 1),
  ('hat_trick', 'Hat Trick', 'A streak of 3',
   'Three in a row. Suspiciously consistent.', 'fire', 2),
  ('on_a_roll', 'On a Roll', 'A streak of 10',
   'Ten straight. Who are you?', 'fire-simple', 3),
  ('unbreakable', 'Unbreakable', 'A streak of 25',
   '25. The couch has given up on you.', 'shield-check', 4),
  ('clean_sheet', 'Clean Sheet', 'A perfect week: every session done',
   'Every session. Not one excuse.', 'check-circle', 5),
  ('back_to_back', 'Back-to-Back', 'Two perfect weeks in a row',
   'Two perfect weeks. Showing off now.', 'checks', 6),
  ('monthly_machine', 'Monthly Machine', 'A times-per-week target met 4 weeks in a row',
   'A whole month. Respect.', 'calendar-check', 7),
  ('comeback', 'Comeback', 'A perfect week right after a week under 50 points',
   'Rose from the couch.', 'arrow-fat-up', 8),
  ('dynasty', 'Dynasty', 'Weekly winner 3 times',
   'Three crowns. Someone stop them.', 'crown', 10),
  ('team_player', 'Team Player', 'The group hits its goal (everyone gets it)',
   'Nobody let the group down. This time.', 'users-three', 11),
  ('fair_judge', 'Fair Judge', 'Voted on 10 challenges or freezes',
   'Keeps the group honest.', 'gavel', 12),
  ('early_bird', 'Early Bird', '5 check-ins taken before 07:00',
   'Up before the excuses.', 'sun-horizon', 13),
  ('night_owl', 'Night Owl', '5 check-ins taken at 22:00 or later',
   'Cutting it close, but it counts.', 'moon-stars', 14),
  ('task_slayer', 'Task Slayer', '10 tasks done',
   'Ten chores down. Adulting unlocked.', 'list-checks', 15);

-- 2. Titles (FR-24) by all-time points in a group. Readable by every signed-in member.
create table public.titles (
  key text primary key,
  name text not null,
  min_points integer not null
    constraint titles_min_points_check
    check (min_points >= 0),
  sort_order integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create unique index titles_min_points_key on public.titles (min_points);

create trigger titles_set_updated_at
  before update on public.titles
  for each row execute function private.set_updated_at();

insert into public.titles (key, name, min_points, sort_order)
values
  ('couch_potato', 'Couch Potato', 0, 1),
  ('warming_up', 'Warming Up', 300, 2),
  ('regular', 'Regular', 1000, 3),
  ('grinder', 'Grinder', 2500, 4),
  ('machine', 'Machine', 5000, 5),
  ('legend', 'Legend', 10000, 6);

-- The title for an all-time points total: the highest threshold at or below it.
create or replace function private.title_for_points(p_points integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.key
  from public.titles t
  where t.min_points <= greatest(coalesce(p_points, 0), 0)
  order by t.min_points desc
  limit 1;
$$;

-- 3. A member week's sessions and points: the stored week_results row when the week is locked
--    (locked rows for locked weeks), nothing for a locked week without a row for the membership,
--    else the live counts (private.session_status) and private.weekly_points.
create or replace function private.member_week_tally(p_membership_id uuid, p_week_start date)
returns table (planned integer, done integer, frozen integer, weekly_points integer)
language sql
stable
security definer
set search_path = ''
as $$
  select wr.sessions_planned, wr.sessions_done, wr.sessions_frozen, wr.weekly_points
  from public.week_results wr
  where wr.membership_id = p_membership_id
    and wr.week_start = p_week_start
  union all
  select x.planned, x.done, x.frozen, private.weekly_points(p_membership_id, p_week_start)
  from (
    select
      count(*)::integer as planned,
      (count(*) filter (where z.status = 'done'))::integer as done,
      (count(*) filter (where z.status = 'frozen'))::integer as frozen
    from public.sessions s
    cross join lateral (select private.session_status(s) as status) z
    where s.membership_id = p_membership_id
      and s.week_start = p_week_start
  ) x
  where not exists (
      select 1 from public.week_results wr
      where wr.membership_id = p_membership_id and wr.week_start = p_week_start
    )
    and not exists (
      select 1
      from public.memberships m
      join public.group_weeks gw
        on gw.group_id = m.group_id
       and gw.week_start = p_week_start
       and gw.locked_at is not null
      where m.id = p_membership_id
    );
$$;

-- 4. AD-4: the badge keys whose criteria the membership meets for week D (a group week). Locked
--    weeks read the stored rows (week_results, week_commitment_results via streak_through_week,
--    badge_awards); unlocked weeks use the live AD-4 functions. One named section per badge:
--    Story 4.7 fills Team Player, Epic 5 Fair Judge. Weekly Winner is not a criterion (the lock
--    awards it from the week's winners).
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
  -- Team Player: Story 4.7 (the group goal).
  select 'team_player'
  where false
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

-- 5. Lock one week (from 20261210000000_weekly_winner.sql): the same body, plus, after the winner
--    awards and feed event and before locked_at, the criteria badges: every member current at
--    lock_at (their week_results row) earns each key private.badge_criteria_met returns that the
--    membership has never earned. An unscored week has no rows, so it awards nothing. Re-runs stay
--    no-ops (locked_at, the unique keys).
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

  insert into public.group_week_results (group_id, week_start, scored, ranked, winner_user_ids)
  values (p_group_id, p_week_start, v_members > 0, v_ranked, v_winners);

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

  -- Story 4.6: the criteria badges, each earned once per membership (after the winner awards, so a
  -- third win earns Dynasty at the same lock).
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

-- 6. Me and the member profile (AD-12). Raises not_member unless the caller is a current member of
--    the group. One row for a user who has (or had) a membership in the group; no row otherwise.
--    A left or removed member: name and avatar, is_current_member false, empty lists.
--    A current member:
--      all_time_points  private.all_time_points of the current membership; title_key from it
--      time_zone        the group's zone for its current week (the pending seals' lock time)
--      badges           the 15 catalog badges in display order: key, name, how_earned, line, icon,
--                       status earned (awarded_at: the latest award) / pending (criteria met in a
--                       group week whose lock has not run: the current week, and the one before
--                       while unlocked; pending_lock_at: the earliest such week's lock) / locked
--      streaks          the member's active commitments: commitment_id, activity_name,
--                       current_streak, back_to_zero
--      plan, task_count the current week's plan (get_board's shape)
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
    select a.badge_key, max(a.awarded_at) as awarded_at
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

-- 7. get_winner_week (from 20261210000000_weekly_winner.sql) with every column plus the Weekly
--    Winner badge's name and line from the catalog, repeated on every row.
drop function public.get_winner_week(uuid, date);

create function public.get_winner_week(p_group_id uuid, p_week_start date)
returns table (
  week_start date,
  lock_at timestamptz,
  scored boolean,
  ranked boolean,
  winner_user_ids uuid[],
  user_id uuid,
  display_name text,
  avatar_path text,
  weekly_points integer,
  rank integer,
  is_winner boolean,
  badge_name text,
  badge_line text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_week date;
  v_name text;
  v_line text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  if p_week_start is null then
    select max(gw.week_start) into v_week
    from public.group_weeks gw
    where gw.group_id = p_group_id
      and gw.locked_at is not null;
  else
    v_week := p_week_start;
  end if;

  select b.name, b.line into v_name, v_line
  from public.badges b
  where b.key = 'weekly_winner';

  return query
  select
    gr.week_start,
    gw.lock_at,
    gr.scored,
    gr.ranked,
    gr.winner_user_ids,
    m.user_id,
    m.display_name,
    m.avatar_path,
    m.weekly_points,
    m.rank,
    m.is_winner,
    v_name,
    v_line
  from public.group_week_results gr
  join public.group_weeks gw
    on gw.group_id = gr.group_id
   and gw.week_start = gr.week_start
   and gw.locked_at is not null
  left join lateral (
    select
      wr.user_id,
      p.display_name,
      p.avatar_path,
      wr.weekly_points,
      wr.rank,
      wr.user_id = any (gr.winner_user_ids) as is_winner
    from public.week_results wr
    join public.profiles p on p.id = wr.user_id
    where wr.group_id = gr.group_id
      and wr.week_start = gr.week_start
      and wr.rank is not null
      and (wr.rank <= 3 or wr.user_id = any (gr.winner_user_ids))
  ) m on true
  where gr.group_id = p_group_id
    and gr.week_start = v_week
  order by m.is_winner desc nulls last,
           case when m.is_winner then null else m.rank end nulls first,
           m.display_name, m.user_id;
end;
$$;

-- 8. Grants (AD-16). The helpers stay closed; the RPCs are for authenticated only.
revoke execute on function private.title_for_points(integer) from public, anon, authenticated;
revoke execute on function private.member_week_tally(uuid, date) from public, anon, authenticated;
revoke execute on function private.badge_criteria_met(uuid, date) from public, anon, authenticated;
revoke execute on function private.lock_week(uuid, date) from public, anon, authenticated;
revoke execute on function public.get_member_profile(uuid, uuid) from public, anon;
grant execute on function public.get_member_profile(uuid, uuid) to authenticated;
revoke execute on function public.get_winner_week(uuid, date) from public, anon;
grant execute on function public.get_winner_week(uuid, date) to authenticated;

-- 9. Row level security: every signed-in member reads the titles; no client writes.
alter table public.titles enable row level security;

create policy titles_select_authenticated
  on public.titles
  for select
  to authenticated
  using (true);

revoke all on table public.titles from public, anon, authenticated;
grant select on table public.titles to authenticated;
