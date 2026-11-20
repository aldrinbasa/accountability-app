-- Story 3.3: week_locked tells the client when the week locked (the outbox's rejection Banner,
-- "Too late for last week. It locked Wed 23:59, so this photo can't count.").
-- post_checkin is redefined in place with the same signature and return type; the body is the one
-- from 20261201000000_checkins.sql, except that the week_locked exception now carries
-- DETAIL = JSON {"lock_at": <the week's lock_at>, "time_zone": <the group zone of that week>}.
-- PostgREST passes DETAIL through as the error's `details`. Additive: older clients ignore it.

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
      and private.session_status(s) = 'open'
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
