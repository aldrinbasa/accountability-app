-- Votes (Story 5.2): cast_vote (owner, challenger, late joiner and rejoined member refused, double
-- vote, unknown kind or choice, non-member), undo_vote (at 5.9 s and at 6 s, after closes_at, on a
-- closed vote), early_close_at (set when all eligible voters voted, cleared by an undo, the close
-- waiting for the last final ballot), vote_tallies (final ballots only, the caller's own pending
-- ballot, non-members refused), private.close_vote's counts (majority Fake, a 2-2 tie stands, a
-- pending ballot not counted, a ballot cast 2 s before closes_at counted, a vote straddling the
-- lock), votes RLS (voter only, also after leaving), feed_items challenge rows, Fair Judge, and the
-- grants per role (AD-16).
--
-- Cast: alice creates "Crew" (Europe/London) with bob, carol, gina and ivy, all back-dated to 1 Oct.
-- ivy leaves Mon 16 Nov 09:30 and rejoins at 10:30 (a new membership); harry joins Mon 10:00. dave
-- creates "Duo" (UTC) with erin. kim is in no group. Week Mon 16 to Sun 22 Nov 2026 (London = UTC;
-- locks Thu 26 Nov 00:00). The routines under test call now() unqualified; their search_path is
-- pointed at test_overrides so tests.freeze_time moves their clock.
begin;
set local timezone = 'UTC';
select plan(48);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('gina');
select tests.create_supabase_user('harry');
select tests.create_supabase_user('ivy');
select tests.create_supabase_user('kim');

