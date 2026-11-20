-- My plan (Story 2.6): get_my_plan (sections, states, dates), get_commitment (edit-mode read),
-- update_commitment (a version at the member's next Monday, replacing a pending one, validation
-- codes), end_commitment (ending a started and a not-yet-started commitment), the FR-10 lock
-- released once an ended commitment is no longer active, and grants per role (AD-16).
--
-- Cast: alice (Europe/London) creates "Crew" (group zone Europe/London); bob (Europe/London) joins
-- with alice's invite. dave (UTC) is in no group.
-- Week under test: Mon 16 Nov to Sun 22 Nov 2026 (GMT in London, so London time = UTC); next
-- Monday is 23 Nov.
-- Tue 10 Nov: alice adds Gym 3 times per week, Run fixed days Mon Wed Fri and Yoga 2 times per
-- week (all start Mon 16 Nov), and Meditate 5 times per week ending Thu 19 Nov (written directly).
-- Mon 16 Nov: tick step 1 writes the week's sessions. Tue 17 Nov: task "Yesterday" due that day.
-- Wed 18 Nov: alice adds Read 4 times per week and Study fixed days Tue (both start Mon 23 Nov)
-- and task "Garage" due Sun 22; she edits Gym twice (5 with an end date, then 4 with none), edits
-- Read to 2, ends Run (started) and Study (not started). Mon 23 Nov: tick step 1 writes the next
-- week.
-- The routines under test call now() unqualified; as the owner their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(80);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('dave');

