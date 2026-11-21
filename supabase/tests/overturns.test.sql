-- Admin overturn (Story 5.3): overturn_ruling (non-admin, the admin's own check-in in a group of 3+
-- and of two, a Real ruling, an open challenge, a double overturn, an owner who left, a non-member,
-- one second before and at lock_at, a locked week's rows untouched), private.checkin_removed false
-- once overturned (session done, points, streak across an unlocked week, the Board's miss mark),
-- a re-check-in after the ruling then an overturn counting once (counted_checkins, counted_position),
-- feed_items (the ruling row's overturn fields and can_overturn per reader, no overturn row of its
-- own, the Vote card row's overturn name, the Polaroid back), the Storage policy, RLS and the grants
-- per role (AD-16).
--
-- Cast: alice creates "Crew" (Europe/London, admin) with bob, carol and gina. dave creates "Duo"
-- (UTC, admin) with erin. harry is in no group. Every membership is back-dated to 1 Oct. Week A is
-- Mon 9 to Sun 15 Nov 2026 (locks Thu 19 Nov 00:00), week B Mon 16 to Sun 22 Nov (locks Thu 26 Nov
-- 00:00); London = UTC in November. bob has Gym Mon Wed Fri, carol Walk Mon Tue, gina Paint Mon,
-- alice Run Mon, dave Clean Mon, erin Run Mon, all from week A. Check-ins are written directly as
-- the table owner. The routines under test call now() unqualified; their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock.
begin;
set local timezone = 'UTC';
select plan(53);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('gina');
select tests.create_supabase_user('harry');

-- ===== Shape =====
select has_table('public', 'overturns', 'overturns exists');
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.overturn_ruling(uuid)'::regprocedure,
                   'private.ruling_can_overturn(uuid)'::regprocedure,
                   'private.checkin_removed(uuid)'::regprocedure,
                   'private.counted_checkins(uuid, date)'::regprocedure,
                   'private.badge_criteria_met(uuid, date)'::regprocedure)),
  'the new and redefined functions have an empty search_path'
);
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('public.overturn_ruling(uuid)'::regprocedure,
                   'private.ruling_can_overturn(uuid)'::regprocedure,
                   'private.checkin_removed(uuid)'::regprocedure)),
  'overturn_ruling, ruling_can_overturn and checkin_removed are security definer'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'for update') > 0 from pg_catalog.pg_proc p
   where p.oid = 'public.overturn_ruling(uuid)'::regprocedure),
  'overturn_ruling locks the challenge row for update'
);
select is(
  (select count(*)::integer from pg_catalog.pg_attribute a
   where a.attrelid = 'public.feed_items'::regclass and a.attnum > 0 and not a.attisdropped),
  28, 'feed_items keeps its 28 columns'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.overturn_ruling(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.overturn_ruling(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.overturn_ruling(uuid)', 'EXECUTE'),
  'overturn_ruling: authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'private.ruling_can_overturn(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.ruling_can_overturn(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'private.ruling_can_overturn(uuid)', 'EXECUTE'),
  'ruling_can_overturn serves the view to authenticated only'
);
select ok(
  has_table_privilege('authenticated', 'public.overturns', 'SELECT')
  and not has_table_privilege('authenticated', 'public.overturns', 'INSERT')
  and not has_table_privilege('authenticated', 'public.overturns', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.overturns', 'DELETE')
  and not has_table_privilege('anon', 'public.overturns', 'SELECT')
  and not has_table_privilege('anon', 'public.overturns', 'INSERT'),
  'overturns: authenticated may only read; anon nothing'
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
select public.save_profile('Harry', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('gina');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select pg_catalog.set_config('test.g2', public.create_group('Duo')::text, true);
select pg_catalog.set_config('test.code2', (select code from public.create_invite(current_setting('test.g2')::uuid, false)), true);
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code2'));

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';

alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.create_challenge(uuid) set search_path = test_overrides, pg_catalog;
alter function public.cast_vote(text, uuid, text) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function public.overturn_ruling(uuid) set search_path = test_overrides, pg_catalog;
alter function private.ruling_can_overturn(uuid) set search_path = test_overrides, pg_catalog;
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
alter function public.get_board(uuid, date) set search_path = test_overrides, pg_catalog;

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

-- The session of a commitment (setting name) in a week, by slot.
create function pg_temp.sess(p_commitment text, p_week date, p_slot integer)
returns public.sessions
language sql
as $$
  select s.* from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = p_week and s.slot = p_slot;
$$;

-- A check-in (setting name p_id) written directly on the session of a week by slot; counted and
-- received at p_at.
create function pg_temp.checkin(p_id text, p_commitment text, p_week date, p_slot integer, p_at timestamptz)
returns void
language sql
as $$
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select current_setting('test.' || p_id)::uuid, c.group_id, c.user_id, c.id,
         (select s.id from public.sessions s
          where s.commitment_id = c.id and s.week_start = p_week and s.slot = p_slot),
         p_at, p_at, p_at, false
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid;
$$;

-- The challenge id of a check-in (setting name).
create function pg_temp.ch(p_id text)
returns uuid
language sql
security definer
as $$
  select ch.id from public.challenges ch where ch.checkin_id = current_setting('test.' || p_id)::uuid;
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

-- The reader's ruling row payload for a check-in's challenge (setting name).
create function pg_temp.ruling(p_id text)
returns jsonb
language sql
as $$
  select f.payload from public.feed_items f
  where f.item_kind = 'ruling' and f.payload ->> 'challenge_id' = pg_temp.ch(p_id)::text;
$$;

grant execute on function pg_temp.ch(text), pg_temp.ruling(text) to authenticated;

select pg_catalog.set_config('test.bA1', '00000000-0000-4000-a000-0000000053a1', true);
select pg_catalog.set_config('test.bA3', '00000000-0000-4000-a000-0000000053a3', true);
select pg_catalog.set_config('test.bA5', '00000000-0000-4000-a000-0000000053a5', true);
select pg_catalog.set_config('test.bB1', '00000000-0000-4000-a000-0000000053b1', true);
select pg_catalog.set_config('test.cA1', '00000000-0000-4000-a000-0000000053c1', true);
select pg_catalog.set_config('test.cB1', '00000000-0000-4000-a000-0000000053c2', true);
select pg_catalog.set_config('test.gB1', '00000000-0000-4000-a000-0000000053d1', true);
select pg_catalog.set_config('test.gB2', '00000000-0000-4000-a000-0000000053d2', true);
select pg_catalog.set_config('test.aB1', '00000000-0000-4000-a000-0000000053e1', true);
select pg_catalog.set_config('test.d1', '00000000-0000-4000-a000-0000000053f1', true);
select pg_catalog.set_config('test.e1', '00000000-0000-4000-a000-0000000053f2', true);

select pg_catalog.set_config('test.gym', pg_temp.add_plan('bob', 'g1', 'gym', array[1, 3, 5]::smallint[], '2026-11-09')::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('carol', 'g1', 'walk', array[1, 2]::smallint[], '2026-11-09')::text, true);
select pg_catalog.set_config('test.paint', pg_temp.add_plan('gina', 'g1', 'paint', array[1]::smallint[], '2026-11-09')::text, true);
select pg_catalog.set_config('test.arun', pg_temp.add_plan('alice', 'g1', 'run', array[1]::smallint[], '2026-11-09')::text, true);
select pg_catalog.set_config('test.clean', pg_temp.add_plan('dave', 'g2', 'clean', array[1]::smallint[], '2026-11-09')::text, true);
select pg_catalog.set_config('test.erun', pg_temp.add_plan('erin', 'g2', 'run', array[1]::smallint[], '2026-11-09')::text, true);

select tests.freeze_time('2026-11-09 00:30:00+00');
select private.tick_step_1_sessions();
select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

select pg_temp.checkin('bA1', 'gym', '2026-11-09', 1, '2026-11-09 08:00:00+00');
select pg_temp.checkin('bA3', 'gym', '2026-11-09', 3, '2026-11-11 08:00:00+00');
select pg_temp.checkin('bA5', 'gym', '2026-11-09', 5, '2026-11-13 18:00:00+00');
select pg_temp.checkin('bB1', 'gym', '2026-11-16', 1, '2026-11-16 08:00:00+00');
select pg_temp.checkin('cA1', 'walk', '2026-11-09', 1, '2026-11-09 08:00:00+00');
select pg_temp.checkin('cB1', 'walk', '2026-11-16', 1, '2026-11-16 08:00:00+00');
select pg_temp.checkin('gB1', 'paint', '2026-11-16', 1, '2026-11-16 08:00:00+00');
select pg_temp.checkin('aB1', 'arun', '2026-11-16', 1, '2026-11-16 08:00:00+00');
select pg_temp.checkin('d1', 'clean', '2026-11-16', 1, '2026-11-16 08:00:00+00');
select pg_temp.checkin('e1', 'erun', '2026-11-16', 1, '2026-11-16 08:00:00+00');

-- ===== Rulings =====
-- Mon 9 Nov 12:00: bob challenges carol's Monday Walk; ruled Fake (lone).
select tests.freeze_time('2026-11-09 12:00:00+00');
select tests.authenticate_as('bob');
select public.create_challenge(current_setting('test.cA1')::uuid);
reset role;
select private.close_vote(pg_temp.ch('cA1'));
-- Sat 14 Nov 10:00: carol challenges bob's Friday Gym (session ended): ruled Fake, miss stamped.
select tests.freeze_time('2026-11-14 10:00:00+00');
select tests.authenticate_as('carol');
select public.create_challenge(current_setting('test.bA5')::uuid);
reset role;
select private.close_vote(pg_temp.ch('bA5'));
-- Mon 16 Nov 09:00: gina's Paint and alice's own Run ruled Fake; bob's Monday Gym ruled Real
-- 2 to 1; carol's Monday Walk left open; in Duo both check-ins ruled Fake at once (2 members).
select tests.freeze_time('2026-11-16 09:00:00+00');
select tests.authenticate_as('alice');
select public.create_challenge(current_setting('test.gB1')::uuid);
select tests.authenticate_as('bob');
select public.create_challenge(current_setting('test.aB1')::uuid);
select public.create_challenge(current_setting('test.cB1')::uuid);
select tests.authenticate_as('carol');
select public.create_challenge(current_setting('test.bB1')::uuid);
select tests.authenticate_as('alice');
select public.cast_vote('challenge', pg_temp.ch('bB1'), 'real');
select tests.authenticate_as('gina');
select public.cast_vote('challenge', pg_temp.ch('bB1'), 'real');
select tests.authenticate_as('erin');
select public.create_challenge(current_setting('test.d1')::uuid);
select tests.authenticate_as('dave');
select public.create_challenge(current_setting('test.e1')::uuid);
reset role;
select tests.freeze_time('2026-11-16 09:00:06+00');
select private.close_vote(pg_temp.ch('gB1'));
select private.close_vote(pg_temp.ch('aB1'));
select private.close_vote(pg_temp.ch('bB1'));
select is(
  (select pg_catalog.string_agg(ch.status, '|' order by ch.checkin_id) from public.challenges ch),
  'fake|real|fake|open|fake|fake|fake|fake',
  'fixture: bA5 Fake, bB1 Real, cA1 Fake, cB1 open, gB1, aB1, d1, e1 Fake'
);

-- ===== Refusals =====
select tests.freeze_time('2026-11-16 10:00:00+00');
select tests.authenticate_as('bob');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('bA5')),
  'P0001', 'not_admin', 'the check-in''s owner, not the admin: not_admin');
select tests.authenticate_as('carol');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('bA5')),
  'P0001', 'not_admin', 'another member, not the admin: not_admin');
select tests.authenticate_as('harry');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('bA5')),
  'P0001', 'not_member', 'a non-member: not_member');
