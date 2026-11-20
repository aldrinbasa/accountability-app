-- Week lock and frozen results (Story 4.4, FR-23, FR-24, FR-25, FR-27, AD-4, AD-5, AD-7, AD-11,
-- AD-15, AD-16).
--
-- At a week's lock_at (Thursday 00:00 after it, group zone) tick step 5 writes its frozen results
-- and stamps group_weeks.locked_at; nothing writes those rows again.
--   week_results             one row per member current at lock_at: weekly points, sessions, rank
--   week_commitment_results  one row per commitment or task of those members with sessions in the
--                            week: planned, done, frozen, target_met, streak_after (null for tasks)
--   group_week_results       one row per locked week: scored, ranked, winner_user_ids, goal columns
--                            (Story 4.7 fills them)
--
-- A group of one scores its own plan (Aldrin, 2026-11-20, a deviation from epics.md Story 4.4): its
-- week is frozen like any other (scored = true, the member's row with points) but ranked = false,
-- so every rank is null and nobody wins. ranked = true needs 2+ members current at lock_at.
-- scored = false (and no member rows) is left for a week with nobody current at lock_at.
--
-- AD-4 single definitions added or replaced here:
--   private.week_ranking(group, week, at)  the ranking over the members current at `at` (null:
--                                          current now); private.group_ranking is now this with
--                                          null, same output
--   private.streak_through_week            starts from the latest stored streak_after at or before
--                                          the week and walks only later weeks (same results);
--                                          private.current_streak delegates to it, unchanged
--   private.streak_back_to_zero            times per week reads stored streak_after > 0 and walks
--                                          only weeks without a stored row
--   private.all_time_points(membership)    the sum of the membership's locked weekly points
--   private.group_current_week(group, at)  the group's current week (get_group_week's formula)
--   private.week_lock_at(group, week)      the week's lock (the group_weeks row, else computed like
--                                          ensure_group_week)
--
-- public.get_board is dropped and recreated with every earlier column plus `locked`: a locked week
-- reads week_results; an unlocked week stays live.
--
-- Additive only: three new tables, one new nullable column, new functions; existing functions are
-- replaced with the same signatures (get_board keeps its arguments and every column). The routines
-- call now() unqualified on purpose (see 20261204000000_misses.sql).

-- 1. The done marker.
alter table public.group_weeks add column locked_at timestamptz null;

-- Tick step 5 looks for due, unlocked weeks.
create index group_weeks_unlocked_lock_at_idx
  on public.group_weeks (lock_at)
  where locked_at is null;

