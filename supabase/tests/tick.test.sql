-- The weekly timer and sessions (Story 2.3): sessions, group_weeks, heartbeat, the sessions_through
-- marker, private.group_time_zone, private.ensure_group_week, tick step 1 (group weeks and sessions),
-- step 8 (heartbeat), private.tick() (advisory lock, step order, a failing step), the pg_cron job,
-- RLS and grants per role.
--
-- Cast: alice (Europe/London) creates "Crew" (group zone Europe/London); bob (Pacific/Auckland),
-- carol (Europe/London) and nina (America/New_York) join with alice's invite. carol leaves before
-- her first week; nina leaves late, after her sessions exist. erin (UTC) is alone in "Solo" (a
-- waiting group). dave (UTC) is in no group. olga (America/New_York) is alone
-- in "Quiet", a group with no commitments.
-- Commitments are written directly (as the table owner) so each case picks its own first week;
-- add_commitment is covered by commitments.test.sql. Steps are called directly under
-- tests.freeze_time, in date order: Mar 2026 (London spring-forward), Oct 2026 (London and
-- New York fall-back), then Nov 2026 (the main week Mon 16 Nov, GMT in London, NZDT in Auckland).
-- The tick routines call now() unqualified; their search_path is pointed at test_overrides so the
-- frozen clock applies (rolled back with everything else).
-- The real pg_cron job also runs every minute against committed data. It sees none of this
-- transaction's rows, and once this transaction holds the tick lock (after the busy case) every
-- cron run returns at once, so it never moves the heartbeat under these assertions.
begin;
select plan(92);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('nina');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('olga');

-- ===== Shape =====
select has_table('public', 'sessions', 'public.sessions exists');
select has_table('public', 'group_weeks', 'public.group_weeks exists');
select has_table('public', 'heartbeat', 'public.heartbeat exists');
select columns_are('public', 'sessions',
  array['id', 'group_id', 'membership_id', 'user_id', 'commitment_id', 'week_start', 'slot', 'starts_at',
        'ends_at', 'miss_recorded_at', 'created_at', 'updated_at'],
  'sessions has the story''s columns and no outcome column');
select columns_are('public', 'group_weeks',
  array['group_id', 'week_start', 'lock_at', 'created_at', 'updated_at'],
  'group_weeks has the story''s columns');
select columns_are('public', 'heartbeat',
  array['id', 'last_run_at', 'last_error_step', 'last_error', 'last_error_at'],
  'heartbeat has the story''s columns');
select has_column('public', 'commitments', 'sessions_through', 'commitments has the sessions_through marker');
select has_index('public', 'sessions', 'sessions_one_per_slot', array['commitment_id', 'week_start', 'slot'],
  'sessions has an index on (commitment_id, week_start, slot)');
select index_is_unique('public', 'sessions', 'sessions_one_per_slot', 'and it is unique');
select col_is_pk('public', 'group_weeks', array['group_id', 'week_start'], 'group_weeks is keyed by (group_id, week_start)');
select tests.rls_enabled('public', 'sessions');
select tests.rls_enabled('public', 'group_weeks');
select tests.rls_enabled('public', 'heartbeat');
select is((select count(*)::integer from public.heartbeat), 1, 'heartbeat has exactly one row');
select throws_ok(
  $$ insert into public.heartbeat (id) values (false) $$,
  '23514', null, 'heartbeat cannot get a second row');