select tests.authenticate_as('alice');
select throws_ok('select * from public.overturn_ruling(''00000000-0000-4000-a000-000000000000'')',
  'P0001', 'not_member', 'an unknown challenge: not_member');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('bB1')),
  'P0001', 'not_fake_ruling', 'a Real ruling: not_fake_ruling');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('cB1')),
  'P0001', 'not_fake_ruling', 'an open challenge: not_fake_ruling');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('aB1')),
  'P0001', 'own_checkin', 'the admin''s own check-in: own_checkin');
select tests.authenticate_as('dave');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('d1')),
  'P0001', 'own_checkin', 'the admin''s own check-in in a group of two: own_checkin');
select tests.authenticate_as('erin');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('e1')),
  'P0001', 'not_admin', 'the non-admin in a group of two: not_admin');
select public.leave_group(current_setting('test.g2')::uuid);
select tests.authenticate_as('dave');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('e1')),
  'P0001', 'not_member', 'an owner who left: not_member');
reset role;
select is(
  (select count(*)::text from public.overturns)
  || '|' || (select count(*)::text from public.feed_events e where e.kind = 'overturn'),
  '0|0', 'no refused call wrote an overturn or an event'
);

-- ===== Re-check-in after the ruling, then the overturn: counts once =====
select tests.freeze_time('2026-11-16 10:30:00+00');
select pg_temp.checkin('gB2', 'paint', '2026-11-16', 1, '2026-11-16 10:30:00+00');
select is(
  (select private.session_status(s) from pg_temp.sess('paint', '2026-11-16', 1) s)
  || '|' || (select pg_catalog.string_agg(k.checkin_id::text, ',')
             from private.counted_checkins(pg_temp.mid('gina', 'g1'), '2026-11-16') k),
  'done|' || current_setting('test.gB2'),
  'control: the re-check-in completes the session freed by the Fake ruling'
);
select tests.freeze_time('2026-11-16 11:00:00+00');
select tests.authenticate_as('alice');
select lives_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('gB1')),
  'the admin overturns gina''s ruling');