-- ===== Shape =====
select ok(
  pg_catalog.to_regprocedure('public.get_my_plan(uuid)') is not null
  and pg_catalog.to_regprocedure('public.get_commitment(uuid)') is not null
  and pg_catalog.to_regprocedure('public.update_commitment(uuid, integer[], integer, date)') is not null
  and pg_catalog.to_regprocedure('public.end_commitment(uuid)') is not null,
  'get_my_plan, get_commitment, update_commitment and end_commitment exist with the story''s signatures'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.get_my_plan(uuid)'::regprocedure, 'public.get_commitment(uuid)'::regprocedure,
                   'public.update_commitment(uuid, integer[], integer, date)'::regprocedure,
                   'public.end_commitment(uuid)'::regprocedure)),
  'all four pin search_path to empty'
);
select ok(
  (select bool_and(not p.prosecdef and p.provolatile = 's') from pg_catalog.pg_proc p
   where p.oid in ('public.get_my_plan(uuid)'::regprocedure, 'public.get_commitment(uuid)'::regprocedure)),
  'the two reads are stable and security invoker'
);
select ok(
  (select bool_and(p.prosecdef and p.provolatile = 'v') from pg_catalog.pg_proc p
   where p.oid in ('public.update_commitment(uuid, integer[], integer, date)'::regprocedure,
                   'public.end_commitment(uuid)'::regprocedure)),
  'the two writes are volatile and security definer'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.get_my_plan(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_commitment(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_commitment(uuid, integer[], integer, date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.end_commitment(uuid)', 'EXECUTE'),
  'authenticated can execute all four'
);
select ok(
  not has_function_privilege('anon', 'public.get_my_plan(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_commitment(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.update_commitment(uuid, integer[], integer, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.end_commitment(uuid)', 'EXECUTE'),
  'anon cannot execute any of the four'
);
select ok(
  not has_function_privilege('public', 'public.get_my_plan(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_commitment(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.update_commitment(uuid, integer[], integer, date)', 'EXECUTE')
  and not has_function_privilege('public', 'public.end_commitment(uuid)', 'EXECUTE'),
  'PUBLIC cannot execute any of the four'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));

-- ===== Frozen clock =====
reset role;
alter function public.get_my_plan(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_commitment(uuid) set search_path = test_overrides, pg_catalog;
alter function public.update_commitment(uuid, integer[], integer, date) set search_path = test_overrides, pg_catalog;
alter function public.end_commitment(uuid) set search_path = test_overrides, pg_catalog;
alter function public.add_task(uuid, text, uuid, text, text, date) set search_path = test_overrides, pg_catalog;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;

-- Tue 10 Nov: commitments that start Mon 16 Nov.
select tests.freeze_time('2026-11-10 12:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.gym', (select a.commitment_id::text from public.add_commitment(
  current_setting('test.g1')::uuid, p_preset_key => 'gym', p_schedule_type => 'times_per_week', p_target => 3) a), true);
select pg_catalog.set_config('test.run', (select a.commitment_id::text from public.add_commitment(
  current_setting('test.g1')::uuid, p_preset_key => 'run', p_schedule_type => 'fixed_days', p_days => array[1, 3, 5]) a), true);
select pg_catalog.set_config('test.yoga', (select a.commitment_id::text from public.add_commitment(
  current_setting('test.g1')::uuid, p_preset_key => 'yoga', p_schedule_type => 'times_per_week', p_target => 2) a), true);

-- Meditate, written directly (add_commitment never allows an end date inside the first week):
-- 5 times per week from Mon 16 Nov, ending Thu 19 Nov.
reset role;
with c as (
  insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
  select m.group_id, m.id, m.user_id, 'commitment',
         (private.resolve_group_activity(m.group_id, 'meditate', null, null)).id, 'times_per_week'
  from public.memberships m
  where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('alice')
  returning id, group_id
)
insert into public.commitment_versions (commitment_id, group_id, effective_week_start, target, end_date)
select c.id, c.group_id, '2026-11-16', 5, '2026-11-19' from c;
select pg_catalog.set_config('test.meditate',
  (select c.id::text from public.commitments c join public.group_activities ga on ga.id = c.group_activity_id
   where ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'meditate'), true);

-- Mon 16 Nov 00:30: the tick writes the week's sessions.
select tests.freeze_time('2026-11-16 00:30:00+00');
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the week''s sessions without error');

-- Tue 17 Nov: a task due that day.
select tests.freeze_time('2026-11-17 10:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.yesterday', (select a.commitment_id::text from public.add_task(
  current_setting('test.g1')::uuid, p_preset_key => 'clean', p_name => 'Yesterday', p_deadline => '2026-11-17') a), true);

-- ===== Wednesday 18 Nov 10:00 =====
select tests.freeze_time('2026-11-18 10:00:00+00');
select pg_catalog.set_config('test.garage', (select a.commitment_id::text from public.add_task(
  current_setting('test.g1')::uuid, p_preset_key => 'clean', p_name => 'Garage', p_deadline => '2026-11-22') a), true);
select pg_catalog.set_config('test.zoo', (select a.commitment_id::text from public.add_task(
  current_setting('test.g1')::uuid, p_preset_key => 'clean', p_name => 'Zoo run', p_deadline => '2026-11-20') a), true);
select pg_catalog.set_config('test.read', (select a.commitment_id::text from public.add_commitment(
  current_setting('test.g1')::uuid, p_preset_key => 'read', p_schedule_type => 'times_per_week', p_target => 4) a), true);
select pg_catalog.set_config('test.study', (select a.commitment_id::text from public.add_commitment(
  current_setting('test.g1')::uuid, p_preset_key => 'study', p_schedule_type => 'fixed_days', p_days => array[2]) a), true);

-- get_commitment before any edit.
select is(
  (select g.group_id::text || ' ' || g.preset_key || ' ' || g.activity_name || ' ' || g.schedule_type || ' '
          || coalesce(g.days::text, '-') || ' ' || g.target::text || ' ' || coalesce(g.end_date::text, '-') || ' '
          || g.changes_from::text || ' ' || g.min_end_date::text || ' ' || g.state || ' ' || g.can_edit::text
   from public.get_commitment(current_setting('test.gym')::uuid) g),
  current_setting('test.g1') || ' gym Gym times_per_week - 3 - 2026-11-23 2026-11-29 active true',
  'get_commitment: activity, type, the latest version, changes from next Monday, its Sunday as the earliest end date, active'
);
select is(
  (select g.days::text || ' ' || coalesce(g.target::text, '-') || ' ' || g.changes_from::text || ' ' || g.state
   from public.get_commitment(current_setting('test.study')::uuid) g),
  '{2} - 2026-11-23 starts_next_week',
  'get_commitment on a commitment that starts next week: changes from its first week'
);

-- ===== Validation: nothing is written on error =====
reset role;
select pg_catalog.set_config('test.before',
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
     v.commitment_id::text || v.effective_week_start::text || coalesce(v.days::text, '') || coalesce(v.target::text, '')
       || coalesce(v.end_date::text, ''), ',' order by v.commitment_id, v.effective_week_start), ''))
   from public.commitment_versions v)
  || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(c.id::text || coalesce(c.ends_after_week_start::text, ''), ','
        order by c.id), '')) from public.commitments c), true);