select ok(
  pg_catalog.to_regprocedure('private.group_time_zone(uuid, date)') is not null
  and pg_catalog.to_regprocedure('private.ensure_group_week(uuid, date)') is not null
  and pg_catalog.to_regprocedure('private.tick()') is not null
  and pg_catalog.to_regprocedure('private.tick_step_1_sessions()') is not null
  and pg_catalog.to_regprocedure('private.tick_step_8_heartbeat(smallint, text, timestamptz)') is not null,
  'group_time_zone, ensure_group_week, tick and its steps exist with the story''s signatures'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in (
     'private.group_time_zone(uuid, date)'::regprocedure,
     'private.ensure_group_week(uuid, date)'::regprocedure,
     'private.tick()'::regprocedure,
     'private.tick_step_1_sessions()'::regprocedure,
     'private.tick_step_8_heartbeat(smallint, text, timestamptz)'::regprocedure)),
  'the new functions pin search_path to empty'
);
select ok(
  exists (select 1 from cron.job j
          where j.jobname = 'proofy-tick' and j.schedule = '* * * * *'
            and j.command = 'select private.tick()' and j.active),
  'pg_cron runs job proofy-tick every minute with select private.tick()'
);
select ok(
  (select p.prosrc like '%if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext(''proofy.tick'')) then%return;%'
   from pg_catalog.pg_proc p where p.oid = 'private.tick()'::regprocedure),
  'tick takes pg_try_advisory_xact_lock(hashtext(''proofy.tick'')) and returns when it is held'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'private.tick_step_1_sessions()') > 0
          and pg_catalog.strpos(p.prosrc, 'private.tick_step_1_sessions()')
              < pg_catalog.strpos(p.prosrc, 'if not v_failed_before_lock then')
          and pg_catalog.strpos(p.prosrc, 'if not v_failed_before_lock then')
              < pg_catalog.strpos(p.prosrc, 'private.tick_step_8_heartbeat(')
   from pg_catalog.pg_proc p where p.oid = 'private.tick()'::regprocedure),
  'tick calls step 1, then the step 5 slot (guarded by steps 1 to 4), then step 8'
);

