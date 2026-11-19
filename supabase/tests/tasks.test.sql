-- Tasks (Story 2.4): the task columns and their kind check, add_task (deadline window in the
-- member's zone, name rules, the session written at once, the group week ensured, FR-10 exemption),
-- delete_task (before the deadline day only, across a DST change), rename_task (until the session
-- ends), get_task (edit mode's read), RLS reads and grants per role.
--
-- Cast: alice (Europe/London) creates "Crew" (group zone Europe/London); bob (Pacific/Auckland)
-- joins with alice's invite. dave (UTC) is in no group. erin (UTC) is alone in "Solo" (a waiting
-- group).
-- Weeks under test: Mon 19 Oct to Sun 25 Oct 2026 (London falls back from BST to GMT at 02:00 on
-- Sun 25 Oct, so that Sunday is 25 hours long), and Mon 16 Nov to Sun 22 Nov 2026 (GMT in London,
-- NZDT, UTC+13, in Auckland).
-- The task RPCs, add_commitment and private.commitment_is_active call now() unqualified; as the
-- owner their search_path is pointed at test_overrides so tests.freeze_time moves their clock
-- (rolled back with everything else).
begin;
-- Timestamps compare as text in UTC.
set local timezone = 'UTC';
select plan(77);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

-- ===== Shape =====
select columns_are('public', 'commitments',
  array['id', 'group_id', 'membership_id', 'user_id', 'kind', 'group_activity_id', 'schedule_type',
        'ends_after_week_start', 'created_at', 'updated_at', 'sessions_through', 'name', 'deadline',
        'deadline_day_starts_at'],
  'commitments gains name, deadline and deadline_day_starts_at');
select col_is_null('public', 'commitments', 'name', 'name is nullable');
select col_type_is('public', 'commitments', 'deadline', 'date', 'deadline is a date');
select col_type_is('public', 'commitments', 'deadline_day_starts_at', 'timestamp with time zone',
  'deadline_day_starts_at is a timestamptz');
select ok(
  pg_catalog.to_regprocedure('public.add_task(uuid, text, uuid, text, text, date)') is not null
  and pg_catalog.to_regprocedure('public.delete_task(uuid)') is not null
  and pg_catalog.to_regprocedure('public.rename_task(uuid, text)') is not null
  and pg_catalog.to_regprocedure('public.get_task(uuid)') is not null,
  'add_task, delete_task, rename_task and get_task exist with the story''s signatures'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in (
     'public.add_task(uuid, text, uuid, text, text, date)'::regprocedure,
     'public.delete_task(uuid)'::regprocedure,
     'public.rename_task(uuid, text)'::regprocedure,
     'public.get_task(uuid)'::regprocedure)),
  'the task functions pin search_path to empty'
);
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in (
     'public.add_task(uuid, text, uuid, text, text, date)'::regprocedure,
     'public.delete_task(uuid)'::regprocedure,
     'public.rename_task(uuid, text)'::regprocedure))
  and (select not p.prosecdef and p.provolatile = 's' from pg_catalog.pg_proc p
       where p.oid = 'public.get_task(uuid)'::regprocedure),
  'the three writes are security definer; get_task is stable and security invoker'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.add_task(uuid, text, uuid, text, text, date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.delete_task(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.rename_task(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_task(uuid)', 'EXECUTE'),
  'authenticated can execute the four task functions'
);
select ok(
  not has_function_privilege('anon', 'public.add_task(uuid, text, uuid, text, text, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.delete_task(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.rename_task(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_task(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.add_task(uuid, text, uuid, text, text, date)', 'EXECUTE')
  and not has_function_privilege('public', 'public.delete_task(uuid)', 'EXECUTE'),
  'anon and PUBLIC cannot execute the task functions'
);
select ok(
  has_table_privilege('authenticated', 'public.commitments', 'SELECT')
  and not has_table_privilege('authenticated', 'public.commitments', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('authenticated', 'public.sessions', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'authenticated still only reads commitments and sessions'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Pacific/Auckland');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));

-- ===== Frozen clock =====
reset role;
alter function public.add_task(uuid, text, uuid, text, text, date) set search_path = test_overrides, pg_catalog;
alter function public.delete_task(uuid) set search_path = test_overrides, pg_catalog;
alter function public.rename_task(uuid, text) set search_path = test_overrides, pg_catalog;
alter function public.get_task(uuid) set search_path = test_overrides, pg_catalog;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
select pg_catalog.set_config('test.alice_m',
  (select m.id::text from public.memberships m
   where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('alice')), true);

-- The kind check: the task columns are set exactly when kind = 'task'.
select throws_ok(
  format($$ insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id)
            values (%L, %L, %L, 'task', %L) $$,
         current_setting('test.g1'), current_setting('test.alice_m'), tests.get_supabase_uid('alice'),
         (private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, null)).id),
  '23514', null, 'a task without name, deadline and deadline_day_starts_at is refused');
select throws_ok(
  format($$ insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id,
              schedule_type, name, deadline, deadline_day_starts_at)
            values (%L, %L, %L, 'commitment', %L, 'fixed_days', 'Gym', '2026-11-22', '2026-11-22 00:00+00') $$,
         current_setting('test.g1'), current_setting('test.alice_m'), tests.get_supabase_uid('alice'),
         (private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, null)).id),
  '23514', null, 'a commitment with task columns is refused');
select throws_ok(
  format($$ insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id,
              name, deadline, deadline_day_starts_at)
            values (%L, %L, %L, 'task', %L, %L, '2026-11-22', '2026-11-22 00:00+00') $$,
         current_setting('test.g1'), current_setting('test.alice_m'), tests.get_supabase_uid('alice'),
         (private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, null)).id,
         pg_catalog.repeat('x', 41)),
  '23514', null, 'a task name of 41 characters is refused by the table');

