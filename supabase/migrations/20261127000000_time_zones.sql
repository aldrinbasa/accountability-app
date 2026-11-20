-- Time zone settings for members and groups (Story 2.7, FR-9, FR-11, NFR11, AD-2, AD-7, AD-11,
-- AD-14, AD-15, AD-16).
--
-- A zone change never reshapes the current week: set_time_zone writes a pending zone that takes
-- effect from the next Monday (pending_week_start), and tick step 2 moves it into time_zone once
-- that Monday 00:00 has come in the new zone. Until then the time helpers already answer with the
-- pending zone for weeks from pending_week_start on, so tick step 1 (which runs before step 2)
-- builds that week's sessions and group_weeks.lock_at in the new zone.
--
-- Additive only: two nullable columns on profiles and groups, member_time_zone and group_time_zone
-- replaced with the same signatures and grants, one new RPC, tick step 2, and private.tick()
-- replaced with step 1 and step 8 unchanged. The routines call now() unqualified on purpose. With
-- search_path = '' that is pg_catalog.now(); pgTAP re-points a function's search_path at
-- test_overrides inside its rolled-back transaction so tests.freeze_time moves the clock.

-- 1. Columns. Both set together or both null.
alter table public.profiles
  add column pending_time_zone text null,
  add column pending_week_start date null
    constraint profiles_pending_week_start_monday_check
    check (extract(isodow from pending_week_start) = 1),
  add constraint profiles_pending_time_zone_pair_check
    check ((pending_time_zone is null) = (pending_week_start is null));

alter table public.groups
  add column pending_time_zone text null,
  add column pending_week_start date null
    constraint groups_pending_week_start_monday_check
    check (extract(isodow from pending_week_start) = 1),
  add constraint groups_pending_time_zone_pair_check
    check ((pending_time_zone is null) = (pending_week_start is null));

-- 2. Helpers, replaced (same signatures, same grants restated below).

-- The member's zone for week `p_week_start`: the pending zone once p_week_start reaches
-- pending_week_start, else profiles.time_zone (also for a null week). Security invoker: a client
-- reads only zones its profile RLS shows (its own and co-members').
create or replace function private.member_time_zone(p_user_id uuid, p_week_start date)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p.pending_time_zone is not null and p_week_start >= p.pending_week_start
      then p.pending_time_zone
    else p.time_zone
  end
  from public.profiles p
  where p.id = p_user_id;
$$;

-- The group's zone for week `p_week_start`: the pending zone once p_week_start reaches
-- pending_week_start, else groups.time_zone (also for a null week).
create or replace function private.group_time_zone(p_group_id uuid, p_week_start date)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when g.pending_time_zone is not null and p_week_start >= g.pending_week_start
      then g.pending_time_zone
    else g.time_zone
  end
  from public.groups g
  where g.id = p_group_id;
$$;

-- 3. RPC: change the caller's zone (no group) or a group's zone (admin only), from the next week.
--    - A pending change whose Monday has already come in its zone is applied first (what tick step 2
--      would do), so "current" always means the zone in effect now.
--    - The change starts at the week that has not started yet: the pending change's week when one is
--      waiting, else the next Monday in the current zone. Sessions and group_weeks rows of the
--      current week are never touched.
--    - The current zone clears any pending change; the pending zone again changes nothing.
--    - Group: after the write, every group_weeks row from that week on whose lock is still ahead is
--      recomputed (a member whose Monday came first may already have created it).
--    Errors (AD-14), in order: not_authenticated, profile_required (member) or not_member then
--    not_admin (group), invalid_time_zone.
--    Returns the row's time_zone, pending_time_zone and pending_week_start after the change.
create or replace function public.set_time_zone(p_time_zone text, p_group_id uuid default null)
returns table (time_zone text, pending_time_zone text, pending_week_start date)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_current text;
  v_pending text;
  v_pending_week date;
  v_week date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_group_id is null then
    select p.time_zone, p.pending_time_zone, p.pending_week_start
      into v_current, v_pending, v_pending_week
    from public.profiles p
    where p.id = v_uid
    for update;

    if not found then
      raise exception 'profile_required';
    end if;
  else
    if not private.is_member(p_group_id) then
      raise exception 'not_member';
    end if;
    if not private.is_admin(p_group_id) then
      raise exception 'not_admin';
    end if;

    select g.time_zone, g.pending_time_zone, g.pending_week_start
      into v_current, v_pending, v_pending_week
    from public.groups g
    where g.id = p_group_id
    for update;
  end if;

  if p_time_zone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = p_time_zone) then
    raise exception 'invalid_time_zone';
  end if;

  -- A due pending change counts as applied.
  if v_pending is not null and now() >= private.local_start(v_pending_week, v_pending) then
    v_current := v_pending;
    v_pending := null;
    v_pending_week := null;
  end if;

  v_week := coalesce(v_pending_week, private.week_start_of(now(), v_current) + 7);

  if p_time_zone = v_current then
    v_pending := null;
    v_pending_week := null;
  elsif p_time_zone is distinct from v_pending then
    v_pending := p_time_zone;
    v_pending_week := v_week;
  end if;

  if p_group_id is null then
    update public.profiles p
    set time_zone = v_current,
        pending_time_zone = v_pending,
        pending_week_start = v_pending_week
    where p.id = v_uid
      and (p.time_zone, p.pending_time_zone, p.pending_week_start)
          is distinct from (v_current, v_pending, v_pending_week);
  else
    update public.groups g
    set time_zone = v_current,
        pending_time_zone = v_pending,
        pending_week_start = v_pending_week
    where g.id = p_group_id
      and (g.time_zone, g.pending_time_zone, g.pending_week_start)
          is distinct from (v_current, v_pending, v_pending_week);

    -- Lock times from the change's week on follow the group's zone for that week.
    update public.group_weeks gw
    set lock_at = private.local_start(gw.week_start + 10, private.group_time_zone(gw.group_id, gw.week_start))
    where gw.group_id = p_group_id
      and gw.week_start >= v_week
      and gw.lock_at > now()
      and gw.lock_at is distinct from
          private.local_start(gw.week_start + 10, private.group_time_zone(gw.group_id, gw.week_start));
  end if;

  return query select v_current, v_pending, v_pending_week;
