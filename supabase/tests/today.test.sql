-- Today (Story 2.5): get_today_items (section placement for fixed days, times per week with the
-- at-risk move, tasks, commitments that start next week, display order, row details) and
-- get_today_summary (member-local today, week number, planned / done / left), a member in a
-- different zone from the group, a non-member rejected, and grants per role (AD-16).
--
-- Cast: alice (Europe/London) creates "Crew" (group zone Europe/London); bob (Europe/London) and
-- carol (Asia/Manila, UTC+8) join with alice's invite. dave (UTC) is in no group.
-- Week under test: Mon 16 Nov to Sun 22 Nov 2026 (GMT in London, so London time = UTC).
-- Commitments are added on Tue 10 Nov (they start Mon 16 Nov), then tick step 1 writes the week's
-- sessions on Mon 16 Nov. alice: Gym fixed days Mon Wed Fri, Run 3 times per week, Yoga 2 times
-- per week, tasks "Yesterday" (deadline Tue 17), "Grocery run" (Wed 18) and "Garage" (Sun 22), and
-- Read 4 times per week added on Wed 18 (starts Mon 23 Nov). bob: Walk fixed days Tue, added on
-- Wed 18 (starts next week, no sessions this week). carol: Study fixed days Thu.
-- The routines under test call now() unqualified; as the owner their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(26);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');

-- ===== Shape =====
select ok(
  pg_catalog.to_regprocedure('public.get_today_items(uuid)') is not null
  and pg_catalog.to_regprocedure('public.get_today_summary(uuid)') is not null,
  'get_today_items and get_today_summary exist with the story''s signatures'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.get_today_items(uuid)'::regprocedure, 'public.get_today_summary(uuid)'::regprocedure)),
  'both reads pin search_path to empty'
);
select ok(
  (select bool_and(not p.prosecdef and p.provolatile = 's') from pg_catalog.pg_proc p
   where p.oid in ('public.get_today_items(uuid)'::regprocedure, 'public.get_today_summary(uuid)'::regprocedure)),
  'both reads are stable and security invoker'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.get_today_items(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_today_summary(uuid)', 'EXECUTE'),
  'authenticated can execute both reads'
);
select ok(
  not has_function_privilege('anon', 'public.get_today_items(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_today_summary(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_today_items(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_today_summary(uuid)', 'EXECUTE'),
  'anon and PUBLIC cannot execute either read'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Asia/Manila');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.c1'));

-- ===== Frozen clock =====
reset role;
alter function public.get_today_items(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_today_summary(uuid) set search_path = test_overrides, pg_catalog;
alter function public.add_task(uuid, text, uuid, text, text, date) set search_path = test_overrides, pg_catalog;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;

-- Joined three weeks before the week under test (Wed 28 Oct) and mid-week (Tue 17 Nov).
update public.memberships set joined_at = '2026-10-28 09:00:00+00'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('alice');
update public.memberships set joined_at = '2026-11-17 09:00:00+00'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('bob');

-- Tue 10 Nov: commitments that start Mon 16 Nov.
select tests.freeze_time('2026-11-10 12:00:00+00');
select tests.authenticate_as('alice');
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym',
  p_schedule_type => 'fixed_days', p_days => array[1, 3, 5]);
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run',
  p_schedule_type => 'times_per_week', p_target => 3);
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'yoga',
  p_schedule_type => 'times_per_week', p_target => 2);
select tests.authenticate_as('carol');
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study',
  p_schedule_type => 'fixed_days', p_days => array[4]);

-- Mon 16 Nov 00:30 (08:30 in Manila): the tick writes the week's sessions.
select tests.freeze_time('2026-11-16 00:30:00+00');
reset role;
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the week''s sessions without error');

-- Tue 17 Nov: a task due that day.
select tests.freeze_time('2026-11-17 10:00:00+00');
select tests.authenticate_as('alice');
select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
  p_name => 'Yesterday', p_deadline => '2026-11-17');

-- Wed 18 Nov: tasks due today and Sunday, and commitments that start next week.
select tests.freeze_time('2026-11-18 10:00:00+00');
select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'groceries',
  p_name => 'Grocery run', p_deadline => '2026-11-18');
select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
  p_name => 'Garage', p_deadline => '2026-11-22');
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read',
  p_schedule_type => 'times_per_week', p_target => 4);
select tests.authenticate_as('bob');
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk',
  p_schedule_type => 'fixed_days', p_days => array[2]);