-- ===== Grants per role =====
select ok(
  not has_table_privilege('anon', 'public.sessions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('anon', 'public.group_weeks', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('anon', 'public.heartbeat', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon has no privileges on sessions, group_weeks or heartbeat'
);
select ok(
  has_table_privilege('authenticated', 'public.sessions', 'SELECT')
  and has_table_privilege('authenticated', 'public.group_weeks', 'SELECT')
  and not has_table_privilege('authenticated', 'public.sessions', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('authenticated', 'public.group_weeks', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated can only SELECT sessions and group_weeks'
);
select ok(
  not has_table_privilege('authenticated', 'public.heartbeat', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated has no privileges on heartbeat'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.oid in (
     'private.group_time_zone(uuid, date)'::regprocedure,
     'private.ensure_group_week(uuid, date)'::regprocedure,
     'private.tick()'::regprocedure,
     'private.tick_step_1_sessions()'::regprocedure,
     'private.tick_step_8_heartbeat(smallint, text, timestamptz)'::regprocedure)
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0, 'tick, its steps, ensure_group_week and group_time_zone are not executable by anon, authenticated or PUBLIC'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Pacific/Auckland');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('nina');
select public.save_profile('Nina', 'America/New_York');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);
select tests.authenticate_as('olga');
select public.save_profile('Olga', 'America/New_York');
select pg_catalog.set_config('test.g3', public.create_group('Quiet')::text, true);

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('nina');
select public.join_group(current_setting('test.c1'));

-- ===== Test helpers (temporary, as the table owner) =====
reset role;
alter function private.tick() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_8_heartbeat(smallint, text, timestamptz) set search_path = test_overrides, pg_catalog;

-- A commitment with one version, written directly. p_group is a setting name (g1, g2).
create function pg_temp.add_plan(
  p_user text, p_group text, p_preset text, p_days smallint[], p_target smallint, p_first date,
  p_end date default null
)
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
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target, end_date)
  values (v_id, v_group, p_first, p_days, p_target, p_end);
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

create function pg_temp.marker(p_commitment text)
returns date
language sql
as $$
  select c.sessions_through from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid;
$$;

create function pg_temp.lock_at(p_group text, p_week date)
returns timestamptz
language sql
as $$
  select gw.lock_at from public.group_weeks gw
  where gw.group_id = current_setting('test.' || p_group)::uuid and gw.week_start = p_week;
$$;

-- ===== March 2026: Europe/London spring-forward (Sun 29 Mar, 01:00 GMT -> 02:00 BST) =====
select pg_catalog.set_config('test.a1',
  pg_temp.add_plan('alice', 'g1', 'yoga', array[7]::smallint[], null, '2026-03-23')::text, true);

select tests.freeze_time('2026-03-22 23:59:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('a1', '2026-03-23'), '-',
  'Sunday 23:59 member time: the week has not started, no sessions');
select is(pg_temp.marker('a1'), null, 'and the marker has not moved');

select tests.freeze_time('2026-03-23 00:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('a1', '2026-03-23'), '7[2026-03-29 00:00,2026-03-29 23:00)',
  'at the member''s Monday 00:00 the Sunday session is created, ending at the next local midnight');
select is(
  (select s.ends_at - s.starts_at from public.sessions s
   where s.commitment_id = current_setting('test.a1')::uuid and s.week_start = '2026-03-23'),
  interval '23 hours', 'the spring-forward Sunday session is 23 hours long');
select is(pg_temp.lock_at('g1', '2026-03-23'), '2026-04-01 23:00:00+00'::timestamptz,
  'lock_at is Thursday 00:00 group time (BST) after a week that started in GMT');
select is(pg_temp.marker('a1'), '2026-03-23'::date, 'the marker records the generated week');

-- ===== October 2026: America/New_York fall-back (Sun 1 Nov), London fall-back (Sun 25 Oct) =====
select pg_catalog.set_config('test.n1',
  pg_temp.add_plan('nina', 'g1', 'walk', array[7]::smallint[], null, '2026-10-26')::text, true);

-- Mon 26 Oct 00:00 in New York (EDT). alice's a1 has not run since March.
select tests.freeze_time('2026-10-26 04:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('n1', '2026-10-26'), '7[2026-11-01 04:00,2026-11-02 05:00)',
  'a New York member''s fall-back Sunday runs from 00:00 EDT to 00:00 EST');
select is(
  (select s.ends_at - s.starts_at from public.sessions s
   where s.commitment_id = current_setting('test.n1')::uuid and s.week_start = '2026-10-26'),
  interval '25 hours', 'the fall-back Sunday session is 25 hours long');
select is(
  (select pg_catalog.array_agg(distinct s.week_start order by s.week_start) from public.sessions s
   where s.commitment_id = current_setting('test.a1')::uuid),
  array['2026-03-23', '2026-10-19', '2026-10-26']::date[],
  'after a long pause, locked weeks are skipped and every unlocked missing week is generated');
select is(pg_temp.marker('a1'), '2026-10-26'::date, 'the marker moves past the skipped locked weeks');
select is(
  (select count(*)::integer from public.group_weeks gw
   where gw.group_id = current_setting('test.g1')::uuid and gw.week_start between '2026-03-30' and '2026-10-12'),
  0, 'nothing is written for locked weeks, not even their group_weeks rows');
select is(pg_temp.slots('a1', '2026-10-19'), '7[2026-10-24 23:00,2026-10-26 00:00)',
  'a London fall-back Sunday runs from 00:00 BST to 00:00 GMT (25 hours)');
select is(pg_temp.lock_at('g1', '2026-10-19'), '2026-10-29 00:00:00+00'::timestamptz,
  'lock_at is Thursday 00:00 group time (GMT) after a week that started in BST');

-- ===== November 2026: the main week, Mon 16 Nov =====
select pg_catalog.set_config('test.b1',
  pg_temp.add_plan('alice', 'g1', 'study', array[1, 3, 5]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.b2',
  pg_temp.add_plan('alice', 'g1', 'gym', null, 3::smallint, '2026-11-16')::text, true);
select pg_catalog.set_config('test.b3',
  pg_temp.add_plan('alice', 'g1', 'run', null, 3::smallint, '2026-11-16', '2026-11-18')::text, true);
select pg_catalog.set_config('test.b4',
  pg_temp.add_plan('alice', 'g1', 'read', null, 7::smallint, '2026-11-16', '2026-11-16')::text, true);
select pg_catalog.set_config('test.b5',
  pg_temp.add_plan('alice', 'g1', 'meditate', null, 2::smallint, '2026-11-16')::text, true);
update public.commitments set ends_after_week_start = '2026-11-16' where id = current_setting('test.b5')::uuid;
select pg_catalog.set_config('test.b6',
  pg_temp.add_plan('alice', 'g1', 'journal', array[2]::smallint[], null, '2026-11-16')::text, true);
insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days)
values (current_setting('test.b6')::uuid, current_setting('test.g1')::uuid, '2026-11-23', array[4]::smallint[]);
select pg_catalog.set_config('test.b7',
  pg_temp.add_plan('bob', 'g1', 'paint', array[1]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.b8',
  pg_temp.add_plan('carol', 'g1', 'draw', array[1]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.b9',
  pg_temp.add_plan('erin', 'g2', 'clean', null, 1::smallint, '2026-11-16')::text, true);
select pg_catalog.set_config('test.b10',
  pg_temp.add_plan('alice', 'g1', 'sleep_early', array[1, 3, 5]::smallint[], null, '2026-11-16', '2026-11-18')::text, true);
-- A task (kind 'task', no version): the tick never generates for it (Story 2.4 creates its session).
insert into public.group_activities (group_id, preset_key, created_by)
values (current_setting('test.g1')::uuid, 'groceries', tests.get_supabase_uid('alice'));
insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type,
                                name, deadline, deadline_day_starts_at)
select current_setting('test.g1')::uuid, m.id, m.user_id, 'task', ga.id, null,
       'Grocery run', '2026-11-22', '2026-11-22 00:00:00+00'
from public.memberships m, public.group_activities ga
where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('alice')
  and ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'groceries';
select pg_catalog.set_config('test.t1',
  (select c.id::text from public.commitments c where c.kind = 'task' and c.group_id = current_setting('test.g1')::uuid), true);

-- carol leaves before her first week.
select tests.authenticate_as('carol');
select public.leave_group(current_setting('test.g1')::uuid);
reset role;

-- Sun 15 Nov 12:00 London = Mon 16 Nov 01:00 Auckland.
select tests.freeze_time('2026-11-15 12:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('b7', '2026-11-16'), '1[2026-11-15 11:00,2026-11-16 11:00)',
  'a Pacific/Auckland member gets week D sessions at their own Monday, before the group''s');
select is(pg_temp.lock_at('g1', '2026-11-16'), '2026-11-26 00:00:00+00'::timestamptz,
  'and the group''s week D row exists before the group''s Monday, locking Thursday 00:00 group time');
select is(pg_temp.slots('b1', '2026-11-16'), '-',
  'a London member in the same group has nothing yet');

-- Mon 16 Nov 00:30 London.
select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.slots('b1', '2026-11-16'),
  '1[2026-11-16 00:00,2026-11-17 00:00) 3[2026-11-18 00:00,2026-11-19 00:00) 5[2026-11-20 00:00,2026-11-21 00:00)',
  'fixed days Mon Wed Fri: 3 rows, slot = ISO day, local midnight to next local midnight');
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.b1')::uuid
     and s.group_id = current_setting('test.g1')::uuid
     and s.membership_id = (select c.membership_id from public.commitments c where c.id = current_setting('test.b1')::uuid)
     and s.user_id = tests.get_supabase_uid('alice')
     and s.miss_recorded_at is null),
  3, 'sessions carry the group, membership and owner, with miss_recorded_at null');
