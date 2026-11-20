-- Misses (Story 3.5, FR-15, FR-31, FR-35, AD-4, AD-6, AD-7, AD-10, AD-11, AD-15, AD-16).
--
-- A session that ends without a counted check-in is missed. private.session_status (AD-4) is
-- redefined in place: `done` with a counted check-in, else `missed` once ends_at has passed, else
-- `open`. It now reads the clock. post_checkin matches any session that is not done, so a late
-- arrival still completes a missed (or miss-stamped) session and the miss goes away.
--
-- Tick step 4 stamps misses: every due session of a current membership with no counted check-in
-- gets miss_recorded_at = now() once, and a `miss` feed event in the same transaction (one per
-- fixed-day or task session, one per times-per-week commitment week), each with a couch tease that
-- never repeats the member's previous one in that group. Step 4 queues no notification (AD-10).
--
-- feed_items hides a miss event once none of its sessions is still `missed`, and shows the live
-- count in a new last column, miss_count. get_friends_today is Today's "Friends today" strip: the
-- group's check-ins received since the caller's local midnight.
--
-- Additive only: session_status, post_checkin, the tick and feed_items replaced in place (the view
-- gains one appended column), one new tick step, one new RPC and one partial index. The routines
-- call now() unqualified on purpose. With search_path = '' that is pg_catalog.now(); pgTAP re-points
-- a function's search_path at test_overrides inside its rolled-back transaction so
-- tests.freeze_time moves the clock.

