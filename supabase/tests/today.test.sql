-- Today (Story 2.5): get_today_items (section placement for fixed days, times per week with the
-- at-risk move, tasks, commitments that start next week, display order, row details) and
-- get_today_summary (member-local today, week number, planned / done / left), a member in a
-- different zone from the group, has_plan (retro F1), a non-member rejected, and grants per role (AD-16).
--
-- Cast: alice (Europe/London) creates "Crew" (group zone Europe/London); bob (Europe/London) and
-- carol (Asia/Manila, UTC+8) join with alice's invite;
-- erin (Europe/London) joins too and never adds anything. dave (UTC) is in no group.
-- Week under test: Mon 16 Nov to Sun 22 Nov 2026 (GMT in London, so London time = UTC).
-- Commitments are added on Tue 10 Nov (they start Mon 16 Nov), then tick step 1 writes the week's
-- sessions on Mon 16 Nov. alice: Gym fixed days Mon Wed Fri, Run 3 times per week, Yoga 2 times
-- per week, Meditate 5 times per week ending Thu 19 Nov (a pro-rated week: 2 sessions ending at
-- Thursday's end), tasks "Yesterday" (deadline Tue 17), "Grocery run" (Wed 18), "Zoo trip" (Fri 20)
-- and "Garage" (Sun 22), and Read 4 times per week added on Wed 18 (starts Mon 23 Nov). bob: Walk fixed days Tue, added on
-- Wed 18 (starts next week, no sessions this week). carol: Study fixed days Thu.
-- The routines under test call now() unqualified; as the owner their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(31);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

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
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'Europe/London');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('erin');
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

-- Meditate, written directly (add_commitment never allows an end date inside the first week):
-- 5 times per week from Mon 16 Nov, ending Thu 19 Nov, so this week owes floor(5 x 4 / 7) = 2.
select tests.authenticate_as('alice');
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

-- Mon 16 Nov 00:30 (08:30 in Manila): the tick writes the week's sessions.
select tests.freeze_time('2026-11-16 00:30:00+00');
reset role;
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the week''s sessions without error');

-- Tue 17 Nov: a task due that day.
select tests.freeze_time('2026-11-17 10:00:00+00');
select tests.authenticate_as('alice');
select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
  p_name => 'Yesterday', p_deadline => '2026-11-17');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'due_today:Yesterday, this_week:Meditate, this_week:Run, this_week:Yoga',
  'Tuesday: Meditate (2 needed, 3 days left before its Thursday end) is not at risk yet'
);

-- Wed 18 Nov: tasks due today and Sunday, and commitments that start next week.
select tests.freeze_time('2026-11-18 10:00:00+00');
select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'groceries',
  p_name => 'Grocery run', p_deadline => '2026-11-18');
select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
  p_name => 'Garage', p_deadline => '2026-11-22');
select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
  p_name => 'Zoo trip', p_deadline => '2026-11-20');
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
  'due_today:Gym, due_today:Meditate, due_today:Grocery run, this_week:Run, this_week:Yoga, this_week:Zoo trip, this_week:Garage, starts_next_week:Read',
  'Wednesday: Gym, Meditate (2 needed, 2 days left before its end) and the task due today are due; tasks later this week by deadline (Zoo trip before Garage, though Garage sorts first by name); Read next week; yesterday''s task is gone'
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
  '2026-11-18 2026-11-16 4 14 0 12',
  'summary: member today, week start, week 4 for a member who joined three weeks earlier, 14 sessions planned, none done, 12 left (Monday''s Gym and yesterday''s task are over)'
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
select is(
  (select s.has_plan from public.get_today_summary(current_setting('test.g1')::uuid) s),
  true,
  'has_plan: a commitment that starts next week is a plan'
);

-- erin: a member with no commitments or tasks.
select tests.authenticate_as('erin');
select is(
  (select s.has_plan::text || ' ' || s.planned::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  'false 0',
  'has_plan: false for a member with no commitments or tasks in the group'
);

-- carol (Manila): Wed 18:00 there, her Thursday session is not listed yet.
select tests.authenticate_as('carol');
select is(
  (select count(*)::integer from public.get_today_items(current_setting('test.g1')::uuid)),
  0, 'on her Wednesday a Thursday-only member has nothing listed'
);
select is(
  (select s.has_plan from public.get_today_summary(current_setting('test.g1')::uuid) s),
  true,
  'has_plan: a fixed-days member with nothing listed today still has a plan (retro F1)'
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
  'due_today:Gym, due_today:Meditate, due_today:Grocery run, this_week:Run, this_week:Yoga, this_week:Zoo trip, this_week:Garage, starts_next_week:Read',
  'at the same moment a London member still sees Wednesday'
);

-- ===== Thursday 19 Nov 10:00 (alice) =====
select tests.freeze_time('2026-11-19 10:00:00+00');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'due_today:Meditate, this_week:Run, this_week:Yoga, this_week:Zoo trip, this_week:Garage, starts_next_week:Read',
  'Thursday: no Gym (not a Gym day), the passed task is gone, Meditate is due on its last day, Run (3 needed, 4 days left) stays this week'
);

-- ===== Friday 20 Nov 10:00 (alice): the at-risk move =====
select tests.freeze_time('2026-11-20 10:00:00+00');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, ord)),
  'due_today:Gym, due_today:Run, due_today:Zoo trip, this_week:Yoga, this_week:Garage, starts_next_week:Read',
  'Friday: Run (target 3, 0 counted, 3 days left) moves to due today; Yoga (target 2) stays this week; Meditate''s last session has ended and is gone'
);
select is(
  (select s.planned::text || ' ' || s."left"::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '14 8',
  'Friday: left counts only open sessions (Gym Fri, Run 3, Yoga 2, Zoo trip, Garage), not past ones'
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