-- ===== Delete across a DST change (London, Sun 25 Oct 2026 is 25 hours long) =====
select tests.freeze_time('2026-10-23 12:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.early', (select a.commitment_id::text
  from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean', p_name => 'Early',
    p_deadline => '2026-10-25') a), true);
select pg_catalog.set_config('test.late', (select a.commitment_id::text
  from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean', p_name => 'Late',
    p_deadline => '2026-10-25') a), true);
reset role;
select is(
  (select c.deadline_day_starts_at from public.commitments c where c.id = current_setting('test.late')::uuid),
  '2026-10-24 23:00:00+00'::timestamptz,
  'deadline_day_starts_at is local midnight in BST (23:00 UTC the day before)'
);
select is(
  (select s.week_start::text || ' '
          || (extract(epoch from (s.ends_at - c.deadline_day_starts_at)) / 3600)::integer::text
   from public.sessions s join public.commitments c on c.id = s.commitment_id
   where s.commitment_id = current_setting('test.late')::uuid),
  '2026-10-19 25',
  'the session ends at the next local midnight, 25 hours after the fall-back Sunday starts'
);

select tests.freeze_time('2026-10-24 22:59:59+00');
select tests.authenticate_as('alice');
select lives_ok(
  format($$ select public.delete_task(%L) $$, current_setting('test.early')),
  'delete one second before the deadline day starts (across the DST change) works');
reset role;
select is(
  (select count(*)::integer from public.commitments where id = current_setting('test.early')::uuid)
  + (select count(*)::integer from public.sessions where commitment_id = current_setting('test.early')::uuid),
  0, 'the task and its session are gone');

select tests.freeze_time('2026-10-24 23:00:00+00');
select tests.authenticate_as('alice');
select throws_ok(
  format($$ select public.delete_task(%L) $$, current_setting('test.late')),
  'P0001', 'task_locked', 'delete at deadline_day_starts_at raises task_locked');