reset role;
select is(
  (select private.session_status(s) from pg_temp.sess('paint', '2026-11-16', 1) s)
  || '|' || (select pg_catalog.string_agg(k.checkin_id::text, ',')
             from private.counted_checkins(pg_temp.mid('gina', 'g1'), '2026-11-16') k)
  || '|' || private.weekly_points(pg_temp.mid('gina', 'g1'), '2026-11-16')::text,
  'done|' || current_setting('test.gB1') || '|100',
  'overturn after a re-check-in: session done, one counted check-in (the original), 100 points'
);
select tests.authenticate_as('carol');
select is(
  (select pg_catalog.string_agg(f.item_id::text || '=' || coalesce(f.counted_position::text, 'null'), ','
                                order by f.received_at)
   from public.feed_items f where f.item_kind = 'checkin' and f.commitment_id = current_setting('test.paint')::uuid),
  current_setting('test.gB1') || '=1,' || current_setting('test.gB2') || '=null',
  'Feed: both Polaroids show; only the original counts (the re-check-in has no counted position)'
);
reset role;
select is(
  (select count(*)::integer from private.badge_criteria_met(pg_temp.mid('gina', 'g1'), '2026-11-16') k
   where k = 'first_proof'),
  1, 'badges: First Proof counts the overturned original'
);