-- 1. Index: the unstamped sessions step 4 scans. Done sessions stay unstamped, so this still grows
--    with every week (acceptable at friend-group scale; Epic 4's lock can bound it).
create index sessions_unstamped_ends_at_idx
  on public.sessions (ends_at)
  where miss_recorded_at is null;

-- 2. AD-4: the one definition of a session's status (from 20261201000000_checkins.sql). Security
--    invoker, so it reads checkins under the caller's RLS. Epic 5 adds `frozen`.
create or replace function private.session_status(s public.sessions)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (select 1 from public.checkins c where c.session_id = s.id) then 'done'
    when s.ends_at <= now() then 'missed'
    else 'open'
  end;
$$;

revoke execute on function private.session_status(public.sessions) from public, anon, authenticated;
grant execute on function private.session_status(public.sessions) to authenticated;

-- 3. post_checkin (from 20261202000000_week_locked_detail.sql, unchanged) except the session
--    matching: a session counts as free while its status is not `done` (open or missed).
create or replace function public.post_checkin(
  p_id uuid,
  p_commitment_id uuid,
  p_captured_at timestamptz,
  p_caption text default null
)
returns table (
  checkin_id uuid,
  session_id uuid,
  counted boolean,
  is_late boolean,
  done_count integer,
  target integer
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_caption text;
  v_existing public.checkins;
  v_c public.commitments;
  v_membership_id uuid;
  v_received timestamptz;
  v_counted timestamptz;
  v_tz text;
  v_week date;
  v_version public.commitment_versions;
  v_lock_at timestamptz;
  v_session_id uuid;
  v_is_late boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_id is null or p_commitment_id is null or p_captured_at is null then
    raise exception 'invalid_checkin';
  end if;

  v_caption := nullif(pg_catalog.regexp_replace(p_caption, '^\s+|\s+$', '', 'g'), '');

  -- The commitment's lock first, so a concurrent post to it (same id or not) waits here.
  select c.* into v_c
  from public.commitments c
  where c.id = p_commitment_id
  for update;

  select ck.* into v_existing from public.checkins ck where ck.id = p_id;
  if found then
    if v_existing.user_id = v_uid
       and v_existing.commitment_id = p_commitment_id
       and v_existing.captured_at = p_captured_at
       and v_existing.caption is not distinct from v_caption then
      select w.week_start into v_week
      from private.member_current_week(v_existing.user_id, v_existing.counted_at) w;
      return query
      select v_existing.id, v_existing.session_id, v_existing.session_id is not null,
             v_existing.is_late, x.done_count, x.target
      from private.checkin_counts(v_existing.commitment_id, v_week) x;
      return;
    end if;
    raise exception 'checkin_conflict';
  end if;

  if v_caption is not null and pg_catalog.char_length(v_caption) > 80 then
    raise exception 'invalid_caption';
  end if;

  v_received := now();
  if p_captured_at > v_received + interval '1 minute' then
    raise exception 'bad_capture_time';
  end if;
  v_counted := case
    when v_received - p_captured_at <= interval '10 minutes' then v_received
    else p_captured_at
  end;

  if v_c.id is null then
    raise exception 'commitment_ended';
  end if;

  -- FOR SHARE: a leave or removal of this membership waits until the post is done.
  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = v_c.group_id
    and m.user_id = v_uid
    and m.ended_at is null
  for share;

  if v_membership_id is null then
    raise exception 'not_member';
  end if;

  if v_c.user_id <> v_uid or v_c.membership_id <> v_membership_id then
    raise exception 'commitment_ended';
  end if;

  select w.week_start, w.time_zone into v_week, v_tz
  from private.member_current_week(v_uid, v_counted) w;

  if v_c.kind = 'task' then
    if not exists (
      select 1 from public.sessions s
      where s.commitment_id = v_c.id and s.week_start = v_week
    ) then
      raise exception 'commitment_ended';
    end if;
  else
    if v_c.ends_after_week_start is not null and v_c.ends_after_week_start < v_week then
      raise exception 'commitment_ended';
    end if;
    select cv.* into v_version
    from public.commitment_versions cv
    where cv.commitment_id = v_c.id
      and cv.effective_week_start <= v_week
    order by cv.effective_week_start desc
    limit 1;
    if v_version.id is null or (v_version.end_date is not null and v_version.end_date < v_week) then
      raise exception 'commitment_ended';
    end if;
  end if;

  select gw.lock_at into v_lock_at
  from public.group_weeks gw
  where gw.group_id = v_c.group_id and gw.week_start = v_week;
  if v_lock_at is null then
    v_lock_at := private.local_start(v_week + 10, private.group_time_zone(v_c.group_id, v_week));
  end if;
  if v_received >= v_lock_at then
    raise exception 'week_locked'
      using detail = pg_catalog.json_build_object(
        'lock_at', v_lock_at,
        'time_zone', private.group_time_zone(v_c.group_id, v_week)
      )::text;
  end if;

  if (
    select count(distinct o.name)
    from storage.objects o
    where o.bucket_id = 'checkins'
      and o.owner_id = v_uid::text
      and o.name in (
        v_c.group_id::text || '/' || p_id::text || '/1080.webp',
        v_c.group_id::text || '/' || p_id::text || '/360.webp'
      )
  ) < 2 then
    raise exception 'photo_missing';
  end if;

  -- Session matching (FR-14): the commitment's session whose [starts_at, ends_at) contains
  -- counted_at and that is not done yet, ended or miss-stamped ones included. Times per week: at
  -- most one counted check-in per member-local day.
  if v_c.kind = 'commitment' and v_c.schedule_type = 'times_per_week'
     and exists (
       select 1
       from private.counted_checkins(v_c.membership_id, v_week) k
       where k.commitment_id = v_c.id
         and (k.counted_at at time zone v_tz)::date = (v_counted at time zone v_tz)::date
     ) then
    v_session_id := null;
  else
    select s.id into v_session_id
    from public.sessions s
    where s.commitment_id = v_c.id
      and s.starts_at <= v_counted
      and v_counted < s.ends_at
      and private.session_status(s) <> 'done'
    order by s.slot
    limit 1;
  end if;

  v_is_late := v_received - p_captured_at > interval '10 minutes'
    or (p_captured_at at time zone v_tz)::date <> (v_received at time zone v_tz)::date;

  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at,
     is_late, caption)
  values
    (p_id, v_c.group_id, v_uid, v_c.id, v_session_id, p_captured_at, v_received, v_counted,
     v_is_late, v_caption);

  return query
  select p_id, v_session_id, v_session_id is not null, v_is_late, x.done_count, x.target
  from private.checkin_counts(v_c.id, v_week) x;
end;
$$;

revoke execute on function public.post_checkin(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.post_checkin(uuid, uuid, timestamptz, text) to authenticated;

-- 4. Tick step 4: stamp misses (AD-6, AD-7, AD-10).
--    Candidates: sessions of current memberships with ends_at <= now(), miss_recorded_at null and
--    status `missed`, not past the commitment's end (ends_after_week_start, or the week's version
--    end date against the session's day). A unit is one session (fixed days, tasks) or every such
--    row of one times-per-week commitment week (they share the week's ends_at), so the count is
--    target minus counted. Each unit runs in its own exception block: it stamps its sessions once
--    and inserts one `miss` event. Units run per member in (ends_at, commitment_id) order; the
--    tease is random among the five keys minus that member's previous miss tease in the group.
--    Idempotent (stamped rows are never candidates again) and catches up after a pause. Returns the
--    first error as text (naming the commitment), or null. No notification of any kind.
create or replace function private.tick_step_4_misses()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_u record;
  v_member text;
  v_prev_member text;
  v_prev_tease text;
  v_choices text[];
  v_tease text;
  v_ids uuid[];
  v_error text;
begin
  for v_u in
    select
      s.group_id,
      s.user_id,
      s.membership_id,
      s.commitment_id,
      s.week_start,
      c.kind,
      c.schedule_type,
      c.name as task_name,
      coalesce(pa.name, ga.custom_name) as activity_name,
      p.display_name as actor_name,
      pg_catalog.array_agg(s.id order by s.slot) as session_ids,
      max(s.ends_at) as ends_at,
      max(case
        when c.kind = 'task' then c.deadline
        when c.schedule_type = 'fixed_days' then s.week_start + (s.slot::integer - 1)
        else least(s.week_start + 6, coalesce(v.end_date, s.week_start + 6))
      end) as missed_on
    from public.sessions s
    join public.memberships m on m.id = s.membership_id and m.ended_at is null
    join public.commitments c on c.id = s.commitment_id
    join public.group_activities ga on ga.id = c.group_activity_id
    left join public.preset_activities pa on pa.key = ga.preset_key
    left join public.profiles p on p.id = s.user_id
    left join lateral (
      select cv.end_date
      from public.commitment_versions cv
      where cv.commitment_id = c.id
        and cv.effective_week_start <= s.week_start
      order by cv.effective_week_start desc
      limit 1
    ) v on true
    where s.ends_at <= now()
      and s.miss_recorded_at is null
      and private.session_status(s) = 'missed'
      and (c.ends_after_week_start is null or s.week_start <= c.ends_after_week_start)
      and (
        v.end_date is null
        or v.end_date >= case
          when c.schedule_type = 'fixed_days' then s.week_start + (s.slot::integer - 1)
          else s.week_start
        end
      )
    group by
      s.group_id, s.user_id, s.membership_id, s.commitment_id, s.week_start, c.kind,
      c.schedule_type, c.name, pa.name, ga.custom_name, p.display_name,
      case when c.schedule_type = 'times_per_week' then null else s.id end
    order by s.group_id, s.user_id, max(s.ends_at), s.commitment_id, min(s.slot)
  loop
    begin
      with stamped as (
        update public.sessions s
        set miss_recorded_at = now()
        where s.id = any (v_u.session_ids)
          and s.miss_recorded_at is null
          and private.session_status(s) = 'missed'
        returning s.id, s.slot
      )
      select pg_catalog.array_agg(st.id order by st.slot) into v_ids
      from stamped st;

      if v_ids is not null then
        v_member := v_u.group_id::text || '/' || v_u.user_id::text;
        if v_prev_member is distinct from v_member then
          select e.payload ->> 'tease' into v_prev_tease
          from public.feed_events e
          where e.group_id = v_u.group_id
            and e.kind = 'miss'
            and e.actor_id = v_u.user_id
          order by e.created_at desc, (e.payload ->> 'ends_at')::timestamptz desc,
                   (e.payload ->> 'commitment_id') desc
          limit 1;
        end if;

        select pg_catalog.array_agg(k.key order by k.ord) into v_choices
        from pg_catalog.unnest(
          array['couch_wins', 'couch_regards', 'couch_comfortable', 'couch_thanks', 'couch_loses']
        ) with ordinality as k(key, ord)
        where k.key is distinct from v_prev_tease;

        v_tease := v_choices[1 + pg_catalog.floor(pg_catalog.random() * pg_catalog.cardinality(v_choices))::integer];

        insert into public.feed_events (group_id, kind, actor_id, payload)
        values (
          v_u.group_id, 'miss', v_u.user_id,
          pg_catalog.jsonb_build_object(
            'actor_name', v_u.actor_name,
            'membership_id', v_u.membership_id,
            'commitment_id', v_u.commitment_id,
            'commitment_kind', v_u.kind,
            'schedule_type', v_u.schedule_type,
            'activity_name', v_u.activity_name,
            'task_name', v_u.task_name,
            'session_ids', pg_catalog.to_jsonb(v_ids),
            'count', pg_catalog.cardinality(v_ids),
            'tease', v_tease,
            'week_start', v_u.week_start,
            'missed_on', v_u.missed_on,
            'ends_at', v_u.ends_at
          )
        );

        v_prev_member := v_member;
        v_prev_tease := v_tease;
      end if;
    exception when others then
      if v_error is null then
        v_error := 'commitment ' || v_u.commitment_id::text || ': ' || sqlerrm;
      end if;
    end;
  end loop;

  return v_error;
end;
$$;

-- 5. The tick (AD-7), from 20261127000000_time_zones.sql: step 4 fills its slot; everything else
--    is unchanged. A failing step 4 counts as a failure before the lock, like steps 1 and 2.
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

-- 6. The Feed's read model (from 20261203000000_feed.sql), replaced with the same 23 columns in
--    order plus miss_count. Miss rows fill the commitment and activity columns (live, else the
--    payload) and miss_count = how many of the event's sessions are still `missed` under the
--    caller's RLS; a miss with none left is hidden (a late arrival completed it, or the member
--    left and their sessions went out of sight). Events are never deleted.
create or replace view public.feed_items
with (security_invoker = true)
as
select
  c.group_id,
  'checkin'::text as item_kind,
  c.id as item_id,
  c.received_at as sort_at,
  c.user_id as actor_id,
  p.display_name as actor_name,
  p.avatar_path as actor_avatar_path,
  null::uuid as subject_id,
  null::text as subject_name,
  c.commitment_id,
  cm.kind as commitment_kind,
  coalesce(pa.name, ga.custom_name) as activity_name,
  ga.preset_key,
  cm.name as task_name,
  c.captured_at,
  c.received_at,
  c.is_late,
  c.session_id is null as is_extra,
  c.caption,
  c.full_pruned_at,
  w.counted_position,
  w.target,
  null::jsonb as payload,
  null::integer as miss_count
from public.checkins c
join public.commitments cm on cm.id = c.commitment_id
join public.group_activities ga on ga.id = cm.group_activity_id
left join public.preset_activities pa on pa.key = ga.preset_key
left join public.profiles p on p.id = c.user_id
left join lateral (
  select
    (select pg_catalog.count(*)::integer
     from private.counted_checkins(s.membership_id, s.week_start) k
     where k.commitment_id = c.commitment_id
       and (k.counted_at, k.checkin_id) <= (c.counted_at, c.id)) as counted_position,
    (select pg_catalog.count(*)::integer
     from public.sessions t
     where t.commitment_id = c.commitment_id
       and t.week_start = s.week_start) as target
  from public.sessions s
  where s.id = c.session_id
) w on true
union all
select
  e.group_id,
  e.kind as item_kind,
  e.id as item_id,
  e.created_at as sort_at,
  e.actor_id,
  coalesce(pa.display_name, e.payload ->> 'actor_name') as actor_name,
  pa.avatar_path as actor_avatar_path,
  e.subject_id,
  coalesce(ps.display_name, e.payload ->> 'subject_name') as subject_name,
  case when e.kind = 'miss' then (e.payload ->> 'commitment_id')::uuid end as commitment_id,
  case when e.kind = 'miss' then coalesce(mc.kind, e.payload ->> 'commitment_kind') end
    as commitment_kind,
  case when e.kind = 'miss' then coalesce(mpa.name, mga.custom_name, e.payload ->> 'activity_name') end
    as activity_name,
  mga.preset_key,
  case when e.kind = 'miss' then coalesce(mc.name, e.payload ->> 'task_name') end as task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  e.payload,
  mm.missed as miss_count
from public.feed_events e
left join public.profiles pa on pa.id = e.actor_id
left join public.profiles ps on ps.id = e.subject_id
left join public.commitments mc
  on e.kind = 'miss' and mc.id = (e.payload ->> 'commitment_id')::uuid
left join public.group_activities mga on mga.id = mc.group_activity_id
left join public.preset_activities mpa on mpa.key = mga.preset_key
left join lateral (
  select pg_catalog.count(*)::integer as missed
  from public.sessions s
  where s.id in (
      select x.id::uuid
      from pg_catalog.jsonb_array_elements_text(coalesce(e.payload -> 'session_ids', '[]'::jsonb)) as x(id)
    )
    and private.session_status(s) = 'missed'
) mm on e.kind = 'miss'
where not (
  e.kind = 'member_left'
  and exists (
    select 1
    from public.feed_events h
    where h.group_id = e.group_id
      and h.kind = 'admin_handover'
      and h.payload ->> 'membership_id' = e.payload ->> 'membership_id'
  )
)
and (e.kind <> 'miss' or mm.missed > 0);

revoke all on table public.feed_items from public, anon, authenticated;
grant select on table public.feed_items to authenticated;

-- 7. Friends today (Today's strip): the group's check-ins received since the caller's local
--    midnight (profile zone through member_current_week), newest first, at most 30. Security
--    invoker, so feed_items' RLS applies (a non-member gets nothing). The local midnight is
--    private.local_start's expression inline (local_start is not granted to clients).
create or replace function public.get_friends_today(p_group_id uuid)
returns setof public.feed_items
language sql
stable
security invoker
set search_path = ''
as $$
  select f.*
  from public.feed_items f
  where f.group_id = p_group_id
    and f.item_kind = 'checkin'
    and f.received_at >= (
      select ((now() at time zone w.time_zone)::date)::timestamp at time zone w.time_zone
      from private.member_current_week(auth.uid(), now()) w
    )
  order by f.sort_at desc, f.item_id desc
  limit 30;
$$;

-- 8. Grants (AD-16). Step 4 and the tick stay closed; get_friends_today is a client read.
revoke execute on function private.tick_step_4_misses() from public, anon, authenticated;
revoke execute on function private.tick() from public, anon, authenticated;
revoke execute on function public.get_friends_today(uuid) from public, anon;
grant execute on function public.get_friends_today(uuid) to authenticated;