reset role;
select is(
  (select count(*)::integer from public.commitments where id = current_setting('test.late')::uuid)
  + (select count(*)::integer from public.sessions where commitment_id = current_setting('test.late')::uuid),
  2, 'the locked task and its session stay');

-- ===== add_task (Wednesday 18 Nov 10:00, London: today 18 Nov, Sunday 22 Nov) =====
select tests.freeze_time('2026-11-18 10:00:00+00');
select is(
  (select count(*)::integer from public.group_weeks
   where group_id = current_setting('test.g1')::uuid and week_start = '2026-11-16'),
  0, 'no group week row for Crew''s week of 16 Nov yet');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.today', (select a.commitment_id::text
  from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'groceries',
    p_name => '  Grocery run  ', p_deadline => '2026-11-18') a), true);
select ok(current_setting('test.today') <> '', 'a task with today''s deadline is added and returns its id');
select pg_catalog.set_config('test.sunday', (select a.commitment_id::text
  from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'groceries',
    p_name => 'Weekly shop', p_deadline => '2026-11-22') a), true);
select ok(current_setting('test.sunday') <> '', 'a task with a Sunday deadline is added');

reset role;
select is(
  (select c.group_id::text || ':' || c.membership_id::text || ':' || c.user_id::text || ':' || c.kind
          || ':' || coalesce(c.schedule_type, '-') || ':' || c.name || ':' || c.deadline::text
          || ':' || coalesce(c.sessions_through::text, '-')
   from public.commitments c where c.id = current_setting('test.today')::uuid),
  current_setting('test.g1') || ':' || current_setting('test.alice_m') || ':'
    || tests.get_supabase_uid('alice')::text || ':task:-:Grocery run:2026-11-18:-',
  'the task row has the group, membership, owner, kind task, no schedule type and the trimmed name'
);
select is(
  (select c.deadline_day_starts_at from public.commitments c where c.id = current_setting('test.today')::uuid),
  '2026-11-18 00:00:00+00'::timestamptz, 'deadline_day_starts_at is the deadline''s local midnight');
select is(
  (select pg_catalog.string_agg(s.slot::text || ' ' || s.week_start::text || ' ' || s.starts_at::text
          || ' ' || s.ends_at::text || ' ' || (s.membership_id::text = current_setting('test.alice_m'))::text, '; ')
   from public.sessions s where s.commitment_id = current_setting('test.today')::uuid),
  '0 2026-11-16 2026-11-18 10:00:00+00 2026-11-19 00:00:00+00 true',
  'one session at once: slot 0, this week, from now to the local midnight after the deadline'
);
select is(
  (select s.ends_at from public.sessions s where s.commitment_id = current_setting('test.sunday')::uuid),
  '2026-11-23 00:00:00+00'::timestamptz, 'a Sunday deadline ends at the midnight starting next week');
select is(
  (select gw.lock_at from public.group_weeks gw
   where gw.group_id = current_setting('test.g1')::uuid and gw.week_start = '2026-11-16'),
  '2026-11-26 00:00:00+00'::timestamptz, 'the group week row is ensured, locking Thursday 00:00 group time');

-- Invalid input: nothing is written.
select pg_catalog.set_config('test.before',
  (select count(*)::text || '/' || (select count(*) from public.sessions)::text
          || '/' || (select count(*) from public.group_activities)::text
          || '/' || (select count(*) from public.group_weeks)::text
   from public.commitments), true);
select tests.authenticate_as('alice');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_name => 'Dog', p_deadline => '2026-11-17') $$,
  'P0001', 'invalid_deadline', 'a deadline of yesterday raises invalid_deadline');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_name => 'Dog', p_deadline => '2026-11-23') $$,
  'P0001', 'invalid_deadline', 'a deadline of next Monday raises invalid_deadline');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_name => 'Dog') $$,
  'P0001', 'invalid_deadline', 'no deadline raises invalid_deadline');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_name => '   ', p_deadline => '2026-11-20') $$,
  'P0001', 'invalid_plan', 'a name of only spaces raises invalid_plan');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_deadline => '2026-11-20') $$,
  'P0001', 'invalid_plan', 'no name raises invalid_plan');
