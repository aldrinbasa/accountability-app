-- Today summary: has_plan tells "no plan" from "nothing listed today" (Epic 2 retro F1, Story 2.5).
--
-- Today showed "No plan here yet." whenever get_today_items returned no rows, which also happens to
-- a member with a plan on a day it lists nothing (fixed days Mon Wed Fri on a Tuesday). The Story
-- 2.5 AC keeps that state for a member with no commitments or tasks in the group. has_plan is true
-- while the caller's current membership has an active commitment (private.commitment_is_active,
-- which includes one that starts next week) or a task whose deadline is today or later in their
-- local day.
--
-- Adding a return column needs drop + create (create or replace cannot change a row type). The body
-- is 20261124000000_today_left.sql's plus has_plan; the old app version ignores the extra column.
-- The function calls now() unqualified on purpose (see 20261123000000_today.sql).
drop function public.get_today_summary(uuid);

create function public.get_today_summary(p_group_id uuid)
returns table (
  member_today date,
  week_start date,
  week_number integer,
  planned integer,
  done integer,
  "left" integer,
  has_plan boolean
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
    x.open_not_counted,
    exists (
      select 1
      from public.commitments c
      where c.membership_id = m.id
        and (
          (c.kind = 'commitment' and private.commitment_is_active(c))
          or (c.kind = 'task' and c.deadline >= v_today)
        )
    )
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