select tests.authenticate_as('alice');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_days => array[]::integer[]) $$, current_setting('test.run')),
  'P0001', 'invalid_plan', 'fixed days with no day raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_days => array[1, 1]) $$, current_setting('test.run')),
  'P0001', 'invalid_plan', 'fixed days with a duplicate day raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_days => array[8]) $$, current_setting('test.run')),
  'P0001', 'invalid_plan', 'day 8 raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_days => array[1], p_target => 3) $$, current_setting('test.run')),
  'P0001', 'invalid_plan', 'fixed days with a target raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 3) $$, current_setting('test.run')),
  'P0001', 'invalid_plan', 'a target on a fixed-days commitment (changing the type) raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 8) $$, current_setting('test.gym')),
  'P0001', 'invalid_plan', 'target 8 raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 0) $$, current_setting('test.gym')),
  'P0001', 'invalid_plan', 'target 0 raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L) $$, current_setting('test.gym')),
  'P0001', 'invalid_plan', 'times per week without a target raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_days => array[1, 3]) $$, current_setting('test.gym')),
  'P0001', 'invalid_plan', 'days on a times-per-week commitment (changing the type) raises invalid_plan');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 4, p_end_date => '2026-11-28') $$, current_setting('test.gym')),
  'P0001', 'invalid_end_date', 'an end date before the Sunday of the week the change takes effect raises invalid_end_date');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 4, p_end_date => '2026-11-20') $$, current_setting('test.gym')),
  'P0001', 'invalid_end_date', 'an end date in the current week raises invalid_end_date');

-- Not the owner, or a task: not_found.
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 1) $$, current_setting('test.garage')),
  'P0001', 'not_found', 'update_commitment on a task raises not_found');
select throws_ok(
  format($$ select * from public.end_commitment(%L) $$, current_setting('test.garage')),
  'P0001', 'not_found', 'end_commitment on a task raises not_found');
select throws_ok(
  format($$ select * from public.get_commitment(%L) $$, current_setting('test.garage')),
  'P0001', 'not_found', 'get_commitment on a task raises not_found');
select throws_ok(
  $$ select * from public.update_commitment(pg_catalog.gen_random_uuid(), p_target => 1) $$,
  'P0001', 'not_found', 'update_commitment on an unknown id raises not_found');
select tests.authenticate_as('bob');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 1) $$, current_setting('test.gym')),
  'P0001', 'not_found', 'another member''s update raises not_found');
select throws_ok(
  format($$ select * from public.end_commitment(%L) $$, current_setting('test.gym')),
  'P0001', 'not_found', 'another member''s end raises not_found');
select throws_ok(
  format($$ select * from public.get_commitment(%L) $$, current_setting('test.gym')),
  'P0001', 'not_found', 'another member''s get_commitment raises not_found');
reset role;
select is(
  (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
     v.commitment_id::text || v.effective_week_start::text || coalesce(v.days::text, '') || coalesce(v.target::text, '')
       || coalesce(v.end_date::text, ''), ',' order by v.commitment_id, v.effective_week_start), ''))
   from public.commitment_versions v)
  || (select pg_catalog.md5(coalesce(pg_catalog.string_agg(c.id::text || coalesce(c.ends_after_week_start::text, ''), ','
        order by c.id), '')) from public.commitments c),
  current_setting('test.before'),
  'nothing was written by the failed calls (no version, no end)'
);