-- ===== Before the overturn: the Feed's ruling row per reader =====
select tests.freeze_time('2026-11-17 12:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select (p ->> 'can_overturn') || '|' || (p ->> 'overturn_until')::timestamptz::text
          || '|' || coalesce(p ->> 'overturned_by_name', 'null') || '|' || coalesce(p ->> 'overturned_at', 'null')
   from pg_temp.ruling('bA5') p),
  'true|2026-11-19 00:00:00+00|null|null',
  'the admin''s ruling row: can overturn until week A''s lock, not overturned'
);
select is(
  (select (p ->> 'can_overturn') from pg_temp.ruling('aB1') p)
  || '|' || (select (p ->> 'can_overturn') || '|' || coalesce(p ->> 'overturn_until', 'null') from pg_temp.ruling('bB1') p),
  'false|false|null',
  'the admin''s own check-in and a Real ruling: no overturn (no overturn_until on Real)'
);
select tests.authenticate_as('carol');
select is((select p ->> 'can_overturn' from pg_temp.ruling('bA5') p), 'false',
  'a non-admin''s ruling row: cannot overturn');
select tests.authenticate_as('bob');
select is((select p ->> 'can_overturn' from pg_temp.ruling('bA5') p), 'false',
  'the owner''s ruling row: cannot overturn');
