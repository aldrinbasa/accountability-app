-- Freeze votes and outcomes (Story 5.5): the votes foreign key and unique ballot per request, the
-- eligibility helpers, cast_vote / undo_vote with kind `freeze` (invalid choice, not_member,
-- not_eligible for the requester and a member who joined after opened_at, already_voted, the 6 s
-- undo edges, all-voted early close and its undo, vote_closed at closes_at and after a close,
-- group_waiting), vote_tallies for freeze requests (the caller's pending ballot, final ballots,
-- eligible = current eligible voters, a leaver dropped), close outcomes (majority Deny denies, a tie
-- and no ballot approve, majority Approve approves), feed_items `freeze` rows (columns and payload,
-- the reader's ballot and can_vote, two_person, last week, solo and withdrawn left out) and the
-- enriched `freeze_result` rows, the lowered targets (get_today_items, get_today_summary,
-- checkin_counts, the check-in row's target), Fair Judge's description, the grants per role
-- (AD-16), a last-week request closing at lock_at through the full tick (approved before the lock
-- step, stored as frozen, the week's score lowered, ballots refused at and after the lock), a voted
-- approval removing a recorded miss and restoring the streak, a silent two-person request approved
-- at closes_at, and a withdrawn request never closed. Pack (gina, hank, jill) and Pair (kim, lee)
-- serve the last four.
--
-- Cast: alice creates "Crew" (Europe/London, admin) with bob, carol, dan and ivy (ivy's membership
-- starts Tue 17 Nov 10:01, after every request but R7). erin creates "Duo" with fay. sam creates
-- "Solo" alone. harry is in no group. Other memberships are back-dated to 1 Oct. Week A is Mon 9
-- to Sun 15 Nov 2026 (locks Thu 19 Nov 00:00), week B Mon 16 to Sun 22 Nov; London = UTC in
-- November. bob has Study every day and Gym 3 times a week from week A, erin Walk every day and sam
-- Run every day from week B. Plans, check-ins and miss stamps are written directly as the table
-- owner. The routines under test call now() unqualified; their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock.
begin;
set local timezone = 'UTC';
select plan(126);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dan');
select tests.create_supabase_user('ivy');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('fay');
select tests.create_supabase_user('sam');
select tests.create_supabase_user('harry');
select tests.create_supabase_user('gina');
select tests.create_supabase_user('hank');
select tests.create_supabase_user('jill');
select tests.create_supabase_user('kim');
select tests.create_supabase_user('lee');

-- ===== Shape =====
select ok(
  (select pg_catalog.pg_get_constraintdef(c.oid) like '%FOREIGN KEY (freeze_request_id) REFERENCES %freeze_requests(id) ON DELETE CASCADE%'
   from pg_catalog.pg_constraint c
   where c.conname = 'votes_freeze_request_id_fkey' and c.conrelid = 'public.votes'::regclass),
  'votes.freeze_request_id references freeze_requests (cascade)'
);
select ok(
  (select c.contype = 'u' and pg_catalog.pg_get_constraintdef(c.oid) = 'UNIQUE (freeze_request_id, voter_id)'
   from pg_catalog.pg_constraint c
   where c.conname = 'votes_freeze_request_voter_key' and c.conrelid = 'public.votes'::regclass),
  'one ballot per voter per freeze request'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.cast_vote(text, uuid, text)'::regprocedure,
                   'public.undo_vote(text, uuid)'::regprocedure,
                   'public.vote_tallies(uuid)'::regprocedure,
                   'public.get_today_items(uuid)'::regprocedure,
                   'public.get_today_summary(uuid)'::regprocedure,
                   'private.checkin_counts(uuid, date)'::regprocedure,
                   'private.freeze_voter_eligible(uuid, uuid)'::regprocedure,
                   'private.freeze_others_at_open(uuid)'::regprocedure)),
  'the new and redefined functions have an empty search_path'
);
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('public.cast_vote(text, uuid, text)'::regprocedure,
                   'public.undo_vote(text, uuid)'::regprocedure,
                   'public.vote_tallies(uuid)'::regprocedure,
                   'private.freeze_voter_eligible(uuid, uuid)'::regprocedure,
                   'private.freeze_others_at_open(uuid)'::regprocedure))
  and not (select bool_or(p.prosecdef) from pg_catalog.pg_proc p
           where p.oid in ('public.get_today_items(uuid)'::regprocedure,
                           'public.get_today_summary(uuid)'::regprocedure)),
  'the vote RPCs and helpers are security definer; the Today RPCs stay security invoker'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'from public.freeze_requests f
    where f.id = p_id
    for update') > 0
   from pg_catalog.pg_proc p where p.oid = 'public.cast_vote(text, uuid, text)'::regprocedure),
  'cast_vote locks the freeze request for update'
);
select is(
  (select b.how_earned || '|' || b.icon from public.badges b where b.key = 'fair_judge'),
  'Voted 10 times on check-ins or freezes|gavel',
  'Fair Judge''s description names check-ins and freezes; its icon stays'
);
select is(
  (select pg_catalog.count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'feed_items'),
  28,
  'feed_items keeps its 28 columns'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.cast_vote(text, uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.undo_vote(text, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.vote_tallies(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.cast_vote(text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.undo_vote(text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.vote_tallies(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.cast_vote(text, uuid, text)', 'EXECUTE'),
  'cast_vote, undo_vote, vote_tallies: authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'private.freeze_voter_eligible(uuid, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.freeze_others_at_open(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.freeze_voter_eligible(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.freeze_others_at_open(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.checkin_counts(uuid, date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.close_vote(uuid)', 'EXECUTE'),
  'the freeze helpers serve feed_items to authenticated; checkin_counts and close_vote stay closed'
);
select ok(
  has_function_privilege('authenticated', 'public.get_today_items(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_today_summary(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_today_items(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_today_summary(uuid)', 'EXECUTE'),
  'get_today_items, get_today_summary: authenticated only'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('dan');
select public.save_profile('Dan', 'Europe/London');
select tests.authenticate_as('ivy');
select public.save_profile('Ivy', 'Europe/London');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'Europe/London');
select tests.authenticate_as('fay');
select public.save_profile('Fay', 'Europe/London');
select tests.authenticate_as('sam');
select public.save_profile('Sam', 'UTC');
select tests.authenticate_as('harry');
select public.save_profile('Harry', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dan');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('ivy');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('erin');
select pg_catalog.set_config('test.g3', public.create_group('Duo')::text, true);
select pg_catalog.set_config('test.code3', (select code from public.create_invite(current_setting('test.g3')::uuid, false)), true);
select tests.authenticate_as('fay');
select public.join_group(current_setting('test.code3'));
select tests.authenticate_as('sam');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);
select tests.authenticate_as('gina');
select public.save_profile('Gina', 'Europe/London');
select tests.authenticate_as('hank');
select public.save_profile('Hank', 'Europe/London');
select tests.authenticate_as('jill');
select public.save_profile('Jill', 'Europe/London');
select tests.authenticate_as('kim');
select public.save_profile('Kim', 'Europe/London');
select tests.authenticate_as('lee');
select public.save_profile('Lee', 'Europe/London');
select tests.authenticate_as('gina');
select pg_catalog.set_config('test.g4', public.create_group('Pack')::text, true);
select pg_catalog.set_config('test.code4', (select code from public.create_invite(current_setting('test.g4')::uuid, false)), true);
select tests.authenticate_as('hank');
select public.join_group(current_setting('test.code4'));
select tests.authenticate_as('jill');
select public.join_group(current_setting('test.code4'));
select tests.authenticate_as('kim');
select pg_catalog.set_config('test.g5', public.create_group('Pair')::text, true);
select pg_catalog.set_config('test.code5', (select code from public.create_invite(current_setting('test.g5')::uuid, false)), true);
select tests.authenticate_as('lee');
select public.join_group(current_setting('test.code5'));

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';
update public.memberships set joined_at = '2026-11-17 10:01:00+00'
where user_id = tests.get_supabase_uid('ivy');

alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.request_freeze(uuid, text, uuid, date) set search_path = test_overrides, pg_catalog;
alter function public.cast_vote(text, uuid, text) set search_path = test_overrides, pg_catalog;
alter function public.undo_vote(text, uuid) set search_path = test_overrides, pg_catalog;
alter function public.vote_tallies(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_today_items(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_today_summary(uuid) set search_path = test_overrides, pg_catalog;
alter function private.checkin_counts(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_3_close_votes() set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.tick() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_4_misses() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_8_heartbeat(smallint, text, timestamptz) set search_path = test_overrides, pg_catalog;
alter function private.lock_week(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.lock_due_weeks() set search_path = test_overrides, pg_catalog;
alter function private.badge_criteria_met(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.checkin_challenge_until(uuid, timestamptz) set search_path = test_overrides, pg_catalog;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

-- A commitment with one version (fixed days when p_days is set, else times per week with
-- p_target), written directly. p_group is a setting name.
create function pg_temp.add_plan(p_user text, p_group text, p_preset text, p_days smallint[],
                                 p_target smallint, p_first date)
returns uuid
language plpgsql
as $$
declare
  v_uid uuid := tests.get_supabase_uid(p_user);
  v_group uuid := current_setting('test.' || p_group)::uuid;
  v_activity uuid;
  v_membership uuid;
  v_id uuid;
begin
  insert into public.group_activities (group_id, preset_key, created_by)
  values (v_group, p_preset, v_uid)
  on conflict do nothing;
  select ga.id into v_activity from public.group_activities ga
  where ga.group_id = v_group and ga.preset_key = p_preset;
  select m.id into v_membership from public.memberships m
  where m.group_id = v_group and m.user_id = v_uid and m.ended_at is null;
  insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
  values (v_group, v_membership, v_uid, 'commitment', v_activity,
          case when p_days is null then 'times_per_week' else 'fixed_days' end)
  returning id into v_id;
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values (v_id, v_group, p_first, p_days, p_target);
  return v_id;
end;
$$;

-- The session id of a commitment (setting name) in a week, by slot.
create function pg_temp.sid(p_commitment text, p_week date, p_slot integer)
returns uuid
language sql
security definer
as $$
  select s.id from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = p_week and s.slot = p_slot;
$$;

-- The status of that session (private.session_status, as the table owner).
create function pg_temp.st(p_commitment text, p_week date, p_slot integer)
returns text
language sql
security definer
as $$
  select private.session_status(s) from public.sessions s
  where s.id = pg_temp.sid(p_commitment, p_week, p_slot);
$$;

-- A freeze request (setting name): status, early_close_at (or '-').
create function pg_temp.fr(p_request text)
returns text
language sql
security definer
as $$
  select f.status || '|' || coalesce(f.early_close_at::text, '-') from public.freeze_requests f
  where f.id = current_setting('test.' || p_request)::uuid;
$$;

-- The caller's tally for a freeze request (setting name): voted/eligible, or 'none'.
create function pg_temp.tally(p_group text, p_request text)
returns text
language sql
as $$
  select coalesce(
    (select t.voted_count || '/' || t.eligible_count
     from public.vote_tallies(current_setting('test.' || p_group)::uuid) t
     where t.target_kind = 'freeze' and t.target_id = current_setting('test.' || p_request)::uuid),
    'none');
$$;

-- The caller's feed_items payload for a freeze request (setting name).
create function pg_temp.fp(p_request text)
returns jsonb
language sql
as $$
  select f.payload from public.feed_items f
  where f.item_kind = 'freeze' and f.item_id = current_setting('test.' || p_request)::uuid;
$$;

-- The freeze_result row's payload for a freeze request (setting name).
create function pg_temp.rp(p_request text)
returns jsonb
language sql
as $$
  select f.payload from public.feed_items f
  where f.item_kind = 'freeze_result'
    and f.payload ->> 'freeze_request_id' = current_setting('test.' || p_request);
$$;

grant execute on function pg_temp.sid(text, date, integer), pg_temp.st(text, date, integer),
  pg_temp.fr(text), pg_temp.tally(text, text), pg_temp.fp(text), pg_temp.rp(text) to authenticated;

select pg_catalog.set_config('test.study', pg_temp.add_plan('bob', 'g1', 'study', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-09')::text, true);
select pg_catalog.set_config('test.gym', pg_temp.add_plan('bob', 'g1', 'gym', null, 3::smallint, '2026-11-09')::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('erin', 'g3', 'walk', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.run', pg_temp.add_plan('sam', 'g2', 'run', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.ggym', pg_temp.add_plan('gina', 'g4', 'gym', null, 2::smallint, '2026-11-09')::text, true);
select pg_catalog.set_config('test.gstudy', pg_temp.add_plan('gina', 'g4', 'study', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.kwalk', pg_temp.add_plan('kim', 'g5', 'walk', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-16')::text, true);

select tests.freeze_time('2026-11-09 00:30:00+00');
select private.tick_step_1_sessions();
select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

-- Week A's Gym rows had no check-in: their misses were stamped Mon 16 Nov 00:10.
update public.sessions set miss_recorded_at = '2026-11-16 00:10:00+00'
where commitment_id = current_setting('test.gym')::uuid and week_start = '2026-11-09';

-- ===== Mon 16 Nov 09:00: bob's requests =====
-- R1 Study Mon, R2 Gym this week, R3 Gym last week.
select tests.freeze_time('2026-11-16 09:00:00+00');
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.r1', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.study')::uuid, 'flu, in bed', pg_temp.sid('study', '2026-11-16', 1), null) r)::text, true);
select pg_catalog.set_config('test.r2', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.gym')::uuid, 'knee', null, '2026-11-16') r)::text, true);
select pg_catalog.set_config('test.r3', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.gym')::uuid, 'away', null, '2026-11-09') r)::text, true);
select is(pg_temp.fr('r1') || ',' || pg_temp.fr('r2') || ',' || pg_temp.fr('r3'),
  'pending|-,pending|-,pending|-', 'three pending requests');

-- ===== feed_items: the freeze row =====
select tests.authenticate_as('alice');
select is(
  (select f.group_id::text || '|' || f.sort_at::text || '|' || (f.actor_id = tests.get_supabase_uid('bob'))::text
          || '|' || f.actor_name || '|' || (f.commitment_id::text = current_setting('test.study'))::text
          || '|' || f.commitment_kind || '|' || f.activity_name || '|' || f.preset_key || '|'
          || coalesce(f.task_name, '-') || '|'
          || (f.subject_id is null and f.subject_name is null and f.captured_at is null
              and f.received_at is null and f.is_late is null and f.is_extra is null
              and f.caption is null and f.full_pruned_at is null and f.counted_position is null
              and f.target is null and f.miss_count is null and f.challenge_id is null
              and f.challenge_status is null and f.challenge_closes_at is null
              and f.challenge_until is null)::text
   from public.feed_items f
   where f.item_kind = 'freeze' and f.item_id = current_setting('test.r1')::uuid),
  current_setting('test.g1') || '|2026-11-16 09:00:00+00|true|Bob|true|commitment|Study|study|-|true',
  'freeze row: item_id = the request, sort_at = opened_at, the requester as actor, the commitment, other columns null'
);
select is(
  (select (p ->> 'status') || '|' || (p ->> 'reason') || '|'
          || ((p ->> 'closes_at')::timestamptz = '2026-11-17 09:00:00+00')::text || '|'
          || (p ->> 'schedule_type') || '|' || (p ->> 'session_day') || '|' || (p ->> 'week_start') || '|'
          || (p ->> 'which') || '|' || (p ->> 'week_target') || '|' || (p ->> 'two_person') || '|'
          || coalesce(p ->> 'cancel_reason', '-') || '|' || coalesce(p ->> 'my_choice', '-') || '|'
          || coalesce(p ->> 'my_cast_at', '-') || '|' || (p ->> 'can_vote')
   from pg_temp.fp('r1') p),
  'pending|flu, in bed|true|fixed_days|2026-11-16|2026-11-16|this|7|false|-|-|-|true',
  'freeze row payload: status, reason, closes_at, schedule type, day, week, which, week target, two_person, the reader''s ballot and can_vote'
);
select is(
  (select coalesce(p ->> 'session_day', '-') || '|' || (p ->> 'schedule_type') || '|' || (p ->> 'which')
          || '|' || (p ->> 'week_target')
   from pg_temp.fp('r2') p),
  '-|times_per_week|this|3',
  'times per week this week: no day, which this, the week''s target'
);
select is(
  (select (p ->> 'which') || '|' || (p ->> 'week_start') from pg_temp.fp('r3') p),
  'last|2026-11-09',
  'times per week last week: which last'
);
select tests.authenticate_as('bob');
select is((pg_temp.fp('r1') ->> 'can_vote'), 'false', 'the requester sees can_vote false');
select tests.authenticate_as('harry');
select is((select pg_catalog.count(*)::integer from public.feed_items f where f.item_kind = 'freeze'), 0,
  'RLS: a non-member sees no freeze row');

-- ===== cast_vote refusals =====
select tests.freeze_time('2026-11-16 10:00:00+00');
select tests.authenticate_as('alice');
select is(pg_temp.tally('g1', 'r1'), '0/3', 'tallies: nobody voted yet, three eligible (not the requester, not ivy)');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''fake'')', current_setting('test.r1')),
  'P0001', 'invalid_vote', 'freeze with a challenge choice: invalid_vote');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''approve'')', current_setting('test.r1')),
  'P0001', 'invalid_vote', 'challenge with a freeze choice: invalid_vote');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, null)', current_setting('test.r1')),
  'P0001', 'invalid_vote', 'no choice: invalid_vote');
select throws_ok(format('select * from public.undo_vote(''other'', %L)', current_setting('test.r1')),
  'P0001', 'invalid_vote', 'undo with an unknown kind: invalid_vote');
select throws_ok('select * from public.cast_vote(''freeze'', ''00000000-0000-4000-a000-000000000000'', ''approve'')',
  'P0001', 'not_member', 'no such freeze request: not_member');
select tests.authenticate_as('harry');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r1')),
  'P0001', 'not_member', 'a non-member: not_member');
select tests.authenticate_as('bob');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r1')),
  'P0001', 'not_eligible', 'the requester: not_eligible');

-- ===== R1: votes, Undo edges, all voted, majority Deny =====
select tests.authenticate_as('alice');
select is(
  (select v.cast_at from public.cast_vote('freeze', current_setting('test.r1')::uuid, 'approve') v),
  '2026-11-16 10:00:00+00'::timestamptz,
  'alice approves: cast_at = now()'
);
select is(pg_temp.tally('g1', 'r1'), '1/3', 'tallies: the caller''s own pending ballot counts for them');
select is(
  (select (p ->> 'my_choice') || '|' || ((p ->> 'my_cast_at')::timestamptz = '2026-11-16 10:00:00+00')::text
   from pg_temp.fp('r1') p),
  'approve|true',
  'freeze row payload: the reader''s own ballot'
);
select is(
  (select v.choice || '|' || (v.challenge_id is null)::text from public.votes v
   where v.freeze_request_id = current_setting('test.r1')::uuid),
  'approve|true',
  'votes RLS: alice reads her ballot on the request'
);
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r1')),
  'P0001', 'already_voted', 'a second ballot: already_voted');
select tests.authenticate_as('carol');
select is(pg_temp.tally('g1', 'r1'), '0/3', 'tallies: someone else''s ballot inside its undo window does not show');
select is(coalesce(pg_temp.fp('r1') ->> 'my_choice', '-'), '-', 'carol''s row carries no ballot of hers');
select is((select pg_catalog.count(*)::integer from public.votes v
           where v.freeze_request_id = current_setting('test.r1')::uuid), 0,
  'votes RLS: carol cannot read alice''s ballot');
select tests.freeze_time('2026-11-16 10:00:06+00');
select is(pg_temp.tally('g1', 'r1'), '1/3', 'tallies: a ballot 6 s old is final and shows to everyone');

select tests.freeze_time('2026-11-16 10:00:05.9+00');
select tests.authenticate_as('alice');
select lives_ok(format('select public.undo_vote(''freeze'', %L)', current_setting('test.r1')),
  'undo 5.9 s after casting');
select is(pg_temp.tally('g1', 'r1'), '0/3', 'the ballot is gone');
select lives_ok(format('select public.undo_vote(''freeze'', %L)', current_setting('test.r1')),
  'undo with no ballot: nothing to do');
select tests.freeze_time('2026-11-16 10:00:10+00');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r1')),
  'alice approves again');
select tests.freeze_time('2026-11-16 10:00:16+00');
select throws_ok(format('select public.undo_vote(''freeze'', %L)', current_setting('test.r1')),
  'P0001', 'undo_expired', 'undo at cast_at + 6 s: undo_expired');

select tests.freeze_time('2026-11-16 10:01:00+00');
select tests.authenticate_as('carol');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r1')),
  'carol denies');
select is(pg_temp.fr('r1'), 'pending|-', 'two of three voted: no early close');
select tests.freeze_time('2026-11-16 10:02:00+00');
select tests.authenticate_as('dan');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r1')),
  'dan denies');
select is(pg_temp.fr('r1'), 'pending|2026-11-16 10:02:06+00', 'all voted: early_close_at = the last cast_at + 6 s');
select tests.freeze_time('2026-11-16 10:02:03+00');
select lives_ok(format('select public.undo_vote(''freeze'', %L)', current_setting('test.r1')),
  'dan takes it back');
select is(pg_temp.fr('r1'), 'pending|-', 'the undo clears early_close_at');
select tests.freeze_time('2026-11-16 10:02:04+00');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r1')),
  'dan denies again');
select is(pg_temp.fr('r1'), 'pending|2026-11-16 10:02:10+00', 'all voted again: early_close_at moves');

reset role;
select tests.freeze_time('2026-11-16 10:02:09+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs');
select is(pg_temp.fr('r1'), 'pending|2026-11-16 10:02:10+00', 'one second before early_close_at: still pending');
select tests.freeze_time('2026-11-16 10:02:10+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs at early_close_at');
select is(split_part(pg_temp.fr('r1'), '|', 1), 'denied', 'majority Deny (1 approve, 2 deny): denied');
select is(pg_temp.st('study', '2026-11-16', 1), 'open', 'a denied freeze leaves the session as it was');

select tests.authenticate_as('alice');
select is(
  (select (p ->> 'outcome') || '|' || (p ->> 'approve_count') || '|' || (p ->> 'deny_count') || '|'
          || (p ->> 'which') || '|' || (p ->> 'week_target')
   from pg_temp.rp('r1') p),
  'denied|1|2|this|7',
  'freeze_result row: outcome, counts, which and the week''s target'
);
select is(
  (select (f.commitment_id::text = current_setting('test.study'))::text || '|' || f.commitment_kind || '|'
          || f.activity_name || '|' || f.preset_key || '|' || f.actor_name
   from public.feed_items f
   where f.item_kind = 'freeze_result' and f.payload ->> 'freeze_request_id' = current_setting('test.r1')),
  'true|commitment|Study|study|Bob',
  'freeze_result row: the commitment columns are filled'
);
select is(pg_temp.fp('r1') ->> 'status', 'denied', 'the freeze row reads denied');
select is(pg_temp.tally('g1', 'r1'), 'none', 'tallies: a closed request is not listed');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r1')),
  'P0001', 'vote_closed', 'cast on a closed request: vote_closed');
select throws_ok(format('select public.undo_vote(''freeze'', %L)', current_setting('test.r1')),
  'P0001', 'vote_closed', 'undo on a closed request: vote_closed');

-- ===== R2 / R3: majority Approve, no ballot, vote_closed at closes_at =====
select tests.freeze_time('2026-11-16 11:00:00+00');
select tests.authenticate_as('alice');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r2')),
  'alice approves R2');
select tests.authenticate_as('carol');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r2')),
  'carol approves R2');
select is(
  (select pg_catalog.string_agg(t.target_kind || ':' || t.voted_count || '/' || t.eligible_count, ','
                                order by t.target_kind, t.voted_count)
   from public.vote_tallies(current_setting('test.g1')::uuid) t),
  'freeze:0/3,freeze:1/3',
  'tallies list every pending request (R2 with carol''s own ballot, R3 with none)'
);
select tests.freeze_time('2026-11-17 09:00:00+00');
select tests.authenticate_as('dan');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r2')),
  'P0001', 'vote_closed', 'at closes_at, before the tick: vote_closed');
