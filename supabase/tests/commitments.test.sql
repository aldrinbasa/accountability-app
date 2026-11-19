-- Commitments (Story 2.2): the commitments and commitment_versions tables, the shared time helpers,
-- add_commitment (first week, validation codes, FR-10 schedule-type lock), plan_preview (dates and
-- the pro-rated last week), the replaced group_activity_options view, RLS and grants per role.
--
-- Cast: alice (Europe/London) creates "Crew" (admin, group zone Europe/London); bob
-- (Pacific/Auckland) and carol (Europe/London) join with alice's invite; carol later leaves.
-- dave (UTC) is in no group. erin (UTC) is alone in "Solo" (a waiting group).
-- The week under test: Mon 16 Nov to Sun 22 Nov 2026; next Monday is 23 Nov. November is GMT in
-- London and NZDT (UTC+13) in Auckland.
-- add_commitment, plan_preview and private.commitment_is_active call now() unqualified; as the
-- owner their search_path is pointed at test_overrides so tests.freeze_time moves their clock
-- (rolled back with everything else).
begin;
select plan(109);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

-- ===== Shape =====
select has_table('public', 'commitments', 'public.commitments exists');
select has_table('public', 'commitment_versions', 'public.commitment_versions exists');
select columns_are('public', 'commitments',
  array['id', 'group_id', 'membership_id', 'user_id', 'kind', 'group_activity_id', 'schedule_type',
        'ends_after_week_start', 'created_at', 'updated_at', 'sessions_through'],
  'commitments has the story''s columns (and Story 2.3''s sessions_through)');
select columns_are('public', 'commitment_versions',
  array['id', 'commitment_id', 'group_id', 'effective_week_start', 'days', 'target', 'end_date',
        'created_at', 'updated_at'],
  'commitment_versions has the story''s columns');
select index_is_unique('public', 'commitment_versions', 'commitment_versions_one_per_week',
  'one version per commitment per week is a unique index');
select tests.rls_enabled('public', 'commitments');
select tests.rls_enabled('public', 'commitment_versions');
select columns_are('public', 'group_activity_options',
  array['id', 'group_id', 'preset_key', 'custom_name', 'created_by', 'locked_schedule_type'],
  'group_activity_options keeps its columns');
select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_catalog.pg_class c
   where c.oid = 'public.group_activity_options'::regclass),
  'group_activity_options is still security_invoker'
);
select ok(
  pg_catalog.to_regprocedure('private.week_start_of(timestamptz, text)') is not null
  and pg_catalog.to_regprocedure('private.local_start(date, text)') is not null
  and pg_catalog.to_regprocedure('private.member_time_zone(uuid, date)') is not null
  and pg_catalog.to_regprocedure('private.prorated_target(smallint, smallint)') is not null
  and pg_catalog.to_regprocedure('private.commitment_is_active(public.commitments)') is not null,
  'the five shared helpers exist with the story''s signatures'
);
select ok(
  (select p.prorettype = 'date'::regtype from pg_catalog.pg_proc p
   where p.oid = 'private.week_start_of(timestamptz, text)'::regprocedure)
  and (select p.prorettype = 'timestamptz'::regtype from pg_catalog.pg_proc p
       where p.oid = 'private.local_start(date, text)'::regprocedure)
  and (select p.prorettype = 'text'::regtype from pg_catalog.pg_proc p
       where p.oid = 'private.member_time_zone(uuid, date)'::regprocedure)
  and (select p.prorettype = 'smallint'::regtype from pg_catalog.pg_proc p
       where p.oid = 'private.prorated_target(smallint, smallint)'::regprocedure)
  and (select p.prorettype = 'boolean'::regtype from pg_catalog.pg_proc p
       where p.oid = 'private.commitment_is_active(public.commitments)'::regprocedure),
  'the helpers return date, timestamptz, text, smallint and boolean'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in (
     'public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)'::regprocedure,
     'public.plan_preview(uuid, integer, date)'::regprocedure,
     'private.week_start_of(timestamptz, text)'::regprocedure,
     'private.local_start(date, text)'::regprocedure,
     'private.member_time_zone(uuid, date)'::regprocedure,
     'private.prorated_target(smallint, smallint)'::regprocedure,
     'private.membership_is_current(uuid)'::regprocedure,
     'private.commitment_is_active(public.commitments)'::regprocedure)),
  'the RPCs and helpers pin search_path to empty'
);
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p
   where p.oid = 'public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)'::regprocedure)
  and (select not p.prosecdef and p.provolatile = 's' from pg_catalog.pg_proc p
       where p.oid = 'public.plan_preview(uuid, integer, date)'::regprocedure),
  'add_commitment is security definer; plan_preview is stable and security invoker'
);

