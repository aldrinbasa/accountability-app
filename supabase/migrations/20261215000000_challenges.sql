-- Challenges (Story 5.1, FR-16, FR-17, FR-18, FR-31, AD-2, AD-3, AD-4, AD-7, AD-9, AD-10, AD-14,
-- AD-15, AD-16, AD-17).
--
-- A current member challenges another current member's check-in within 24 h of its received_at and
-- before its week locks (create_challenge). The challenge counts as one Fake vote; no ballot row is
-- written for it. private.close_vote is the only code that decides an outcome: tick step 3 calls it
-- once coalesce(early_close_at, closes_at) has passed, and create_challenge calls it at once in a
-- group of exactly 2 current members (the challenger is the only eligible voter). Story 5.2 adds
-- ballots; until then Fake (1) always beats Real (0), so every challenge is ruled Fake.
--
-- A check-in whose challenge is ruled Fake is removed (private.checkin_removed): the AD-4 functions
-- treat it as if it did not exist. session_status and counted_checkins are redefined in place to
-- skip it; weekly_points, group_ranking, current_streak, the streak walk and the lock read them, so
-- they follow with no other change. badge_criteria_met's counted check-ins skip it too. Its photo
-- objects stay (an overturn in Story 5.3 restores them) but the Storage SELECT policy denies them
-- while the ruling stands, and the Feed view hides it. Its session reads missed, or open again if it
-- has not ended, so the owner can check in again: the unique index on checkins.session_id becomes a
-- plain index (the removed row keeps its session_id for an overturn); post_checkin still matches
-- only sessions that are not done, under the commitment's row lock.
--
-- Additive only: one new table, new functions, one new tick step; session_status, counted_checkins,
-- can_read_checkin_photo, badge_criteria_met, the tick and feed_items replaced in place (the view
-- appends four columns); the feed log gains the kind `ruling`. The routines call now() unqualified on
-- purpose (pgTAP re-points their search_path at test_overrides so tests.freeze_time moves the clock).

-- 1. Table
create table public.challenges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- One challenge per check-in, ever (a cancelled one too).
  checkin_id uuid not null references public.checkins (id) on delete cascade
    constraint challenges_checkin_id_key unique,
  challenger_id uuid not null references public.profiles (id),
  subject_user_id uuid not null references public.profiles (id),
  opened_at timestamptz not null,
  -- least(opened_at + 24 h, lock_at of the check-in's week): every challenge closes before its lock.
  closes_at timestamptz not null,
  -- Set by Story 5.2 when every eligible voter has a final ballot.
  early_close_at timestamptz null,
  closed_at timestamptz null,
  status text not null default 'open'
    constraint challenges_status_check
    check (status in ('open', 'fake', 'real', 'cancelled')),
  -- Null until closed, so no tally leaks while the challenge is open.
  fake_count integer null,
  real_count integer null,
  cancel_reason text null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint challenges_closed_consistent_check
    check ((status = 'open') = (closed_at is null)),
  constraint challenges_counts_check
    check (
      (status in ('fake', 'real')) = (fake_count is not null and real_count is not null)
    )
);

-- The open challenges tick step 3 scans.
create index challenges_open_idx
  on public.challenges (closes_at)
  where closed_at is null;
create index challenges_group_id_idx on public.challenges (group_id);

create trigger challenges_set_updated_at
  before update on public.challenges
  for each row execute function private.set_updated_at();

-- 2. Row level security: current members of the group read its challenges; no client writes
--    (create_challenge and close_vote are the only writers).
alter table public.challenges enable row level security;

create policy challenges_select_member
  on public.challenges
  for select
  to authenticated
  using (private.is_member(group_id));

revoke all on table public.challenges from public, anon, authenticated;
grant select on table public.challenges to authenticated;

-- 3. A check-in may now be re-posted on a session freed by a Fake ruling (the removed row keeps its
--    session_id). One live check-in per session still holds: post_checkin serializes posts to a
--    commitment (row lock) and matches only sessions whose status is not `done`.
create index checkins_session_id_idx
  on public.checkins (session_id)
  where session_id is not null;
drop index public.checkins_one_per_session;

-- 4. Helpers. Security definer, so the answer never depends on the caller's RLS; granted to
--    authenticated because security-invoker callers (session_status, counted_checkins, feed_items)
--    use them.

-- True while the check-in's challenge is ruled Fake (Story 5.3 adds: and not overturned).
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
  );
$$;

-- The lock of the check-in's week: the owner's member-local week containing counted_at (the week
-- post_checkin used for its week_locked check), from group_weeks, else the computed Thursday 00:00.
create or replace function private.checkin_lock_at(p_checkin_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select private.week_lock_at(c.group_id, w.week_start)
  from public.checkins c
  cross join lateral private.member_current_week(c.user_id, c.counted_at) w
  where c.id = p_checkin_id;
$$;

revoke execute on function private.checkin_removed(uuid) from public, anon, authenticated;
revoke execute on function private.checkin_lock_at(uuid) from public, anon, authenticated;
grant execute on function private.checkin_removed(uuid) to authenticated;
grant execute on function private.checkin_lock_at(uuid) to authenticated;

-- 5. AD-4: the one definition of a session's status (from 20261204000000_misses.sql): a removed
--    check-in no longer completes it. Epic 5 adds `frozen` (Story 5.5).
create or replace function private.session_status(s public.sessions)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.checkins c
      where c.session_id = s.id
        and not private.checkin_removed(c.id)
    ) then 'done'
    when s.ends_at <= now() then 'missed'
    else 'open'
  end;
