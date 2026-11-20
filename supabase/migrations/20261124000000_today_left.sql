-- Today summary: `left` counts only what is still owed (Story 2.5 review fix, AD-11, AD-16).
--
-- 20261123000000_today.sql set left = planned - done, which also counted sessions that are already
-- over (yesterday's fixed-day session, a task whose deadline passed), so "N left this week"
-- overstated what is still owed. left is now the caller's sessions this week that have not ended
-- (ends_at > now()) and are not counted yet. Nothing counts until Epic 3, which switches done and
-- the "not counted" part to the AD-4 scoring functions.
--
-- Additive only: the same function, signature and columns, replaced. The function calls now()
-- unqualified on purpose (see 20261123000000_today.sql).
create or replace function public.get_today_summary(p_group_id uuid)
returns table (
  member_today date,
  week_start date,
  week_number integer,
  planned integer,
  done integer,
  "left" integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_tz text;
  v_week_start date;
  v_today date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);
  v_today := (now() at time zone v_tz)::date;

  return query
  select
    v_today,
    v_week_start,
    greatest(1, (v_week_start - private.week_start_of(m.joined_at, v_tz)) / 7 + 1)::integer,
    x.planned,
    x.done,
    x.open_not_counted
  from public.memberships m
  cross join lateral (
    select
      count(*)::integer as planned,
      0::integer as done,
      -- Open sessions; none is counted until Epic 3.
      (count(*) filter (where s.ends_at > now()))::integer as open_not_counted
    from public.sessions s
    where s.membership_id = m.id
      and s.week_start = v_week_start
  ) x
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;
end;
$$;

-- Grants as before: authenticated only.
revoke execute on function public.get_today_summary(uuid) from public, anon;
grant execute on function public.get_today_summary(uuid) to authenticated;