-- ===== Edit mid-week, twice =====
select tests.authenticate_as('alice');
select is(
  (select u.changes_from from public.update_commitment(current_setting('test.gym')::uuid, p_target => 5,
     p_end_date => '2026-11-29') u),
  '2026-11-23'::date,
  'an edit on Wednesday takes effect next Monday (an end date on that week''s Sunday is accepted)'
);
select is(
  (select u.changes_from from public.update_commitment(current_setting('test.gym')::uuid, p_target => 4) u),
  '2026-11-23'::date,
  'a second edit before Monday takes effect the same Monday'
);
reset role;
select is(
  (select pg_catalog.string_agg(v.effective_week_start::text || ':' || v.target::text || ':' || coalesce(v.end_date::text, '-'),
     ', ' order by v.effective_week_start)
   from public.commitment_versions v where v.commitment_id = current_setting('test.gym')::uuid),
  '2026-11-16:3:-, 2026-11-23:4:-',
  'two edits leave the current version untouched and one pending version, the last'
);
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.gym')::uuid and s.week_start = '2026-11-16'),
  3, 'this week''s sessions are unchanged by the edit'
);

-- ===== Editing a commitment that starts next week =====
select tests.authenticate_as('alice');
select is(
  (select u.changes_from from public.update_commitment(current_setting('test.read')::uuid, p_target => 2) u),
  '2026-11-23'::date,
  'an edit of a commitment that starts next week takes effect at its first week'
);
reset role;
select is(
  (select pg_catalog.string_agg(v.effective_week_start::text || ':' || v.target::text, ', ')
   from public.commitment_versions v where v.commitment_id = current_setting('test.read')::uuid),
  '2026-11-23:2',
  'its first version is replaced, not added to'
);

-- ===== The FR-10 lock before an end =====
select tests.authenticate_as('bob');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'P0001', 'schedule_type_locked', 'Run is locked to fixed days while alice''s commitment is active');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'P0001', 'schedule_type_locked', 'Study is locked by a commitment that starts next week');

-- ===== End a started commitment (Run) and a not-started one (Study) =====
select tests.authenticate_as('alice');
select is(
  (select e.ends_after_week_start from public.end_commitment(current_setting('test.run')::uuid) e),
  '2026-11-16'::date,
  'ending a started commitment mid-week sets ends_after_week_start to the current week'
);
select is(
  (select e.ends_after_week_start from public.end_commitment(current_setting('test.study')::uuid) e),
  '2026-11-09'::date,
  'ending a commitment that has not started sets the previous Monday'
);
reset role;
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.run')::uuid and s.week_start = '2026-11-16'),
  3, 'this week''s sessions of the ended commitment are kept'
);
select is(
  (select count(*)::integer from public.commitment_versions v where v.commitment_id = current_setting('test.study')::uuid),
  1, 'a not-started commitment keeps its first version (for Past)'
);

-- After an end: commitment_ended.
select tests.authenticate_as('alice');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_days => array[2]) $$, current_setting('test.run')),
  'P0001', 'commitment_ended', 'editing an ending commitment raises commitment_ended');
select throws_ok(
  format($$ select * from public.end_commitment(%L) $$, current_setting('test.run')),
  'P0001', 'commitment_ended', 'ending an ending commitment raises commitment_ended');
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_days => array[3]) $$, current_setting('test.study')),
  'P0001', 'commitment_ended', 'editing an ended commitment raises commitment_ended');
select throws_ok(
  format($$ select * from public.end_commitment(%L) $$, current_setting('test.study')),
  'P0001', 'commitment_ended', 'ending an ended commitment raises commitment_ended');

-- The lock: Run (ending this week) still locks; Study (ended at once) does not.
select tests.authenticate_as('bob');
select throws_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'P0001', 'schedule_type_locked', 'a commitment ending this Sunday still locks the type');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'a not-started commitment ended at once no longer locks the type');