-- 2. Result tables.
create table public.week_results (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  -- Nullable so account deletion (Epic 7) can anonymize a locked row.
  user_id uuid null references public.profiles (id) on delete set null,
  week_start date not null
    constraint week_results_week_start_monday_check
    check (extract(isodow from week_start) = 1),
  weekly_points integer null
    constraint week_results_weekly_points_check
    check (weekly_points between 0 and 100),
  sessions_done integer not null
    constraint week_results_sessions_done_check
    check (sessions_done >= 0),
  sessions_planned integer not null
    constraint week_results_sessions_planned_check
    check (sessions_planned >= 0),
  sessions_frozen integer not null
    constraint week_results_sessions_frozen_check
    check (sessions_frozen >= 0),
  rank integer null
    constraint week_results_rank_check
    check (rank >= 1),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.week_commitment_results (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  commitment_id uuid not null references public.commitments (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  week_start date not null
    constraint week_commitment_results_week_start_monday_check
    check (extract(isodow from week_start) = 1),
  planned integer not null
    constraint week_commitment_results_planned_check
    check (planned >= 0),
  done integer not null
    constraint week_commitment_results_done_check
    check (done >= 0),
  frozen integer not null
    constraint week_commitment_results_frozen_check
    check (frozen >= 0),
  target_met boolean not null,
  -- The streak after this week (private.streak_through_week); null for a task.
  streak_after integer null
    constraint week_commitment_results_streak_after_check
    check (streak_after >= 0),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.group_week_results (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  week_start date not null
    constraint group_week_results_week_start_monday_check
    check (extract(isodow from week_start) = 1),
  -- At least one member was current at lock_at (their rows exist).
  scored boolean not null,
  -- At least two members were current at lock_at: ranks and a winner exist only then.
  ranked boolean not null default false,
  -- Story 4.7.
  goal_target smallint null,
  goal_period text null
    constraint group_week_results_goal_period_check
    check (goal_period in ('weekly', 'monthly')),
  goal_average numeric(4, 1) null,
  goal_hit boolean null,
  -- Every ranked member with the top weekly points (above 0); empty otherwise.
  winner_user_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint group_week_results_group_week_fkey
    foreign key (group_id, week_start)
    references public.group_weeks (group_id, week_start)
    on delete cascade
);

-- Only-once rules live in unique indexes (AD-18).
create unique index week_results_one_per_membership_week
  on public.week_results (membership_id, week_start);
create index week_results_group_id_week_start_idx on public.week_results (group_id, week_start);
create index week_results_user_id_idx on public.week_results (user_id);

create unique index week_commitment_results_one_per_commitment_week
  on public.week_commitment_results (commitment_id, week_start);
create index week_commitment_results_group_id_week_start_idx
  on public.week_commitment_results (group_id, week_start);
create index week_commitment_results_membership_id_idx
  on public.week_commitment_results (membership_id);

create unique index group_week_results_one_per_group_week
  on public.group_week_results (group_id, week_start);

create trigger week_results_set_updated_at
  before update on public.week_results
  for each row execute function private.set_updated_at();
create trigger week_commitment_results_set_updated_at
  before update on public.week_commitment_results
  for each row execute function private.set_updated_at();
create trigger group_week_results_set_updated_at
  before update on public.group_week_results
  for each row execute function private.set_updated_at();

-- 3. Week helpers (single definitions of formulas get_group_week and get_board repeated; the
--    instant is a parameter, the helper never reads the clock).

-- The group's current week at `p_at`: the Monday in the group's zone for that week.
create or replace function private.group_current_week(p_group_id uuid, p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select private.week_start_of(
    p_at,
    private.group_time_zone(
      p_group_id,
      private.week_start_of(p_at, private.group_time_zone(p_group_id, null))
    )
  );
$$;

-- The week's lock: the group_weeks row, else Thursday 00:00 after the week in the group's zone for
-- that week (as ensure_group_week computes it).
create or replace function private.week_lock_at(p_group_id uuid, p_week_start date)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select gw.lock_at from public.group_weeks gw
     where gw.group_id = p_group_id and gw.week_start = p_week_start),
    private.local_start(p_week_start + 10, private.group_time_zone(p_group_id, p_week_start))
  );
$$;

-- 4. AD-4: the ranking over a set of members. p_at null: the current members (FR-6); otherwise
--    the members current at p_at (joined at or before it and not ended before it). Scored members
--    are ranked by points desc, then sessions done desc; equal on both share a rank and the next is
--    skipped (rank()). Unscored members, and everyone when the set has fewer than 2 members, get
--    rank null and come after the ranked ones.
create or replace function private.week_ranking(
  p_group_id uuid,
  p_week_start date,
  p_at timestamptz
)
returns table (
  membership_id uuid,
  user_id uuid,
  weekly_points integer,
  sessions_done integer,
  sessions_planned integer,
  sessions_frozen integer,
  rank integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.id, m.user_id
    from public.memberships m
    where m.group_id = p_group_id
      and case
        when p_at is null then m.ended_at is null
        else m.joined_at <= p_at and (m.ended_at is null or m.ended_at >= p_at)
      end
  ),
  scored as (
    select
      mb.id,
      mb.user_id,
      private.weekly_points(mb.id, p_week_start) as points,
      x.done,
      x.planned,
      x.frozen
    from members mb
    cross join lateral (
      select
        (count(*) filter (where z.status = 'done'))::integer as done,
        count(*)::integer as planned,
        (count(*) filter (where z.status = 'frozen'))::integer as frozen
      from public.sessions s
      cross join lateral (select private.session_status(s) as status) z
      where s.membership_id = mb.id
        and s.week_start = p_week_start
    ) x
  ),
  ranked as (
    select
      sc.*,
      case
        when sc.points is not null and (select count(*) from members) >= 2
          then (pg_catalog.rank() over (
            partition by sc.points is null
            order by sc.points desc, sc.done desc
          ))::integer
      end as member_rank
    from scored sc
  )
  select r.id, r.user_id, r.points, r.done, r.planned, r.frozen, r.member_rank
  from ranked r
  order by r.member_rank nulls last, r.user_id;
$$;

-- The group's ranking for a week over its current members (Story 4.1's output, unchanged).
create or replace function private.group_ranking(p_group_id uuid, p_week_start date)
returns table (
  user_id uuid,
  weekly_points integer,
  sessions_done integer,
  sessions_planned integer,
  sessions_frozen integer,
  rank integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, r.weekly_points, r.sessions_done, r.sessions_planned, r.sessions_frozen, r.rank
  from private.week_ranking(p_group_id, p_week_start, null) r
  order by r.rank nulls last, r.user_id;
$$;

-- 5. AD-4: streaks from the stored results. The latest week_commitment_results row at or before
--    the week holds the streak after that week (rows exist only for locked weeks, written in the
--    lock's transaction); only later weeks are walked, with Story 4.2's rules:
--    Fixed days: a miss in the walked weeks resets the run to the done sessions after the latest
--    one; with no miss there, the stored streak plus the walked done sessions.
--    Times per week: a broken week (below a non-zero target, nothing open) in the walked weeks
--    resets the run to the met weeks after the latest one; otherwise the stored streak plus the
--    walked met weeks.
--    With no stored row this is Story 4.2's walk from the first session. A locked week's sessions
--    have all ended by its lock and nothing changes them afterwards, so the results are identical.
create or replace function private.streak_through_week(p_commitment_id uuid, p_week_start date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select r.week_start, r.streak_after
    from public.week_commitment_results r
    where r.commitment_id = p_commitment_id
      and r.week_start <= p_week_start
    order by r.week_start desc
    limit 1
  ),
  s as (
    select s.week_start, s.starts_at, private.session_status(s) as status
    from public.sessions s
    where s.commitment_id = p_commitment_id
      and s.week_start <= p_week_start
      and s.week_start > coalesce((select b.week_start from base b), '-infinity'::date)
  ),
  weeks as (
    select
      s.week_start,
      count(*) filter (where s.status <> 'frozen') as target,
      count(*) filter (where s.status = 'done') as done,
      count(*) filter (where s.status = 'open') as open
    from s
    group by s.week_start
  ),
  last_miss as (
    select max(s.starts_at) as miss_at from s where s.status = 'missed'
  ),
  last_broken as (
    select max(w.week_start) as week_start
    from weeks w
    where w.target > 0 and w.done < w.target and w.open = 0
  )
  select case
    when c.kind <> 'commitment' then null
    when c.schedule_type = 'fixed_days' then (
      select case
        when lm.miss_at is not null
          then (select count(*) from s where s.status = 'done' and s.starts_at > lm.miss_at)::integer
        else coalesce((select b.streak_after from base b), 0)
          + (select count(*) from s where s.status = 'done')::integer
      end
      from last_miss lm
    )
    else (
      select case
        when lb.week_start is not null
          then (select count(*) from weeks w
                where w.target > 0 and w.done >= w.target and w.week_start > lb.week_start)::integer
        else coalesce((select b.streak_after from base b), 0)
          + (select count(*) from weeks w where w.target > 0 and w.done >= w.target)::integer
      end
      from last_broken lb
    )
  end
  from public.commitments c
  where c.id = p_commitment_id;
$$;

-- "back to 0": as Story 4.2, but a times-per-week commitment reads its stored streak_after values
-- and walks only the weeks with no stored row (the unlocked ones), instead of every week.
create or replace function private.streak_back_to_zero(p_commitment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    c.kind = 'commitment'
    and private.current_streak(c.id) = 0
    and case
      when c.schedule_type = 'fixed_days' then exists (
        select 1 from public.sessions s
        where s.commitment_id = c.id
          and private.session_status(s) = 'done'
      )
      else exists (
        select 1 from public.week_commitment_results r
        where r.commitment_id = c.id
          and r.streak_after > 0
      )
      or exists (
        select 1
        from (
          select distinct s.week_start
          from public.sessions s
          where s.commitment_id = c.id
            and not exists (
              select 1 from public.week_commitment_results r
              where r.commitment_id = c.id and r.week_start = s.week_start
            )
        ) w
        where private.streak_through_week(c.id, w.week_start) > 0
      )
    end,
    false
  )
  from public.commitments c
  where c.id = p_commitment_id;
$$;

-- 6. AD-4: all-time points of a membership (FR-24): the sum of its locked weekly points, 0 when
--    none. The only definition later stories use.
create or replace function private.all_time_points(p_membership_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(wr.weekly_points), 0)::integer
  from public.week_results wr
  where wr.membership_id = p_membership_id;
$$;

-- 7. Lock one week (AD-5). Returns false and writes nothing when the week has no group_weeks row,
--    is already locked or is not due yet. The group_weeks row is locked FOR UPDATE first, so a
--    concurrent run waits and then finds it locked. FOR SHARE on the group's commitments waits for
--    any post_checkin in flight (it holds its commitment FOR UPDATE), so its check-in is counted.
--    Writes, in this order: week_results for the members current at lock_at (private.week_ranking),
--    week_commitment_results for their commitments and tasks with sessions in the week, then
--    group_week_results (winners only when ranked: every ranked member on the top points, on
--    points alone, none when the top is 0), then stamps locked_at. Stories 4.5-4.7 add their
--    writes here, in the same transaction.
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

  update public.group_weeks
  set locked_at = now()
  where group_id = p_group_id
    and week_start = p_week_start;

  return true;
end;
$$;

-- 8. Tick step 5 (AD-7): lock every due week (lock_at <= now(), not locked), oldest first, so after
--    a pause every overdue week locks in order in one run. Each week runs in its own exception
--    block (a subtransaction): a failing week rolls back only its own writes, and its group's later
--    weeks wait for the next run so the order holds. Returns the first error (naming the group and
--    week), or null. Re-runs are no-ops (locked_at, the unique keys).
create or replace function private.lock_due_weeks()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_w record;
  v_failed uuid[] := '{}'::uuid[];
  v_error text;
begin
  for v_w in
    select gw.group_id, gw.week_start
    from public.group_weeks gw
    where gw.lock_at <= now()
      and gw.locked_at is null
    order by gw.week_start, gw.lock_at, gw.group_id
  loop
    continue when v_w.group_id = any (v_failed);
    begin
      perform private.lock_week(v_w.group_id, v_w.week_start);
    exception when others then
      v_failed := v_failed || v_w.group_id;
      if v_error is null then
        v_error := 'group ' || v_w.group_id::text || ' week ' || v_w.week_start::text || ': '
          || sqlerrm;
      end if;
    end;
  end loop;

  return v_error;
end;
$$;

-- 9. The tick (from 20261204000000_misses.sql) with step 5 in its slot.
create or replace function private.tick()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_failed_before_lock boolean := false;
  v_error_step smallint;
  v_error text;
  v_error_at timestamptz;
  v_step_error text;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('proofy.tick')) then
    return;
  end if;

  -- Step 1: group weeks and sessions. A returned error counts as a failure, like a raised one.
  begin
    v_step_error := private.tick_step_1_sessions();
    if v_step_error is not null then
      v_failed_before_lock := true;
      v_error_step := 1;
      v_error := v_step_error;
      v_error_at := now();
    end if;
  exception when others then
    v_failed_before_lock := true;
    v_error_step := 1;
    v_error := sqlerrm;
    v_error_at := now();
  end;

  -- Step 2: pending time zones. A returned error counts as a failure, like a raised one.
  begin
    v_step_error := private.tick_step_2_time_zones();
    if v_step_error is not null then
      v_failed_before_lock := true;
      v_error_step := 2;
      v_error := v_step_error;
      v_error_at := now();
    end if;
  exception when others then
    v_failed_before_lock := true;
    v_error_step := 2;
    v_error := sqlerrm;
    v_error_at := now();
  end;

  -- Step 3: close votes (Epic 5).

  -- Step 4: stamp misses. A returned error counts as a failure, like a raised one.
  begin
    v_step_error := private.tick_step_4_misses();
    if v_step_error is not null then
      v_failed_before_lock := true;
      v_error_step := 4;
      v_error := v_step_error;
      v_error_at := now();
    end if;
  exception when others then
    v_failed_before_lock := true;
    v_error_step := 4;
    v_error := sqlerrm;
    v_error_at := now();
  end;

  -- Step 5: lock due weeks. Skipped when any of steps 1 to 4 failed (AD-17).
  if not v_failed_before_lock then
    begin
      v_step_error := private.lock_due_weeks();
      if v_step_error is not null then
        v_error_step := 5;
        v_error := v_step_error;
        v_error_at := now();
      end if;
    exception when others then
      v_error_step := 5;
      v_error := sqlerrm;
      v_error_at := now();
    end;
  end if;

  -- Step 6: nudges and reminders (Epic 6).

  -- Step 7: retention (Epic 7).

  -- Step 8: heartbeat. Always runs.
  begin
    perform private.tick_step_8_heartbeat(v_error_step, v_error, v_error_at);
  exception when others then
    raise warning 'proofy tick: heartbeat failed: %', sqlerrm;
  end;
end;
$$;

-- 10. RPC: the group's current week (from 20261206000000_weekly_score.sql), on the shared helpers.
create or replace function public.get_group_week(p_group_id uuid)
returns table (week_start date, lock_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_week date;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  v_week := private.group_current_week(p_group_id, now());

  return query
  select v_week, private.week_lock_at(p_group_id, v_week);
end;
$$;

-- 11. RPC: the Board (from 20261208000000_board_podium.sql) with every column kept plus `locked`.
--     A locked week returns its week_results rows (members who left after the lock included; a row
--     anonymized by Epic 7 is skipped), waiting = not ranked and miss_count = planned - done -
--     frozen from the stored counts. An unlocked week is live, as before. plan, task_count and
--     best_streak stay live for both.
drop function public.get_board(uuid, date);

create function public.get_board(p_group_id uuid, p_week_start date)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  weekly_points integer,
  sessions_done integer,
  sessions_planned integer,
  sessions_frozen integer,
  rank integer,
  waiting boolean,
  miss_count integer,
  best_streak integer,
  plan jsonb,
  task_count integer,
  lock_at timestamptz,
  is_current_week boolean,
  time_zone text,
  locked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_locked boolean;
  v_waiting boolean;
  v_current date;
  v_lock_at timestamptz;
  v_tz text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  v_locked := coalesce((
    select gw.locked_at is not null
    from public.group_weeks gw
    where gw.group_id = p_group_id and gw.week_start = p_week_start
  ), false);

  if v_locked then
    v_waiting := coalesce((
      select not gr.ranked
      from public.group_week_results gr
      where gr.group_id = p_group_id and gr.week_start = p_week_start
    ), true);
  else
    select count(*) < 2 into v_waiting
    from public.memberships m
    where m.group_id = p_group_id
      and m.ended_at is null;
  end if;

  v_current := private.group_current_week(p_group_id, now());
  v_tz := private.group_time_zone(p_group_id, p_week_start);
  v_lock_at := private.week_lock_at(p_group_id, p_week_start);

  return query
  with r as (
    select
      wr.membership_id,
      wr.user_id,
      wr.weekly_points,
      wr.sessions_done,
      wr.sessions_planned,
      wr.sessions_frozen,
      wr.rank,
      greatest(wr.sessions_planned - wr.sessions_done - wr.sessions_frozen, 0) as stored_misses
    from public.week_results wr
    where v_locked
      and wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.user_id is not null
    union all
    select
      w.membership_id,
      w.user_id,
      w.weekly_points,
      w.sessions_done,
      w.sessions_planned,
      w.sessions_frozen,
      w.rank,
      null::integer
    from private.week_ranking(p_group_id, p_week_start, null) w
    where not v_locked
  )
  select
    r.user_id,
    p.display_name,
    p.avatar_path,
    r.weekly_points,
    r.sessions_done,
    r.sessions_planned,
    r.sessions_frozen,
    r.rank,
    v_waiting,
    coalesce(r.stored_misses, (
      select count(*)::integer
      from public.sessions s
      where s.membership_id = r.membership_id
        and s.week_start = p_week_start
        and private.session_status(s) = 'missed'
    ), 0),
    coalesce((
      select max(private.current_streak(c.id))
      from public.commitments c
      where c.membership_id = r.membership_id
        and c.kind = 'commitment'
        and private.commitment_is_active(c)
    ), 0),
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
          and cv.effective_week_start <= p_week_start
        order by cv.effective_week_start desc
        limit 1
      ) v on true
      where c.membership_id = r.membership_id
        and c.kind = 'commitment'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = p_week_start
        )
    ), '[]'::jsonb),
    (
      select count(*)::integer
      from public.commitments c
      where c.membership_id = r.membership_id
        and c.kind = 'task'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = p_week_start
        )
    ),
    v_lock_at,
    p_week_start = v_current,
    v_tz,
    v_locked
  from r
  join public.profiles p on p.id = r.user_id
  order by r.rank nulls last, p.display_name, r.user_id;