-- ===== Grants per role =====
select ok(
  not has_table_privilege('anon', 'public.commitments', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('anon', 'public.commitment_versions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon has no privileges on commitments or commitment_versions'
);
select ok(
  has_table_privilege('authenticated', 'public.commitments', 'SELECT')
  and has_table_privilege('authenticated', 'public.commitment_versions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.commitments', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('authenticated', 'public.commitment_versions', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'authenticated can only SELECT commitments and commitment_versions'
);
select ok(
  has_function_privilege('authenticated', 'public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.plan_preview(uuid, integer, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.plan_preview(uuid, integer, date)', 'EXECUTE'),
  'add_commitment and plan_preview are executable by authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'private.week_start_of(timestamptz, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.member_time_zone(uuid, date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.prorated_target(smallint, smallint)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.membership_is_current(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.commitment_is_active(public.commitments)', 'EXECUTE'),
  'helpers used by RLS, the view and plan_preview are executable by authenticated'
);
select ok(
  not has_function_privilege('anon', 'private.week_start_of(timestamptz, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.member_time_zone(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.prorated_target(smallint, smallint)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.membership_is_current(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.commitment_is_active(public.commitments)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.local_start(date, text)', 'EXECUTE'),
  'no helper is executable by anon'
);
select ok(
  not has_function_privilege('authenticated', 'private.local_start(date, text)', 'EXECUTE')
  and not has_function_privilege('public', 'private.local_start(date, text)', 'EXECUTE'),
  'local_start is not client-executable'
);

-- ===== Time helpers =====
select is(private.week_start_of('2026-11-22 23:30:00+00', 'Europe/London'), '2026-11-16'::date,
  'week_start_of: Sunday 23:30 London is in the week of Monday 16 Nov');
select is(private.week_start_of('2026-11-23 00:01:00+00', 'Europe/London'), '2026-11-23'::date,
  'week_start_of: Monday 00:01 London starts the week of 23 Nov');
select is(private.week_start_of('2026-11-22 11:30:00+00', 'Pacific/Auckland'), '2026-11-23'::date,
  'week_start_of: Sunday 11:30 UTC is already Monday 23 Nov in Auckland');
select is(private.local_start('2026-03-29', 'Europe/London'), '2026-03-29 00:00:00+00'::timestamptz,
  'local_start: midnight before the spring-forward is 00:00 GMT');
select is(private.local_start('2026-03-30', 'Europe/London'), '2026-03-29 23:00:00+00'::timestamptz,
  'local_start: the next local midnight is 23 h later (BST), never + 24 h');
select is(private.prorated_target(3::smallint, 5::smallint), 2::smallint, 'prorated_target: 3 over 5 days is 2');
select is(private.prorated_target(1::smallint, 3::smallint), 1::smallint, 'prorated_target: 1 over 3 days is 1');
select is(private.prorated_target(7::smallint, 1::smallint), 1::smallint, 'prorated_target: 7 over 1 day is 1');
select is(private.prorated_target(2::smallint, 1::smallint), 1::smallint, 'prorated_target: never below 1');

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Pacific/Auckland');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
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
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.c1'));

-- ===== Frozen clock =====
reset role;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function public.plan_preview(uuid, integer, date) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
select pg_catalog.set_config('test.alice_m',
  (select m.id::text from public.memberships m
   where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('alice')), true);

-- ===== First week: Sunday night, Monday early, a member zone that differs from the group's =====
select tests.freeze_time('2026-11-22 23:30:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.sun', (select a.commitment_id::text || '|' || a.starts_on::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study',
    p_schedule_type => 'fixed_days', p_days => array[5, 1, 3]) a), true);
select is(split_part(current_setting('test.sun'), '|', 2), '2026-11-23',
  'saved Sunday 23:30 member time, it starts the next day');

reset role;
select is(
  (select c.group_id::text || ':' || c.membership_id::text || ':' || c.user_id::text || ':' || c.kind
          || ':' || c.schedule_type || ':' || coalesce(c.ends_after_week_start::text, '-')
   from public.commitments c where c.id = split_part(current_setting('test.sun'), '|', 1)::uuid),
  current_setting('test.g1') || ':' || current_setting('test.alice_m') || ':'
    || tests.get_supabase_uid('alice')::text || ':commitment:fixed_days:-',
  'the commitment row has the group, membership, owner, kind and schedule type'
);
select is(
  (select v.group_id::text || ':' || v.effective_week_start::text || ':' || v.days::text || ':'
          || coalesce(v.target::text, '-') || ':' || coalesce(v.end_date::text, '-')
   from public.commitment_versions v where v.commitment_id = split_part(current_setting('test.sun'), '|', 1)::uuid),
  current_setting('test.g1') || ':2026-11-23:{1,3,5}:-:-',
  'one version effective next Monday, with the days sorted'
);
select is(
  (select count(*)::integer from public.commitment_versions v
   where v.commitment_id = split_part(current_setting('test.sun'), '|', 1)::uuid),
  1, 'exactly one version is written'
);
select is(
  (select ga.schedule_type from public.group_activities ga
   where ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'study'),
  'fixed_days', 'the activity''s schedule type is set to the chosen type'
);

select tests.freeze_time('2026-11-23 00:01:00+00');
select tests.authenticate_as('alice');
select is(
  (select a.starts_on from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study',
    p_schedule_type => 'fixed_days', p_days => array[2]) a),
  '2026-11-30'::date,
  'saved Monday 00:01 member time, it starts 7 days later'
);

select tests.freeze_time('2026-11-22 11:30:00+00');
select tests.authenticate_as('bob');
select is(
  (select a.starts_on from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study',
    p_schedule_type => 'fixed_days', p_days => array[6, 7]) a),
  '2026-11-30'::date,
  'a Pacific/Auckland member in a London group starts from their own zone (already Monday there)'
);
select tests.authenticate_as('alice');
select is(
  (select a.starts_on from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study',
    p_schedule_type => 'fixed_days', p_days => array[4]) a),
  '2026-11-23'::date,
  'at the same instant a London member starts the next day'
);

-- ===== Validation (Wednesday 18 Nov: next Monday 23 Nov, earliest end date Sun 29 Nov) =====
select tests.freeze_time('2026-11-18 10:00:00+00');
reset role;
select pg_catalog.set_config('test.before',
  (select count(*)::text || '/' || (select count(*) from public.commitment_versions)::text
          || '/' || (select count(*) from public.group_activities)::text
   from public.commitments), true);
select tests.authenticate_as('alice');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[]::integer[]) $$,
  'P0001', 'invalid_plan', 'fixed days with no day raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[1, 1]) $$,
  'P0001', 'invalid_plan', 'fixed days with a duplicate day raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[0]) $$,
  'P0001', 'invalid_plan', 'day 0 raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[8]) $$,
  'P0001', 'invalid_plan', 'day 8 raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[1, null]) $$,
  'P0001', 'invalid_plan', 'a null day raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days') $$,
  'P0001', 'invalid_plan', 'fixed days without a day list raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[1], p_target => 3) $$,
  'P0001', 'invalid_plan', 'fixed days with a target raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'times_per_week', p_target => 0) $$,
  'P0001', 'invalid_plan', 'target 0 raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'times_per_week', p_target => 8) $$,
  'P0001', 'invalid_plan', 'target 8 raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'times_per_week') $$,
  'P0001', 'invalid_plan', 'times per week without a target raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'times_per_week', p_days => array[1], p_target => 3) $$,
  'P0001', 'invalid_plan', 'times per week with days raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'daily', p_target => 3) $$,
  'P0001', 'invalid_plan', 'an unknown schedule type raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_target => 3) $$,
  'P0001', 'invalid_plan', 'no schedule type raises invalid_plan');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_schedule_type => 'times_per_week', p_target => 3) $$,
  'P0001', 'invalid_activity', 'no activity raises invalid_activity');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'times_per_week', p_target => 3, p_end_date => '2026-11-28') $$,
  'P0001', 'invalid_end_date', 'an end date of starts_on + 5 raises invalid_end_date');