select is(pg_temp.slots('b2', '2026-11-16'),
  '1[2026-11-16 00:00,2026-11-23 00:00) 2[2026-11-16 00:00,2026-11-23 00:00) 3[2026-11-16 00:00,2026-11-23 00:00)',
  'times per week 3: 3 rows, slots 1 to 3, each the whole week');
select is(pg_temp.slots('b3', '2026-11-16'), '1[2026-11-16 00:00,2026-11-19 00:00)',
  'target 3 ending Wednesday: 1 row ending Thursday 00:00');
select is(pg_temp.slots('b4', '2026-11-16'), '1[2026-11-16 00:00,2026-11-17 00:00)',
  'target 7 ending Monday: 1 row');
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.b5')::uuid and s.week_start = '2026-11-16'),
  2, 'a commitment ending after week D still gets week D');
select is(pg_temp.slots('b6', '2026-11-16'), '2[2026-11-17 00:00,2026-11-18 00:00)',
  'week D uses the version in effect for D, not the one starting D+1');
select is(
  (select count(*)::integer from public.sessions s where s.commitment_id = current_setting('test.b8')::uuid),
  0, 'a commitment of an ended membership is skipped');
select is(
  (select count(*)::integer from public.sessions s where s.commitment_id = current_setting('test.t1')::uuid),
  0, 'a task is skipped');
select is(pg_temp.slots('b9', '2026-11-16'), '1[2026-11-16 00:00,2026-11-23 00:00)',
  'a waiting group (one member) is generated as usual');
select is(pg_temp.lock_at('g2', '2026-11-16'), '2026-11-26 00:00:00+00'::timestamptz,
  'and the waiting group gets its group week');

select pg_catalog.set_config('test.counts',
  (select count(*)::text from public.sessions) || '/' || (select count(*)::text from public.group_weeks)
    || '/' || (select string_agg(coalesce(c.sessions_through::text, '-'), ',' order by c.id) from public.commitments c),
  true);
select private.tick_step_1_sessions();
select is(
  (select count(*)::text from public.sessions) || '/' || (select count(*)::text from public.group_weeks)
    || '/' || (select string_agg(coalesce(c.sessions_through::text, '-'), ',' order by c.id) from public.commitments c),
  current_setting('test.counts'),
  'a second run creates nothing new and moves no marker');