end;
$$;

-- 12. Grants (AD-16). Nothing private is client-executable; the RPCs are for authenticated only.
revoke execute on function private.group_current_week(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.week_lock_at(uuid, date) from public, anon, authenticated;
revoke execute on function private.week_ranking(uuid, date, timestamptz) from public, anon, authenticated;
revoke execute on function private.group_ranking(uuid, date) from public, anon, authenticated;
revoke execute on function private.streak_through_week(uuid, date) from public, anon, authenticated;
revoke execute on function private.streak_back_to_zero(uuid) from public, anon, authenticated;
revoke execute on function private.all_time_points(uuid) from public, anon, authenticated;
revoke execute on function private.lock_week(uuid, date) from public, anon, authenticated;
revoke execute on function private.lock_due_weeks() from public, anon, authenticated;
revoke execute on function private.tick() from public, anon, authenticated;
revoke execute on function public.get_group_week(uuid) from public, anon;
grant execute on function public.get_group_week(uuid) to authenticated;
revoke execute on function public.get_board(uuid, date) from public, anon;
grant execute on function public.get_board(uuid, date) to authenticated;

-- 13. Row level security: current members of the group read its results (AD-3); no client writes.
alter table public.week_results enable row level security;
alter table public.week_commitment_results enable row level security;
alter table public.group_week_results enable row level security;

create policy week_results_select_member
  on public.week_results
  for select
  to authenticated
  using (private.is_member(group_id));

create policy week_commitment_results_select_member
  on public.week_commitment_results
  for select
  to authenticated
  using (private.is_member(group_id));

create policy group_week_results_select_member
  on public.group_week_results
  for select
  to authenticated
  using (private.is_member(group_id));

revoke all on table public.week_results from public, anon, authenticated;
revoke all on table public.week_commitment_results from public, anon, authenticated;
revoke all on table public.group_week_results from public, anon, authenticated;
grant select on table public.week_results to authenticated;
grant select on table public.week_commitment_results to authenticated;
grant select on table public.group_week_results to authenticated;
