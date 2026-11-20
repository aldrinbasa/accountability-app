-- The weekly timer and sessions (Story 2.3, FR-9, FR-4, AD-5, AD-6, AD-7, AD-11, AD-15, AD-16, AD-19).
--
-- sessions holds what a member owes each week: one row per scheduled day (fixed days) or per time
-- (times per week), created by the tick at the member's Monday 00:00 and never reshaped. No outcome
-- is ever stored on a session (AD-6); miss_recorded_at stays null until tick step 4 (Story 3.5).
-- group_weeks holds each group week's lock time (Thursday 00:00 after the week, group zone).
-- heartbeat is a single row the tick writes on every run; clients have no grants on it.
--
-- private.tick() runs every minute from pg_cron job `proofy-tick` under an advisory lock, and calls
-- the AD-7 steps in fixed order, each in its own exception block. This story builds step 1
-- (group weeks and sessions) and step 8 (heartbeat); later stories fill steps 2 to 7 in their slots.
--
-- Additive only: three new tables, one new nullable column, new functions and the cron job. The
-- tick routines call now() unqualified on purpose. With search_path = '' that is pg_catalog.now();
-- pgTAP re-points a function's search_path at test_overrides inside its rolled-back transaction so
-- tests.freeze_time moves the clock.

-- 1. Tables
create table public.group_weeks (
  group_id uuid not null references public.groups (id) on delete cascade,
  week_start date not null
    constraint group_weeks_week_start_monday_check
    check (extract(isodow from week_start) = 1),
  -- Thursday 00:00 after the week, in the group's zone for that week.
  lock_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (group_id, week_start)
);

create table public.sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  commitment_id uuid not null references public.commitments (id) on delete cascade,
  -- The member's Monday of the week the session belongs to.
  week_start date not null
    constraint sessions_week_start_monday_check
    check (extract(isodow from week_start) = 1),
  -- ISO weekday for fixed days, 1..N for times per week, 0 for a task (Story 2.4).
  slot smallint not null
    constraint sessions_slot_check
    check (slot between 0 and 7),
  -- Half-open [starts_at, ends_at), local midnights through the member's IANA zone.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Stamped by tick step 4 (Story 3.5); null until then.
  miss_recorded_at timestamptz null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint sessions_period_check
    check (ends_at > starts_at)
);

-- Single row: id is always true.
create table public.heartbeat (
  id boolean primary key default true
    constraint heartbeat_single_row_check
    check (id),
  last_run_at timestamptz null,
  last_error_step smallint null
    constraint heartbeat_last_error_step_check
    check (last_error_step between 1 and 8),
  last_error text null,
  last_error_at timestamptz null
);

insert into public.heartbeat (id) values (true) on conflict do nothing;

-- The last week step 1 processed for this commitment (generated, or skipped because locked);
-- null until its first week is processed.
alter table public.commitments
  add column sessions_through date null
    constraint commitments_sessions_through_monday_check
    check (extract(isodow from sessions_through) = 1);

-- 2. Indexes. Only-once rules live in unique indexes (AD-18).
create unique index sessions_one_per_slot
  on public.sessions (commitment_id, week_start, slot);

create index sessions_group_id_week_start_idx on public.sessions (group_id, week_start);
create index sessions_membership_id_idx on public.sessions (membership_id);
create index sessions_user_id_idx on public.sessions (user_id);

-- 3. updated_at triggers
create trigger group_weeks_set_updated_at
  before update on public.group_weeks
  for each row execute function private.set_updated_at();

create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function private.set_updated_at();

-- 4. Helpers

-- The group's zone for week `p_week_start`. For now always groups.time_zone; Story 2.7 returns the
-- pending zone once p_week_start reaches pending_week_start.
create or replace function private.group_time_zone(p_group_id uuid, p_week_start date)
returns text
language sql
stable
set search_path = ''
as $$
  select g.time_zone from public.groups g where g.id = p_group_id;
$$;

-- Creates the group week's row with its lock time (Thursday 00:00 after the week, group zone).
-- Does nothing if the row exists. Callers never ask for a week whose lock time has passed.
create or replace function private.ensure_group_week(p_group_id uuid, p_week_start date)
returns void
language sql
set search_path = ''
as $$
  insert into public.group_weeks (group_id, week_start, lock_at)
  values (
    p_group_id,
    p_week_start,
    private.local_start(p_week_start + 10, private.group_time_zone(p_group_id, p_week_start))
  )
  on conflict (group_id, week_start) do nothing;
$$;