select is(
  (select count(*)::integer from public.feed_items f where f.item_id = current_setting('test.bA5')::uuid),
  0, 'the Fake-ruled Polaroid is hidden'
);
select tests.authenticate_as('dave');
select is((select p ->> 'can_overturn' from pg_temp.ruling('e1') p), 'false',
  'an owner who left: the admin''s row cannot overturn');
reset role;
select is(
  (select private.session_status(s) || '|' || (s.miss_recorded_at is not null)::text
   from pg_temp.sess('gym', '2026-11-09', 5) s)
  || '|' || private.weekly_points(pg_temp.mid('bob', 'g1'), '2026-11-09')::text
  || '|' || private.current_streak(current_setting('test.gym')::uuid)::text,
  'missed|true|67|1',
  'control: the Fake ruling left Friday missed (stamped), week A at 67, streak 1'
);
select tests.authenticate_as('alice');
select is(
  (select b.miss_count from public.get_board(current_setting('test.g1')::uuid, '2026-11-09') b
   where b.user_id = tests.get_supabase_uid('bob')),
  1, 'control: the Board shows bob''s miss mark for week A'
);

-- ===== One second before the lock: the overturn succeeds =====
select tests.freeze_time('2026-11-18 23:59:59+00');
select is((select p ->> 'can_overturn' from pg_temp.ruling('cA1') p), 'true',
  'one second before week A''s lock the admin may still overturn carol''s ruling');
select is(
  (select r.created_at::text from public.overturn_ruling(pg_temp.ch('bA5')) r),
  '2026-11-18 23:59:59+00', 'one second before lock_at the overturn succeeds');
