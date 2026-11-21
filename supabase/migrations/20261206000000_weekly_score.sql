-- Weekly score and points (Story 4.1, FR-23, FR-24, AD-4, AD-5, AD-8, AD-11, AD-12, AD-14, AD-16).
--
-- AD-4 single definitions, each defined here once, built on private.session_status:
--   private.commitment_week_score(commitment, week)  done / (planned - frozen), null with no
--                                                    non-frozen session
--   private.weekly_points(membership, week)          all done / all non-frozen sessions of the
--                                                    member in the group (commitments and tasks),
--                                                    as an integer 0-100 rounded half up, null with
--                                                    no non-frozen session
--   private.group_ranking(group, week)               one row per current member with points,
--                                                    counts and rank (competition numbering), rank
--                                                    null for unscored members and in a waiting group
-- Open sessions count in planned, so points rise only as sessions are done. Extras (session_id
-- null) never touch a session, so they never count. `frozen` arrives with Epic 5; until then the
-- frozen counts are 0. private.counted_checkins is reused as is (not redefined).
--
-- Client reads: public.get_group_week (the group's current week from its group_weeks row, AD-11)
-- and public.get_board (the ranking with names and avatars, plus `waiting`). post_checkin returns
-- the post-moment values (AD-8): weekly_points, rank and passed_user_ids for the check-in's week.
--
-- Additive only: new functions; post_checkin is dropped and recreated with the same arguments,
-- body and grants, its return keeping every earlier column and gaining three. The routines call
-- now() unqualified on purpose (see 20261204000000_misses.sql).

-- 1. AD-4: per-commitment weekly score, 0..1.
create or replace function private.commitment_week_score(p_commitment_id uuid, p_week_start date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when x.planned - x.frozen > 0 then least(1::numeric, x.done::numeric / (x.planned - x.frozen))
  end
  from (
    select
      count(*) as planned,
      count(*) filter (where z.status = 'done') as done,
      count(*) filter (where z.status = 'frozen') as frozen
    from public.sessions s
    cross join lateral (select private.session_status(s) as status) z
    where s.commitment_id = p_commitment_id
      and s.week_start = p_week_start
  ) x;
$$;

-- 2. AD-4: weekly points of a membership, an integer 0-100 (half up), null without a score.
create or replace function private.weekly_points(p_membership_id uuid, p_week_start date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when x.planned - x.frozen > 0
      then least(100, pg_catalog.round(x.done * 100::numeric / (x.planned - x.frozen)))::integer
  end
  from (
    select
      count(*) as planned,
      count(*) filter (where z.status = 'done') as done,
      count(*) filter (where z.status = 'frozen') as frozen
    from public.sessions s
    cross join lateral (select private.session_status(s) as status) z
    where s.membership_id = p_membership_id
      and s.week_start = p_week_start
  ) x;
$$;

-- 3. AD-4: the group's ranking for a week. Current members only (FR-6). Scored members are ranked
--    by points desc, then sessions done desc; equal on both share a rank and the next is skipped
--    (rank()). Unscored members and every member of a waiting group (fewer than 2 current
--    members, FR-4) get rank null and come after the ranked ones.
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
  with members as (
    select m.id, m.user_id
    from public.memberships m
    where m.group_id = p_group_id
      and m.ended_at is null
  ),
  scored as (
    select
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
  select r.user_id, r.points, r.done, r.planned, r.frozen, r.member_rank
  from ranked r
  order by r.member_rank nulls last, r.user_id;
$$;

revoke execute on function private.commitment_week_score(uuid, date) from public, anon, authenticated;
revoke execute on function private.weekly_points(uuid, date) from public, anon, authenticated;
revoke execute on function private.group_ranking(uuid, date) from public, anon, authenticated;

-- 4. RPC: the group's current week (AD-11). The week tick step 1 writes for the group now, with
--    its lock time from the group_weeks row (computed like ensure_group_week until the tick has
--    written it). Security definer: the zone helpers are not executable by clients.
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

  v_week := private.week_start_of(
    now(),
    private.group_time_zone(
      p_group_id,
      private.week_start_of(now(), private.group_time_zone(p_group_id, null))
    )
  );

  return query
  select
    v_week,
    coalesce(
      (select gw.lock_at from public.group_weeks gw
       where gw.group_id = p_group_id and gw.week_start = v_week),
      private.local_start(v_week + 10, private.group_time_zone(p_group_id, v_week))
    );
end;
$$;

revoke execute on function public.get_group_week(uuid) from public, anon;
grant execute on function public.get_group_week(uuid) to authenticated;

-- 5. RPC: the Board's rows for a week (AD-12): group_ranking plus each member's display name and
--    avatar path, and whether the group is waiting. Ranked first, then by name.
create or replace function public.get_board(p_group_id uuid, p_week_start date)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  weekly_points integer,
  sessions_done integer,
  sessions_planned integer,
  sessions_frozen integer,
  rank integer,
  waiting boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_waiting boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  select count(*) < 2 into v_waiting
  from public.memberships m
  where m.group_id = p_group_id
    and m.ended_at is null;

  return query
  select
    r.user_id,
    p.display_name,
    p.avatar_path,
    r.weekly_points,
    r.sessions_done,
    r.sessions_planned,
    r.sessions_frozen,
    r.rank,
    v_waiting
  from private.group_ranking(p_group_id, p_week_start) r
  join public.profiles p on p.id = r.user_id
  order by r.rank nulls last, p.display_name, r.user_id;
end;
$$;

revoke execute on function public.get_board(uuid, date) from public, anon;
grant execute on function public.get_board(uuid, date) to authenticated;

-- 6. post_checkin (from 20261204000000_misses.sql, unchanged) plus the post-moment values for the
--    check-in's member week: weekly_points and rank after the post, and passed_user_ids = members
--    ranked better than the poster before the post and worse after it (an unranked poster counts
--    as last). passed_user_ids is computed only for a counted check-in counted at received_at (on
--    time); a late or extra check-in, a waiting group and an idempotent replay return '{}'.
drop function public.post_checkin(uuid, uuid, timestamptz, text);

create function public.post_checkin(
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
  target integer,
  weekly_points integer,
  rank integer,
  passed_user_ids uuid[]
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
  v_before jsonb := '{}'::jsonb;
  v_before_rank integer;
  v_points integer;
  v_rank integer;
  v_passed uuid[] := '{}'::uuid[];
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
      select r.weekly_points, r.rank into v_points, v_rank
      from private.group_ranking(v_existing.group_id, v_week) r
      where r.user_id = v_uid;
      return query
      select v_existing.id, v_existing.session_id, v_existing.session_id is not null,
             v_existing.is_late, x.done_count, x.target, v_points, v_rank, '{}'::uuid[]
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

  -- The ranking before the post: only an on-time post that completes a session can pass anyone.
  if v_session_id is not null and v_counted = v_received then
    select coalesce(pg_catalog.jsonb_object_agg(r.user_id::text, r.rank), '{}'::jsonb)
      into v_before
    from private.group_ranking(v_c.group_id, v_week) r
    where r.rank is not null;
    v_before_rank := (v_before ->> v_uid::text)::integer;
  end if;

  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at,
     is_late, caption)
  values
    (p_id, v_c.group_id, v_uid, v_c.id, v_session_id, p_captured_at, v_received, v_counted,
     v_is_late, v_caption);

  select r.weekly_points, r.rank into v_points, v_rank
  from private.group_ranking(v_c.group_id, v_week) r
  where r.user_id = v_uid;

  if v_rank is not null and v_before <> '{}'::jsonb then
    select coalesce(pg_catalog.array_agg(r.user_id order by r.rank, r.user_id), '{}'::uuid[])
      into v_passed
    from private.group_ranking(v_c.group_id, v_week) r
    where r.user_id <> v_uid
      and v_before ? r.user_id::text
      and (v_before_rank is null or (v_before ->> r.user_id::text)::integer < v_before_rank)
      and (r.rank is null or r.rank > v_rank);
  end if;

  return query
  select p_id, v_session_id, v_session_id is not null, v_is_late, x.done_count, x.target,
         v_points, v_rank, v_passed
  from private.checkin_counts(v_c.id, v_week) x;
end;
$$;

revoke execute on function public.post_checkin(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.post_checkin(uuid, uuid, timestamptz, text) to authenticated;