reset role;
select is(
  (select count(*)::text || '/' || (select count(*) from public.commitment_versions)::text
          || '/' || (select count(*) from public.group_activities)::text
   from public.commitments),
  current_setting('test.before'),
  'nothing was written by the failed calls (no commitment, version or activity row)'
);
select tests.authenticate_as('alice');
select is(
  (select a.starts_on from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk',
    p_schedule_type => 'times_per_week', p_target => 3, p_end_date => '2026-11-29') a),
  '2026-11-23'::date,
  'an end date of starts_on + 6 (the first Sunday) is accepted'
);
reset role;
select is(
  (select v.target::text || ':' || v.end_date::text || ':' || coalesce(v.days::text, '-')
   from public.commitment_versions v join public.commitments c on c.id = v.commitment_id
   join public.group_activities ga on ga.id = c.group_activity_id
   where ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'walk'),
  '3:2026-11-29:-',
  'a times-per-week version stores the target and end date, no days'
);

-- Non-members
select tests.authenticate_as('dave');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'times_per_week', p_target => 3) $$,
  'P0001', 'not_member', 'a non-member gets not_member');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'daily') $$,
  'P0001', 'not_member', 'not_member comes before plan validation');

-- A waiting group (one member) works as usual.
select tests.authenticate_as('erin');
select is(
  (select a.starts_on from public.add_commitment(current_setting('test.g2')::uuid, p_preset_key => 'run',
    p_schedule_type => 'times_per_week', p_target => 2) a),
  '2026-11-23'::date,
  'a member of a waiting group can add a commitment'
);

