-- Votes (Story 5.2, FR-17, FR-31, AD-2, AD-3, AD-4, AD-10, AD-14, AD-15, AD-16, AD-17).
--
-- Members vote Fake or Real on an open challenge (cast_vote) and may take a ballot back within 6 s
-- (undo_vote). Eligible voters are the members at the challenge's opened_at who are still current
-- (the same membership row, so a rejoined member is not), other than the check-in's owner and the
-- challenger, whose challenge is one implicit Fake vote with no ballot row. Ballots are readable only
-- by their voter (also after leaving); other members see only tallies (vote_tallies). A ballot is
-- final 6 s after cast_at, or once the vote's closes_at has passed. When every eligible voter has a
-- ballot, cast_vote sets early_close_at = least(now() + 6 s, closes_at), so tick step 3 closes the
-- vote only after the last undo window. private.close_vote now counts final ballots (Fake = 1 +
-- Fake ballots, Real = Real ballots; a tie keeps the check-in) and reads `lone` only when no ballot
-- was counted. Fair Judge (badge_criteria_met) counts a membership's final ballots. feed_items gains
-- one `challenge` row per challenge that had voters (item_id = challenge id, sort_at = opened_at),
-- so the Feed shows the Vote card and /feed/v/{voteId} anchors on it.
--
-- Additive only: one new table, new functions; close_vote, badge_criteria_met and feed_items
-- replaced in place (the view keeps its 28 columns and adds rows). The routines call now()
-- unqualified on purpose (pgTAP re-points their search_path at test_overrides so tests.freeze_time
-- moves the clock).

-- 1. Table. freeze_request_id has no foreign key until Story 5.5 creates freeze_requests; exactly
--    one target is set, and the choice matches the target's kind.
create table public.votes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  challenge_id uuid null references public.challenges (id) on delete cascade,
  freeze_request_id uuid null,
  voter_id uuid not null references public.profiles (id),
  choice text not null,
  cast_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint votes_one_target_check
    check (pg_catalog.num_nonnulls(challenge_id, freeze_request_id) = 1),
  constraint votes_choice_check
    check (
      (challenge_id is not null and choice in ('fake', 'real'))
      or (freeze_request_id is not null and choice in ('approve', 'deny'))
    ),
  constraint votes_challenge_voter_key unique (challenge_id, voter_id)
);

create index votes_voter_id_idx on public.votes (voter_id);
create index votes_group_id_idx on public.votes (group_id);

create trigger votes_set_updated_at
  before update on public.votes
  for each row execute function private.set_updated_at();

-- 2. Row level security: a voter reads only their own ballots, also after their membership ends;
--    no client writes (cast_vote and undo_vote are the only writers).
alter table public.votes enable row level security;

create policy votes_select_own
  on public.votes
  for select
  to authenticated
  using (voter_id = (select auth.uid()));

revoke all on table public.votes from public, anon, authenticated;
grant select on table public.votes to authenticated;

-- 3. Helpers (security definer: the answer never depends on the caller's RLS; granted to
--    authenticated because feed_items, a security-invoker view, uses them).

