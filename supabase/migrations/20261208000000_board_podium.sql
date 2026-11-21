-- Board podium (Story 4.3, FR-26, AD-4, AD-5, AD-11, AD-12, AD-14, AD-16).
--
-- public.get_board (Story 4.1) grows the fields the Board needs, per member row:
--   miss_count   sessions of week D whose private.session_status is 'missed' (tasks included). A
--                times-per-week row ends with the member's week, so its misses count only after it.
--   best_streak  the highest private.current_streak over the member's active commitments, 0 when
--                none (the Board flame).
--   plan         the member's plan for week D: one {activity_name, schedule_type, days, target}
--                object per commitment with sessions that week (the version in effect for D),
--                ordered by when the commitment was made.
--   task_count   the member's tasks with a session in week D.
-- and, the same on every row, the week's facts from group_weeks and the group row (AD-11):
--   lock_at          the week's lock (the group_weeks row, computed like ensure_group_week until
--                    the tick has written it)
--   is_current_week  whether D is the group's current week (get_group_week's formula)
--   time_zone        the group's zone for week D
--
-- Every number still comes from the AD-4 definitions (group_ranking, session_status,
-- current_streak); nothing is copied. A waiting group keeps rank null but its member's
-- weekly_points are returned as before (a solo member sees their own score, 2026-11-20 decision).
--
-- Additive only: get_board is dropped and recreated with the same arguments, auth errors, order
-- and grants, its return keeping every earlier column and gaining seven. The routine calls now()
-- unqualified on purpose (see 20261204000000_misses.sql).

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
  time_zone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
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

  select count(*) < 2 into v_waiting
  from public.memberships m
  where m.group_id = p_group_id
    and m.ended_at is null;

  -- The group's current week, as get_group_week computes it.
  v_current := private.week_start_of(
    now(),
    private.group_time_zone(
      p_group_id,
      private.week_start_of(now(), private.group_time_zone(p_group_id, null))
    )
  );

  v_tz := private.group_time_zone(p_group_id, p_week_start);
  v_lock_at := coalesce(
    (select gw.lock_at from public.group_weeks gw
     where gw.group_id = p_group_id and gw.week_start = p_week_start),
    private.local_start(p_week_start + 10, v_tz)
  );

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
    v_waiting,
    coalesce((
      select count(*)::integer
      from public.sessions s
      where s.membership_id = m.id
        and s.week_start = p_week_start
        and private.session_status(s) = 'missed'
    ), 0),
    coalesce((
      select max(private.current_streak(c.id))
      from public.commitments c
      where c.membership_id = m.id
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
      where c.membership_id = m.id
        and c.kind = 'commitment'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = p_week_start
        )
    ), '[]'::jsonb),
    (
      select count(*)::integer
      from public.commitments c
      where c.membership_id = m.id
        and c.kind = 'task'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = p_week_start
        )
    ),
    v_lock_at,
    p_week_start = v_current,
    v_tz
  from private.group_ranking(p_group_id, p_week_start) r
  join public.profiles p on p.id = r.user_id
  join public.memberships m
    on m.group_id = p_group_id
   and m.user_id = r.user_id
   and m.ended_at is null
  order by r.rank nulls last, p.display_name, r.user_id;
end;
$$;

revoke execute on function public.get_board(uuid, date) from public, anon;
grant execute on function public.get_board(uuid, date) to authenticated;