-- ===== FR-10: the schedule-type lock =====
-- Gym: alice times per week; bob the same type is fine, the other type is locked.
select tests.authenticate_as('alice');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'times_per_week', p_target => 3) $$,
  'alice adds Gym as times per week');
select tests.authenticate_as('bob');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'times_per_week', p_target => 4) $$,
  'another member adds Gym with the same type');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'fixed_days', p_days => array[1, 3, 5]) $$,
  'P0001', 'schedule_type_locked', 'Gym as fixed days is locked while times-per-week commitments are active');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'fixed_days', p_days => array[1], p_end_date => '2026-11-25') $$,
  'P0001', 'invalid_end_date', 'the end date is checked before the lock');
select is(
  (select o.locked_schedule_type from public.group_activity_options o
   where o.group_id = current_setting('test.g1')::uuid and o.preset_key = 'gym'),
  'times_per_week', 'group_activity_options shows Gym locked to times per week');
select is(
  (select o.locked_schedule_type from public.group_activity_options o
   where o.group_id = current_setting('test.g1')::uuid and o.preset_key = 'study'),
  'fixed_days', 'commitments that start next week lock the type too');

-- Run: alice's fixed-days commitment ended before this week, so it no longer locks.
select tests.authenticate_as('alice');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run', p_schedule_type => 'fixed_days', p_days => array[2, 4]) $$,
  'alice adds Run as fixed days');
reset role;
update public.commitments c set ends_after_week_start = '2026-11-09'
from public.group_activities ga
where ga.id = c.group_activity_id and ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'run';
select tests.authenticate_as('bob');
select is(
  (select o.locked_schedule_type from public.group_activity_options o
   where o.group_id = current_setting('test.g1')::uuid and o.preset_key = 'run'),
  null, 'an ended commitment does not lock the type');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'an ended commitment is ignored: another type is accepted');
reset role;
select is(
  (select ga.schedule_type from public.group_activities ga
   where ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'run'),
  'times_per_week', 'and the activity''s type is set to the new type');

-- Yoga: a commitment ending this week (ends_after_week_start = current Monday) still locks.
select tests.authenticate_as('alice');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'yoga', p_schedule_type => 'fixed_days', p_days => array[1]) $$,
  'alice adds Yoga as fixed days');
reset role;
update public.commitments c set ends_after_week_start = '2026-11-16'
from public.group_activities ga
where ga.id = c.group_activity_id and ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'yoga';
select tests.authenticate_as('bob');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'yoga', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'P0001', 'schedule_type_locked', 'a commitment ending after this week still locks the type');

-- Walk: alice's end date (Sun 29 Nov) not yet passed locks; once it is in the past it does not.
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[1]) $$,
  'P0001', 'schedule_type_locked', 'a commitment with a future end date locks the type');
reset role;
update public.commitment_versions v set end_date = '2026-11-18'
from public.commitments c join public.group_activities ga on ga.id = c.group_activity_id
where v.commitment_id = c.id and ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'walk';
select tests.authenticate_as('bob');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[1]) $$,
  'P0001', 'schedule_type_locked', 'an end date of today (owner''s local day) still locks the type');
