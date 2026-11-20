-- Time zone settings (Story 2.7): the pending columns, private.member_time_zone and
-- private.group_time_zone with a pending zone, public.set_time_zone (member and group), tick step 2
-- (pending time zones) and its slot in private.tick(), and grants per role (AD-16).
--
-- Cast: alice (Europe/London) creates "Crew" (group zone Europe/London) and is its admin; bob
-- (Europe/London) and mia (Europe/London) join with alice's invite. bob also creates "Spring"
-- (Europe/London), used for the DST case. carol (Europe/London) and dave (America/New_York) are in
-- no group; erin has no profile.
-- Commitments are written directly (as the table owner); add_commitment is covered by
-- commitments.test.sql. Steps are called directly under tests.freeze_time, in date order: March 2026
-- (New York spring-forward, Sun 8 Mar), then November 2026 (week D = Mon 16 Nov, D+1 = Mon 23 Nov;
-- GMT in London, EST in New York, NZDT in Auckland). The routines that read the clock get their
-- search_path pointed at test_overrides (rolled back with everything else).
begin;
select plan(75);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('mia');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

-- ===== Shape =====
select has_column('public', 'profiles', 'pending_time_zone', 'profiles has pending_time_zone');
select has_column('public', 'profiles', 'pending_week_start', 'profiles has pending_week_start');
select has_column('public', 'groups', 'pending_time_zone', 'groups has pending_time_zone');
select has_column('public', 'groups', 'pending_week_start', 'groups has pending_week_start');
select col_is_null('public', 'profiles', 'pending_time_zone', 'profiles.pending_time_zone is nullable');
select col_type_is('public', 'profiles', 'pending_week_start', 'date', 'profiles.pending_week_start is a date');
select col_is_null('public', 'groups', 'pending_time_zone', 'groups.pending_time_zone is nullable');
select col_type_is('public', 'groups', 'pending_week_start', 'date', 'groups.pending_week_start is a date');
select ok(
  pg_catalog.to_regprocedure('public.set_time_zone(text, uuid)') is not null
  and pg_catalog.to_regprocedure('private.tick_step_2_time_zones()') is not null
  and pg_catalog.to_regprocedure('private.member_time_zone(uuid, date)') is not null
  and pg_catalog.to_regprocedure('private.group_time_zone(uuid, date)') is not null,
  'set_time_zone, tick step 2 and both zone helpers exist with the story''s signatures'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in (
     'public.set_time_zone(text, uuid)'::regprocedure,
     'private.tick_step_2_time_zones()'::regprocedure,
     'private.member_time_zone(uuid, date)'::regprocedure,
     'private.group_time_zone(uuid, date)'::regprocedure,
     'private.tick()'::regprocedure)),
  'the new and replaced functions pin search_path to empty'
);
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.set_time_zone(text, uuid)'::regprocedure),
  'set_time_zone is security definer'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'private.tick_step_1_sessions()') > 0
          and pg_catalog.strpos(p.prosrc, 'private.tick_step_1_sessions()')
              < pg_catalog.strpos(p.prosrc, 'private.tick_step_2_time_zones()')
          and pg_catalog.strpos(p.prosrc, 'private.tick_step_2_time_zones()')
              < pg_catalog.strpos(p.prosrc, 'if not v_failed_before_lock then')
          and pg_catalog.strpos(p.prosrc, 'if not v_failed_before_lock then')
              < pg_catalog.strpos(p.prosrc, 'private.tick_step_8_heartbeat(')
   from pg_catalog.pg_proc p where p.oid = 'private.tick()'::regprocedure),
  'tick calls step 1, then step 2, then the step 5 slot (guarded by steps 1 to 4), then step 8'
);

-- ===== Grants per role =====
select ok(
  has_function_privilege('authenticated', 'public.set_time_zone(text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_time_zone(text, uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.set_time_zone(text, uuid)', 'EXECUTE'),
  'set_time_zone is executable by authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'private.member_time_zone(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.member_time_zone(uuid, date)', 'EXECUTE')
  and not has_function_privilege('public', 'private.member_time_zone(uuid, date)', 'EXECUTE'),
  'member_time_zone keeps EXECUTE for authenticated only'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
     'private.group_time_zone(uuid, date)'::regprocedure,
     'private.tick_step_2_time_zones()'::regprocedure,
     'private.tick()'::regprocedure)
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0, 'group_time_zone, tick step 2 and the tick are not executable by anon, authenticated or PUBLIC'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'pending_time_zone', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'pending_week_start', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'time_zone', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.groups', 'UPDATE'),
  'clients cannot write zones directly: only set_time_zone changes them'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('mia');
select public.save_profile('Mia', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'America/New_York');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));
select pg_catalog.set_config('test.g2', public.create_group('Spring')::text, true);
select tests.authenticate_as('mia');
select public.join_group(current_setting('test.c1'));

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
alter function public.set_time_zone(text, uuid) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_2_time_zones() set search_path = test_overrides, pg_catalog;
alter function private.tick() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_8_heartbeat(smallint, text, timestamptz) set search_path = test_overrides, pg_catalog;