reset role;
select is(private.tick_step_3_close_votes(), null, 'tick step 3 closes R2 and R3 at closes_at');
select is(split_part(pg_temp.fr('r2'), '|', 1) || ',' || split_part(pg_temp.fr('r3'), '|', 1),
  'approved,approved', 'majority Approve approves; no ballot approves');
select is(pg_temp.st('gym', '2026-11-16', 3), 'frozen', 'R2 froze the highest free Gym row');

select tests.authenticate_as('alice');
select is(
  (select (p ->> 'outcome') || '|' || (p ->> 'approve_count') || '|' || (p ->> 'deny_count') || '|'
          || (p ->> 'which') || '|' || (p ->> 'week_target')
   from pg_temp.rp('r2') p),
  'approved|2|0|this|2',
  'R2 freeze_result: approved 2-0, this week, the target is now 2'
);
select is(
  (select (p ->> 'outcome') || '|' || (p ->> 'which') || '|' || (p ->> 'week_target') || '|' || (p ->> 'miss_removed')
   from pg_temp.rp('r3') p),
  'approved|last|2|true',
  'R3 freeze_result: approved, last week, its target now 2, the miss removed'
);
select is(
  (select (p ->> 'status') || '|' || (p ->> 'week_target') from pg_temp.fp('r2') p),
  'approved|2',
  'the freeze row reads approved with the lowered target'
);