select throws_ok(
  format($$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_name => %L, p_deadline => '2026-11-20') $$,
         pg_catalog.repeat('x', 41)),
  'P0001', 'invalid_plan', 'a trimmed name of 41 characters raises invalid_plan');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_name => 'Dog', p_deadline => '2026-11-20') $$,
  'P0001', 'invalid_activity', 'no activity raises invalid_activity');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'nope', p_name => 'Dog', p_deadline => '2026-11-20') $$,
  'P0001', 'invalid_activity', 'an unknown preset raises invalid_activity');
select tests.authenticate_as('dave');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_name => 'Dog', p_deadline => '2026-11-20') $$,
  'P0001', 'not_member', 'a non-member gets not_member');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_name => '', p_deadline => '2026-11-01') $$,
  'P0001', 'not_member', 'not_member comes before name and deadline validation');
reset role;
select is(
  (select count(*)::text || '/' || (select count(*) from public.sessions)::text
          || '/' || (select count(*) from public.group_activities)::text
          || '/' || (select count(*) from public.group_weeks)::text
   from public.commitments),
  current_setting('test.before'),
  'nothing was written by the failed calls (no task, session, activity or group week row)'
);
select tests.authenticate_as('alice');
select lives_ok(
  format($$ select * from public.add_task(current_setting('test.g1')::uuid, p_custom_name => 'Errands', p_name => %L, p_deadline => '2026-11-20') $$,
         pg_catalog.repeat('x', 40)),
  'a name of 40 characters and a custom activity are accepted');

-- FR-10: tasks never check, set or lock the schedule type.
select tests.authenticate_as('bob');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'times_per_week', p_target => 3) $$,
  'bob adds Gym as times per week');
select tests.authenticate_as('alice');
select lives_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_name => 'Leg day', p_deadline => '2026-11-21') $$,
  'a task to Gym is allowed while Gym is times per week in the group');
reset role;
select is(
  (select ga.schedule_type from public.group_activities ga
   where ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'gym'),
  'times_per_week', 'and Gym''s type is untouched');
select is(
  (select coalesce(ga.schedule_type, '-') from public.group_activities ga
   where ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'groceries'),
  '-', 'a task to a new activity leaves its type unset');
select tests.authenticate_as('bob');
select is(
  (select o.locked_schedule_type from public.group_activity_options o
   where o.group_id = current_setting('test.g1')::uuid and o.preset_key = 'groceries'),
  null, 'tasks do not lock the type in group_activity_options');

-- A waiting group (one member) works as usual.
select tests.authenticate_as('erin');
select lives_ok(
  $$ select * from public.add_task(current_setting('test.g2')::uuid, p_preset_key => 'clean', p_name => 'Garage', p_deadline => '2026-11-22') $$,
  'a member of a waiting group can add a task');

-- RLS: a co-member reads the task and its session.
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.commitments where id = current_setting('test.today')::uuid)
  + (select count(*)::integer from public.sessions where commitment_id = current_setting('test.today')::uuid),
  2, 'a current co-member reads the task and its session');
select tests.authenticate_as('dave');
select is(
  (select count(*)::integer from public.commitments where id = current_setting('test.today')::uuid),
  0, 'a non-member reads no task');