-- 5. Tick step 1: group weeks and sessions (AD-5, AD-6, AD-7).
--    a) Every group gets its current group-local week (waiting groups included).
--    b) Every commitment (never a task) of a current membership gets its sessions for each week from
--       the one after its marker (sessions_through, else its first version's week) up to the
--       member's current week, in order. A week counts once the member's Monday 00:00 in
--       private.member_time_zone(user_id, week) has passed. A week whose lock time has passed is
--       skipped (nothing writes a locked week) but still moves the marker. The group week's row is
--       ensured before the week's sessions, so a member whose Monday comes before the group's still
--       gets it. Weeks after ends_after_week_start or after the end date get no rows.
--    Idempotent: the marker plus the unique (commitment_id, week_start, slot) and on conflict do
--    nothing, so a rerun creates nothing new.
--    Part a) and each commitment run in their own exception block, so one failure (a deadlock, a
--    constraint, a bad zone) rolls back only its own work and the rest still commits. Returns the
--    first error as text (naming the commitment), or null when everything went through.
create or replace function private.tick_step_1_sessions()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_c record;
  v_week date;
  v_last date;
  v_tz text;
  v_lock_at timestamptz;
  v_version public.commitment_versions;
  v_last_day date;
  v_count smallint;
  v_error text;
begin
  -- a) Group weeks.
  begin
    perform private.ensure_group_week(x.group_id, x.week_start)
    from (
      select
        g.id as group_id,
        private.week_start_of(
          now(),
          private.group_time_zone(g.id, private.week_start_of(now(), private.group_time_zone(g.id, null)))
        ) as week_start
      from public.groups g
    ) x
    where not exists (
      select 1 from public.group_weeks gw
      where gw.group_id = x.group_id and gw.week_start = x.week_start
    );
  exception when others then
    v_error := 'group weeks: ' || sqlerrm;
  end;

  -- b) Sessions. The prefilter only drops commitments with nothing due anywhere yet: no member's
  --    current week can be later than the week in the zone furthest ahead (UTC+14). Commitments past
  --    their end (ends_after_week_start, or the latest version's end date) have nothing left.
  for v_c in
    select
      c.id,
      c.group_id,
      c.membership_id,
      c.user_id,
      c.ends_after_week_start,
      coalesce(c.sessions_through + 7, f.first_week) as next_week
    from public.commitments c
    join public.memberships m on m.id = c.membership_id and m.ended_at is null
    cross join lateral (
      select min(cv.effective_week_start) as first_week
      from public.commitment_versions cv
      where cv.commitment_id = c.id
    ) f
    cross join lateral (
      select cv.end_date as latest_end_date
      from public.commitment_versions cv
      where cv.commitment_id = c.id
      order by cv.effective_week_start desc
      limit 1
    ) l
    where c.kind = 'commitment'
      and f.first_week is not null
      and coalesce(c.sessions_through + 7, f.first_week) <= private.week_start_of(now(), 'Pacific/Kiritimati')
      and (c.ends_after_week_start is null or coalesce(c.sessions_through + 7, f.first_week) <= c.ends_after_week_start)
      and (l.latest_end_date is null or coalesce(c.sessions_through + 7, f.first_week) <= l.latest_end_date)
    order by c.id
  loop
    begin
      v_week := v_c.next_week;
      v_last := null;

      loop
        v_tz := private.member_time_zone(v_c.user_id, v_week);
        -- Not yet the member's Monday 00:00 for this week.
        exit when v_tz is null or private.local_start(v_week, v_tz) > now();
        -- Ended: nothing from here on.
        exit when v_c.ends_after_week_start is not null and v_week > v_c.ends_after_week_start;

        -- The version with the latest effective_week_start <= this week (all nulls when none).
        select cv.* into v_version
        from public.commitment_versions cv
        where cv.commitment_id = v_c.id
          and cv.effective_week_start <= v_week
        order by cv.effective_week_start desc
        limit 1;

        select gw.lock_at into v_lock_at
        from public.group_weeks gw
        where gw.group_id = v_c.group_id and gw.week_start = v_week;
        if not found then
          v_lock_at := private.local_start(v_week + 10, private.group_time_zone(v_c.group_id, v_week));
        end if;

        if v_lock_at > now()
           and v_version.id is not null
           and (v_version.end_date is null or v_version.end_date >= v_week) then
          perform private.ensure_group_week(v_c.group_id, v_week);

          -- The last day of this week with a session (the end date when it falls inside the week).
          v_last_day := least(v_week + 6, coalesce(v_version.end_date, v_week + 6));

          if v_version.days is not null then
            insert into public.sessions
              (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
            select
              v_c.group_id, v_c.membership_id, v_c.user_id, v_c.id, v_week, d.weekday,
              private.local_start(v_week + (d.weekday::integer - 1), v_tz),
              private.local_start(v_week + d.weekday::integer, v_tz)
            from pg_catalog.unnest(v_version.days) as d(weekday)
            where v_week + (d.weekday::integer - 1) <= v_last_day
            on conflict (commitment_id, week_start, slot) do nothing;
          else
            -- A week cut short by the end date gets the pro-rated target (the only place the tick
            -- computes it); every row covers the days up to the end date.
            if v_last_day < v_week + 6 then
              v_count := private.prorated_target(v_version.target, (v_last_day - v_week + 1)::smallint);
            else
              v_count := v_version.target;
            end if;

            insert into public.sessions
              (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
            select
              v_c.group_id, v_c.membership_id, v_c.user_id, v_c.id, v_week, s.slot::smallint,
              private.local_start(v_week, v_tz),
              private.local_start(v_last_day + 1, v_tz)
            from pg_catalog.generate_series(1, v_count::integer) as s(slot)
            on conflict (commitment_id, week_start, slot) do nothing;
          end if;
        end if;

        v_last := v_week;
        v_week := v_week + 7;
      end loop;

      if v_last is not null then
        update public.commitments
        set sessions_through = v_last
        where id = v_c.id;
      end if;
    exception when others then
      if v_error is null then
        v_error := 'commitment ' || v_c.id::text || ': ' || sqlerrm;
      end if;
    end;
  end loop;

  return v_error;
end;
$$;

-- 6. Tick step 8: the heartbeat. last_run_at moves on every run; the error columns change only
--    when a step failed in this run (they keep the last failure otherwise). Story 7.4 adds
--    last_ok_at.
create or replace function private.tick_step_8_heartbeat(
  p_error_step smallint default null,
  p_error text default null,
  p_error_at timestamptz default null
)
returns void
language sql
set search_path = ''
as $$
  -- An upsert, so a missing row is recreated rather than silently skipped.
  insert into public.heartbeat as h (id, last_run_at, last_error_step, last_error, last_error_at)
  values (true, now(), p_error_step,
          case when p_error_step is null then null else p_error end,
          case when p_error_step is null then null else p_error_at end)
  on conflict (id) do update
  set last_run_at = excluded.last_run_at,
      last_error_step = case when p_error_step is null then h.last_error_step else p_error_step end,
      last_error = case when p_error_step is null then h.last_error else p_error end,
      last_error_at = case when p_error_step is null then h.last_error_at else p_error_at end;
$$;

-- 7. The tick (AD-7). One run at a time: returns at once if another tick holds the lock. Steps run
--    in fixed order, each in its own exception block, so a failing step rolls back only its own
--    work, is recorded in the heartbeat (the last failing step of the run wins), and the other
--    steps still run. The lock step (5) is skipped when any of steps 1 to 4 failed (AD-17).
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

  -- Step 2: pending time zones (Story 2.7).

  -- Step 3: close votes (Epic 5).

  -- Step 4: stamp misses (Story 3.5).

  -- Step 5: lock weeks (Epic 4). Skipped when any of steps 1 to 4 failed.
  if not v_failed_before_lock then
    null;
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

-- Nothing here is client-executable (AD-16): only the tick, its cron job and definer RPCs call them.
revoke execute on function private.group_time_zone(uuid, date) from public, anon, authenticated;
revoke execute on function private.ensure_group_week(uuid, date) from public, anon, authenticated;
revoke execute on function private.tick_step_1_sessions() from public, anon, authenticated;
revoke execute on function private.tick_step_8_heartbeat(smallint, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function private.tick() from public, anon, authenticated;

-- 8. Row level security: current members read the group's weeks, and the sessions of current
--    memberships. heartbeat has RLS and no policy.
alter table public.group_weeks enable row level security;
alter table public.sessions enable row level security;
alter table public.heartbeat enable row level security;

create policy group_weeks_select_member
  on public.group_weeks
  for select
  to authenticated
  using (private.is_member(group_id));

create policy sessions_select_member
  on public.sessions
  for select
  to authenticated
  using (private.is_member(group_id) and private.membership_is_current(membership_id));

-- 9. Grants (the baseline revoked the defaults). SELECT only for authenticated on sessions and
--    group_weeks; nothing on heartbeat; nothing for anon.
revoke all on table public.group_weeks from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;
revoke all on table public.heartbeat from public, anon, authenticated;
grant select on table public.group_weeks to authenticated;
grant select on table public.sessions to authenticated;

-- 10. The schedule: every minute. cron.schedule with an existing job name updates that job.
create extension if not exists pg_cron;

select cron.schedule('proofy-tick', '* * * * *', 'select private.tick()');