-- ===== Lowered targets =====
reset role;
insert into public.checkins
  (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
values ('00000000-0000-4000-a000-0000000055b1', current_setting('test.g1')::uuid,
        tests.get_supabase_uid('bob'), current_setting('test.gym')::uuid,
        pg_temp.sid('gym', '2026-11-16', 1), '2026-11-17 08:00:00+00', '2026-11-17 08:00:00+00',
        '2026-11-17 08:00:00+00', false);
select is(
  (select x.done_count || '/' || x.target
   from private.checkin_counts(current_setting('test.gym')::uuid, '2026-11-16') x),
  '1/2',
  'checkin_counts (post_checkin''s target): 1 done of 2'
);
select tests.freeze_time('2026-11-17 10:00:00+00');
select tests.authenticate_as('bob');
select is(
  (select i.target || '|' || i.done_count || '|' || i.target_met::text
   from public.get_today_items(current_setting('test.g1')::uuid) i
   where i.commitment_id = current_setting('test.gym')::uuid),
  '2|1|false',
  'get_today_items: Gym 3 a week with one frozen reads 1 of 2'
);
select is(
  (select i.target::text
   from public.get_today_items(current_setting('test.g1')::uuid) i
   where i.commitment_id = current_setting('test.study')::uuid),
  '7',
  'get_today_items: Study (its freeze denied) keeps 7'
);
select is(
  (select s.planned || '|' || s.done from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '9|1',
  'get_today_summary: planned 10 sessions minus 1 frozen'
);
select tests.authenticate_as('alice');
select is(
  (select f.target from public.feed_items f
   where f.item_kind = 'checkin' and f.item_id = '00000000-0000-4000-a000-0000000055b1'),
  2,
  'feed check-in row: the target leaves out the frozen row'
);

-- ===== R4: a tie approves; a later joiner is not eligible; a leaver drops from the tally =====
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.r4', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.study')::uuid, 'exam', pg_temp.sid('study', '2026-11-16', 3), null) r)::text, true);
select tests.freeze_time('2026-11-17 10:05:00+00');
select tests.authenticate_as('alice');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r4')),
  'alice approves R4');