-- ===== get_task (Wednesday 18 Nov 10:00) =====
select tests.authenticate_as('alice');
select is(
  (select g.commitment_id::text || ':' || g.group_id::text || ':' || coalesce(g.preset_key, '-') || ':'
          || coalesce(g.custom_name, '-') || ':' || g.name || ':' || g.deadline::text || ':'
          || g.can_delete::text || ':' || g.can_rename::text
   from public.get_task(current_setting('test.sunday')::uuid) g),
  current_setting('test.sunday') || ':' || current_setting('test.g1') || ':groceries:-:Weekly shop:2026-11-22:true:true',
  'get_task returns the task with can_delete and can_rename before the deadline day'
);
select is(
  (select g.can_delete::text || ':' || g.can_rename::text from public.get_task(current_setting('test.today')::uuid) g),
  'false:true', 'a task due today cannot be deleted but can be renamed');
select is(
  (select coalesce(g.preset_key, '-') || ':' || g.custom_name
   from public.get_task((select c.id from public.commitments c where c.name = pg_catalog.repeat('x', 40))) g),
  '-:Errands', 'get_task returns a custom activity''s name');
select tests.authenticate_as('bob');
select throws_ok(
  format($$ select * from public.get_task(%L) $$, current_setting('test.today')),
  'P0001', 'not_found', 'get_task of another member''s task raises not_found');
select throws_ok(
  format($$ select * from public.get_task(%L) $$,
         (select c.id from public.commitments c where c.user_id = tests.get_supabase_uid('bob') and c.kind = 'commitment')),
  'P0001', 'not_found', 'get_task of a commitment raises not_found');
select throws_ok(
  $$ select * from public.get_task(pg_catalog.gen_random_uuid()) $$,
  'P0001', 'not_found', 'get_task of an unknown id raises not_found');

-- ===== delete_task (Wednesday 18 Nov 10:00) =====
select tests.authenticate_as('alice');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read', p_schedule_type => 'fixed_days', p_days => array[1]) $$,
  'alice adds Read as a commitment');
select throws_ok(
  format($$ select public.delete_task(%L) $$, current_setting('test.today')),
  'P0001', 'task_locked', 'a task due today can never be deleted');
select throws_ok(
  format($$ select public.delete_task(%L) $$,
         (select c.id from public.commitments c where c.user_id = tests.get_supabase_uid('alice') and c.kind = 'commitment')),
  'P0001', 'not_found', 'delete_task of a commitment raises not_found');
select tests.authenticate_as('bob');
select throws_ok(
  format($$ select public.delete_task(%L) $$, current_setting('test.sunday')),
  'P0001', 'not_found', 'delete by another member raises not_found');
reset role;
select is(
  (select count(*)::integer from public.commitments
   where id in (current_setting('test.today')::uuid, current_setting('test.sunday')::uuid))
  + (select count(*)::integer from public.commitments where user_id = tests.get_supabase_uid('alice') and kind = 'commitment'),
  3, 'refused deletes remove nothing');

-- ===== rename_task =====
select tests.authenticate_as('alice');
select lives_ok(
  format($$ select public.rename_task(%L, '  Big shop ') $$, current_setting('test.sunday')),
  'the owner renames a task before it ends');
reset role;
select is(
  (select c.name from public.commitments c where c.id = current_setting('test.sunday')::uuid),
  'Big shop', 'the new name is stored trimmed');
select tests.authenticate_as('alice');
select throws_ok(
  format($$ select public.rename_task(%L, ' ') $$, current_setting('test.sunday')),
  'P0001', 'invalid_plan', 'renaming to only spaces raises invalid_plan');
select throws_ok(
  format($$ select public.rename_task(%L, %L) $$, current_setting('test.sunday'), pg_catalog.repeat('x', 41)),
  'P0001', 'invalid_plan', 'renaming to 41 characters raises invalid_plan');
select tests.authenticate_as('bob');
select throws_ok(
  format($$ select public.rename_task(%L, 'Mine now') $$, current_setting('test.sunday')),
  'P0001', 'not_found', 'rename by another member raises not_found');

select tests.freeze_time('2026-11-18 23:59:59+00');
select tests.authenticate_as('alice');
select lives_ok(
  format($$ select public.rename_task(%L, 'Quick shop') $$, current_setting('test.today')),
  'rename one second before the session ends works');