reset role;
update public.commitment_versions v set end_date = '2026-11-17'
from public.commitments c join public.group_activities ga on ga.id = c.group_activity_id
where v.commitment_id = c.id and ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'walk';
select tests.authenticate_as('bob');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk', p_schedule_type => 'fixed_days', p_days => array[1]) $$,
  'a commitment past its end date is ignored: another type is accepted');

-- Sports: a task never locks the type.
reset role;
select pg_catalog.set_config('test.sports',
  (private.resolve_group_activity(current_setting('test.g1')::uuid, 'sports', null, null)).id::text, true);
insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
values (current_setting('test.g1')::uuid, current_setting('test.alice_m')::uuid,
        tests.get_supabase_uid('alice'), 'task', current_setting('test.sports')::uuid, null);
select tests.authenticate_as('bob');
select is(
  (select o.locked_schedule_type from public.group_activity_options o
   where o.id = current_setting('test.sports')::uuid),
  null, 'a task does not lock the type');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'sports', p_schedule_type => 'fixed_days', p_days => array[6]) $$,
  'a task is ignored: the first commitment sets the type');
select tests.authenticate_as('alice');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'sports', p_schedule_type => 'times_per_week', p_target => 1) $$,
  'P0001', 'schedule_type_locked', 'the commitment, not the task, locks the type for its owner too');

-- Pottery: free-typed custom activities with the same name stay separate (FR-10).
select tests.authenticate_as('alice');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_custom_name => 'Pottery', p_schedule_type => 'fixed_days', p_days => array[3]) $$,
  'alice adds her custom Pottery as fixed days');
select tests.authenticate_as('bob');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_custom_name => 'pottery', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'bob''s free-typed pottery is a separate activity and is not locked');
reset role;
select pg_catalog.set_config('test.apottery',
  (select ga.id::text from public.group_activities ga
   where ga.group_id = current_setting('test.g1')::uuid and ga.created_by = tests.get_supabase_uid('alice')
     and ga.custom_name = 'Pottery'), true);
select tests.authenticate_as('bob');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_group_activity_id => current_setting('test.apottery')::uuid, p_schedule_type => 'times_per_week', p_target => 2) $$,
  'P0001', 'schedule_type_locked', 'picking alice''s Pottery from the group list shares its lock');

-- Read: carol's commitment stops locking once her membership ends.
select tests.authenticate_as('carol');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read', p_schedule_type => 'fixed_days', p_days => array[1, 2]) $$,
  'carol adds Read as fixed days');
select tests.authenticate_as('bob');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read', p_schedule_type => 'times_per_week', p_target => 3) $$,
  'P0001', 'schedule_type_locked', 'carol''s active commitment locks Read');
select tests.authenticate_as('carol');
select public.leave_group(current_setting('test.g1')::uuid);
select tests.authenticate_as('bob');
select is(
  (select o.locked_schedule_type from public.group_activity_options o
   where o.group_id = current_setting('test.g1')::uuid and o.preset_key = 'read'),
  null, 'a commitment of an ended membership does not lock the type');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read', p_schedule_type => 'times_per_week', p_target => 3) $$,
  'an ended membership''s commitment is ignored: another type is accepted');
select tests.authenticate_as('carol');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read', p_schedule_type => 'times_per_week', p_target => 3) $$,
  'P0001', 'not_member', 'an ended membership gets not_member');

-- ===== plan_preview (Wednesday 18 Nov, London) =====
select tests.authenticate_as('alice');
select is(
  (select p.member_today::text || ' ' || p.week_start::text || ' ' || p.week_end::text || ' '
          || p.starts_on::text || ' ' || p.min_end_date::text || ' ' || coalesce(p.last_week_target::text, '-')
   from public.plan_preview(current_setting('test.g1')::uuid) p),
  '2026-11-18 2026-11-16 2026-11-22 2026-11-23 2026-11-29 -',
  'plan_preview returns today, this week, the first Monday and the earliest end date'
);
select is(
  (select p.last_week_target from public.plan_preview(current_setting('test.g1')::uuid, 3, '2026-12-04') p),
  2::smallint, 'target 3 with a last week of 5 days (ends Friday) gives 2');
select is(
  (select p.last_week_target from public.plan_preview(current_setting('test.g1')::uuid, 1, '2026-12-02') p),
  1::smallint, 'target 1 with a last week of 3 days (ends Wednesday) gives 1');
select is(
  (select p.last_week_target from public.plan_preview(current_setting('test.g1')::uuid, 3, '2026-12-06') p),
  null, 'an end date on a Sunday (full last week) gives none');