select tests.authenticate_as('carol');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r4')),
  'carol denies R4');
select tests.authenticate_as('ivy');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r4')),
  'P0001', 'not_eligible', 'a member who joined after opened_at: not_eligible');
select is(pg_temp.fp('r4') ->> 'can_vote', 'false', 'the later joiner''s row: can_vote false');
select tests.freeze_time('2026-11-17 10:06:00+00');
select is(pg_temp.tally('g1', 'r4'), '2/3', 'tallies: two final ballots of three eligible');
reset role;
update public.memberships set ended_at = '2026-11-17 10:06:00+00', end_reason = 'left'
where user_id = tests.get_supabase_uid('dan') and group_id = current_setting('test.g1')::uuid;
select tests.authenticate_as('alice');
select is(pg_temp.tally('g1', 'r4'), '2/2', 'tallies: a leaver is no longer eligible');
reset role;
select tests.freeze_time('2026-11-18 10:00:00+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 closes R4');
select is(split_part(pg_temp.fr('r4'), '|', 1), 'approved', 'a tie (1-1) approves');
select is(pg_temp.st('study', '2026-11-16', 3), 'frozen', 'the tied request froze Wednesday');
select tests.authenticate_as('bob');
select is(
  (select i.target::text
   from public.get_today_items(current_setting('test.g1')::uuid) i
   where i.commitment_id = current_setting('test.study')::uuid),
  '6',
  'get_today_items: Study with Wednesday frozen reads a target of 6'
);