-- A fixed-days commitment with one version, written directly. p_group is a setting name (g1, g2).
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
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days)
  values (v_id, v_group, p_first, p_days);
  return v_id;
end;
$$;

-- A commitment's sessions for one week as "slot[start,end)" in UTC, ordered by slot; '-' for none.
create function pg_temp.slots(p_commitment text, p_week date)
returns text
language sql
as $$
  select coalesce(
    string_agg(
      s.slot::text || '[' || to_char(s.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ','
        || to_char(s.ends_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ')',
      ' ' order by s.slot),
    '-')
  from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = p_week;
$$;

create function pg_temp.lock_at(p_group text, p_week date)
returns timestamptz
language sql
as $$
  select gw.lock_at from public.group_weeks gw
  where gw.group_id = current_setting('test.' || p_group)::uuid and gw.week_start = p_week;
$$;

-- A profile's zones as "time_zone|pending_time_zone|pending_week_start" ('-' for null).
create function pg_temp.profile_zone(p_user text)
returns text
language sql
as $$
  select p.time_zone || '|' || coalesce(p.pending_time_zone, '-') || '|' || coalesce(p.pending_week_start::text, '-')
  from public.profiles p where p.id = tests.get_supabase_uid(p_user);
$$;

create function pg_temp.group_zone(p_group text)
returns text
language sql
as $$
  select g.time_zone || '|' || coalesce(g.pending_time_zone, '-') || '|' || coalesce(g.pending_week_start::text, '-')
  from public.groups g where g.id = current_setting('test.' || p_group)::uuid;
$$;

-- ===== March 2026: a group change across a DST week =====
-- Wed 4 Mar 12:00 UTC. New York springs forward on Sun 8 Mar (EST -> EDT); London stays on GMT
-- until 29 Mar. bob moves "Spring" from London to New York from Mon 9 Mar.
select tests.freeze_time('2026-03-04 12:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.lock_at('g2', '2026-03-02'), '2026-03-12 00:00:00+00'::timestamptz,
  'Spring''s current week locks Thursday 00:00 London time');
select tests.authenticate_as('bob');
select is(
  (select row(t.*)::text from public.set_time_zone('America/New_York', current_setting('test.g2')::uuid) t),
  '(Europe/London,America/New_York,2026-03-09)',
  'an admin''s group change is pending from the group''s next Monday');
reset role;
select is(pg_temp.lock_at('g2', '2026-03-02'), '2026-03-12 00:00:00+00'::timestamptz,
  'the current week''s lock is untouched');
select is(private.group_time_zone(current_setting('test.g2')::uuid, '2026-03-02'), 'Europe/London',
  'group_time_zone answers the current zone for the current week');
select is(private.group_time_zone(current_setting('test.g2')::uuid, '2026-03-09'), 'America/New_York',
  'and the pending zone from pending_week_start on');
select is(private.group_time_zone(current_setting('test.g2')::uuid, null), 'Europe/London',
  'and the current zone for a null week');

-- Mon 9 Mar 00:00 London: still Sunday 20:00 in New York, so the group's week has not turned.
select tests.freeze_time('2026-03-09 00:00:00+00');
select private.tick_step_1_sessions();
select is(private.tick_step_2_time_zones(), null, 'step 2 runs without error');
select is(pg_temp.lock_at('g2', '2026-03-09'), null,
  'at London''s Monday the group has no row for the new week yet (New York''s Monday comes later)');
select is(pg_temp.group_zone('g2'), 'Europe/London|America/New_York|2026-03-09',
  'and step 2 does not promote before the new zone''s Monday');

-- Mon 9 Mar 00:00 EDT = 04:00 UTC.
select tests.freeze_time('2026-03-09 04:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.lock_at('g2', '2026-03-09'), '2026-03-19 04:00:00+00'::timestamptz,
  'the first week in the new zone locks Thursday 00:00 New York time (EDT, after the DST switch)');
select is(private.tick_step_2_time_zones(), null, 'step 2 runs without error');
select is(pg_temp.group_zone('g2'), 'America/New_York|-|-',
  'at the new zone''s Monday 00:00 step 2 moves the pending zone into time_zone');

-- ===== November 2026: week D = Mon 16 Nov =====
select pg_catalog.set_config('test.a1',
  pg_temp.add_plan('alice', 'g1', 'yoga', array[1, 3]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.m1',
  pg_temp.add_plan('mia', 'g1', 'study', array[1]::smallint[], '2026-11-16')::text, true);

select tests.freeze_time('2026-11-16 00:00:00+00');
select private.tick_step_1_sessions();
select pg_catalog.set_config('test.a1_d', pg_temp.slots('a1', '2026-11-16'), true);
select is(current_setting('test.a1_d'), '1[2026-11-16 00:00,2026-11-17 00:00) 3[2026-11-18 00:00,2026-11-19 00:00)',
  'week D sessions are in London bounds');
select is(pg_temp.lock_at('g1', '2026-11-16'), '2026-11-26 00:00:00+00'::timestamptz,
  'Crew''s week D locks Thursday 00:00 London time');

-- Wed 18 Nov 12:00 UTC.
select tests.freeze_time('2026-11-18 12:00:00+00');

-- Errors.
select tests.authenticate_as('alice');
select throws_ok($$ select * from public.set_time_zone('Mars/Base') $$,
  'P0001', 'invalid_time_zone', 'an unknown zone raises invalid_time_zone');
select throws_ok($$ select * from public.set_time_zone(null) $$,
  'P0001', 'invalid_time_zone', 'a null zone raises invalid_time_zone');
select throws_ok(
  format($$ select * from public.set_time_zone('Mars/Base', %L) $$, current_setting('test.g1')),
  'P0001', 'invalid_time_zone', 'an unknown group zone raises invalid_time_zone');
select tests.authenticate_as('bob');
select throws_ok(
  format($$ select * from public.set_time_zone('Asia/Tokyo', %L) $$, current_setting('test.g1')),
  'P0001', 'not_admin', 'a member who is not the admin gets not_admin');
select tests.authenticate_as('dave');
select throws_ok(
  format($$ select * from public.set_time_zone('Asia/Tokyo', %L) $$, current_setting('test.g1')),
  'P0001', 'not_member', 'a non-member gets not_member');
select throws_ok(
  format($$ select * from public.set_time_zone('Mars/Base', %L) $$, current_setting('test.g1')),
  'P0001', 'not_member', 'not_member comes before invalid_time_zone');
select tests.authenticate_as('erin');
select throws_ok($$ select * from public.set_time_zone('UTC') $$,
  'P0001', 'profile_required', 'a user with no profile gets profile_required');
select tests.clear_authentication();
select throws_ok($$ select * from public.set_time_zone('UTC') $$,
  '42501', null, 'anon cannot call set_time_zone');

-- Member: London -> New York mid-week, clearing and repeating on the way.
select tests.authenticate_as('alice');
select is(
  (select row(t.*)::text from public.set_time_zone('America/New_York') t),
  '(Europe/London,America/New_York,2026-11-23)',
  'a member''s change is pending from their next Monday in their current zone');
select is(
  (select row(t.*)::text from public.set_time_zone('Europe/London') t),
  '(Europe/London,,)',
  'setting the current zone clears the pending change');
select is(
  (select row(t.*)::text from public.set_time_zone('Asia/Tokyo') t),
  '(Europe/London,Asia/Tokyo,2026-11-23)',
  'a new zone is pending again');
select is(
  (select row(t.*)::text from public.set_time_zone('America/New_York') t),
  '(Europe/London,America/New_York,2026-11-23)',
  'another zone replaces the pending one, same week');
reset role;
-- A row's ctid changes on every update (updated_at cannot show it: now() is fixed per transaction).
select pg_catalog.set_config('test.alice_ctid',
  (select p.ctid::text from public.profiles p where p.id = tests.get_supabase_uid('alice')), true);
select tests.freeze_time('2026-11-18 12:05:00+00');
select tests.authenticate_as('alice');
select is(
  (select row(t.*)::text from public.set_time_zone('America/New_York') t),
  '(Europe/London,America/New_York,2026-11-23)',
  'the pending zone again changes nothing');
reset role;
select is(
  (select p.ctid::text from public.profiles p where p.id = tests.get_supabase_uid('alice')),
  current_setting('test.alice_ctid'),
  'and writes nothing');
select is(pg_temp.slots('a1', '2026-11-16'), current_setting('test.a1_d'),
  'the current week''s sessions are untouched');
select is(private.member_time_zone(tests.get_supabase_uid('alice'), '2026-11-16'), 'Europe/London',
  'member_time_zone answers the current zone for week D');
select is(private.member_time_zone(tests.get_supabase_uid('alice'), '2026-11-23'), 'America/New_York',
  'and the pending zone for week D+1');
select is(private.member_time_zone(tests.get_supabase_uid('alice'), null), 'Europe/London',
  'and the current zone for a null week');

-- Zone ahead: mia moves London -> Pacific/Auckland.
select tests.authenticate_as('mia');
select is(
  (select row(t.*)::text from public.set_time_zone('Pacific/Auckland') t),
  '(Europe/London,Pacific/Auckland,2026-11-23)',
  'mia''s move to Auckland is pending from Mon 23 Nov');
reset role;

-- Sun 22 Nov 10:59 UTC = Sun 22 Nov 23:59 NZDT, one minute before Auckland's Monday.
select tests.freeze_time('2026-11-22 10:59:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('m1', '2026-11-23'), '-',
  'one minute before Auckland''s Monday 00:00, week D+1 has no sessions');

-- Sun 22 Nov 11:00 UTC = Mon 23 Nov 00:00 NZDT.
select tests.freeze_time('2026-11-22 11:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('m1', '2026-11-23'), '1[2026-11-22 11:00,2026-11-23 11:00)',
  'at Auckland''s Monday 00:00, step 1 builds week D+1 in Auckland bounds');
select is(pg_temp.profile_zone('mia'), 'Europe/London|Pacific/Auckland|2026-11-23',
  'before step 2 has promoted the zone');
select is(pg_temp.lock_at('g1', '2026-11-23'), '2026-12-03 00:00:00+00'::timestamptz,
  'mia''s Monday created Crew''s week D+1 row, locking Thursday 00:00 London time');
select is(private.tick_step_2_time_zones(), null, 'step 2 runs without error');
select is(pg_temp.profile_zone('mia'), 'Pacific/Auckland|-|-', 'step 2 promotes mia''s zone');
select is(pg_temp.profile_zone('alice'), 'Europe/London|America/New_York|2026-11-23',
  'and leaves alice''s change waiting for New York''s Monday');

-- Group change with week D+1's row already there: alice moves Crew to New York.
select tests.authenticate_as('alice');
select is(
  (select row(t.*)::text from public.set_time_zone('America/New_York', current_setting('test.g1')::uuid) t),
  '(Europe/London,America/New_York,2026-11-23)',
  'the admin''s group change is pending from the group''s next Monday');
reset role;
select is(pg_temp.lock_at('g1', '2026-11-23'), '2026-12-03 05:00:00+00'::timestamptz,
  'the existing week D+1 row''s lock is recomputed: Thursday 00:00 New York time');
select is(pg_temp.lock_at('g1', '2026-11-16'), '2026-11-26 00:00:00+00'::timestamptz,
  'the current week''s lock is untouched');

-- Same-zone clearing puts the lock back, a change back to New York moves it again.
select tests.authenticate_as('alice');
select is(
  (select row(t.*)::text from public.set_time_zone('Europe/London', current_setting('test.g1')::uuid) t),
  '(Europe/London,,)',
  'setting the group''s current zone clears its pending change');
reset role;
select is(pg_temp.lock_at('g1', '2026-11-23'), '2026-12-03 00:00:00+00'::timestamptz,
  'and week D+1''s lock goes back to London time');
select tests.authenticate_as('alice');
select public.set_time_zone('America/New_York', current_setting('test.g1')::uuid);
reset role;

-- Zone ahead whose Monday has already come: Sun 22 Nov 12:00 UTC is Mon 23 Nov 01:00 in Auckland,
-- so carol (London) moving there starts the Monday after next, never a week already under way.
select tests.freeze_time('2026-11-22 12:00:00+00');
select tests.authenticate_as('carol');
select is(
  (select row(t.*)::text from public.set_time_zone('Pacific/Auckland') t),
  '(Europe/London,Pacific/Auckland,2026-11-30)',
  'a zone whose next Monday 00:00 has already passed starts the Monday after');
reset role;

-- Mon 23 Nov 00:00 London: alice's new zone (New York) has not reached Monday yet.
select tests.freeze_time('2026-11-23 00:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('a1', '2026-11-23'), '-',
  'at London''s Monday, alice''s week D+1 has nothing yet (it follows New York)');
select private.tick_step_2_time_zones();
select is(pg_temp.profile_zone('alice') || ' ' || pg_temp.group_zone('g1'),
  'Europe/London|America/New_York|2026-11-23 Europe/London|America/New_York|2026-11-23',
  'and neither alice''s nor Crew''s change is promoted');

-- Mon 23 Nov 00:00 EST = 05:00 UTC.
select tests.freeze_time('2026-11-23 05:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('a1', '2026-11-23'), '1[2026-11-23 05:00,2026-11-24 05:00) 3[2026-11-25 05:00,2026-11-26 05:00)',
  'week D+1 sessions are in New York bounds');
select is(pg_temp.slots('a1', '2026-11-16'), current_setting('test.a1_d'),
  'week D keeps its London bounds');
select private.tick_step_2_time_zones();
select is(pg_temp.profile_zone('alice') || ' ' || pg_temp.group_zone('g1'),
  'America/New_York|-|- America/New_York|-|-',
  'at New York''s Monday step 2 promotes both');

-- ===== Step 2 catch-up after a pause =====
update public.profiles
set pending_time_zone = 'Asia/Tokyo', pending_week_start = '2026-11-30'
where id = tests.get_supabase_uid('carol');
update public.profiles
set pending_time_zone = 'UTC', pending_week_start = '2026-12-07'
where id = tests.get_supabase_uid('dave');
update public.groups
set pending_time_zone = 'Asia/Tokyo', pending_week_start = '2026-12-07'
where id = current_setting('test.g2')::uuid;

-- Nothing ran between 23 Nov and Wed 16 Dec.
select tests.freeze_time('2026-12-16 12:00:00+00');
select is(private.tick_step_2_time_zones(), null, 'after the pause step 2 runs without error');
select is(
  pg_temp.profile_zone('carol') || ' ' || pg_temp.profile_zone('dave') || ' ' || pg_temp.group_zone('g2'),
  'Asia/Tokyo|-|- UTC|-|- Asia/Tokyo|-|-',
  'every pending change past its start is promoted in one run');
select pg_catalog.set_config('test.zones_snapshot',
  (select string_agg(p.id::text || p.time_zone || p.ctid::text, ',' order by p.id) from public.profiles p)
    || '/' || (select string_agg(g.id::text || g.time_zone || g.ctid::text, ',' order by g.id) from public.groups g),
  true);
select tests.freeze_time('2026-12-16 12:01:00+00');
select is(private.tick_step_2_time_zones(), null, 'a rerun runs without error');
select is(
  (select string_agg(p.id::text || p.time_zone || p.ctid::text, ',' order by p.id) from public.profiles p)
    || '/' || (select string_agg(g.id::text || g.time_zone || g.ctid::text, ',' order by g.id) from public.groups g),
  current_setting('test.zones_snapshot'),
  'and changes nothing');

-- ===== Step 2 inside private.tick() =====
-- This transaction holds the tick lock, so the real cron job's runs return at once.
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));
update public.profiles
set pending_time_zone = 'Asia/Tokyo', pending_week_start = '2026-12-21'
where id = tests.get_supabase_uid('dave');
-- Mon 21 Dec 00:00 in Tokyo was Sun 20 Dec 15:00 UTC.
select tests.freeze_time('2026-12-21 00:00:00+00');
select private.tick();
select ok(
  pg_temp.profile_zone('dave') = 'Asia/Tokyo|-|-'
  and (select h.last_run_at from public.heartbeat h) = '2026-12-21 00:00:00+00'::timestamptz,
  'a tick run promotes a due pending zone (step 2) and writes the heartbeat');

-- A failing step 2: recorded in the heartbeat, and step 8 still runs.
create or replace function private.tick_step_2_time_zones()
returns text
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'step two broke';
end;
$$;
select tests.freeze_time('2026-12-21 00:05:00+00');
select lives_ok($$ select private.tick() $$, 'a failing step 2 does not fail the tick');
select ok(
  (select h.last_error_step = 2
          and h.last_error = 'step two broke'
          and h.last_error_at = '2026-12-21 00:05:00+00'::timestamptz
          and h.last_run_at = '2026-12-21 00:05:00+00'::timestamptz
   from public.heartbeat h),
  'the heartbeat records step 2 and its error, and last_run_at is fresh');

-- A pending change already due when the member changes again counts as applied first.
update public.profiles
set pending_time_zone = 'Europe/Paris', pending_week_start = '2026-12-14'
where id = tests.get_supabase_uid('carol');
select tests.authenticate_as('carol');
select is(
  (select row(t.*)::text from public.set_time_zone('Europe/Paris') t),
  '(Europe/Paris,,)',
  'a due pending zone counts as current: choosing it again just applies it');
reset role;

select * from finish();
rollback;