select tests.freeze_time('2026-11-19 00:00:00+00');
select throws_ok(
  format($$ select public.rename_task(%L, 'Too late') $$, current_setting('test.today')),
  'P0001', 'task_locked', 'rename at the session''s ends_at raises task_locked');
select is(
  (select g.name || ':' || g.can_delete::text || ':' || g.can_rename::text
   from public.get_task(current_setting('test.today')::uuid) g),
  'Quick shop:false:false', 'after the session ends get_task reports neither delete nor rename');
select lives_ok(
  format($$ select public.delete_task(%L) $$, current_setting('test.sunday')),
  'a task whose deadline day has not started (Sunday) can still be deleted on Thursday');
reset role;
select is(
  (select count(*)::integer from public.commitments where id = current_setting('test.sunday')::uuid)
  + (select count(*)::integer from public.sessions where commitment_id = current_setting('test.sunday')::uuid),
  0, 'the deleted task and its session are gone');

-- ===== Late Sunday (Sun 22 Nov 23:50, London) =====
select tests.freeze_time('2026-11-22 23:50:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.latesun', (select a.commitment_id::text
  from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean', p_name => 'Dishes',
    p_deadline => '2026-11-22') a), true);
reset role;
select is(
  (select s.starts_at::text || ' ' || s.ends_at::text || ' ' || s.week_start::text
   from public.sessions s where s.commitment_id = current_setting('test.latesun')::uuid),
  '2026-11-22 23:50:00+00 2026-11-23 00:00:00+00 2026-11-16',
  'a task added Sunday 23:50 for today ends at local midnight, 10 minutes later'
);
select tests.authenticate_as('alice');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean', p_name => 'Dishes', p_deadline => '2026-11-23') $$,
  'P0001', 'invalid_deadline', 'on Sunday night Monday is still next week');

-- ===== Member zone (Sun 22 Nov 11:30 UTC is Mon 23 Nov 00:30 in Auckland) =====
select tests.freeze_time('2026-11-22 11:30:00+00');
select tests.authenticate_as('bob');
select throws_ok(
  $$ select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'run', p_name => 'Park', p_deadline => '2026-11-22') $$,
  'P0001', 'invalid_deadline', 'a member ahead of the group cannot pick the group''s Sunday (their yesterday)');
select pg_catalog.set_config('test.bob', (select a.commitment_id::text
  from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'run', p_name => 'Park',
    p_deadline => '2026-11-29') a), true);
reset role;
select is(
  (select s.week_start::text || ' ' || s.ends_at::text
   from public.sessions s where s.commitment_id = current_setting('test.bob')::uuid),
  '2026-11-23 2026-11-29 11:00:00+00',
  'the session is in the member''s own week and ends at their local midnight'
);
select is(
  (select gw.lock_at from public.group_weeks gw
   where gw.group_id = current_setting('test.g1')::uuid and gw.week_start = '2026-11-23'),
  '2026-12-03 00:00:00+00'::timestamptz, 'the member''s week is ensured for the group, locking in group time');

-- ===== anon =====
select tests.clear_authentication();
select throws_ok(
  $$ select * from public.add_task(pg_catalog.gen_random_uuid(), p_preset_key => 'gym', p_name => 'x', p_deadline => '2026-11-22') $$,
  '42501', null, 'anon cannot call add_task');
select throws_ok(
  $$ select public.delete_task(pg_catalog.gen_random_uuid()) $$,
  '42501', null, 'anon cannot call delete_task');
select throws_ok(
  $$ select public.rename_task(pg_catalog.gen_random_uuid(), 'x') $$,
  '42501', null, 'anon cannot call rename_task');
select throws_ok(
  $$ select * from public.get_task(pg_catalog.gen_random_uuid()) $$,
  '42501', null, 'anon cannot call get_task');

select * from finish();
rollback;