-- ===== Withdrawn requests stay out of the Feed =====
select pg_catalog.set_config('test.r7', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.study')::uuid, 'busy', pg_temp.sid('study', '2026-11-16', 4), null) r)::text, true);
reset role;
update public.freeze_requests set status = 'withdrawn', closed_at = '2026-11-18 10:00:00+00'
where id = current_setting('test.r7')::uuid;
select tests.authenticate_as('alice');
select is((select pg_catalog.count(*)::integer from public.feed_items f
           where f.item_kind = 'freeze' and f.item_id = current_setting('test.r7')::uuid), 0,
  'a withdrawn request has no freeze row');

-- ===== Duo: the other member decides; two_person =====
select tests.freeze_time('2026-11-16 12:00:00+00');
select tests.authenticate_as('erin');
select pg_catalog.set_config('test.r5', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.walk')::uuid, 'sick', pg_temp.sid('walk', '2026-11-16', 1), null) r)::text, true);
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r5')),
  'P0001', 'not_eligible', 'Duo: the requester cannot vote');
select tests.authenticate_as('fay');
select is(
  (select (p ->> 'two_person') || '|' || (p ->> 'can_vote') from pg_temp.fp('r5') p),
  'true|true',
  'Duo: the freeze row is two_person and fay may vote'
);
select is(pg_temp.tally('g3', 'r5'), '0/1', 'Duo tallies: one eligible voter');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r5')),
  'fay denies');