select is(pg_temp.slots('b10', '2026-11-16'),
  '1[2026-11-16 00:00,2026-11-17 00:00) 3[2026-11-18 00:00,2026-11-19 00:00)',
  'fixed days Mon Wed Fri ending Wednesday: only slots 1 and 3 that week');

-- "Quiet" (New York, no commitments) gets its group week at its own Monday 00:00 (05:00 UTC).
select tests.freeze_time('2026-11-16 04:59:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.lock_at('g3', '2026-11-16'), null,
  'a group with no commitments has no week row one minute before its Monday');
select tests.freeze_time('2026-11-16 05:00:00+00');
select private.tick_step_1_sessions();
select is(pg_temp.lock_at('g3', '2026-11-16'), '2026-11-26 05:00:00+00'::timestamptz,
  'at its Monday 00:00 it gets the row, locking Thursday 00:00 New York time');

-- A run on Saturday, then a 3-day pause until Tuesday 24 Nov.
select tests.freeze_time('2026-11-21 12:00:00+00');
select private.tick_step_1_sessions();
-- erin's Solo walk started on 2 Nov but was never generated: 2 and 9 Nov are locked by 24 Nov.
select pg_catalog.set_config('test.l1',
  pg_temp.add_plan('erin', 'g2', 'walk', null, 1::smallint, '2026-11-02')::text, true);

select tests.freeze_time('2026-11-24 12:00:00+00');
select private.tick_step_1_sessions();
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.b1')::uuid and s.week_start = '2026-11-23'),
  3, 'after a 3-day pause the missing week is generated');
select is(pg_temp.marker('b1'), '2026-11-23'::date, 'and the marker moves to it');
select is(pg_temp.slots('b6', '2026-11-23'), '4[2026-11-26 00:00,2026-11-27 00:00)',
  'week D+1 uses the new version');
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.b5')::uuid and s.week_start > '2026-11-16'),
  0, 'ends_after_week_start = D: week D+1 gets nothing');
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.b3')::uuid and s.week_start > '2026-11-16'),
  0, 'nothing after the end date');
select is(
  (select pg_catalog.array_agg(s.week_start order by s.week_start) from public.sessions s
   where s.commitment_id = current_setting('test.l1')::uuid),
  array['2026-11-16', '2026-11-23']::date[],
  'catch-up skips the locked weeks (2 and 9 Nov) and generates the open ones in order');
select is(pg_temp.marker('l1'), '2026-11-23'::date, 'the marker still advances past the locked weeks');
select is(
  (select count(*)::integer from public.group_weeks gw
   where gw.group_id = current_setting('test.g2')::uuid and gw.week_start = '2026-11-02'),
  0, 'no group week is written for a locked week');

-- ===== RLS: reads =====
select pg_catalog.set_config('test.gw_g1',
  (select count(*)::text from public.group_weeks gw where gw.group_id = current_setting('test.g1')::uuid), true);
select tests.authenticate_as('nina');
select public.leave_group(current_setting('test.g1')::uuid);

select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.sessions s where s.commitment_id = current_setting('test.b1')::uuid),
  6, 'a current member reads another current member''s sessions');
select is(
  (select count(*)::text from public.group_weeks gw where gw.group_id = current_setting('test.g1')::uuid),
  current_setting('test.gw_g1'), 'a current member reads the group''s weeks');
select is(
  (select count(*)::integer from public.sessions s where s.commitment_id = current_setting('test.n1')::uuid),
  0, 'sessions of an ended membership are hidden from the group');
select is(
  (select count(*)::integer from public.sessions s where s.group_id = current_setting('test.g2')::uuid)
  + (select count(*)::integer from public.group_weeks gw where gw.group_id = current_setting('test.g2')::uuid),
  0, 'a member of another group reads none of Solo''s sessions or weeks');