-- ===== get_my_plan on Wednesday (alice) =====
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.string_agg(p.section || ':' || p.state || ':' || coalesce(p.name, p.activity_name), ', ' order by p.ord)
   from public.get_my_plan(current_setting('test.g1')::uuid) with ordinality
     as p(commitment_id, kind, section, state, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, end_date, deadline, starts_on, ends_on, can_edit, can_delete, ord)),
  'current:pending_change:Gym, current:ending:Meditate, current:starts_next_week:Read, current:ending:Run, current:active:Yoga, current:open:Zoo run, current:open:Garage, past:ended:Study, past:past:Yesterday',
  'Wednesday: current commitments by name, then open tasks by deadline (Zoo run before Garage, though Garage sorts first by name); the ended commitment and the passed task are in Past'
);
select is(
  (select p.kind || ' ' || p.schedule_type || ' ' || coalesce(p.days::text, '-') || ' ' || p.target::text || ' '
          || coalesce(p.end_date::text, '-') || ' ' || p.starts_on::text || ' ' || coalesce(p.ends_on::text, '-') || ' '
          || p.can_edit::text || ' ' || p.can_delete::text
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.gym')::uuid),
  'commitment times_per_week - 4 - 2026-11-23 - true false',
  'a pending change shows the new target and the Monday it starts'
);
select is(
  (select p.days::text || ' ' || coalesce(p.target::text, '-') || ' ' || coalesce(p.starts_on::text, '-') || ' '
          || p.ends_on::text || ' ' || p.can_edit::text
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.run')::uuid),
  '{1,3,5} - - 2026-11-22 false',
  'an ended-this-week commitment ends on Sunday and cannot be edited'
);
select is(
  (select p.target::text || ' ' || p.end_date::text || ' ' || p.ends_on::text || ' ' || p.can_edit::text
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.meditate')::uuid),
  '5 2026-11-19 2026-11-19 false',
  'a commitment whose end date is inside this week is ending on that day and cannot be edited'
);
select is(
  (select p.target::text || ' ' || p.starts_on::text || ' ' || p.can_edit::text
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.read')::uuid),
  '2 2026-11-23 true',
  'a commitment that starts next week shows its (edited) first target and first Monday'
);
select is(
  (select p.schedule_type || ' ' || p.target::text || ' ' || coalesce(p.starts_on::text, '-') || ' ' || coalesce(p.ends_on::text, '-')
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.yoga')::uuid),
  'times_per_week 2 - -',
  'an active commitment shows this week''s version and no dates'
);
select is(
  (select p.days::text || ' ' || p.can_edit::text || ' ' || p.can_delete::text
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.study')::uuid),
  '{2} false false',
  'an ended commitment keeps its days for Past and cannot be edited'
);
select is(
  (select p.kind || ' ' || p.activity_name || ' ' || p.deadline::text || ' ' || p.can_edit::text || ' ' || p.can_delete::text
          || ' ' || coalesce(p.schedule_type, '-')
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.garage')::uuid),
  'task Clean 2026-11-22 true true -',
  'an open task has its deadline and can be edited and deleted'
);
select is(
  (select p.can_edit::text || ' ' || p.can_delete::text
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.yesterday')::uuid),
  'false false',
  'a passed task cannot be edited or deleted'
);
select is(
  (select g.state || ' ' || g.can_edit::text from public.get_commitment(current_setting('test.gym')::uuid) g),
  'pending_change true', 'get_commitment: a pending change can still be edited'
);
select is(
  (select g.target::text || ' ' || coalesce(g.end_date::text, '-') from public.get_commitment(current_setting('test.gym')::uuid) g),
  '4 -', 'get_commitment reads the pending version'
);
select is(
  (select g.state || ' ' || g.can_edit::text from public.get_commitment(current_setting('test.run')::uuid) g),
  'ending false', 'get_commitment: an ending commitment cannot be edited'
);
select is(
  (select g.state || ' ' || g.can_edit::text from public.get_commitment(current_setting('test.study')::uuid) g),
  'ended false', 'get_commitment: an ended commitment cannot be edited'
);

-- A commitment ending by its end date this week: an edit would extend it, so it is refused.
select throws_ok(
  format($$ select * from public.update_commitment(%L, p_target => 5) $$, current_setting('test.meditate')),
  'P0001', 'commitment_ended', 'editing a commitment that ends by its end date this week raises commitment_ended');
select is(
  (select g.state || ' ' || g.can_edit::text || ' '
          || (select count(*) from public.commitment_versions v where v.commitment_id = current_setting('test.meditate')::uuid)::text
   from public.get_commitment(current_setting('test.meditate')::uuid) g),
  'ending false 1',
  'get_commitment says it cannot be edited, and the refused edit wrote no version'
);

-- Ending a started commitment that has a pending change drops the change.
select is(
  (select u.changes_from from public.update_commitment(current_setting('test.yoga')::uuid, p_target => 3) u),
  '2026-11-23'::date,
  'Yoga gets a pending change for next Monday'
);
select is(
  (select e.ends_after_week_start from public.end_commitment(current_setting('test.yoga')::uuid) e),
  '2026-11-16'::date,
  'ending it sets the current week'
);
reset role;
select is(
  (select pg_catalog.string_agg(v.effective_week_start::text || ':' || v.target::text, ', ' order by v.effective_week_start)
   from public.commitment_versions v where v.commitment_id = current_setting('test.yoga')::uuid),
  '2026-11-16:2',
  'only the versions up to the current week remain (the pending change is dropped)'
);

-- bob's plan does not include alice's rows.
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.string_agg(p.section || ':' || p.state || ':' || p.activity_name, ', ')
   from public.get_my_plan(current_setting('test.g1')::uuid) p),
  'current:starts_next_week:Study',
  'a member sees only their own plan'
);

-- ===== Monday 23 Nov: the next week =====
select tests.freeze_time('2026-11-23 00:30:00+00');
reset role;
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the next week without error');
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.gym')::uuid and s.week_start = '2026-11-16'),
  3, 'the edited commitment still has its 3 sessions last week'
);
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.gym')::uuid and s.week_start = '2026-11-23'),
  4, 'and 4 sessions this week, from the edit'
);
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.run')::uuid and s.week_start = '2026-11-23'),
  0, 'the commitment ended last week gets no sessions this week'
);
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.yoga')::uuid and s.week_start = '2026-11-23'),
  0, 'the commitment ended with a pending change gets no sessions this week'
);
select is(
  (select count(*)::integer from public.sessions s where s.commitment_id = current_setting('test.study')::uuid),
  0, 'the not-started commitment ended at once never gets sessions'
);
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.read')::uuid and s.week_start = '2026-11-23'),
  2, 'the edited not-yet-started commitment starts with its edited target'
);

select tests.freeze_time('2026-11-23 10:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.string_agg(p.section || ':' || p.state || ':' || coalesce(p.name, p.activity_name), ', ' order by p.ord)
   from public.get_my_plan(current_setting('test.g1')::uuid) with ordinality
     as p(commitment_id, kind, section, state, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, end_date, deadline, starts_on, ends_on, can_edit, can_delete, ord)),
  'current:active:Gym, current:active:Read, past:ended:Meditate, past:ended:Run, past:ended:Study, past:ended:Yoga, past:past:Garage, past:past:Zoo run, past:past:Yesterday',
  'next Monday: the change is active, ended commitments and passed tasks are in Past (latest task first)'
);