select is(pg_temp.fr('r5'), 'pending|2026-11-16 12:00:06+00', 'Duo: the only voter voted, early close after 6 s');
reset role;
select tests.freeze_time('2026-11-16 12:00:06+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 closes R5');
select is(split_part(pg_temp.fr('r5'), '|', 1), 'denied', 'Duo: fay''s Deny denies');

-- group_waiting: fay leaves while erin's next request is open.
select tests.authenticate_as('erin');
select pg_catalog.set_config('test.r6', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.walk')::uuid, 'sick', pg_temp.sid('walk', '2026-11-16', 2), null) r)::text, true);
reset role;
update public.memberships set ended_at = '2026-11-16 12:01:00+00', end_reason = 'left'
where user_id = tests.get_supabase_uid('fay');
select tests.freeze_time('2026-11-16 12:02:00+00');
select tests.authenticate_as('erin');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r6')),
  'P0001', 'group_waiting', 'under 2 current members: group_waiting');
select tests.authenticate_as('fay');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r6')),
  'P0001', 'not_member', 'a member who left: not_member');

-- ===== Solo: no freeze row, the freeze_result row filled =====
select tests.freeze_time('2026-11-17 12:00:00+00');
select tests.authenticate_as('sam');
select is(
  (select r.status from public.request_freeze(current_setting('test.run')::uuid, 'sick',
     pg_temp.sid('run', '2026-11-16', 2), null) r),
  'approved',
  'solo: approved at once'
);
select is(
  (select pg_catalog.string_agg(f.item_kind || ':' || coalesce(f.activity_name, '-') || ':'
                                || coalesce(f.payload ->> 'which', '-') || ':'
                                || coalesce(f.payload ->> 'week_target', '-'), ',')
   from public.feed_items f
   where f.group_id = current_setting('test.g2')::uuid and f.item_kind in ('freeze', 'freeze_result')),
  'freeze_result:Run:this:6',
  'solo: no freeze row; the freeze_result row names the habit, the week and its target'
);
select is(
  (select pg_catalog.count(*)::integer from public.vote_tallies(current_setting('test.g2')::uuid)),
  0,
  'solo: no tallies'
);

