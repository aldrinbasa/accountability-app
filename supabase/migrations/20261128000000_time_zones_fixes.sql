-- Time zone fixes (Story 2.7 review, FR-9, AD-7, AD-11, AD-16).
--
-- 1. set_time_zone: a move to a zone ahead of the current one (New York on Sunday 20:00 to
--    Pacific/Auckland) took the next Monday in the old zone even when that Monday 00:00 had already
--    passed in the new zone, so tick step 1 built a week that started in the past. The change now
--    starts at the first such Monday whose 00:00 in the new zone is still ahead (a week later when
--    not). Group lock times are recomputed from the earlier of the replaced change's week and the
--    new one, so a replaced change's week goes back to the zone it now follows.
-- 2. tick step 2: each row's UPDATE now re-checks that its pending change is due, so a concurrent
--    set_time_zone that wrote a new, not yet due change is never promoted early.
--
-- Additive only: both functions replaced with the same signatures; grants restated. The routines
-- call now() unqualified on purpose (see 20261127000000_time_zones.sql).

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
  v_recompute_from date;
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

  -- The week that has not started yet: the waiting change's, else the next Monday in the current
  -- zone; then the first Monday from there whose 00:00 in the new zone is still ahead.
  v_week := coalesce(v_pending_week, private.week_start_of(now(), v_current) + 7);
  while private.local_start(v_week, p_time_zone) <= now() loop
    v_week := v_week + 7;
  end loop;
  v_recompute_from := least(coalesce(v_pending_week, v_week), v_week);

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
      and gw.week_start >= v_recompute_from
      and gw.lock_at > now()
      and gw.lock_at is distinct from
          private.local_start(gw.week_start + 10, private.group_time_zone(gw.group_id, gw.week_start));
  end if;

  return query select v_current, v_pending, v_pending_week;
end;
$$;

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
        and p.pending_time_zone is not null
        and now() >= private.local_start(p.pending_week_start, p.pending_time_zone);
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
        and g.pending_time_zone is not null
        and now() >= private.local_start(g.pending_week_start, g.pending_time_zone);
    exception when others then
      if v_error is null then
        v_error := 'group ' || v_id::text || ': ' || sqlerrm;
      end if;
    end;
  end loop;

  return v_error;
end;
$$;

revoke execute on function private.tick_step_2_time_zones() from public, anon, authenticated;
revoke execute on function public.set_time_zone(text, uuid) from public, anon, authenticated;
grant execute on function public.set_time_zone(text, uuid) to authenticated;