end;
$$;

-- 4. Tick step 2: pending time zones (AD-7). Every profile and group whose pending Monday 00:00 has
--    come in the pending zone gets that zone as time_zone and its pending columns cleared. Selected
--    by due time, so it catches up after a pause; a rerun finds nothing due, so it is idempotent.
--    Each row runs in its own exception block, so one failure rolls back only that row. Returns the
--    first error as text (naming the row), or null when everything went through.
create or replace function private.tick_step_2_time_zones()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_error text;
begin
  for v_id in
    select p.id
    from public.profiles p
    where p.pending_time_zone is not null
      and now() >= private.local_start(p.pending_week_start, p.pending_time_zone)
    order by p.id
  loop
    begin
      update public.profiles p
      set time_zone = p.pending_time_zone,
          pending_time_zone = null,
          pending_week_start = null
      where p.id = v_id
        and p.pending_time_zone is not null;
    exception when others then
      if v_error is null then
        v_error := 'profile ' || v_id::text || ': ' || sqlerrm;
      end if;
    end;
  end loop;

  for v_id in
    select g.id
    from public.groups g
    where g.pending_time_zone is not null
      and now() >= private.local_start(g.pending_week_start, g.pending_time_zone)
    order by g.id
  loop
    begin
      update public.groups g
      set time_zone = g.pending_time_zone,
          pending_time_zone = null,
          pending_week_start = null
      where g.id = v_id
        and g.pending_time_zone is not null;
    exception when others then
      if v_error is null then
        v_error := 'group ' || v_id::text || ': ' || sqlerrm;
      end if;
    end;
  end loop;

  return v_error;
end;
$$;

-- 5. The tick (AD-7), replaced: step 2 fills its slot; step 1, the step 5 guard and step 8 are
--    unchanged. One run at a time: returns at once if another tick holds the lock. Steps run in
--    fixed order, each in its own exception block, so a failing step rolls back only its own work,
--    is recorded in the heartbeat (the last failing step of the run wins), and the other steps
--    still run. The lock step (5) is skipped when any of steps 1 to 4 failed (AD-17).
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

-- 6. Grants (AD-16). member_time_zone keeps EXECUTE for authenticated (RLS, invoker views and
--    reads call it); group_time_zone, step 2 and the tick stay closed. set_time_zone is the client
--    RPC: authenticated only.
revoke execute on function private.member_time_zone(uuid, date) from public, anon, authenticated;
grant execute on function private.member_time_zone(uuid, date) to authenticated;
revoke execute on function private.group_time_zone(uuid, date) from public, anon, authenticated;
revoke execute on function private.tick_step_2_time_zones() from public, anon, authenticated;
revoke execute on function private.tick() from public, anon, authenticated;
revoke execute on function public.set_time_zone(text, uuid) from public, anon, authenticated;
grant execute on function public.set_time_zone(text, uuid) to authenticated;
