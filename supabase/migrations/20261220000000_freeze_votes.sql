-- Freeze votes and outcomes (Story 5.5, FR-18, FR-20, FR-22, FR-31, AD-2, AD-4, AD-6, AD-10,
-- AD-14, AD-15, AD-16, AD-17).
--
-- The group votes Approve or Deny on a pending freeze request (cast_vote / undo_vote with kind
-- `freeze`). Eligible voters are the members at the request's opened_at who are still current (the
-- same membership row, so a rejoined member is not), other than the requester; there is no implicit
-- vote. vote_tallies lists open freeze requests next to open challenges. private.close_vote is not
-- changed: Story 5.4's freeze branch already decides (Approve >= Deny over final ballots, so a tie or
-- no ballot approves) and writes the `freeze_result` event; tick step 3 already closes due requests
-- by coalesce(early_close_at, closes_at), so an all-voted request closes after the last undo window.
--
-- feed_items gains one `freeze` row per request that had voters at open (a solo request, approved
-- at once, has none), withdrawn requests left out (the check-in's Polaroid tells that story):
-- item_id = the request id, sort_at = opened_at, the requester is the actor, the commitment fills its
-- columns, and the payload carries the status, reason, closes_at, schedule type, day, week (`this` or
-- `last` from the requester's week at opened_at), the week's live target, two_person, the cancel
-- reason and, for the reader only, their own ballot (votes RLS) and whether they may vote.
-- `freeze_result` event rows now fill the commitment columns (like `miss` and `ruling`) and their
-- payload gains `which` and `week_target`. A check-in row's target no longer counts frozen rows.
--
-- An approved freeze lowers the week's target: get_today_items (target), checkin_counts
-- (post_checkin's target) and get_today_summary (planned) count only sessions that are not frozen.
-- Fair Judge's description now names check-ins (copy only).
--
-- Additive only: a foreign key and a unique constraint on votes, two helpers; cast_vote, undo_vote,
-- vote_tallies, feed_items (same 28 columns), get_today_items, get_today_summary and checkin_counts
-- replaced in place with the same signatures and return shapes. The routines call now() unqualified
-- on purpose (pgTAP re-points their search_path at test_overrides so tests.freeze_time moves the
-- clock).

-- 1. votes: freeze ballots point at a real request, and one ballot per voter per request.
alter table public.votes
  add constraint votes_freeze_request_id_fkey
  foreign key (freeze_request_id) references public.freeze_requests (id) on delete cascade;

alter table public.votes
  add constraint votes_freeze_request_voter_key unique (freeze_request_id, voter_id);

-- 2. Helpers (security definer: the answer never depends on the caller's RLS; granted to
--    authenticated because feed_items, a security-invoker view, uses them).

-- Whether p_user may vote on the freeze request: a membership of its group that began at or before
-- opened_at and has not ended (a rejoined member's new membership began later), not the requester.
create or replace function private.freeze_voter_eligible(p_freeze_request_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.freeze_requests f
    join public.memberships m
      on m.group_id = f.group_id
     and m.user_id = p_user_id
     and m.joined_at <= f.opened_at
     and m.ended_at is null
    where f.id = p_freeze_request_id
      and p_user_id <> f.requester_id
  );
$$;

-- The members at opened_at (joined at or before it, not ended by then) other than the requester.
-- Zero means a solo request (approved at once, no vote); one means a group of two.
create or replace function private.freeze_others_at_open(p_freeze_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from public.freeze_requests f
  join public.memberships m on m.group_id = f.group_id
  where f.id = p_freeze_request_id
    and m.joined_at <= f.opened_at
    and (m.ended_at is null or m.ended_at > f.opened_at)
    and m.user_id <> f.requester_id;
$$;

revoke execute on function private.freeze_voter_eligible(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.freeze_others_at_open(uuid) from public, anon, authenticated;
grant execute on function private.freeze_voter_eligible(uuid, uuid) to authenticated;
grant execute on function private.freeze_others_at_open(uuid) to authenticated;

-- 3. RPC: cast a ballot (FR-17, FR-18, FR-31, AD-14, AD-17), from 20261217000000_votes.sql. The
--    `challenge` kind is unchanged (fake | real). The `freeze` kind (approve | deny) locks the
--    request for update: not_member (no such request, or the caller is not a current member),
--    group_waiting (under 2 current members), vote_closed (closed, not pending, or now() >=
--    closes_at), not_eligible, already_voted. Never closes the vote; when every eligible voter has a
--    ballot, early_close_at = least(now() + 6 s, closes_at). Same signature.
create or replace function public.cast_vote(p_kind text, p_id uuid, p_choice text)
returns table (vote_id uuid, cast_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_ch public.challenges;
  v_fr public.freeze_requests;
  v_now timestamptz := now();
  v_members integer;
  v_eligible integer;
  v_voted integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_choice is null
     or not (
       (p_kind = 'challenge' and p_choice in ('fake', 'real'))
       or (p_kind = 'freeze' and p_choice in ('approve', 'deny'))
     ) then
    raise exception 'invalid_vote';
  end if;

  if p_kind = 'freeze' then
    select f.* into v_fr
    from public.freeze_requests f
    where f.id = p_id
    for update;

    if v_fr.id is null or not private.is_current_member(v_fr.group_id, v_uid) then
      raise exception 'not_member';
    end if;

    select pg_catalog.count(*)::integer into v_members
    from public.memberships m
    where m.group_id = v_fr.group_id
      and m.ended_at is null;

    if v_members < 2 then
      raise exception 'group_waiting';
    end if;

    if v_fr.closed_at is not null or v_fr.status <> 'pending' or v_now >= v_fr.closes_at then
      raise exception 'vote_closed';
    end if;

    if not private.freeze_voter_eligible(v_fr.id, v_uid) then
      raise exception 'not_eligible';
    end if;

    if exists (select 1 from public.votes v where v.freeze_request_id = v_fr.id and v.voter_id = v_uid) then
      raise exception 'already_voted';
    end if;

    begin
      insert into public.votes (group_id, freeze_request_id, voter_id, choice, cast_at)
      values (v_fr.group_id, v_fr.id, v_uid, p_choice, v_now)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'already_voted';
    end;

    -- Every eligible voter has a ballot now: close after the last undo window (never past closes_at).
    select pg_catalog.count(*)::integer into v_eligible
    from public.memberships m
    where m.group_id = v_fr.group_id
      and m.ended_at is null
      and private.freeze_voter_eligible(v_fr.id, m.user_id);

    select pg_catalog.count(*)::integer into v_voted
    from public.votes v
    where v.freeze_request_id = v_fr.id
      and private.freeze_voter_eligible(v_fr.id, v.voter_id);

    if v_voted >= v_eligible then
      update public.freeze_requests
      set early_close_at = least(v_now + interval '6 seconds', v_fr.closes_at)
      where id = v_fr.id;
    end if;

    return query select v_id, v_now;
    return;
  end if;

  select ch.* into v_ch
  from public.challenges ch
  where ch.id = p_id
  for update;

  if v_ch.id is null or not private.is_current_member(v_ch.group_id, v_uid) then
    raise exception 'not_member';
  end if;

  select pg_catalog.count(*)::integer into v_members
  from public.memberships m
  where m.group_id = v_ch.group_id
    and m.ended_at is null;

  if v_members < 2 then
    raise exception 'group_waiting';
  end if;

  if v_ch.closed_at is not null or v_ch.status <> 'open' or v_now >= v_ch.closes_at then
    raise exception 'vote_closed';
  end if;

  if not private.challenge_voter_eligible(v_ch.id, v_uid) then
    raise exception 'not_eligible';
  end if;

  if exists (select 1 from public.votes v where v.challenge_id = v_ch.id and v.voter_id = v_uid) then
    raise exception 'already_voted';
  end if;

  begin
    insert into public.votes (group_id, challenge_id, voter_id, choice, cast_at)
    values (v_ch.group_id, v_ch.id, v_uid, p_choice, v_now)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_voted';
  end;

  -- Every eligible voter has a ballot now: close after the last undo window (never past closes_at).
  select pg_catalog.count(*)::integer into v_eligible
  from public.memberships m
  where m.group_id = v_ch.group_id
    and m.ended_at is null
    and private.challenge_voter_eligible(v_ch.id, m.user_id);

  select pg_catalog.count(*)::integer into v_voted
  from public.votes v
  where v.challenge_id = v_ch.id
    and private.challenge_voter_eligible(v_ch.id, v.voter_id);

  if v_voted >= v_eligible then
    update public.challenges
    set early_close_at = least(v_now + interval '6 seconds', v_ch.closes_at)
    where id = v_ch.id;
  end if;

  return query select v_id, v_now;
end;
$$;

-- 4. RPC: take a ballot back within 6 s of casting it (AD-17), from 20261217000000_votes.sql, now
--    for `challenge` and `freeze`. No ballot: nothing to undo. Clears early_close_at, since a voter
--    is missing again. Same signature.
create or replace function public.undo_vote(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ch public.challenges;
  v_fr public.freeze_requests;
  v_vote public.votes;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('challenge', 'freeze') then
    raise exception 'invalid_vote';
  end if;

  if p_kind = 'freeze' then
    select f.* into v_fr
    from public.freeze_requests f
    where f.id = p_id
    for update;

    if v_fr.id is null or not private.is_current_member(v_fr.group_id, v_uid) then
      raise exception 'not_member';
    end if;

    if v_fr.closed_at is not null or v_fr.status <> 'pending' or v_now >= v_fr.closes_at then
      raise exception 'vote_closed';
    end if;

    select v.* into v_vote
    from public.votes v
    where v.freeze_request_id = v_fr.id
      and v.voter_id = v_uid;

    if v_vote.id is null then
      return;
    end if;

    if v_now >= v_vote.cast_at + interval '6 seconds' then
      raise exception 'undo_expired';
    end if;

    delete from public.votes where id = v_vote.id;

    update public.freeze_requests
    set early_close_at = null
    where id = v_fr.id;
    return;
  end if;

  select ch.* into v_ch
  from public.challenges ch
  where ch.id = p_id
  for update;

  if v_ch.id is null or not private.is_current_member(v_ch.group_id, v_uid) then
    raise exception 'not_member';
  end if;

  if v_ch.closed_at is not null or v_ch.status <> 'open' or v_now >= v_ch.closes_at then
    raise exception 'vote_closed';
  end if;

  select v.* into v_vote
  from public.votes v
  where v.challenge_id = v_ch.id
    and v.voter_id = v_uid;

  if v_vote.id is null then
    return;
  end if;

  if v_now >= v_vote.cast_at + interval '6 seconds' then
    raise exception 'undo_expired';
  end if;

  delete from public.votes where id = v_vote.id;

  update public.challenges
  set early_close_at = null
  where id = v_ch.id;
end;
$$;

-- 5. RPC: the group's open votes as tallies only (FR-17), from 20261217000000_votes.sql. Challenges
--    unchanged (the challenger counts as one voter and one vote). Pending freeze requests: eligible
--    = the current eligible voters (no implicit vote); voted = their final ballots plus the caller's
--    own ballot inside its undo window. Both kinds ordered together by closes_at, id.
create or replace function public.vote_tallies(p_group_id uuid)
returns table (target_kind text, target_id uuid, voted_count integer, eligible_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  return query
  select x.kind, x.id, x.voted, x.eligible
  from (
    select
      'challenge'::text as kind,
      ch.id,
      1 + (
        select pg_catalog.count(*)::integer
        from public.votes v
        where v.challenge_id = ch.id
          and private.challenge_voter_eligible(ch.id, v.voter_id)
          and (v.cast_at + interval '6 seconds' <= now()
               or now() >= ch.closes_at
               or v.voter_id = v_uid)
      ) as voted,
      1 + (
        select pg_catalog.count(*)::integer
        from public.memberships m
        where m.group_id = ch.group_id
          and m.ended_at is null
          and private.challenge_voter_eligible(ch.id, m.user_id)
      ) as eligible,
      ch.closes_at
    from public.challenges ch
    where ch.group_id = p_group_id
      and ch.closed_at is null
      and ch.status = 'open'
    union all
    select
      'freeze'::text,
      f.id,
      (
        select pg_catalog.count(*)::integer
        from public.votes v
        where v.freeze_request_id = f.id
          and private.freeze_voter_eligible(f.id, v.voter_id)
          and (v.cast_at + interval '6 seconds' <= now()
               or now() >= f.closes_at
               or v.voter_id = v_uid)
      ),
      (
        select pg_catalog.count(*)::integer
        from public.memberships m
        where m.group_id = f.group_id
          and m.ended_at is null
          and private.freeze_voter_eligible(f.id, m.user_id)
      ),
      f.closes_at
    from public.freeze_requests f
    where f.group_id = p_group_id
      and f.closed_at is null
      and f.status = 'pending'
  ) x
  order by x.closes_at, x.id;
end;
$$;

-- 6. post_checkin's counts (from 20261201000000_checkins.sql): the target is the commitment's
--    sessions in the member week that are not frozen (an approved freeze lowers it by 1).
create or replace function private.checkin_counts(p_commitment_id uuid, p_week_start date)
returns table (done_count integer, target integer)
language sql
stable
set search_path = ''
as $$
  select
    (select count(*)::integer
     from public.commitments c
     cross join lateral private.counted_checkins(c.membership_id, p_week_start) k
     where c.id = p_commitment_id
       and k.commitment_id = p_commitment_id),
    (select count(*)::integer
     from public.sessions s
     where s.commitment_id = p_commitment_id
       and s.week_start = p_week_start
       and private.session_status(s) <> 'frozen');
$$;

revoke execute on function private.checkin_counts(uuid, date) from public, anon, authenticated;

-- 7. Today's rows (from 20261201000000_checkins.sql), same signature and return shape: a
--    commitment's week target (session_count) leaves out frozen sessions. Everything else verbatim.
create or replace function public.get_today_items(p_group_id uuid)
returns table (
  commitment_id uuid,
  kind text,
  section text,
  preset_key text,
  custom_name text,
  activity_name text,
  name text,
  schedule_type text,
  days smallint[],
  target smallint,
  counted smallint,
  deadline date,
  starts_on date,
  can_delete boolean,
  done_count smallint,
  counted_today boolean,
  target_met boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
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

  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;
  v_today := (now() at time zone v_tz)::date;

  return query
  with week_sessions as (
    select
      s.commitment_id as cid,
      -- The week's target: sessions that are not frozen (Story 5.5).
      (count(*) filter (where private.session_status(s) <> 'frozen'))::smallint as session_count,
      bool_or(s.ends_at > now()) as has_open,
      bool_or(s.slot = extract(isodow from v_today) and s.ends_at > now()) as has_open_today_slot,
      max(s.ends_at) as last_ends_at
    from public.sessions s
    where s.membership_id = v_membership_id
      and s.week_start = v_week_start
    group by s.commitment_id
  ),
  counted as (
    select
      k.commitment_id as cid,
      count(*)::smallint as done_count,
      bool_or((k.counted_at at time zone v_tz)::date = v_today) as counted_today
    from private.counted_checkins(v_membership_id, v_week_start) k
    group by k.commitment_id
  ),
  current_rows as (
    select
      c.id as cid,
      c.kind as c_kind,
      c.group_activity_id as ga_id,
      c.name as c_name,
      c.schedule_type as c_schedule_type,
      c.deadline as c_deadline,
      c.deadline_day_starts_at as c_deadline_day_starts_at,
      w.session_count as c_target,
      coalesce(k.done_count, 0::smallint) as c_counted,
      coalesce(k.counted_today, false) as c_counted_today,
      -- Member-local days from today through the local day of the last session end.
      (((w.last_ends_at - interval '1 microsecond') at time zone v_tz)::date - v_today + 1) as days_left,
      v_week_start as version_week
    from public.commitments c
    join week_sessions w on w.cid = c.id
    left join counted k on k.cid = c.id
    where c.group_id = p_group_id
      and c.membership_id = v_membership_id
      and w.has_open
      and (
        (c.kind = 'task' and c.deadline >= v_today)
        or (c.kind = 'commitment' and c.schedule_type = 'times_per_week')
        or (c.kind = 'commitment' and c.schedule_type = 'fixed_days' and w.has_open_today_slot)
      )
  ),
  placed as (
    select
      r.*,
      case
        when r.c_kind = 'task' and r.c_deadline = v_today then 'due_today'
        when r.c_kind = 'task' then 'this_week'
        when r.c_schedule_type = 'fixed_days' then 'due_today'
        when r.c_target - r.c_counted > 0 and r.c_target - r.c_counted >= r.days_left then 'due_today'
        else 'this_week'
      end as c_section,
      null::date as c_starts_on
    from current_rows r
  ),
  next_rows as (
    select
      c.id as cid,
      c.kind as c_kind,
      c.group_activity_id as ga_id,
      c.name as c_name,
      c.schedule_type as c_schedule_type,
      c.deadline as c_deadline,
      c.deadline_day_starts_at as c_deadline_day_starts_at,
      null::smallint as c_target,
      0::smallint as c_counted,
      false as c_counted_today,
      null::integer as days_left,
      f.first_week as version_week,
      'starts_next_week' as c_section,
      f.first_week as c_starts_on
    from public.commitments c
    cross join lateral (
      select min(cv.effective_week_start) as first_week
      from public.commitment_versions cv
      where cv.commitment_id = c.id
    ) f
    where c.group_id = p_group_id
      and c.membership_id = v_membership_id
      and c.kind = 'commitment'
      and f.first_week > v_week_start
      and private.commitment_is_active(c)
  ),
  all_rows as (
    select * from placed
    union all
    select * from next_rows
  ),
  judged as (
    select
      a.*,
      coalesce(a.c_target is not null and a.c_counted >= a.c_target, false) as c_target_met,
      case
        when a.c_section = 'starts_next_week' then false
        when a.c_kind = 'commitment' and a.c_schedule_type = 'fixed_days' then a.c_counted_today
        else coalesce(a.c_counted >= a.c_target, false)
      end as c_done
    from all_rows a
  )
  select
    a.cid,
    a.c_kind,
    a.c_section,
    ga.preset_key,
    ga.custom_name,
    coalesce(pa.name, ga.custom_name),
    a.c_name,
    a.c_schedule_type,
    v.days,
    case
      when a.c_section = 'starts_next_week' then v.target
      else a.c_target
    end,
    a.c_counted,
    a.c_deadline,
    a.c_starts_on,
    coalesce(a.c_kind = 'task' and now() < a.c_deadline_day_starts_at, false),
    a.c_counted,
    a.c_counted_today,
    a.c_target_met
  from judged a
  join public.group_activities ga on ga.id = a.ga_id
  left join public.preset_activities pa on pa.key = ga.preset_key
  left join lateral (
    select cv.days, cv.target
    from public.commitment_versions cv
    where cv.commitment_id = a.cid
      and cv.effective_week_start <= a.version_week
    order by cv.effective_week_start desc
    limit 1
  ) v on true
  order by
    case a.c_section when 'due_today' then 0 when 'this_week' then 1 else 2 end,
    -- Open before done.
    a.c_done,
    case
      when a.c_kind = 'commitment' and a.c_schedule_type = 'fixed_days' then 0
      when a.c_kind = 'commitment' then 1
      else 2
    end,
    a.c_deadline nulls first,
    pg_catalog.lower(coalesce(a.c_name, pa.name, ga.custom_name)),
    a.cid;
end;
$$;

revoke execute on function public.get_today_items(uuid) from public, anon;
grant execute on function public.get_today_items(uuid) to authenticated;

-- 8. Today's summary (from 20261201000000_checkins.sql), same signature and return shape: planned
--    leaves out frozen sessions. Everything else verbatim.
create or replace function public.get_today_summary(p_group_id uuid)
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

  select w.time_zone, w.week_start into v_tz, v_week_start
  from private.member_current_week(v_uid, now()) w;
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
      -- Sessions that are not frozen (Story 5.5).
      (count(*) filter (where private.session_status(s) <> 'frozen'))::integer as planned,
      (count(*) filter (where private.session_status(s) = 'done'))::integer as done,
      -- Open sessions not done yet.
      (count(*) filter (where s.ends_at > now() and private.session_status(s) = 'open'))::integer
        as open_not_counted
    from public.sessions s
    where s.membership_id = m.id
      and s.week_start = v_week_start
  ) x
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;
end;
$$;

revoke execute on function public.get_today_summary(uuid) from public, anon;
grant execute on function public.get_today_summary(uuid) to authenticated;

-- 9. The Feed's read model (from 20261218000000_overturns.sql), same 28 columns.
--    - A check-in row's target leaves out frozen sessions.
--    - One `freeze` row per freeze request with voters at opened_at (never a solo request), not
--      withdrawn: item_id = the request id, sort_at = opened_at, the requester is the actor (live
--      profile), the commitment fills its columns (left joins), every other check-in and challenge
--      column is null; payload {status, reason, closes_at, schedule_type, session_day, week_start,
--      which, week_target, two_person, cancel_reason, my_choice, my_cast_at, can_vote}.
--    - `freeze_result` event rows fill the commitment columns like `miss` and `ruling`, and their
--      payload gains `which` and `week_target`.
--    `which` = `last` when the request's week is before the requester's week at opened_at, else
--    `this`; `week_target` = the commitment's sessions in that week that are not frozen (live).
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
  null::integer as miss_count,
  ch.id as challenge_id,
  ch.status as challenge_status,
  ch.closes_at as challenge_closes_at,
  private.checkin_challenge_until(c.id, c.received_at) as challenge_until
from public.checkins c
join public.commitments cm on cm.id = c.commitment_id
join public.group_activities ga on ga.id = cm.group_activity_id
left join public.preset_activities pa on pa.key = ga.preset_key
left join public.profiles p on p.id = c.user_id
left join public.challenges ch on ch.checkin_id = c.id
left join lateral (
  select
    case when exists (
      select 1
      from private.counted_checkins(s.membership_id, s.week_start) k0
      where k0.checkin_id = c.id
    ) then (
      select pg_catalog.count(*)::integer
      from private.counted_checkins(s.membership_id, s.week_start) k
      where k.commitment_id = c.commitment_id
        and (k.counted_at, k.checkin_id) <= (c.counted_at, c.id)
    ) end as counted_position,
    (select pg_catalog.count(*)::integer
     from public.sessions t
     where t.commitment_id = c.commitment_id
       and t.week_start = s.week_start
       and private.session_status(t) <> 'frozen') as target
  from public.sessions s
  where s.id = c.session_id
) w on true
where not private.checkin_removed(c.id)
union all
select
  ch.group_id,
  'challenge'::text as item_kind,
  ch.id as item_id,
  ch.opened_at as sort_at,
  ch.challenger_id as actor_id,
  pc.display_name as actor_name,
  pc.avatar_path as actor_avatar_path,
  ch.subject_user_id as subject_id,
  po.display_name as subject_name,
  c.commitment_id,
  cm.kind as commitment_kind,
  coalesce(pa.name, ga.custom_name) as activity_name,
  ga.preset_key,
  cm.name as task_name,
  c.captured_at,
  c.received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  c.full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  pg_catalog.jsonb_build_object(
    'checkin_id', ch.checkin_id,
    'fake_count', ch.fake_count,
    'real_count', ch.real_count,
    'variant', case
      when ch.status not in ('fake', 'real') then null
      when ch.fake_count = 1 and ch.real_count = 0 then 'lone'
      else 'normal'
    end,
    'cancel_reason', ch.cancel_reason,
    'my_choice', mv.choice,
    'my_cast_at', mv.cast_at,
    'can_vote', private.challenge_voter_eligible(ch.id, (select auth.uid())),
    'overturned_by_id', cov.admin_id,
    'overturned_by_name', case when cov.id is not null then coalesce(
      pcov.display_name,
      (select oe.payload ->> 'actor_name'
       from public.feed_events oe
       where oe.group_id = ch.group_id
         and oe.kind = 'overturn'
         and oe.payload ->> 'challenge_id' = ch.id::text
       order by oe.created_at
       limit 1)
    ) end
  ) as payload,
  null::integer as miss_count,
  ch.id as challenge_id,
  ch.status as challenge_status,
  ch.closes_at as challenge_closes_at,
  null::timestamptz as challenge_until
from public.challenges ch
join public.checkins c on c.id = ch.checkin_id
join public.commitments cm on cm.id = c.commitment_id
join public.group_activities ga on ga.id = cm.group_activity_id
left join public.preset_activities pa on pa.key = ga.preset_key
left join public.profiles pc on pc.id = ch.challenger_id
left join public.profiles po on po.id = ch.subject_user_id
left join lateral (
  select v.choice, v.cast_at
  from public.votes v
  where v.challenge_id = ch.id
    and v.voter_id = (select auth.uid())
) mv on true
left join public.overturns cov on cov.challenge_id = ch.id
left join public.profiles pcov on pcov.id = cov.admin_id
where private.challenge_others_at_open(ch.id) > 0
union all
select
  f.group_id,
  'freeze'::text as item_kind,
  f.id as item_id,
  f.opened_at as sort_at,
  f.requester_id as actor_id,
  pf.display_name as actor_name,
  pf.avatar_path as actor_avatar_path,
  null::uuid as subject_id,
  null::text as subject_name,
  f.commitment_id,
  cm.kind as commitment_kind,
  coalesce(pa.name, ga.custom_name) as activity_name,
  ga.preset_key,
  cm.name as task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  pg_catalog.jsonb_build_object(
    'status', f.status,
    'reason', f.reason,
    'closes_at', f.closes_at,
    'schedule_type', cm.schedule_type,
    'session_day', case
      when cm.kind = 'task' then cm.deadline
      when cm.schedule_type = 'fixed_days' then f.week_start + (fs.slot::integer - 1)
    end,
    'week_start', f.week_start,
    'which', case
      when f.week_start < (select mw.week_start
                           from private.member_current_week(f.requester_id, f.opened_at) mw)
        then 'last'
      else 'this'
    end,
    'week_target', (
      select pg_catalog.count(*)::integer
      from public.sessions t
      where t.commitment_id = f.commitment_id
        and t.week_start = f.week_start
        and private.session_status(t) <> 'frozen'
    ),
    'two_person', private.freeze_others_at_open(f.id) = 1,
    'cancel_reason', f.cancel_reason,
    'my_choice', fv.choice,
    'my_cast_at', fv.cast_at,
    'can_vote', private.freeze_voter_eligible(f.id, (select auth.uid()))
  ) as payload,
  null::integer as miss_count,
  null::uuid as challenge_id,
  null::text as challenge_status,
  null::timestamptz as challenge_closes_at,
  null::timestamptz as challenge_until
from public.freeze_requests f
left join public.commitments cm on cm.id = f.commitment_id
left join public.group_activities ga on ga.id = cm.group_activity_id
left join public.preset_activities pa on pa.key = ga.preset_key
left join public.profiles pf on pf.id = f.requester_id
left join public.sessions fs on fs.id = f.session_id
left join lateral (
  select v.choice, v.cast_at
  from public.votes v
  where v.freeze_request_id = f.id
    and v.voter_id = (select auth.uid())
) fv on true
where f.status <> 'withdrawn'
  and private.freeze_others_at_open(f.id) > 0
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
  case when e.kind in ('miss', 'ruling', 'freeze_result') then (e.payload ->> 'commitment_id')::uuid end
    as commitment_id,
  case when e.kind in ('miss', 'ruling', 'freeze_result')
    then coalesce(mc.kind, e.payload ->> 'commitment_kind') end
    as commitment_kind,
  case when e.kind in ('miss', 'ruling', 'freeze_result')
    then coalesce(mpa.name, mga.custom_name, e.payload ->> 'activity_name') end
    as activity_name,
  mga.preset_key,
  case when e.kind in ('miss', 'ruling', 'freeze_result')
    then coalesce(mc.name, e.payload ->> 'task_name') end
    as task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  case
    when e.kind = 'ruling' then e.payload || pg_catalog.jsonb_build_object(
      'overturn_until', case when e.payload ->> 'outcome' = 'fake'
        then private.checkin_lock_at((e.payload ->> 'checkin_id')::uuid) end,
      'can_overturn', private.ruling_can_overturn((e.payload ->> 'challenge_id')::uuid),
      'overturned_by_id', ov.admin_id,
      'overturned_by_name', case when ov.id is not null
        then coalesce(pov.display_name, oe.payload ->> 'actor_name') end,
      'overturned_at', ov.created_at
    )
    when e.kind = 'freeze_result' then e.payload || pg_catalog.jsonb_build_object(
      'which', case
        when (e.payload ->> 'week_start')::date
             < (select mw.week_start
                from private.member_current_week(e.actor_id, coalesce(efr.opened_at, e.created_at)) mw)
          then 'last'
        else 'this'
      end,
      'week_target', (
        select pg_catalog.count(*)::integer
        from public.sessions t
        where t.commitment_id = (e.payload ->> 'commitment_id')::uuid
          and t.week_start = (e.payload ->> 'week_start')::date
          and private.session_status(t) <> 'frozen'
      )
    )
    else e.payload
  end as payload,
  mm.missed as miss_count,
  null::uuid as challenge_id,
  null::text as challenge_status,
  null::timestamptz as challenge_closes_at,
  null::timestamptz as challenge_until
from public.feed_events e
left join public.profiles pa on pa.id = e.actor_id
left join public.profiles ps on ps.id = e.subject_id
left join public.commitments mc
  on e.kind in ('miss', 'ruling', 'freeze_result') and mc.id = (e.payload ->> 'commitment_id')::uuid
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
left join public.overturns ov
  on e.kind = 'ruling' and ov.challenge_id = (e.payload ->> 'challenge_id')::uuid
left join public.profiles pov on pov.id = ov.admin_id
left join lateral (
  select o.payload
  from public.feed_events o
  where o.group_id = e.group_id
    and o.kind = 'overturn'
    and o.payload ->> 'challenge_id' = e.payload ->> 'challenge_id'
  order by o.created_at
  limit 1
) oe on ov.id is not null
left join public.freeze_requests efr
  on e.kind = 'freeze_result' and efr.id = (e.payload ->> 'freeze_request_id')::uuid
where e.kind <> 'overturn'
and not (
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

-- 10. Fair Judge counts ballots on check-ins and freezes (copy only; the criterion is unchanged).
update public.badges
set how_earned = 'Voted 10 times on check-ins or freezes'
where key = 'fair_judge';

-- 11. Grants (AD-16), restated: cast_vote, undo_vote and vote_tallies stay client RPCs.
revoke execute on function public.cast_vote(text, uuid, text) from public, anon;
revoke execute on function public.undo_vote(text, uuid) from public, anon;
revoke execute on function public.vote_tallies(uuid) from public, anon;
grant execute on function public.cast_vote(text, uuid, text) to authenticated;
grant execute on function public.undo_vote(text, uuid) to authenticated;
grant execute on function public.vote_tallies(uuid) to authenticated;
