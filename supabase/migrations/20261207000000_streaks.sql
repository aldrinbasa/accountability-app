-- Streaks (Story 4.2, FR-25, AD-4, AD-6, AD-11, AD-15, AD-16).
--
-- AD-4 single definitions, each defined here once, built on private.session_status:
--   private.streak_through_week(commitment, week)  the commitment's streak counting only sessions
--                                                  in weeks up to and including `week`
--   private.current_streak(commitment)             the streak as of now (through the owner's
--                                                  current week)
--   private.streak_back_to_zero(commitment)        the streak is 0 now but was above 0 before
--                                                  (the "back to 0" meta)
-- Tasks have no streak: null from the first two, false from the third.
--
-- Fixed days: consecutive done sessions ordered by starts_at, walking back from the latest one. A
-- missed session resets to 0; a frozen session (Epic 5) and a session still open neither break nor
-- add, so today's unfinished session never zeroes the streak. Set-based: the done sessions that
-- start after the latest missed one.
-- Times per week: consecutive target-met weeks. A week's target is its number of non-frozen rows
-- (pro-rated weeks already have fewer rows, Story 2.3); met = done >= target. A week with 0
-- non-frozen rows is neutral; a week below target resets to 0 only once none of its rows is open,
-- so the current week adds 1 as soon as it is met and never breaks the streak before it ends.
-- Both walk every week from the commitment's first session (no locked results exist yet); Story
-- 4.4 replaces the bodies to start from the last locked streak_after with identical results.
-- Sessions belong to the commitment, not to a version, so a streak runs on across schedule changes
-- (AD-6). Ordering uses the stored session bounds, so DST weeks need nothing special.
--
-- Client read: public.get_streaks(group) for Today, the Board and profiles.
--
-- Additive only: new functions. The routines call now() unqualified on purpose (see
-- 20261204000000_misses.sql).

-- 1. AD-4: the streak through a week.
create or replace function private.streak_through_week(p_commitment_id uuid, p_week_start date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select s.week_start, s.starts_at, private.session_status(s) as status
    from public.sessions s
    where s.commitment_id = p_commitment_id
      and s.week_start <= p_week_start
  ),
  weeks as (
    select
      s.week_start,
      count(*) filter (where s.status <> 'frozen') as target,
      count(*) filter (where s.status = 'done') as done,
      count(*) filter (where s.status = 'open') as open
    from s
    group by s.week_start
  )
  select case
    when c.kind <> 'commitment' then null
    when c.schedule_type = 'fixed_days' then (
      select (count(*) filter (
        where s.status = 'done'
          and s.starts_at > coalesce(
            (select max(m.starts_at) from s m where m.status = 'missed'),
            '-infinity'::timestamptz
          )
      ))::integer
      from s
    )
    else (
      select (count(*) filter (
        where w.target > 0
          and w.done >= w.target
          and w.week_start > coalesce(
            (select max(b.week_start) from weeks b
             where b.target > 0 and b.done < b.target and b.open = 0),
            '-infinity'::date
          )
      ))::integer
      from weeks w
    )
  end
  from public.commitments c
  where c.id = p_commitment_id;
$$;

-- 2. AD-4: the streak as of now: through the owner's current week (sessions of a later week, made
--    early for zones ahead, are open and would change nothing anyway).
create or replace function private.current_streak(p_commitment_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.streak_through_week(c.id, w.week_start)
  from public.commitments c
  cross join lateral private.member_current_week(c.user_id, now()) w
  where c.id = p_commitment_id;
$$;

-- 3. "back to 0": the current streak is 0 and the commitment once had a streak above 0. Fixed days:
--    any done session (with the streak at 0, every done session came before the latest miss).
--    Times per week: any week whose streak_through_week was above 0 (a met week).
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
        select 1
        from (select distinct s.week_start from public.sessions s where s.commitment_id = c.id) w
        where private.streak_through_week(c.id, w.week_start) > 0
      )
    end,
    false
  )
  from public.commitments c
  where c.id = p_commitment_id;
$$;

revoke execute on function private.streak_through_week(uuid, date) from public, anon, authenticated;
revoke execute on function private.current_streak(uuid) from public, anon, authenticated;
revoke execute on function private.streak_back_to_zero(uuid) from public, anon, authenticated;

-- 4. RPC: every commitment's current streak in the group (AD-12): each commitment and task (null)
--    of the group's current members, active or ended, with back_to_zero for the "back to 0" meta.
--    Security definer: the streak helpers are not executable by clients.
create or replace function public.get_streaks(p_group_id uuid)
returns table (
  commitment_id uuid,
  user_id uuid,
  current_streak integer,
  back_to_zero boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  return query
  select
    c.id,
    c.user_id,
    private.current_streak(c.id),
    private.streak_back_to_zero(c.id)
  from public.commitments c
  join public.memberships m on m.id = c.membership_id
  where c.group_id = p_group_id
    and m.ended_at is null
  order by c.user_id, c.id;
end;
$$;

revoke execute on function public.get_streaks(uuid) from public, anon;
grant execute on function public.get_streaks(uuid) to authenticated;
