-- Admin overturn (Story 5.3, FR-19, FR-31, AD-2, AD-4, AD-5, AD-10, AD-11, AD-14, AD-15, AD-16).
--
-- The group's current admin overturns a Fake ruling the group got wrong (overturn_ruling): not their
-- own check-in, its owner still a current member, before its week's lock_at. The overturn is a row
-- in `overturns` plus one `overturn` feed event; challenges.status stays `fake` and no event is
-- deleted. private.checkin_removed returns false once an overturn exists, so the AD-4 functions
-- (session_status, counted_checkins, weekly_points, group_ranking, current_streak, the lock, the
-- Board's miss marks) and the Storage SELECT policy count and show the check-in again with no other
-- change. The miss stamp stays (the miss sticky hides once the session is no longer missed).
--
-- A re-check-in posted after the ruling plus the overturned original leave two live check-ins on
-- one session: session_status already reads `done` once; private.counted_checkins and
-- badge_criteria_met's counted check-ins now keep one per session, the earliest (counted_at, id),
-- which is the original. Both Polaroids stay on the wall; the Feed's counted_position is null on
-- the one that does not count.
--
-- The Feed never shows an `overturn` event as its own row: the ruling row's payload gains
-- overturn_until (the check-in's lock_at, Fake rulings only), can_overturn (for the reader),
-- overturned_by_id, overturned_by_name (live name, else the event's) and overturned_at; the
-- challenge (Vote card) row's payload gains overturned_by_id and overturned_by_name.
--
-- Additive only: one new table, new functions; checkin_removed, counted_checkins,
-- badge_criteria_met and feed_items replaced in place (the view keeps its 28 columns); the feed log
-- gains the kind `overturn`. The routines call now() unqualified on purpose (pgTAP re-points their
-- search_path at test_overrides so tests.freeze_time moves the clock).

-- 1. Table: one overturn per challenge, ever.
create table public.overturns (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade
    constraint overturns_challenge_id_key unique,
  admin_id uuid not null references public.profiles (id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index overturns_group_id_idx on public.overturns (group_id);

create trigger overturns_set_updated_at
  before update on public.overturns
  for each row execute function private.set_updated_at();

-- 2. Row level security: current members of the group read its overturns; no client writes
--    (overturn_ruling is the only writer).
alter table public.overturns enable row level security;

create policy overturns_select_member
  on public.overturns
  for select
  to authenticated
  using (private.is_member(group_id));

revoke all on table public.overturns from public, anon, authenticated;
grant select on table public.overturns to authenticated;

-- 3. True while the check-in's challenge is ruled Fake and not overturned (from
--    20261215000000_challenges.sql). Same signature, grants unchanged.
create or replace function private.checkin_removed(p_checkin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.challenges ch
    where ch.checkin_id = p_checkin_id
      and ch.status = 'fake'
      and not exists (select 1 from public.overturns o where o.challenge_id = ch.id)
  );
$$;

revoke execute on function private.checkin_removed(uuid) from public, anon, authenticated;
grant execute on function private.checkin_removed(uuid) to authenticated;

-- 4. AD-4: the counted check-ins of a member week (from 20261215000000_challenges.sql), removed
--    ones left out, now one per session: the earliest (counted_at, id). An overturned original and
--    a re-check-in made after the ruling count once.
create or replace function private.counted_checkins(p_membership_id uuid, p_week_start date)
returns table (commitment_id uuid, checkin_id uuid, session_id uuid, counted_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (c.session_id) c.commitment_id, c.id, c.session_id, c.counted_at
  from public.sessions s
  join public.checkins c on c.session_id = s.id
  where s.membership_id = p_membership_id
    and s.week_start = p_week_start
    and not private.checkin_removed(c.id)
  order by c.session_id, c.counted_at, c.id;
$$;

revoke execute on function private.counted_checkins(uuid, date) from public, anon, authenticated;
grant execute on function private.counted_checkins(uuid, date) to authenticated;

-- 5. AD-4: the badge criteria (from 20261217000000_votes.sql), every section verbatim but the
--    counted check-ins, which keep one per session.
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
  -- hour they were taken in the zone the member's sessions of that week were built with. One per
  -- session, the earliest (counted_at, id), as in private.counted_checkins: an overturned original
  -- and the re-check-in made after the ruling count once.
  counted as (
    select distinct on (k.session_id)
      extract(
        hour from k.captured_at at time zone private.member_time_zone(s.user_id, s.week_start)
      ) as local_hour
    from public.sessions s
    join public.checkins k on k.session_id = s.id
    where s.membership_id = p_membership_id
      and s.week_start <= p_week_start
      and not private.checkin_removed(k.id)
    order by k.session_id, k.counted_at, k.id
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

-- 6. The feed log gains `overturn` (keeps every kind).
alter table public.feed_events drop constraint feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check
  check (kind in ('member_joined', 'member_left', 'member_removed', 'admin_handover', 'miss',
                  'weekly_winner', 'goal_result', 'ruling', 'overturn'));

-- 7. Whether the reader (auth.uid()) may overturn the challenge's ruling now: they are the group's
--    current admin, the ruling is Fake and not overturned, the check-in's owner is a current member
--    and not the reader, and now() < lock_at of the check-in's week. Security definer (the answer
--    never depends on the reader's RLS); granted to authenticated for the feed_items view. A
--    function, so pgTAP can move its clock.
create or replace function private.ruling_can_overturn(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.is_admin(ch.group_id)
      and ch.subject_user_id <> (select auth.uid())
      and private.is_current_member(ch.group_id, ch.subject_user_id)
      and not exists (select 1 from public.overturns o where o.challenge_id = ch.id)
      and now() < private.checkin_lock_at(ch.checkin_id)
    from public.challenges ch
    where ch.id = p_challenge_id
      and ch.status = 'fake'
  ), false);
$$;

revoke execute on function private.ruling_can_overturn(uuid) from public, anon, authenticated;
grant execute on function private.ruling_can_overturn(uuid) to authenticated;

-- 8. RPC: overturn a Fake ruling (FR-19, AD-2, AD-14, AD-16). The admin is auth.uid(). Checks in
--    order: signed in; lock the challenge FOR UPDATE; it exists and the caller is a current member
--    of its group (not_member); the caller is the current admin (not_admin); it is ruled Fake
--    (not_fake_ruling: Real, open or cancelled); no overturn yet (already_overturned); not the
--    caller's own check-in (own_checkin, also in a group of two); its owner is still a current
--    member (not_member); now() < lock_at of the check-in's week (week_locked). Inserts the
--    overturn (a unique violation reads already_overturned) and one `overturn` feed event in the
--    same transaction. challenges.status stays `fake`. Freeze denials have no overturn.
create or replace function public.overturn_ruling(p_challenge_id uuid)
returns table (overturn_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_ch public.challenges;
  v_checkin public.checkins;
  v_now timestamptz := now();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select ch.* into v_ch
  from public.challenges ch
  where ch.id = p_challenge_id
  for update;

  if v_ch.id is null or not private.is_current_member(v_ch.group_id, v_uid) then
    raise exception 'not_member';
  end if;

  if not private.is_admin(v_ch.group_id) then
    raise exception 'not_admin';
  end if;

  if v_ch.status <> 'fake' then
    raise exception 'not_fake_ruling';
  end if;

  if exists (select 1 from public.overturns o where o.challenge_id = v_ch.id) then
    raise exception 'already_overturned';
  end if;

  if v_ch.subject_user_id = v_uid then
    raise exception 'own_checkin';
  end if;

  if not private.is_current_member(v_ch.group_id, v_ch.subject_user_id) then
    raise exception 'not_member';
  end if;

  if v_now >= private.checkin_lock_at(v_ch.checkin_id) then
    raise exception 'week_locked';
  end if;

  begin
    insert into public.overturns (group_id, challenge_id, admin_id, created_at, updated_at)
    values (v_ch.group_id, v_ch.id, v_uid, v_now, v_now)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_overturned';
  end;

  select c.* into v_checkin from public.checkins c where c.id = v_ch.checkin_id;

  insert into public.feed_events (group_id, kind, actor_id, subject_id, payload, created_at, updated_at)
  values (
    v_ch.group_id, 'overturn', v_uid, v_ch.subject_user_id,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_ch.id,
      'checkin_id', v_ch.checkin_id,
      'actor_name', (select p.display_name from public.profiles p where p.id = v_uid),
      'subject_name', (select p.display_name from public.profiles p where p.id = v_ch.subject_user_id),
      'commitment_id', v_checkin.commitment_id
    ),
    v_now, v_now
  );

  return query select v_id, v_now;
end;
$$;

-- 9. The Feed's read model (from 20261217000000_votes.sql), same 28 columns. A check-in that is
--    not one of the counted check-ins (a re-check-in on a session whose overturned original counts)
--    has a null counted_position. The challenge row's payload gains overturned_by_id and
--    overturned_by_name. `overturn` events are never a row of their own: the ruling row's payload
--    gains overturn_until, can_overturn, overturned_by_id, overturned_by_name and overturned_at.
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
  case when e.kind = 'ruling' then e.payload || pg_catalog.jsonb_build_object(
    'overturn_until', case when e.payload ->> 'outcome' = 'fake'
      then private.checkin_lock_at((e.payload ->> 'checkin_id')::uuid) end,
    'can_overturn', private.ruling_can_overturn((e.payload ->> 'challenge_id')::uuid),
    'overturned_by_id', ov.admin_id,
    'overturned_by_name', case when ov.id is not null
      then coalesce(pov.display_name, oe.payload ->> 'actor_name') end,
    'overturned_at', ov.created_at
  ) else e.payload end as payload,
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

-- 10. Grants (AD-16). overturn_ruling is a client RPC.
revoke execute on function public.overturn_ruling(uuid) from public, anon;
grant execute on function public.overturn_ruling(uuid) to authenticated;