select is(
  (select p.schedule_type || ' ' || p.target::text
   from public.get_my_plan(current_setting('test.g1')::uuid) p where p.commitment_id = current_setting('test.yoga')::uuid),
  'times_per_week 2',
  'the ended commitment''s Past row shows the schedule that ran, not the dropped change'
);

-- The FR-10 lock from Run is released the week after the end.
select tests.authenticate_as('bob');
select lives_ok(
  $$ select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run', p_schedule_type => 'times_per_week', p_target => 2) $$,
  'the week after an end, another type is accepted');

-- ===== Non-member and anon =====
select tests.authenticate_as('dave');
select throws_ok(
  format($$ select * from public.get_my_plan(%L) $$, current_setting('test.g1')),
  'P0001', 'not_member', 'get_my_plan for another group raises not_member');
select throws_ok(
  format($$ select * from public.get_commitment(%L) $$, current_setting('test.gym')),
  'P0001', 'not_found', 'a non-member''s get_commitment raises not_found');

select tests.clear_authentication();
select throws_ok(
  $$ select * from public.get_my_plan(pg_catalog.gen_random_uuid()) $$,
  '42501', null, 'anon cannot call get_my_plan');
select throws_ok(
  $$ select * from public.end_commitment(pg_catalog.gen_random_uuid()) $$,
  '42501', null, 'anon cannot call end_commitment');

select * from finish();
rollback;