select is(
  (select p.last_week_target from public.plan_preview(current_setting('test.g1')::uuid, 3, '2026-11-29') p),
  null, 'the earliest end date (the first Sunday) gives none');
select is(
  (select p.last_week_target from public.plan_preview(current_setting('test.g1')::uuid, 3, '2026-11-27') p),
  null, 'an end date before the earliest one gives none');
select is(
  (select p.last_week_target from public.plan_preview(current_setting('test.g1')::uuid, null, '2026-12-04') p),
  null, 'no target (fixed days) gives none');
select throws_ok(
  $$ select * from public.plan_preview(current_setting('test.g1')::uuid, 8, null) $$,
  'P0001', 'invalid_plan', 'plan_preview with a target of 8 raises invalid_plan');

select tests.freeze_time('2026-11-22 11:30:00+00');
select tests.authenticate_as('bob');
select is(
  (select p.member_today::text || ' ' || p.week_start::text || ' ' || p.starts_on::text
   from public.plan_preview(current_setting('test.g1')::uuid) p),
  '2026-11-23 2026-11-23 2026-11-30',
  'plan_preview uses the member''s zone, not the group''s'
);
select tests.freeze_time('2026-11-18 10:00:00+00');

select tests.authenticate_as('dave');
select throws_ok(
  $$ select * from public.plan_preview(current_setting('test.g1')::uuid) $$,
  'P0001', 'not_member', 'plan_preview for a non-member raises not_member');
select tests.authenticate_as('carol');
select throws_ok(
  $$ select * from public.plan_preview(current_setting('test.g1')::uuid) $$,
  'P0001', 'not_member', 'plan_preview for an ended membership raises not_member');
select tests.authenticate_as('erin');
select is(
  (select p.starts_on from public.plan_preview(current_setting('test.g2')::uuid) p),
  '2026-11-23'::date, 'plan_preview works in a waiting group');

-- ===== RLS: reads =====
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.commitments
   where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('alice')),
  9, 'a current member reads another current member''s commitments (and tasks)');
select is(
  (select count(*)::integer from public.commitment_versions v join public.commitments c on c.id = v.commitment_id
   where c.user_id = tests.get_supabase_uid('alice')),
  8, 'a current member reads their versions (tasks have none)');
select is(
  (select count(*)::integer from public.commitments where user_id = tests.get_supabase_uid('carol')),
  0, 'commitments of an ended membership are hidden from the group');
select is(
  (select count(*)::integer from public.commitment_versions v
   where v.group_id = current_setting('test.g1')::uuid
     and not exists (select 1 from public.commitments c where c.id = v.commitment_id)),
  0, 'versions of hidden commitments are hidden too');
select is(
  (select count(*)::integer from public.commitments where group_id = current_setting('test.g2')::uuid),
  0, 'a member of another group reads none of Solo''s commitments');
select throws_ok(
  format($$ insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
            values (%L, %L, %L, 'commitment', %L, 'fixed_days') $$,
         current_setting('test.g1'), current_setting('test.alice_m'), tests.get_supabase_uid('alice'),
         current_setting('test.sports')),
  '42501', null, 'a client cannot insert into commitments');
select throws_ok(
  $$ delete from public.commitment_versions $$,
  '42501', null, 'a client cannot delete versions');

select tests.authenticate_as('carol');
select is((select count(*)::integer from public.commitments), 0, 'an ended membership reads no commitments, not even its own');
select is((select count(*)::integer from public.commitment_versions), 0, 'an ended membership reads no versions');

select tests.authenticate_as('dave');
select is((select count(*)::integer from public.commitments), 0, 'a non-member reads no commitments');
select is(
  (select count(*)::integer from public.group_activity_options where locked_schedule_type is not null),
  0, 'a non-member sees no locked types');

select tests.clear_authentication();
select throws_ok(
  $$ select count(*) from public.commitments $$,
  '42501', null, 'anon cannot read commitments');
select throws_ok(
  $$ select * from public.plan_preview(pg_catalog.gen_random_uuid()) $$,
  '42501', null, 'anon cannot call plan_preview');
select throws_ok(
  $$ select * from public.add_commitment(pg_catalog.gen_random_uuid(), p_preset_key => 'gym', p_schedule_type => 'times_per_week', p_target => 3) $$,
  '42501', null, 'anon cannot call add_commitment');

select * from finish();
rollback;