-- ===== Shape =====
select has_table('public', 'votes', 'votes exists');
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.cast_vote(text, uuid, text)'::regprocedure,
                   'public.undo_vote(text, uuid)'::regprocedure,
                   'public.vote_tallies(uuid)'::regprocedure,
                   'private.challenge_voter_eligible(uuid, uuid)'::regprocedure,
                   'private.challenge_others_at_open(uuid)'::regprocedure,
                   'private.close_vote(uuid)'::regprocedure)),
  'the vote functions have an empty search_path'
);
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('public.cast_vote(text, uuid, text)'::regprocedure,
                   'public.undo_vote(text, uuid)'::regprocedure,
                   'public.vote_tallies(uuid)'::regprocedure,
                   'private.challenge_voter_eligible(uuid, uuid)'::regprocedure,
                   'private.challenge_others_at_open(uuid)'::regprocedure)),
  'the vote RPCs and helpers are security definer'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'for update') > 0 from pg_catalog.pg_proc p
   where p.oid = 'public.cast_vote(text, uuid, text)'::regprocedure)
  and (select pg_catalog.strpos(p.prosrc, 'for update') > 0 from pg_catalog.pg_proc p
       where p.oid = 'public.undo_vote(text, uuid)'::regprocedure),
  'cast_vote and undo_vote lock the challenge row'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.cast_vote(text, uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.undo_vote(text, uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.vote_tallies(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.cast_vote(text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.undo_vote(text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.vote_tallies(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.cast_vote(text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.undo_vote(text, uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.vote_tallies(uuid)', 'EXECUTE'),
  'cast_vote, undo_vote, vote_tallies: authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'private.challenge_voter_eligible(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.challenge_voter_eligible(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.challenge_others_at_open(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.close_vote(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.close_vote(uuid)', 'EXECUTE'),
  'the helpers serve the view only to authenticated; close_vote stays closed'
);
select ok(
  has_table_privilege('authenticated', 'public.votes', 'SELECT')
  and not has_table_privilege('authenticated', 'public.votes', 'INSERT')
  and not has_table_privilege('authenticated', 'public.votes', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.votes', 'DELETE')
  and not has_table_privilege('anon', 'public.votes', 'SELECT'),
  'votes: authenticated may only read; anon nothing'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select tests.authenticate_as('gina');
select public.save_profile('Gina', 'Europe/London');
select tests.authenticate_as('harry');
select public.save_profile('Harry', 'Europe/London');
select tests.authenticate_as('ivy');
select public.save_profile('Ivy', 'Europe/London');
select tests.authenticate_as('kim');
select public.save_profile('Kim', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('gina');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('ivy');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select pg_catalog.set_config('test.g2', public.create_group('Duo')::text, true);
select pg_catalog.set_config('test.code2', (select code from public.create_invite(current_setting('test.g2')::uuid, false)), true);
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code2'));

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';
-- ivy left Mon 09:30 and rejoined at 10:30; harry joined at 10:00.
update public.memberships set ended_at = '2026-11-16 09:30:00+00', end_reason = 'left'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('ivy');
insert into public.memberships (group_id, user_id, role, joined_at)
values (current_setting('test.g1')::uuid, tests.get_supabase_uid('ivy'), 'member', '2026-11-16 10:30:00+00'),
       (current_setting('test.g1')::uuid, tests.get_supabase_uid('harry'), 'member', '2026-11-16 10:00:00+00');

alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.create_challenge(uuid) set search_path = test_overrides, pg_catalog;
alter function public.cast_vote(text, uuid, text) set search_path = test_overrides, pg_catalog;
alter function public.undo_vote(text, uuid) set search_path = test_overrides, pg_catalog;
alter function public.vote_tallies(uuid) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function private.badge_criteria_met(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_3_close_votes() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_4_misses() set search_path = test_overrides, pg_catalog;
alter function private.tick() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_8_heartbeat(smallint, text, timestamptz) set search_path = test_overrides, pg_catalog;
alter function private.lock_week(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.lock_due_weeks() set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.checkin_challenge_until(uuid, timestamptz) set search_path = test_overrides, pg_catalog;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

-- A fixed-days commitment with one version, written directly. p_group is a setting name.
create function pg_temp.add_plan(p_user text, p_group text, p_preset text, p_days smallint[], p_first date)
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
  values (v_group, v_membership, v_uid, 'commitment', v_activity, 'fixed_days')
  returning id into v_id;
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values (v_id, v_group, p_first, p_days, null);
  return v_id;
end;
$$;

-- A check-in (setting name p_id) written directly. Session by slot (null = extra).
create function pg_temp.checkin(
  p_id text, p_commitment text, p_slot integer, p_counted timestamptz, p_received timestamptz
)
returns void
language sql
as $$
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select current_setting('test.' || p_id)::uuid, c.group_id, c.user_id, c.id,
         (select s.id from public.sessions s
          where s.commitment_id = c.id and s.week_start = '2026-11-16' and s.slot = p_slot),
         p_counted, p_received, p_counted, p_received - p_counted > interval '10 minutes'
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid;
$$;

-- The challenge of a check-in (setting name).
create function pg_temp.ch(p_id text)
returns public.challenges
language sql
as $$
  select ch.* from public.challenges ch where ch.checkin_id = current_setting('test.' || p_id)::uuid;
$$;

-- The current membership id of a user in a group (setting name).
create function pg_temp.mid(p_user text, p_group text)
returns uuid
language sql
as $$
  select m.id from public.memberships m
  where m.group_id = current_setting('test.' || p_group)::uuid
    and m.user_id = tests.get_supabase_uid(p_user) and m.ended_at is null;
$$;

select pg_catalog.set_config('test.b1', '00000000-0000-4000-a000-0000000052b1', true);
select pg_catalog.set_config('test.b2', '00000000-0000-4000-a000-0000000052b2', true);
select pg_catalog.set_config('test.c1', '00000000-0000-4000-a000-0000000052c1', true);
select pg_catalog.set_config('test.g1c', '00000000-0000-4000-a000-0000000052a1', true);
select pg_catalog.set_config('test.e1', '00000000-0000-4000-a000-0000000052e1', true);

select pg_catalog.set_config('test.gym', pg_temp.add_plan('bob', 'g1', 'gym', array[1, 3, 5]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('carol', 'g1', 'walk', array[1, 2]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.paint', pg_temp.add_plan('gina', 'g1', 'paint', array[1]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.run', pg_temp.add_plan('erin', 'g2', 'run', array[1]::smallint[], '2026-11-16')::text, true);

select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

-- Mon 08:00 posts; bob's Friday Gym taken Fri 23:00 and sent late on Wed 25 Nov 10:00.
select pg_temp.checkin('b1', 'gym', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');
select pg_temp.checkin('b2', 'gym', 5, '2026-11-20 23:00:00+00', '2026-11-25 10:00:00+00');
select pg_temp.checkin('c1', 'walk', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');
select pg_temp.checkin('g1c', 'paint', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');
select pg_temp.checkin('e1', 'run', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');

-- ===== Challenge A: alice challenges bob's Monday Gym at 09:00 =====
-- Eligible: carol and gina (members at 09:00, still current). ivy's current membership began at
-- 10:30 and harry joined at 10:00, so neither may vote; bob owns it, alice challenged.
select tests.freeze_time('2026-11-16 09:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.ch_b1', (select r.challenge_id::text from public.create_challenge(current_setting('test.b1')::uuid) r), true);

select tests.freeze_time('2026-11-16 10:40:00+00');
select tests.authenticate_as('bob');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch_b1')),
  'P0001', 'not_eligible', 'the check-in owner cannot vote: not_eligible');
select tests.authenticate_as('alice');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch_b1')),
  'P0001', 'not_eligible', 'the challenger cannot vote: not_eligible');
select tests.authenticate_as('harry');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch_b1')),
  'P0001', 'not_eligible', 'a member who joined after opened_at: not_eligible');
select tests.authenticate_as('ivy');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch_b1')),
  'P0001', 'not_eligible', 'a rejoined member (new membership after opened_at): not_eligible');
select tests.authenticate_as('kim');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch_b1')),
  'P0001', 'not_member', 'a non-member: not_member');
select tests.authenticate_as('carol');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''maybe'')', current_setting('test.ch_b1')),
  'P0001', 'invalid_vote', 'a choice other than fake or real: invalid_vote');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.ch_b1')),
  'P0001', 'not_member', 'kind freeze with a challenge id (no such freeze request): not_member');

select is(
  (select r.cast_at::text from public.cast_vote('challenge', current_setting('test.ch_b1')::uuid, 'fake') r),
  '2026-11-16 10:40:00+00', 'carol votes Fake: the ballot is cast now');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch_b1')),
  'P0001', 'already_voted', 'a second ballot: already_voted');
reset role;
select is(
  (select coalesce(ch.early_close_at::text, 'null') || '|' || ch.status from pg_temp.ch('b1') ch),
  'null|open', 'one of two voters: no early close, still open (cast_vote never closes)');

-- RLS: a ballot is readable by its voter only.
select tests.authenticate_as('carol');
select pg_catalog.set_config('test.n_carol', (select count(*)::text from public.votes), true);
select tests.authenticate_as('gina');
select pg_catalog.set_config('test.n_gina', (select count(*)::text from public.votes), true);
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.n_bob', (select count(*)::text from public.votes), true);
select is(
  current_setting('test.n_carol') || '|' || current_setting('test.n_gina') || '|' || current_setting('test.n_bob'),
  '1|0|0', 'votes: the voter reads their ballot; other members read none');

-- Tallies: final ballots plus the challenger; the caller's own pending ballot counts for the caller.
select tests.freeze_time('2026-11-16 10:40:03+00');
select tests.authenticate_as('gina');
select pg_catalog.set_config('test.t_gina', (select t.voted_count || '/' || t.eligible_count || '|' || t.target_kind
  from public.vote_tallies(current_setting('test.g1')::uuid) t where t.target_id = current_setting('test.ch_b1')::uuid), true);
select tests.authenticate_as('carol');
select is(
  current_setting('test.t_gina') || ' ' || (select t.voted_count || '/' || t.eligible_count
    from public.vote_tallies(current_setting('test.g1')::uuid) t where t.target_id = current_setting('test.ch_b1')::uuid),
  '1/3|challenge 2/3',
  'at 3 s: gina sees 1 of 3 (carol''s ballot not final), carol sees her own: 2 of 3');
select tests.freeze_time('2026-11-16 10:40:06+00');
select tests.authenticate_as('gina');
select is(
  (select t.voted_count || '/' || t.eligible_count
   from public.vote_tallies(current_setting('test.g1')::uuid) t where t.target_id = current_setting('test.ch_b1')::uuid),
  '2/3', 'at 6 s the ballot is final: 2 of 3 for everyone');
select tests.authenticate_as('kim');
select throws_ok(format('select * from public.vote_tallies(%L)', current_setting('test.g1')),
  'P0001', 'not_member', 'vote_tallies rejects a non-member');

-- Feed rows.
select tests.authenticate_as('gina');
select is(
  (select f.sort_at::text || '|' || (f.actor_id = tests.get_supabase_uid('alice'))::text
          || '|' || (f.subject_id = tests.get_supabase_uid('bob'))::text || '|' || f.challenge_status
          || '|' || (f.payload ->> 'can_vote') || '|' || coalesce(f.payload ->> 'my_choice', 'null')
          || '|' || (f.payload ->> 'checkin_id' = current_setting('test.b1'))::text || '|' || f.activity_name
   from public.feed_items f where f.item_kind = 'challenge' and f.item_id = current_setting('test.ch_b1')::uuid),
  '2026-11-16 09:00:00+00|true|true|open|true|null|true|Gym',
  'feed_items: a challenge row at opened_at, challenger and owner, gina may vote and has no ballot');
select tests.authenticate_as('carol');
select is(
  (select (f.payload ->> 'my_choice') || '|' || (f.payload ->> 'can_vote')
   from public.feed_items f where f.item_kind = 'challenge' and f.item_id = current_setting('test.ch_b1')::uuid),
  'fake|true', 'carol''s row carries her own ballot');
select tests.authenticate_as('bob');
select is(
  (select coalesce(f.payload ->> 'my_choice', 'null') || '|' || (f.payload ->> 'can_vote')
   from public.feed_items f where f.item_kind = 'challenge' and f.item_id = current_setting('test.ch_b1')::uuid),
  'null|false', 'the owner''s row: no ballot, may not vote');

-- Undo: refused at 6 s, accepted at 5.9 s.
select tests.authenticate_as('carol');
select throws_ok(format('select public.undo_vote(''challenge'', %L)', current_setting('test.ch_b1')),
  'P0001', 'undo_expired', 'undo at exactly 6 s: undo_expired');
select tests.freeze_time('2026-11-16 10:50:00+00');
select tests.authenticate_as('gina');
select public.cast_vote('challenge', current_setting('test.ch_b1')::uuid, 'fake');
reset role;
select is(
  (select ch.early_close_at::text from pg_temp.ch('b1') ch),
  '2026-11-16 10:50:06+00', 'every eligible voter has a ballot: early_close_at = now() + 6 s');
select tests.freeze_time('2026-11-16 10:50:05.9+00');
select tests.authenticate_as('gina');
select lives_ok(format('select public.undo_vote(''challenge'', %L)', current_setting('test.ch_b1')),
  'undo at 5.9 s is accepted');
reset role;
select is(
  (select count(*)::text from public.votes v
   where v.challenge_id = current_setting('test.ch_b1')::uuid and v.voter_id = tests.get_supabase_uid('gina'))
  || '|' || (select coalesce(ch.early_close_at::text, 'null') from pg_temp.ch('b1') ch),
  '0|null', 'the undo deleted the ballot and cleared early_close_at');
select tests.authenticate_as('gina');
select lives_ok(format('select public.undo_vote(''challenge'', %L)', current_setting('test.ch_b1')),
  'undo with no ballot is a no-op');

-- gina votes again (Real): the vote closes only after her undo window.
select tests.freeze_time('2026-11-16 10:52:00+00');
select public.cast_vote('challenge', current_setting('test.ch_b1')::uuid, 'real');
reset role;
select tests.freeze_time('2026-11-16 10:52:05+00');
select private.tick_step_3_close_votes();
select is((select ch.status from pg_temp.ch('b1') ch), 'open',
  'at 5 s after the last ballot step 3 leaves it open');
select tests.freeze_time('2026-11-16 10:52:06+00');
select private.tick_step_3_close_votes();
select is(
  (select ch.status || '|' || ch.fake_count || '|' || ch.real_count || '|' || ch.closed_at::text from pg_temp.ch('b1') ch)
  || '|' || (select e.payload ->> 'variant' from public.feed_events e
             where e.kind = 'ruling' and e.payload ->> 'challenge_id' = current_setting('test.ch_b1')),
  'fake|2|1|2026-11-16 10:52:06+00|normal',
  'closed once the last ballot is final: majority Fake, 2 to 1, variant normal');
select tests.authenticate_as('carol');
select throws_ok(format('select public.undo_vote(''challenge'', %L)', current_setting('test.ch_b1')),
  'P0001', 'vote_closed', 'undo on a closed vote: vote_closed');
select tests.authenticate_as('gina');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch_b1')),
  'P0001', 'vote_closed', 'a ballot on a closed vote: vote_closed');
select is(
  (select f.challenge_status || '|' || (f.payload ->> 'fake_count') || '|' || (f.payload ->> 'real_count')
          || '|' || (f.payload ->> 'variant')
   from public.feed_items f where f.item_kind = 'challenge' and f.item_id = current_setting('test.ch_b1')::uuid),
  'fake|2|1|normal', 'the closed challenge keeps its Feed row with the counts');

-- ===== A pending ballot is not counted =====
select tests.freeze_time('2026-11-16 12:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.ch_g1c', (select r.challenge_id::text from public.create_challenge(current_setting('test.g1c')::uuid) r), true);
select tests.authenticate_as('carol');
select public.cast_vote('challenge', current_setting('test.ch_g1c')::uuid, 'real');
reset role;
select tests.freeze_time('2026-11-16 12:00:03+00');
select private.close_vote(current_setting('test.ch_g1c')::uuid);
select is(
  (select ch.status || '|' || ch.fake_count || '|' || ch.real_count from pg_temp.ch('g1c') ch)
  || '|' || (select e.payload ->> 'variant' from public.feed_events e
             where e.kind = 'ruling' and e.payload ->> 'challenge_id' = current_setting('test.ch_g1c')),
  'fake|1|0|lone', 'closing inside a ballot''s undo window leaves it out (no ballot counted: lone)');
select tests.authenticate_as('alice');
select is(
  (select f.payload ->> 'variant' from public.feed_items f
   where f.item_kind = 'challenge' and f.item_id = current_setting('test.ch_g1c')::uuid),
  'lone', 'the closed challenge''s Feed row carries the lone variant');
reset role;

-- ===== Challenge B: a 2-2 tie stands =====
-- alice challenges carol's Monday Walk at 13:00: bob, gina, harry (joined 10:00) and ivy (rejoined
-- 10:30) may vote.
select tests.freeze_time('2026-11-16 13:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.ch_c1', (select r.challenge_id::text from public.create_challenge(current_setting('test.c1')::uuid) r), true);
select tests.authenticate_as('bob');
select public.cast_vote('challenge', current_setting('test.ch_c1')::uuid, 'real');
select tests.authenticate_as('gina');
select public.cast_vote('challenge', current_setting('test.ch_c1')::uuid, 'real');
select tests.authenticate_as('harry');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch_c1')),
  'a member who joined before opened_at may vote');
reset role;
select is((select coalesce(ch.early_close_at::text, 'null') from pg_temp.ch('c1') ch), 'null',
  'ivy has not voted: no early close');
select tests.freeze_time('2026-11-17 13:00:00+00');
select private.tick_step_3_close_votes();
select is(
  (select ch.status || '|' || ch.fake_count || '|' || ch.real_count from pg_temp.ch('c1') ch),
  'real|2|2', 'at closes_at: 2 Fake (challenger + harry), 2 Real: the tie keeps the check-in');

-- RLS after leaving: harry still reads his ballot; gina never reads it.
update public.memberships set ended_at = '2026-11-17 14:00:00+00', end_reason = 'left'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('harry');
select tests.authenticate_as('harry');
select pg_catalog.set_config('test.n_harry', (select count(*)::text from public.votes), true);
select tests.authenticate_as('gina');
select is(
  current_setting('test.n_harry') || '|'
  || (select count(*)::text from public.votes v where v.voter_id = tests.get_supabase_uid('harry')),
  '1|0', 'a voter reads their ballot after leaving; another member never does');

-- ===== Challenge C: a vote straddling the lock =====
-- bob's Friday Gym, sent Wed 25 Nov 10:00: closes_at = the week's lock, Thu 26 Nov 00:00.
select tests.freeze_time('2026-11-25 10:00:30+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.ch_b2', (select r.challenge_id::text from public.create_challenge(current_setting('test.b2')::uuid) r), true);
reset role;
select is((select ch.closes_at::text from pg_temp.ch('b2') ch), '2026-11-26 00:00:00+00',
  'closes_at = lock_at');
select tests.freeze_time('2026-11-25 23:59:58+00');
select tests.authenticate_as('carol');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch_b2')),
  'a ballot 2 s before closes_at');
select tests.freeze_time('2026-11-26 00:00:00+00');
select throws_ok(format('select public.undo_vote(''challenge'', %L)', current_setting('test.ch_b2')),
  'P0001', 'vote_closed', 'undo at closes_at (not yet closed): vote_closed');
select tests.authenticate_as('gina');
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch_b2')),
  'P0001', 'vote_closed', 'a ballot at closes_at: vote_closed');
reset role;
select private.tick();
select is(
  (select ch.status || '|' || ch.fake_count || '|' || ch.real_count || '|' || ch.closed_at::text from pg_temp.ch('b2') ch)
  || '|' || (select coalesce(gw.locked_at::text, 'null') from public.group_weeks gw
             where gw.group_id = current_setting('test.g1')::uuid and gw.week_start = '2026-11-16'),
  'fake|2|0|2026-11-26 00:00:00+00|2026-11-26 00:00:00+00',
  'one tick at the lock: the ballot from 2 s before counts, then the week locks');

-- ===== 2-person group: no Vote card =====
select tests.freeze_time('2026-11-16 14:00:00+00');
select tests.authenticate_as('dave');
select public.create_challenge(current_setting('test.e1')::uuid);
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g2')::uuid and f.item_kind = 'challenge'),
  0, 'a challenge ruled at once in a group of two has no challenge row in the Feed');

-- ===== Fair Judge =====
-- ivy (current membership from Mon 10:30) gets 10 ballots on extra check-ins of bob, cast Mon
-- 15:00, plus one cast at 09:15 under her ended membership.
reset role;
select tests.freeze_time('2026-11-27 12:00:00+00');
create temporary table fj on commit drop as
select pg_catalog.gen_random_uuid() as checkin_id, pg_catalog.gen_random_uuid() as challenge_id, n
from pg_catalog.generate_series(1, 11) n;
insert into public.checkins
  (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
select fj.checkin_id, c.group_id, c.user_id, c.id, null,
       '2026-11-16 14:00:00+00', '2026-11-16 14:00:00+00', '2026-11-16 14:00:00+00', false
from fj cross join public.commitments c
where c.id = current_setting('test.gym')::uuid;
insert into public.challenges (id, group_id, checkin_id, challenger_id, subject_user_id, opened_at, closes_at)
select fj.challenge_id, current_setting('test.g1')::uuid, fj.checkin_id, tests.get_supabase_uid('alice'),
       tests.get_supabase_uid('bob'), '2026-11-16 08:00:00+00', '2026-11-17 08:00:00+00'
from fj;
insert into public.votes (group_id, challenge_id, voter_id, choice, cast_at)
select current_setting('test.g1')::uuid, fj.challenge_id, tests.get_supabase_uid('ivy'), 'real',
       case when fj.n = 11 then '2026-11-16 09:15:00+00'::timestamptz else '2026-11-16 15:00:00+00'::timestamptz end
from fj;
select is(
  (select pg_catalog.string_agg(x, '|') from (values
    ((select count(*)::text from private.badge_criteria_met(pg_temp.mid('ivy', 'g1'), '2026-11-16') k where k = 'fair_judge')),
    ((select count(*)::text from private.badge_criteria_met(pg_temp.mid('ivy', 'g1'), '2026-11-09') k where k = 'fair_judge')),
    ((select count(*)::text from private.badge_criteria_met(pg_temp.mid('alice', 'g1'), '2026-11-16') k where k = 'fair_judge'))
  ) v(x)),
  '1|0|0',
  'Fair Judge: 10 ballots in week D yes; not for the week before; the challenger''s implicit Fakes never');
delete from public.votes v
where v.voter_id = tests.get_supabase_uid('ivy')
  and v.challenge_id = (select fj.challenge_id from fj where fj.n = 1);
select is(
  (select count(*)::integer from private.badge_criteria_met(pg_temp.mid('ivy', 'g1'), '2026-11-16') k
   where k = 'fair_judge'),
  0, 'Fair Judge: 9 ballots in the membership (the 11th belongs to the ended one) is not enough');

select * from finish();
rollback;