-- Whether p_user may vote on the challenge: a membership of its group that began at or before
-- opened_at and has not ended (a rejoined member's new membership began later), not the
-- check-in's owner, not the challenger.
create or replace function private.challenge_voter_eligible(p_challenge_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.challenges ch
    join public.memberships m
      on m.group_id = ch.group_id
     and m.user_id = p_user_id
     and m.joined_at <= ch.opened_at
     and m.ended_at is null
    where ch.id = p_challenge_id
      and p_user_id <> ch.challenger_id
      and p_user_id <> ch.subject_user_id
  );
$$;

-- The members at opened_at (joined at or before it, not ended by then) other than the challenger
-- and the owner. Zero means a group of two: the challenge was ruled at once, with no vote.
create or replace function private.challenge_others_at_open(p_challenge_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from public.challenges ch
  join public.memberships m on m.group_id = ch.group_id
  where ch.id = p_challenge_id
    and m.joined_at <= ch.opened_at
    and (m.ended_at is null or m.ended_at > ch.opened_at)
    and m.user_id <> ch.challenger_id
    and m.user_id <> ch.subject_user_id;
$$;

revoke execute on function private.challenge_voter_eligible(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.challenge_others_at_open(uuid) from public, anon, authenticated;
grant execute on function private.challenge_voter_eligible(uuid, uuid) to authenticated;
grant execute on function private.challenge_others_at_open(uuid) to authenticated;

-- 4. RPC: cast a ballot (FR-17, FR-31, AD-14, AD-17). Never closes the vote. Story 5.5 adds the
--    `freeze` kind (approve | deny) to this signature.
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
  v_now timestamptz := now();
  v_members integer;
  v_eligible integer;
  v_voted integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_kind is distinct from 'challenge' or p_choice is null or p_choice not in ('fake', 'real') then
    raise exception 'invalid_vote';
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

-- 5. RPC: take a ballot back within 6 s of casting it (AD-17). No ballot: nothing to undo (the end
--    state the caller wants already holds). Clears early_close_at, since a voter is missing again.
create or replace function public.undo_vote(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ch public.challenges;
  v_vote public.votes;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_kind is distinct from 'challenge' then
    raise exception 'invalid_vote';
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

-- 6. RPC: the group's open votes as tallies only (FR-17). eligible_count = the challenger + the
--    current eligible voters; voted_count = the challenger + their final ballots, plus the caller's
--    own ballot inside its undo window (the caller knows it already; nobody else's pending ballot
--    shows). Individual ballots never leave the database.
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
  select
    'challenge'::text,
    ch.id,
    1 + (
      select pg_catalog.count(*)::integer
      from public.votes v
      where v.challenge_id = ch.id
        and private.challenge_voter_eligible(ch.id, v.voter_id)
        and (v.cast_at + interval '6 seconds' <= now()
             or now() >= ch.closes_at
             or v.voter_id = v_uid)
    ),
    1 + (
      select pg_catalog.count(*)::integer
      from public.memberships m
      where m.group_id = ch.group_id
        and m.ended_at is null
        and private.challenge_voter_eligible(ch.id, m.user_id)
    )
  from public.challenges ch
  where ch.group_id = p_group_id
    and ch.closed_at is null
    and ch.status = 'open'
  order by ch.closes_at, ch.id;
end;
$$;

-- 7. Close one vote (AD-17), from 20261216000000_challenge_variant.sql: now counts the final
--    ballots (cast_at + 6 s <= now(), or every ballot once now() >= closes_at). Fake = the
--    challenger's implicit vote + Fake ballots, Real = Real ballots; Fake wins only when it
--    outnumbers Real (a tie keeps the check-in). Variant: `two_person` with nobody else at
--    opened_at, `lone` when no ballot was counted, else `normal`. Same signature.
create or replace function private.close_vote(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ch public.challenges;
  v_fake integer;
  v_real integer;
  v_ballots integer := 0;
  v_status text;
  v_variant text;
  v_checkin public.checkins;
  v_commitment public.commitments;
  v_activity text;
begin
  select ch.* into v_ch
  from public.challenges ch
  where ch.id = p_id
  for update;

  if v_ch.id is null or v_ch.closed_at is not null or v_ch.status = 'cancelled' then
    return;
  end if;

  select
    pg_catalog.count(*) filter (where v.choice = 'fake')::integer,
    pg_catalog.count(*) filter (where v.choice = 'real')::integer
  into v_fake, v_real
  from public.votes v
  where v.challenge_id = v_ch.id
    and (v.cast_at + interval '6 seconds' <= now() or now() >= v_ch.closes_at);

  v_ballots := v_fake + v_real;
  v_fake := 1 + v_fake;
  v_status := case when v_fake > v_real then 'fake' else 'real' end;

  v_variant := case
    when private.challenge_others_at_open(v_ch.id) = 0 then 'two_person'
    when v_ballots = 0 then 'lone'
    else 'normal'
  end;

  update public.challenges
  set status = v_status,
      fake_count = v_fake,
      real_count = v_real,
      closed_at = now()
  where id = v_ch.id;

  select c.* into v_checkin from public.checkins c where c.id = v_ch.checkin_id;
  select cm.* into v_commitment from public.commitments cm where cm.id = v_checkin.commitment_id;
  select coalesce(pa.name, ga.custom_name) into v_activity
  from public.group_activities ga
  left join public.preset_activities pa on pa.key = ga.preset_key
  where ga.id = v_commitment.group_activity_id;

  insert into public.feed_events (group_id, kind, actor_id, subject_id, payload)
  values (
    v_ch.group_id, 'ruling', v_ch.challenger_id, v_ch.subject_user_id,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_ch.id,
      'checkin_id', v_ch.checkin_id,
      'outcome', v_status,
      'fake_count', v_fake,
      'real_count', v_real,
      'variant', v_variant,
      'actor_name', (select p.display_name from public.profiles p where p.id = v_ch.challenger_id),
      'subject_name', (select p.display_name from public.profiles p where p.id = v_ch.subject_user_id),
      'commitment_id', v_commitment.id,
      'commitment_kind', v_commitment.kind,
      'activity_name', v_activity,
      'task_name', v_commitment.name
    )
  );

  if v_status = 'fake' and v_checkin.session_id is not null then
    update public.sessions s
    set miss_recorded_at = now()
    where s.id = v_checkin.session_id
      and s.ends_at <= now()
      and s.miss_recorded_at is null
      and private.session_status(s) = 'missed';
  end if;
end;
$$;

revoke execute on function private.close_vote(uuid) from public, anon, authenticated;

-- 8. AD-4: the badge criteria (from 20261215000000_challenges.sql), every section verbatim but
--    Fair Judge, which now counts the membership's final ballots. It drives both the lock-step
--    award and the pending seal (both call this function).
create or replace function private.badge_criteria_met(p_membership_id uuid, p_week_start date)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with
  week_d as (
    select t.planned - t.frozen > 0 and t.done >= t.planned - t.frozen as perfect
    from private.member_week_tally(p_membership_id, p_week_start) t
  ),
  week_before as (
    select
      t.planned - t.frozen > 0 and t.done >= t.planned - t.frozen as perfect,
      t.weekly_points
    from private.member_week_tally(p_membership_id, p_week_start - 7) t
  ),
  streaks as (
    select c.schedule_type, private.streak_through_week(c.id, p_week_start) as streak
    from public.commitments c
    where c.membership_id = p_membership_id
      and c.kind = 'commitment'
  ),
  -- Counted check-ins (they completed a session and are not removed) in weeks up to D, with the
  -- hour they were taken in the zone the member's sessions of that week were built with.
  counted as (
    select
      extract(
        hour from k.captured_at at time zone private.member_time_zone(s.user_id, s.week_start)
      ) as local_hour
    from public.sessions s
    join public.checkins k on k.session_id = s.id
    where s.membership_id = p_membership_id
      and s.week_start <= p_week_start
      and not private.checkin_removed(k.id)
  )
  -- First Proof: at least 1 check-in.
  select 'first_proof'::text
  where exists (select 1 from counted)
  union all
  -- Hat Trick: any streak at least 3.
  select 'hat_trick'
  where exists (select 1 from streaks where streak >= 3)
  union all
  -- On a Roll: any streak at least 10.
  select 'on_a_roll'
  where exists (select 1 from streaks where streak >= 10)
  union all
  -- Unbreakable: any streak at least 25.
  select 'unbreakable'
  where exists (select 1 from streaks where streak >= 25)
  union all
  -- Clean Sheet: D has non-frozen sessions and all of them are done.
  select 'clean_sheet'
  where coalesce((select w.perfect from week_d w), false)
  union all
  -- Back-to-Back: D and D-1 both perfect.
  select 'back_to_back'
  where coalesce((select w.perfect from week_d w), false)
    and coalesce((select b.perfect from week_before b), false)
  union all
  -- Monthly Machine: a times-per-week streak (target-met weeks) at least 4.
  select 'monthly_machine'
  where exists (select 1 from streaks where schedule_type = 'times_per_week' and streak >= 4)
  union all
  -- Comeback: D perfect and D-1's weekly points under 50 (a D-1 without a score does not count).
  select 'comeback'
  where coalesce((select w.perfect from week_d w), false)
    and coalesce((select b.weekly_points < 50 from week_before b), false)
  union all
  -- Dynasty: at least 3 Weekly Winner awards up to D.
  select 'dynasty'
  where (
    select pg_catalog.count(*)
    from public.badge_awards a
    where a.membership_id = p_membership_id
      and a.badge_key = 'weekly_winner'
      and a.week_start <= p_week_start
  ) >= 3
  union all
  -- Team Player (Story 4.7): the group's goal for D is hit (every member current at the lock).
  select 'team_player'
  where coalesce((
    select private.goal_week_hit(m.group_id, p_week_start)
    from public.memberships m
    where m.id = p_membership_id
  ), false)
  union all
  -- Fair Judge (Story 5.2): at least 10 final ballots by the membership (its user, in its group,
  -- cast while it lasted) in weeks up to D, i.e. before the member-local Monday after D. The
  -- challenger's implicit Fake is no ballot, so it never counts.
  select 'fair_judge'
  where (
    select pg_catalog.count(*)
    from public.memberships m
    join public.votes v
      on v.group_id = m.group_id
     and v.voter_id = m.user_id
     and v.cast_at >= m.joined_at
     and (m.ended_at is null or v.cast_at < m.ended_at)
    where m.id = p_membership_id
      and v.cast_at + interval '6 seconds' <= now()
      and v.cast_at < private.local_start(
        p_week_start + 7, private.member_time_zone(m.user_id, p_week_start)
      )
  ) >= 10
  union all
  -- Early Bird: at least 5 counted check-ins taken before 07:00.
  select 'early_bird'
  where (select pg_catalog.count(*) from counted where local_hour < 7) >= 5
  union all
  -- Night Owl: at least 5 counted check-ins taken at or after 22:00.
  select 'night_owl'
  where (select pg_catalog.count(*) from counted where local_hour >= 22) >= 5
  union all
  -- Task Slayer: at least 10 task sessions done.
  select 'task_slayer'
  where (
    select pg_catalog.count(*)
    from public.sessions s
    join public.commitments c on c.id = s.commitment_id
    where s.membership_id = p_membership_id
      and s.week_start <= p_week_start
      and c.kind = 'task'
      and private.session_status(s) = 'done'
  ) >= 10;
$$;

revoke execute on function private.badge_criteria_met(uuid, date) from public, anon, authenticated;

revoke execute on function private.badge_criteria_met(uuid, date) from public, anon, authenticated;

-- 9. The Feed's read model (from 20261216000000_challenge_variant.sql), same 28 columns, plus one
--    `challenge` row per challenge that had voters (a 2-person challenge, ruled at once, has none):
--    item_id = the challenge id, sort_at = opened_at; the challenger is the actor, the check-in's
--    owner the subject, the check-in's commitment, times and full_pruned_at fill their columns,
--    and the payload carries the check-in id, the counts once closed, the variant, the cancel
--    reason and, for the reader only, their own ballot (votes RLS) and whether they may vote.
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
    'can_vote', private.challenge_voter_eligible(ch.id, (select auth.uid()))
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
where private.challenge_others_at_open(ch.id) > 0
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
  case when e.kind in ('miss', 'ruling') then (e.payload ->> 'commitment_id')::uuid end
    as commitment_id,
  case when e.kind in ('miss', 'ruling') then coalesce(mc.kind, e.payload ->> 'commitment_kind') end
    as commitment_kind,
  case when e.kind in ('miss', 'ruling')
    then coalesce(mpa.name, mga.custom_name, e.payload ->> 'activity_name') end
    as activity_name,
  mga.preset_key,
  case when e.kind in ('miss', 'ruling') then coalesce(mc.name, e.payload ->> 'task_name') end
    as task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  e.payload,
  mm.missed as miss_count,
  null::uuid as challenge_id,
  null::text as challenge_status,
  null::timestamptz as challenge_closes_at,
  null::timestamptz as challenge_until
from public.feed_events e
left join public.profiles pa on pa.id = e.actor_id
left join public.profiles ps on ps.id = e.subject_id
left join public.commitments mc
  on e.kind in ('miss', 'ruling') and mc.id = (e.payload ->> 'commitment_id')::uuid
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

-- 10. Grants (AD-16). close_vote stays closed; cast_vote, undo_vote and vote_tallies are client RPCs.
revoke execute on function public.cast_vote(text, uuid, text) from public, anon;
revoke execute on function public.undo_vote(text, uuid) from public, anon;
revoke execute on function public.vote_tallies(uuid) from public, anon;
grant execute on function public.cast_vote(text, uuid, text) to authenticated;
grant execute on function public.undo_vote(text, uuid) to authenticated;
grant execute on function public.vote_tallies(uuid) to authenticated;