-- ===== Pack (gina, hank, jill) and Pair (kim, lee): the lock, a removed miss, a silent Duo =====
-- gina: Gym 2 a week from week A (slot 1 done Tue 10 Nov, slot 2 missed and stamped Wed 18 Nov
-- 00:10, so last week's window runs to the lock), Study every day from week B (Mon done, Tue
-- missed, stamped Wed 00:05, with its miss event). kim: Walk every day from week B.
reset role;
insert into public.checkins
  (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
values
  ('00000000-0000-4000-a000-0000000055c1', current_setting('test.g4')::uuid, tests.get_supabase_uid('gina'),
   current_setting('test.ggym')::uuid, pg_temp.sid('ggym', '2026-11-09', 1),
   '2026-11-10 08:00:00+00', '2026-11-10 08:00:00+00', '2026-11-10 08:00:00+00', false),
  ('00000000-0000-4000-a000-0000000055c2', current_setting('test.g4')::uuid, tests.get_supabase_uid('gina'),
   current_setting('test.gstudy')::uuid, pg_temp.sid('gstudy', '2026-11-16', 1),
   '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00', false);
update public.sessions set miss_recorded_at = '2026-11-18 00:10:00+00'
where id = pg_temp.sid('ggym', '2026-11-09', 2);
update public.sessions set miss_recorded_at = '2026-11-18 00:05:00+00'
where id = pg_temp.sid('gstudy', '2026-11-16', 2);
insert into public.feed_events (group_id, kind, actor_id, payload)
values (current_setting('test.g4')::uuid, 'miss', tests.get_supabase_uid('gina'),
        pg_catalog.jsonb_build_object(
          'session_ids', pg_catalog.jsonb_build_array(pg_temp.sid('gstudy', '2026-11-16', 2)),
          'commitment_id', current_setting('test.gstudy')));

select tests.freeze_time('2026-11-18 06:00:00+00');
select is(private.current_streak(current_setting('test.gstudy')::uuid), 0,
  'before the freeze: the recorded Tuesday miss breaks gina''s Study streak');
select is(private.commitment_week_score(current_setting('test.ggym')::uuid, '2026-11-09'), 0.5,
  'before the freeze: last week''s Gym scores 1 of 2');
select tests.authenticate_as('gina');
select pg_catalog.set_config('test.r8', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.ggym')::uuid, 'flu', null, '2026-11-09') r)::text, true);
select pg_catalog.set_config('test.r9', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.gstudy')::uuid, 'flu', pg_temp.sid('gstudy', '2026-11-16', 2), null) r)::text, true);
select tests.authenticate_as('kim');
select pg_catalog.set_config('test.r10', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.kwalk')::uuid, 'travel', pg_temp.sid('kwalk', '2026-11-16', 3), null) r)::text, true);
reset role;
select is(
  (select f.closes_at = private.week_lock_at(f.group_id, f.week_start)
          and f.closes_at = '2026-11-19 00:00:00+00'::timestamptz
   from public.freeze_requests f where f.id = current_setting('test.r8')::uuid),
  true,
  'a last-week request made under 24 h before the lock closes at lock_at'
);
select tests.authenticate_as('hank');
select is(pg_temp.fp('r8') ->> 'which', 'last', 'R8 is a last-week request');
select is((select pg_catalog.count(*)::integer from public.feed_items f
           where f.group_id = current_setting('test.g4')::uuid and f.item_kind = 'miss'), 1,
  'the Tuesday miss sticky shows while R9 is pending');

-- R9: everyone approves; the early close removes the miss.
select tests.freeze_time('2026-11-18 07:00:00+00');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r8')),
  'hank approves R8 (jill never votes on it)');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r9')),
  'hank approves R9');
select tests.freeze_time('2026-11-18 07:01:00+00');
select tests.authenticate_as('jill');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.r9')),
  'jill approves R9');
reset role;
select tests.freeze_time('2026-11-18 07:01:06+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 closes R9 after the last undo window');
select is(split_part(pg_temp.fr('r9'), '|', 1) || ',' || split_part(pg_temp.fr('r8'), '|', 1),
  'approved,pending', 'R9 approved by votes; R8 still open until the lock');
select is(pg_temp.st('gstudy', '2026-11-16', 2), 'frozen', 'the missed Tuesday reads frozen');
select is(private.current_streak(current_setting('test.gstudy')::uuid), 1,
  'the approved freeze restores the streak (Monday done, Tuesday neutral)');
select is(private.commitment_week_score(current_setting('test.ggym')::uuid, '2026-11-09'), 0.5,
  'R8 pending: last week''s Gym still scores 1 of 2');
select tests.authenticate_as('hank');
select is((select pg_catalog.count(*)::integer from public.feed_items f
           where f.group_id = current_setting('test.g4')::uuid and f.item_kind = 'miss'), 0,
  'the miss sticky is gone');
select is(
  (select (p ->> 'outcome') || '|' || (p ->> 'approve_count') || '|' || (p ->> 'deny_count') || '|'
          || (p ->> 'miss_removed')
   from pg_temp.rp('r9') p),
  'approved|2|0|true',
  'R9 freeze_result: approved 2-0, miss removed'
);

-- R8: one final Approve ballot; the full tick at lock_at closes it (step 3), then locks (step 5).
select tests.freeze_time('2026-11-19 00:00:00+00');
select tests.authenticate_as('jill');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r8')),
  'P0001', 'vote_closed', 'a ballot at lock_at (= closes_at): vote_closed');