-- ===== Wednesday 18 Nov 10:00 (alice) =====
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'due_today:Gym, due_today:Grocery run, this_week:Run, this_week:Yoga, this_week:Garage, starts_next_week:Read',
  'Wednesday: Gym and the task due today are due; Run, Yoga and the Sunday task this week; Read next week; yesterday''s task is gone'
);
select is(
  (select t.kind || ' ' || t.schedule_type || ' ' || t.days::text || ' ' || t.target::text || ' '
          || t.counted::text || ' ' || t.can_delete::text || ' ' || t.preset_key || ' '
          || coalesce(t.custom_name, '-') || ' ' || coalesce(t.starts_on::text, '-')
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.activity_name = 'Gym'),
  'commitment fixed_days {1,3,5} 3 0 false gym - -',
  'a fixed-day row has its days, the week''s session count as target, counted 0 and no delete'
);
select is(
  (select t.schedule_type || ' ' || coalesce(t.days::text, '-') || ' ' || t.target::text || ' ' || t.counted::text
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.activity_name = 'Run'),
  'times_per_week - 3 0',
  'a times-per-week row has its target and counted 0'
);
select is(
  (select t.section || ' ' || t.schedule_type || ' ' || coalesce(t.days::text, '-') || ' '
          || t.target::text || ' ' || t.starts_on::text || ' ' || t.can_delete::text
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.activity_name = 'Read'),
  'starts_next_week times_per_week - 4 2026-11-23 false',
  'a commitment that starts next week has starts_on = that Monday and its first target'
);
select is(
  (select t.kind || ' ' || t.activity_name || ' ' || t.deadline::text || ' ' || t.target::text || ' '
          || t.counted::text || ' ' || t.can_delete::text || ' ' || coalesce(t.schedule_type, '-')
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.name = 'Grocery run'),
  'task Groceries 2026-11-18 1 0 false -',
  'a task due today has its deadline and cannot be deleted'
);
select is(
  (select t.section || ' ' || t.deadline::text || ' ' || t.can_delete::text
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.name = 'Garage'),
  'this_week 2026-11-22 true',
  'a task due Sunday is this week and can still be deleted'
);
select is(
  (select s.member_today::text || ' ' || s.week_start::text || ' ' || s.week_number::text || ' '
          || s.planned::text || ' ' || s.done::text || ' ' || s."left"::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '2026-11-18 2026-11-16 4 11 0 11',
  'summary: member today, week start, week 4 for a member who joined three weeks earlier, 11 sessions planned, none done'
);

-- bob: joined mid-week, only a plan for next week.
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.string_agg(t.section || ':' || t.activity_name || ':' || t.starts_on::text, ', ')
   from public.get_today_items(current_setting('test.g1')::uuid) t),
  'starts_next_week:Walk:2026-11-23',
  'a member with only next week''s plan gets one starts_next_week row'
);
select is(
  (select s.week_number::text || ' ' || s.planned::text || ' ' || s.done::text || ' ' || s."left"::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '1 0 0 0',
  'summary: week 1 for a member who joined mid-week, nothing planned this week'
);

-- carol (Manila): Wed 18:00 there, her Thursday session is not listed yet.
select tests.authenticate_as('carol');
select is(
  (select count(*)::integer from public.get_today_items(current_setting('test.g1')::uuid)),
  0, 'on her Wednesday a Thursday-only member has nothing listed'
);

-- ===== Wed 18 Nov 20:00 UTC: Thursday 04:00 in Manila, still Wednesday in London =====
select tests.freeze_time('2026-11-18 20:00:00+00');
select is(
  (select pg_catalog.string_agg(t.section || ':' || t.activity_name, ', ')
   from public.get_today_items(current_setting('test.g1')::uuid) t),
  'due_today:Study',
  'a member ahead of the group sees her own local Thursday''s session as due today'
);
select is(
  (select s.member_today::text || ' ' || s.week_start::text || ' ' || s.planned::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '2026-11-19 2026-11-16 1',
  'her summary uses her own local today'
);
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'due_today:Gym, due_today:Grocery run, this_week:Run, this_week:Yoga, this_week:Garage, starts_next_week:Read',
  'at the same moment a London member still sees Wednesday'
);

-- ===== Thursday 19 Nov 10:00 (alice) =====
select tests.freeze_time('2026-11-19 10:00:00+00');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'this_week:Run, this_week:Yoga, this_week:Garage, starts_next_week:Read',
  'Thursday: no Gym (not a Gym day), the passed task is gone, Run (3 needed, 4 days left) stays this week'
);

-- ===== Friday 20 Nov 10:00 (alice): the at-risk move =====
select tests.freeze_time('2026-11-20 10:00:00+00');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'due_today:Gym, due_today:Run, this_week:Yoga, this_week:Garage, starts_next_week:Read',
  'Friday: Run (target 3, 0 counted, 3 days left) moves to due today; Yoga (target 2) stays this week'
);

-- ===== Sunday 22 Nov 10:00 (alice) =====
select tests.freeze_time('2026-11-22 10:00:00+00');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'due_today:Run, due_today:Yoga, due_today:Garage, starts_next_week:Read',
  'Sunday: every open times-per-week row is at risk and the Sunday task is due today'
);

-- ===== Non-member and anon =====
select tests.authenticate_as('dave');
select throws_ok(
  format($$ select * from public.get_today_items(%L) $$, current_setting('test.g1')),
  'P0001', 'not_member', 'get_today_items for another group raises not_member');
select throws_ok(
  format($$ select * from public.get_today_summary(%L) $$, current_setting('test.g1')),
  'P0001', 'not_member', 'get_today_summary for another group raises not_member');

select tests.clear_authentication();
select throws_ok(
  $$ select * from public.get_today_items(pg_catalog.gen_random_uuid()) $$,
  '42501', null, 'anon cannot call get_today_items');
select throws_ok(
  $$ select * from public.get_today_summary(pg_catalog.gen_random_uuid()) $$,
  '42501', null, 'anon cannot call get_today_summary');

select * from finish();
rollback;