select throws_ok(
  format($$ insert into public.sessions (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
            select group_id, membership_id, user_id, commitment_id, '2026-12-07', 1, now(), now() + interval '1 day'
            from public.sessions where commitment_id = %L limit 1 $$, current_setting('test.b1')),
  '42501', null, 'a client cannot insert sessions');
select throws_ok(
  $$ select count(*) from public.heartbeat $$,
  '42501', null, 'a client cannot read the heartbeat');
select throws_ok(
  $$ select private.tick() $$,
  '42501', null, 'a client cannot run the tick');
select throws_ok(
  format($$ select private.ensure_group_week(%L, '2026-12-07') $$, current_setting('test.g1')),
  '42501', null, 'a client cannot call ensure_group_week');

select tests.authenticate_as('nina');
select is(
  (select count(*)::integer from public.sessions) + (select count(*)::integer from public.group_weeks),
  0, 'an ended membership reads no sessions or group weeks, not even its own');

select tests.authenticate_as('dave');
select is(
  (select count(*)::integer from public.sessions) + (select count(*)::integer from public.group_weeks),
  0, 'a non-member reads no sessions or group weeks');

select tests.clear_authentication();
select throws_ok($$ select count(*) from public.sessions $$, '42501', null, 'anon cannot read sessions');
select throws_ok($$ select count(*) from public.group_weeks $$, '42501', null, 'anon cannot read group_weeks');
select throws_ok($$ select private.tick() $$, '42501', null, 'anon cannot run the tick');

-- ===== private.tick(): busy, heartbeat, order, a failing step =====
reset role;
-- Mon 30 Nov 00:30 London: alice's week 30 Nov is due.
select tests.freeze_time('2026-11-30 00:30:00+00');

-- Another session holds the tick lock: a second connection through dblink, over the same network
-- address pg_prove used (so the password is checked). The lock is released and the connection
-- closed even if tick() raises.
do $$
declare
  v_conn text;
  v_error text;
begin
  create extension if not exists dblink with schema extensions;
  v_conn := pg_catalog.format('host=%s port=%s dbname=%s user=postgres password=postgres',
    coalesce(pg_catalog.host(pg_catalog.inet_server_addr()), '127.0.0.1'),
    coalesce(pg_catalog.inet_server_port(), 5432),
    pg_catalog.current_database());
  perform extensions.dblink_connect('proofy_busy', v_conn);
  perform * from extensions.dblink('proofy_busy',
    'select pg_catalog.pg_advisory_lock(pg_catalog.hashtext(''proofy.tick''))::text') as t(v text);
  begin
    perform private.tick();
  exception when others then
    v_error := sqlerrm;
  end;
  perform * from extensions.dblink('proofy_busy',
    'select pg_catalog.pg_advisory_unlock(pg_catalog.hashtext(''proofy.tick''))::text') as t(v text);
  perform extensions.dblink_disconnect('proofy_busy');
  if v_error is not null then
    raise exception 'tick() raised while another session held the lock: %', v_error;
  end if;
end;
$$;
select ok(
  pg_temp.slots('b1', '2026-11-30') = '-'
  and (select h.last_run_at from public.heartbeat h) is distinct from '2026-11-30 00:30:00+00'::timestamptz,
  'while another session holds the tick lock, tick() returns at once: no step runs, no heartbeat'
);

-- From here this transaction holds the lock, so the real cron job's runs return at once.
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

select private.tick();
select is((select h.last_run_at from public.heartbeat h), '2026-11-30 00:30:00+00'::timestamptz,
  'a tick run writes the heartbeat''s last_run_at');
select is(pg_temp.slots('b1', '2026-11-30'),
  '1[2026-11-30 00:00,2026-12-01 00:00) 3[2026-12-02 00:00,2026-12-03 00:00) 5[2026-12-04 00:00,2026-12-05 00:00)',
  'and step 1 generated the due week');

select tests.freeze_time('2026-11-30 00:31:00+00');
select private.tick();
select is((select h.last_run_at from public.heartbeat h), '2026-11-30 00:31:00+00'::timestamptz,
  'last_run_at moves on every run');

-- One failing commitment: bob's profile zone is broken (written as the table owner), so his week
-- fails. alice's commitment in the same run still gets its sessions; step 1 is recorded as failed.
select tests.freeze_time('2026-12-07 00:30:00+00');
update public.profiles set time_zone = 'Not/A_Zone' where id = tests.get_supabase_uid('bob');
select lives_ok($$ select private.tick() $$, 'a failing commitment does not fail the tick');
select is(pg_temp.slots('b7', '2026-12-07'), '-', 'the failing commitment gets nothing');
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.b1')::uuid and s.week_start = '2026-12-07'),
  3, 'another commitment in the same run still gets its sessions');
