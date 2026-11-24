-- Membership vote side effects, review fixes (Story 5.6): a vote that is already due when a member
-- leaves (its early close passed, tick step 3 has not run) is decided first, with every ballot,
-- instead of being cancelled. Cast: alice creates "Trio" (London) with bob and carol; memberships
-- back-dated to 1 Oct; week Mon 16 Nov 2026. Bob questions alice's check-in, carol (the only other
-- voter) says it counts, and alice leaves 10 s later, before the tick: the challenge is ruled
-- (Counts), not cancelled, and carol's ballot stays.
begin;
set local timezone = 'UTC';
select plan(5);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');

select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g', public.create_group('Trio')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));

reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';

alter function private.end_membership(uuid, text) set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.create_challenge(uuid) set search_path = test_overrides, pg_catalog;
alter function public.cast_vote(text, uuid, text) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.checkin_challenge_until(uuid, timestamptz) set search_path = test_overrides, pg_catalog;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

-- Alice's Walk on Mon and Tue, written directly.
insert into public.group_activities (group_id, preset_key, created_by)
values (current_setting('test.g')::uuid, 'walk', tests.get_supabase_uid('alice'));
select pg_catalog.set_config('test.walk', '00000000-0000-4000-a000-0000000057c1', true);
insert into public.commitments (id, group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
select current_setting('test.walk')::uuid, m.group_id, m.id, m.user_id, 'commitment', ga.id, 'fixed_days'
from public.memberships m
join public.group_activities ga on ga.group_id = m.group_id and ga.preset_key = 'walk'
where m.group_id = current_setting('test.g')::uuid and m.user_id = tests.get_supabase_uid('alice');
insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
values (current_setting('test.walk')::uuid, current_setting('test.g')::uuid, '2026-11-16', array[1, 2]::smallint[], null);

select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

select pg_catalog.set_config('test.a1', '00000000-0000-4000-a000-0000000057a1', true);
insert into public.checkins
  (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
select current_setting('test.a1')::uuid, c.group_id, c.user_id, c.id,
       (select s.id from public.sessions s
        where s.commitment_id = c.id and s.week_start = '2026-11-16' and s.slot = 1),
       '2026-11-16 07:00:00+00', '2026-11-16 07:00:00+00', '2026-11-16 07:00:00+00', false
from public.commitments c
where c.id = current_setting('test.walk')::uuid;

-- 08:00 bob questions it; 08:01 carol says it counts (every voter has a ballot: early close 08:01:06).
select tests.freeze_time('2026-11-16 08:00:00+00');
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.ch', (select r.challenge_id::text from public.create_challenge(current_setting('test.a1')::uuid) r), true);
select tests.freeze_time('2026-11-16 08:01:00+00');
select tests.authenticate_as('carol');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch')), 'carol says it counts');

-- 08:01:10, before tick step 3: alice (the check-in owner) leaves.
select tests.freeze_time('2026-11-16 08:01:10+00');
select tests.authenticate_as('alice');
select lives_ok(format('select public.leave_group(%L)', current_setting('test.g')), 'alice leaves with the vote already due');
reset role;

select is(
  (select ch.status || '|' || coalesce(ch.cancel_reason, '-') || '|' || ch.fake_count || '|' || ch.real_count
   from public.challenges ch where ch.id = current_setting('test.ch')::uuid),
  'real|-|1|1',
  'the due challenge is ruled (a tie keeps it), not cancelled'
);
select is(
  (select pg_catalog.count(*)::integer from public.feed_events e
   where e.kind = 'ruling' and e.payload ->> 'challenge_id' = current_setting('test.ch')),
  1,
  'one ruling event'
);
select is(
  (select pg_catalog.count(*)::integer from public.votes v
   where v.challenge_id = current_setting('test.ch')::uuid),
  1,
  'carol''s ballot on the decided challenge stays'
);

select * from finish();
rollback;