reset role;
select is(
  (select (o.admin_id = tests.get_supabase_uid('alice'))::text || '|' || (o.group_id = current_setting('test.g1')::uuid)::text
   from public.overturns o where o.challenge_id = pg_temp.ch('bA5'))
  || '|' || (select count(*)::text || '|' || bool_and(e.actor_id = tests.get_supabase_uid('alice'))::text
             || '|' || bool_and(e.subject_id = tests.get_supabase_uid('bob'))::text
             || '|' || max(e.payload ->> 'actor_name') || '|' || max(e.payload ->> 'subject_name')
             || '|' || (max(e.payload ->> 'checkin_id') = current_setting('test.bA5'))::text
             || '|' || (max(e.payload ->> 'commitment_id') = current_setting('test.gym'))::text
             || '|' || max(e.created_at)::text
             from public.feed_events e
             where e.kind = 'overturn' and e.payload ->> 'challenge_id' = pg_temp.ch('bA5')::text),
  'true|true|1|true|true|Alice|Bob|true|true|2026-11-18 23:59:59+00',
  'one overturns row by alice and one overturn event (admin, owner, names, check-in, commitment)'
);
select is(
  (select ch.status || '|' || ch.fake_count || '|' || ch.real_count from public.challenges ch
   where ch.id = pg_temp.ch('bA5'))
  || '|' || private.checkin_removed(current_setting('test.bA5')::uuid)::text,
  'fake|1|0|false',
  'challenges.status stays fake; checkin_removed is false once overturned'
);
select is(
  (select private.session_status(s) || '|' || (s.miss_recorded_at is not null)::text
   from pg_temp.sess('gym', '2026-11-09', 5) s)
  || '|' || private.weekly_points(pg_temp.mid('bob', 'g1'), '2026-11-09')::text
  || '|' || private.current_streak(current_setting('test.gym')::uuid)::text,
  'done|true|100|4',
  'restored: Friday done (the stamp stays), week A at 100, streak 4 across the unlocked week'
);
select tests.authenticate_as('alice');
select is(
  (select b.miss_count from public.get_board(current_setting('test.g1')::uuid, '2026-11-09') b
   where b.user_id = tests.get_supabase_uid('bob')),
  0, 'the miss mark leaves the Board'
);
select is(
  (select (p ->> 'can_overturn') || '|' || (p ->> 'overturned_by_name')
          || '|' || ((p ->> 'overturned_by_id')::uuid = tests.get_supabase_uid('alice'))::text
          || '|' || (p ->> 'overturned_at')::timestamptz::text
   from pg_temp.ruling('bA5') p),
  'false|Alice|true|2026-11-18 23:59:59+00',
  'the ruling row folds the overturn in: by Alice, at the overturn time, no longer overturnable'
);
select tests.authenticate_as('carol');
select is(
  (select count(*) filter (where f.item_kind = 'overturn')::text
          || '|' || count(*) filter (where f.item_kind = 'ruling' and f.payload ->> 'challenge_id' = pg_temp.ch('bA5')::text)::text
   from public.feed_items f where f.group_id = current_setting('test.g1')::uuid),
  '0|1', 'no overturn row of its own: one ruling sticky'
);
select is(
  (select f.counted_position || '/' || f.target || '|' || f.sort_at::text
   from public.feed_items f where f.item_kind = 'checkin' and f.item_id = current_setting('test.bA5')::uuid),
  '3/3|2026-11-13 18:00:00+00',
  'the Polaroid is back at its original position, 3 of 3'
);
select is(
  (select (f.payload ->> 'overturned_by_name') || '|' || ((f.payload ->> 'overturned_by_id')::uuid = tests.get_supabase_uid('alice'))::text
   from public.feed_items f where f.item_kind = 'challenge' and f.item_id = pg_temp.ch('bA5')),
  'Alice|true', 'the Vote card row carries who overturned it'
);
select is(
  (select coalesce(f.payload ->> 'overturned_by_name', 'null')
   from public.feed_items f where f.item_kind = 'challenge' and f.item_id = pg_temp.ch('cA1')),
  'null', 'a standing Fake ruling''s Vote card row has no overturn name'
);
select ok(
  private.can_read_checkin_photo(
    current_setting('test.g1') || '/' || current_setting('test.bA5') || '/1080.webp',
    tests.get_supabase_uid('bob')::text),
  'Storage: the overturned check-in''s photo is readable again'
);
select is(
  (select count(*)::integer from public.overturns o where o.group_id = current_setting('test.g1')::uuid),
  2, 'RLS: a current member reads the group''s overturns'
);
select tests.authenticate_as('harry');
select is((select count(*)::integer from public.overturns), 0, 'RLS: a non-member reads none');
select tests.authenticate_as('alice');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('bA5')),
  'P0001', 'already_overturned', 'a second overturn: already_overturned');

-- ===== At the lock: week_locked; the locked week's rows untouched =====
select tests.freeze_time('2026-11-19 00:00:00+00');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('cA1')),
  'P0001', 'week_locked', 'at lock_at: week_locked');
select is((select p ->> 'can_overturn' from pg_temp.ruling('cA1') p), 'false',
  'at lock_at the ruling row is no longer overturnable');
reset role;
select private.tick();
select is(
  (select pg_catalog.string_agg(p.display_name || '=' || wr.weekly_points, ',' order by p.display_name)
   from public.week_results wr join public.profiles p on p.id = wr.user_id
   where wr.group_id = current_setting('test.g1')::uuid and wr.week_start = '2026-11-09'
     and p.display_name in ('Bob', 'Carol')),
  'Bob=100,Carol=0',
  'week A locks with bob''s overturned Friday counted and carol''s Monday removed'
);
select tests.authenticate_as('alice');
select throws_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('cA1')),
  'P0001', 'week_locked', 'after the lock: week_locked');
reset role;
select is(
  (select wr.weekly_points || '|' || wr.sessions_done from public.week_results wr
   where wr.group_id = current_setting('test.g1')::uuid and wr.week_start = '2026-11-09'
     and wr.user_id = tests.get_supabase_uid('carol'))
  || '|' || (select count(*)::text from public.overturns o where o.challenge_id = pg_temp.ch('cA1'))
  || '|' || private.checkin_removed(current_setting('test.cA1')::uuid)::text,
  '0|0|0|true',
  'the locked week''s rows are untouched: no overturn, the check-in still removed'
);

select * from finish();
rollback;