select ok(
  (select h.last_run_at = '2026-12-07 00:30:00+00'::timestamptz
          and h.last_error_step = 1
          and h.last_error like 'commitment ' || current_setting('test.b7') || ': %'
          and h.last_error_at = '2026-12-07 00:30:00+00'::timestamptz
   from public.heartbeat h),
  'the heartbeat names step 1 and the failing commitment'
);
update public.profiles set time_zone = 'Pacific/Auckland' where id = tests.get_supabase_uid('bob');

-- Step 1 runs before step 8: a probe step 1 records the heartbeat it saw. The real step 1 (with
-- the test search_path) is kept to restore later.
select pg_catalog.set_config('test.step1_def',
  pg_catalog.pg_get_functiondef('private.tick_step_1_sessions()'::regprocedure), true);
create temp table tick_probe (seen_last_run_at timestamptz);
create or replace function private.tick_step_1_sessions()
returns text
language plpgsql
set search_path = ''
as $$
begin
  insert into pg_temp.tick_probe (seen_last_run_at) select h.last_run_at from public.heartbeat h;
  return null;
end;
$$;
select tests.freeze_time('2026-12-07 00:32:00+00');
select private.tick();
select is(
  (select p.seen_last_run_at::text || ' then ' || (select h.last_run_at::text from public.heartbeat h)
   from pg_temp.tick_probe p),
  '2026-12-07 00:30:00+00'::timestamptz::text || ' then ' || '2026-12-07 00:32:00+00'::timestamptz::text,
  'step 1 runs before step 8 writes the heartbeat'
);

-- A failing step 1: its own writes roll back, it is recorded, and step 8 still runs.
create or replace function private.tick_step_1_sessions()
returns text
language plpgsql
set search_path = ''
as $$
begin
  insert into pg_temp.tick_probe (seen_last_run_at) values ('2000-01-01 00:00:00+00');
  raise exception 'step one broke';
end;
$$;
select tests.freeze_time('2026-12-07 00:33:00+00');
select lives_ok($$ select private.tick() $$, 'a failing step does not fail the tick');
select ok(
  (select h.last_run_at = '2026-12-07 00:33:00+00'::timestamptz
          and h.last_error_step = 1
          and h.last_error = 'step one broke'
          and h.last_error_at = '2026-12-07 00:33:00+00'::timestamptz
   from public.heartbeat h),
  'the heartbeat records step 1, SQLERRM and the time, and step 8 still wrote last_run_at'
);
select is((select count(*)::integer from pg_temp.tick_probe), 1, 'the failing step''s own writes rolled back');

-- The real step 1 back: a later clean run moves last_run_at and keeps the earlier failure.
do $$ begin execute current_setting('test.step1_def'); end; $$;
select tests.freeze_time('2026-12-07 00:40:00+00');
select private.tick();
select ok(
  (select h.last_run_at = '2026-12-07 00:40:00+00'::timestamptz
          and h.last_error_step = 1
          and h.last_error = 'step one broke'
          and h.last_error_at = '2026-12-07 00:33:00+00'::timestamptz
   from public.heartbeat h),
  'a later clean run moves last_run_at and leaves the last failure in the error columns'
);

-- A missing heartbeat row is recreated by step 8.
delete from public.heartbeat;
select tests.freeze_time('2026-12-07 00:41:00+00');
select private.tick();
select ok(
  (select count(*) = 1 and bool_and(h.last_run_at = '2026-12-07 00:41:00+00'::timestamptz)
   from public.heartbeat h),
  'step 8 recreates a missing heartbeat row'
);

-- ===== ensure_group_week and group_time_zone =====
select private.ensure_group_week(current_setting('test.g1')::uuid, '2026-12-21');
select is(pg_temp.lock_at('g1', '2026-12-21'), '2026-12-31 00:00:00+00'::timestamptz,
  'ensure_group_week sets lock_at to Thursday 00:00 after the week in the group zone');
update public.groups set time_zone = 'America/New_York' where id = current_setting('test.g1')::uuid;
select private.ensure_group_week(current_setting('test.g1')::uuid, '2026-12-21');
select private.ensure_group_week(current_setting('test.g1')::uuid, '2026-12-28');
select ok(
  pg_temp.lock_at('g1', '2026-12-21') = '2026-12-31 00:00:00+00'::timestamptz
  and pg_temp.lock_at('g1', '2026-12-28') = '2027-01-07 05:00:00+00'::timestamptz,
  'ensure_group_week leaves an existing row alone and reads the group zone through group_time_zone'
);

select * from finish();
rollback;