$$;

-- AD-4: the counted check-ins of a member week (from 20261201000000_checkins.sql), removed ones
-- left out.
create or replace function private.counted_checkins(p_membership_id uuid, p_week_start date)
returns table (commitment_id uuid, checkin_id uuid, session_id uuid, counted_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.commitment_id, c.id, c.session_id, c.counted_at
  from public.sessions s
  join public.checkins c on c.session_id = s.id
  where s.membership_id = p_membership_id
    and s.week_start = p_week_start
    and not private.checkin_removed(c.id);
$$;

revoke execute on function private.session_status(public.sessions) from public, anon, authenticated;
revoke execute on function private.counted_checkins(uuid, date) from public, anon, authenticated;
grant execute on function private.session_status(public.sessions) to authenticated;
grant execute on function private.counted_checkins(uuid, date) to authenticated;

-- 6. Storage SELECT (from 20261201000000_checkins.sql): nobody reads a removed check-in's photos
--    while the ruling stands (AD-9: hidden check-ins are denied at once), the owner included. The
--    objects are kept, so an overturn restores them.
create or replace function private.can_read_checkin_photo(p_name text, p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.group_id is not null
       and private.is_member(p.group_id)
       and not private.checkin_removed(p.checkin_id)
       and (
         p_owner_id = (select auth.uid())::text
         or exists (
           select 1
           from public.checkins c
           where c.id = p.checkin_id
             and c.group_id = p.group_id
             and private.is_current_member(c.group_id, c.user_id)
         )
       )
     from private.checkin_photo_path(p_name) p),
    false
  );
$$;

revoke execute on function private.can_read_checkin_photo(text, text) from public, anon, authenticated;
grant execute on function private.can_read_checkin_photo(text, text) to authenticated;

-- 7. AD-4: the badge criteria (from 20261212000000_group_goal.sql), every section verbatim; the
--    counted check-ins (First Proof, Early Bird, Night Owl) leave removed check-ins out.
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
  -- Fair Judge: Epic 5 (final ballots).
  select 'fair_judge'
  where false
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

-- 8. The feed log gains `ruling` (keeps every kind).
alter table public.feed_events drop constraint feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check
  check (kind in ('member_joined', 'member_left', 'member_removed', 'admin_handover', 'miss',
                  'weekly_winner', 'goal_result', 'ruling'));

-- 9. Close one vote (AD-17): the only code that decides an outcome. Locks the challenge; returns
--    without change when it is closed or cancelled. Fake = the challenger's implicit vote plus final
--    Fake ballots (none exist until Story 5.2), Real = final Real ballots; Fake wins only when it
--    outnumbers Real (a tie keeps the check-in). Stores the counts and closed_at, appends one
--    `ruling` feed event (variant `two_person` when the group had no eligible voter besides the
--    challenger, `lone` when no other ballot was counted, else `normal`), and on a Fake ruling of a
--    session that has already ended with no miss recorded, stamps miss_recorded_at without a miss
--    event (the ruling sticky reports the removal), so tick step 4 never adds a second sticky.
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
  v_eligible integer;
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

  -- Story 5.2 adds the final ballots here (and to v_ballots).
  v_fake := 1;
  v_real := 0;
  v_status := case when v_fake > v_real then 'fake' else 'real' end;

  -- Eligible voters: members at opened_at, still current, neither the challenger nor the owner.
  select pg_catalog.count(*)::integer into v_eligible
  from public.memberships m
  where m.group_id = v_ch.group_id
    and m.ended_at is null
    and m.joined_at <= v_ch.opened_at
    and m.user_id <> v_ch.challenger_id
    and m.user_id <> v_ch.subject_user_id;

  v_variant := case
    when v_eligible = 0 then 'two_person'
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

-- 10. Tick step 3: close due votes (AD-7, AD-17). Every challenge with closed_at null whose
--     coalesce(early_close_at, closes_at) has passed, oldest first, each in its own exception block.
--     Selected by time, so it catches up after a pause; closes_at <= lock_at and step 3 runs before
--     step 5, so no challenge on a week is still open when that week locks. Returns the first error
--     as text (naming the challenge), or null.
create or replace function private.tick_step_3_close_votes()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_error text;
begin
  for v_id in
    select ch.id
    from public.challenges ch
    where ch.closed_at is null
      and coalesce(ch.early_close_at, ch.closes_at) <= now()
    order by coalesce(ch.early_close_at, ch.closes_at), ch.id
  loop
    begin
      perform private.close_vote(v_id);
    exception when others then
      if v_error is null then
        v_error := 'challenge ' || v_id::text || ': ' || sqlerrm;
      end if;
    end;
  end loop;

  return v_error;