reset role;
select lives_ok('select private.tick()', 'the full tick runs at lock_at');
select is(
  (select gw.locked_at is not null from public.group_weeks gw
   where gw.group_id = current_setting('test.g4')::uuid and gw.week_start = '2026-11-09'),
  true,
  'Pack''s week A is locked'
);
select is(split_part(pg_temp.fr('r8'), '|', 1), 'approved', 'step 3 approved R8 (1-0) before the lock step');
select is(
  (select r.planned || '|' || r.done || '|' || r.frozen || '|' || r.target_met::text
   from public.week_commitment_results r
   where r.commitment_id = current_setting('test.ggym')::uuid and r.week_start = '2026-11-09'),
  '2|1|1|true',
  'the locked Gym week counts the frozen row: 1 of 2 done, 1 frozen, target met'
);
select is(
  (select w.sessions_planned || '|' || w.sessions_done || '|' || w.sessions_frozen
   from public.week_results w
   where w.user_id = tests.get_supabase_uid('gina') and w.week_start = '2026-11-09'),
  '2|1|1',
  'gina''s locked week stores 1 frozen'
);
select is(private.commitment_week_score(current_setting('test.ggym')::uuid, '2026-11-09'), 1::numeric,
  'the approved last-week freeze lowers the week''s target: Gym scores 1 of 1');
select tests.freeze_time('2026-11-19 00:00:01+00');
select tests.authenticate_as('jill');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''deny'')', current_setting('test.r8')),
  'P0001', 'vote_closed', 'a ballot after lock_at: vote_closed');

-- R10 (Pair): nobody votes; at closes_at tick step 3 approves.
select tests.authenticate_as('lee');
select is(pg_temp.fp('r10') ->> 'two_person', 'true', 'Pair: two_person');
reset role;
select tests.freeze_time('2026-11-19 05:59:59+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs before R10''s closes_at');
select is(split_part(pg_temp.fr('r10'), '|', 1), 'pending', 'one second before closes_at: pending');
select tests.freeze_time('2026-11-19 06:00:00+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs at R10''s closes_at');
select is(
  (select f.status || '|' || (e.payload ->> 'approve_count') || '|' || (e.payload ->> 'deny_count')
   from public.freeze_requests f
   join public.feed_events e on e.kind = 'freeze_result' and e.payload ->> 'freeze_request_id' = f.id::text
   where f.id = current_setting('test.r10')::uuid),
  'approved|0|0',
  'Pair: no ballot at closes_at approves'
);

-- A withdrawn request is never closed by tick step 3 (R7's closes_at is Thu 19 Nov 10:00).
select tests.freeze_time('2026-11-19 10:00:00+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs at R7''s closes_at');
select is(
  (select f.status || '|' || (select pg_catalog.count(*)::integer from public.feed_events e
                              where e.kind = 'freeze_result'
                                and e.payload ->> 'freeze_request_id' = f.id::text)
   from public.freeze_requests f where f.id = current_setting('test.r7')::uuid),
  'withdrawn|0',
  'a withdrawn request stays withdrawn with no freeze_result event'
);

select * from finish();
rollback;