end;
$$;

-- 11. The tick (from 20261209000000_week_lock.sql) with step 3 in its slot. A failing step 3 counts
--     as a failure before the lock, like steps 1, 2 and 4.
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

  -- Step 3: close due votes. A returned error counts as a failure, like a raised one.
  begin
    v_step_error := private.tick_step_3_close_votes();
    if v_step_error is not null then
      v_failed_before_lock := true;
      v_error_step := 3;
      v_error := v_step_error;
      v_error_at := now();
    end if;
  exception when others then
    v_failed_before_lock := true;
    v_error_step := 3;
    v_error := sqlerrm;
    v_error_at := now();
  end;

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

  -- Step 5: lock due weeks. Skipped when any of steps 1 to 4 failed (AD-17).
  if not v_failed_before_lock then
    begin
      v_step_error := private.lock_due_weeks();
      if v_step_error is not null then
        v_error_step := 5;
        v_error := v_step_error;
        v_error_at := now();
      end if;
    exception when others then
      v_error_step := 5;
      v_error := sqlerrm;
      v_error_at := now();
    end;
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

-- 12. RPC: challenge a check-in (FR-16, AD-2, AD-14, AD-16, AD-17). The challenger is auth.uid().
--     Checks in order: signed in; the check-in exists and the caller is a current member of its
--     group (not_member); the group has 2+ current members (group_waiting); its owner is still a
--     current member (not_member); not the caller's own (own_checkin); no challenge yet
--     (already_challenged); now() < received_at + 24 h (challenge_expired); now() < lock_at of its
--     week (week_locked). The check-in row is locked FOR UPDATE, so two concurrent challenges never
--     both succeed (the unique key backs it up). closes_at = least(opened_at + 24 h, lock_at). With
--     exactly 2 current members the vote closes at once (ruled Fake).
create or replace function public.create_challenge(p_checkin_id uuid)
returns table (challenge_id uuid, status text, closes_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_checkin public.checkins;
  v_members integer;
  v_lock_at timestamptz;
  v_now timestamptz := now();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_checkin
  from public.checkins c
  where c.id = p_checkin_id
  for update;

  if v_checkin.id is null or not private.is_current_member(v_checkin.group_id, v_uid) then
    raise exception 'not_member';
  end if;

  select pg_catalog.count(*)::integer into v_members
  from public.memberships m
  where m.group_id = v_checkin.group_id
    and m.ended_at is null;

  if v_members < 2 then
    raise exception 'group_waiting';
  end if;

  if not private.is_current_member(v_checkin.group_id, v_checkin.user_id) then
    raise exception 'not_member';
  end if;

  if v_checkin.user_id = v_uid then
    raise exception 'own_checkin';
  end if;

  if exists (select 1 from public.challenges ch where ch.checkin_id = v_checkin.id) then
    raise exception 'already_challenged';
  end if;

  if v_now >= v_checkin.received_at + interval '24 hours' then
    raise exception 'challenge_expired';
  end if;

  v_lock_at := private.checkin_lock_at(v_checkin.id);
  if v_now >= v_lock_at then
    raise exception 'week_locked';
  end if;

  begin
    insert into public.challenges
      (group_id, checkin_id, challenger_id, subject_user_id, opened_at, closes_at)
    values
      (v_checkin.group_id, v_checkin.id, v_uid, v_checkin.user_id, v_now,
       least(v_now + interval '24 hours', v_lock_at))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_challenged';
  end;

  if v_members = 2 then
    perform private.close_vote(v_id);
  end if;

  return query
  select ch.id, ch.status, ch.closes_at
  from public.challenges ch
  where ch.id = v_id;
end;
$$;

-- 13. The Feed's read model (from 20261204000000_misses.sql), replaced with the same 24 columns in
--     order plus four: challenge_id and challenge_status (the check-in's challenge, if any),
--     challenge_closes_at (its closes_at, for the Vote chip) and challenge_until (until when the
--     check-in can be challenged: least(received_at + 24 h, lock_at); for a check-in already older
--     than 24 h the lock lookup is skipped and it is received_at + 24 h, already past). Check-ins
--     ruled Fake are hidden (private.checkin_removed). `ruling` rows fill the commitment and
--     activity columns like `miss` rows (live, else the payload).
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
  case
    when c.received_at + interval '24 hours' > now()
      then least(c.received_at + interval '24 hours', private.checkin_lock_at(c.id))
    else c.received_at + interval '24 hours'
  end as challenge_until
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

-- 14. Grants (AD-16). close_vote, step 3 and the tick stay closed; create_challenge is a client RPC.
revoke execute on function private.close_vote(uuid) from public, anon, authenticated;
revoke execute on function private.tick_step_3_close_votes() from public, anon, authenticated;
revoke execute on function private.tick() from public, anon, authenticated;
revoke execute on function public.create_challenge(uuid) from public, anon;
grant execute on function public.create_challenge(uuid) to authenticated;
