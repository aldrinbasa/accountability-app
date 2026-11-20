-- The client RPCs while a zone change is waiting (Epic 2 retro V1): get_today_items,
-- get_today_summary, plan_preview, add_task, add_commitment, get_my_plan, get_commitment,
-- update_commitment and end_commitment, for a member whose own move ahead is waiting (not due yet),
-- for a member whose only waiting change is the group's, and for a move behind in the window after
-- the old zone's Monday. member_current_week.test.sql covers the due-but-not-promoted window (F5).
--
-- Cast: alice (Europe/London) creates "Crew" (group zone Europe/London) and invites bob
-- (Europe/London) and carol (Pacific/Auckland). The week under test: Mon 16 Nov to Sun 22 Nov 2026
-- (GMT in London, NZDT = UTC+13 in Auckland). Tue 10 Nov: alice adds Gym fixed days Mon Wed Fri and
-- Run 3 times per week, bob adds Walk fixed days Wed; tick step 1 writes the week's sessions on Mon
-- 16 Nov. Wed 18 Nov 10:00 UTC: alice moves to Pacific/Auckland from Mon 23 Nov, sets the group's
-- zone to America/New_York from Mon 23 Nov, and carol moves to Europe/London from Mon 23 Nov.
-- The routines under test call now() unqualified; as the owner their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(21);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');

-- ===== Profiles and group =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Pacific/Auckland');

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
alter function public.plan_preview(uuid, integer, date) set search_path = test_overrides, pg_catalog;
alter function public.add_task(uuid, text, uuid, text, text, date) set search_path = test_overrides, pg_catalog;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function public.get_my_plan(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_commitment(uuid) set search_path = test_overrides, pg_catalog;
alter function public.update_commitment(uuid, integer[], integer, date) set search_path = test_overrides, pg_catalog;
alter function public.end_commitment(uuid) set search_path = test_overrides, pg_catalog;
alter function public.set_time_zone(text, uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;

-- Tue 10 Nov: commitments that start Mon 16 Nov.
select tests.freeze_time('2026-11-10 12:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.gym', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym',
    p_schedule_type => 'fixed_days', p_days => array[1, 3, 5]) a), true);
select pg_catalog.set_config('test.run', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run',
    p_schedule_type => 'times_per_week', p_target => 3) a), true);
select tests.authenticate_as('bob');
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk',
  p_schedule_type => 'fixed_days', p_days => array[3]);

-- Mon 16 Nov 00:30: the tick writes the week's sessions.
select tests.freeze_time('2026-11-16 00:30:00+00');
reset role;
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the week''s sessions without error');

-- ===== Wed 18 Nov 10:00 UTC: the zone changes wait for Mon 23 Nov =====
select tests.freeze_time('2026-11-18 10:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select z.time_zone || '|' || z.pending_time_zone || '|' || z.pending_week_start::text
   from public.set_time_zone('Pacific/Auckland') z),
  'Europe/London|Pacific/Auckland|2026-11-23',
  'alice''s move ahead to Auckland waits for Mon 23 Nov'
);
select is(
  (select z.time_zone || '|' || z.pending_time_zone || '|' || z.pending_week_start::text
   from public.set_time_zone('America/New_York', current_setting('test.g1')::uuid) z),
  'Europe/London|America/New_York|2026-11-23',
  'the group''s move to New York waits for Mon 23 Nov'
);
select tests.authenticate_as('carol');
select is(
  (select z.time_zone || '|' || z.pending_time_zone || '|' || z.pending_week_start::text
   from public.set_time_zone('Europe/London') z),
  'Pacific/Auckland|Europe/London|2026-11-23',
  'carol''s move behind to London waits for Mon 23 Nov'
);

-- ===== alice, own move ahead waiting (not due): everything stays in London's week of 16 Nov =====
select tests.authenticate_as('alice');
select is((select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, done_count, counted_today,
          target_met, ord)), 'due_today:Gym, this_week:Run',
  'Today: London''s Wednesday, Gym due and Run this week');
select is(
  (select s.member_today::text || '|' || s.week_start::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '2026-11-18|2026-11-16',
  'get_today_summary: London''s today and week'
);
select is(
  (select p.member_today::text || '|' || p.week_start::text || '|' || p.starts_on::text
   from public.plan_preview(current_setting('test.g1')::uuid) p),
  '2026-11-18|2026-11-16|2026-11-23',
  'plan_preview: London''s today and week; a new commitment starts Mon 23 Nov'
);
select lives_ok(
  $$select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
      p_name => 'Garage', p_deadline => '2026-11-22')$$,
  'add_task with deadline Sun 22 Nov (the last day of London''s week) succeeds'
);
select throws_ok(
  $$select * from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
      p_name => 'Attic', p_deadline => '2026-11-23')$$,
  'P0001', 'invalid_deadline',
  'add_task with deadline Mon 23 Nov (the waiting zone''s week) is refused'
);
select is(
  (select a.starts_on::text
   from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'yoga',
     p_schedule_type => 'times_per_week', p_target => 2) a),
  '2026-11-23',
  'add_commitment: Yoga starts Mon 23 Nov'
);
select is(
  (select pg_catalog.string_agg(p.activity_name || ':' || p.state, ', ' order by p.ord)
   from public.get_my_plan(current_setting('test.g1')::uuid) with ordinality
     as p(commitment_id, kind, section, state, preset_key, custom_name, activity_name, name,
          schedule_type, days, target, end_date, deadline, starts_on, ends_on, can_edit, can_delete,
          ord)
   where p.kind = 'commitment'),
  'Gym:active, Run:active, Yoga:starts_next_week',
  'get_my_plan: Gym and Run active, Yoga starts next week'
);
select is(
  (select c.changes_from::text || '|' || c.min_end_date::text || '|' || c.state || '|' || c.can_edit::text
   from public.get_commitment(current_setting('test.run')::uuid) c),
  '2026-11-23|2026-11-29|active|true',
  'get_commitment(Run): an edit changes from Mon 23 Nov'
);
select is(
  (select u.changes_from::text
   from public.update_commitment(current_setting('test.run')::uuid, p_target => 5) u),
  '2026-11-23',
  'update_commitment(Run, 5) takes effect Mon 23 Nov'
);
select is(
  (select t.target::text from public.get_today_items(current_setting('test.g1')::uuid) t
   where t.activity_name = 'Run'),
  '3',
  'Today keeps Run''s target 3 this week'
);
select is(
  (select e.ends_after_week_start::text from public.end_commitment(current_setting('test.gym')::uuid) e),
  '2026-11-16',
  'end_commitment(Gym) ends it after London''s week of 16 Nov'
);
select is(
  (select t.section from public.get_today_items(current_setting('test.g1')::uuid) t
   where t.activity_name = 'Gym'),
  'due_today',
  'Gym is still due today after ending'
);

-- ===== bob: only the group's change is waiting; his reads are as without one =====
select tests.authenticate_as('bob');
select is((select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, done_count, counted_today,
          target_met, ord)), 'due_today:Walk',
  'bob''s Today: Walk due on Wednesday');
select is(
  (select s.member_today::text || '|' || s.week_start::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '2026-11-18|2026-11-16',
  'bob''s get_today_summary: London''s today and week'
);
select is(
  (select p.starts_on::text from public.plan_preview(current_setting('test.g1')::uuid) p),
  '2026-11-23',
  'bob''s plan_preview: a new commitment starts Mon 23 Nov'
);

-- ===== Sun 22 Nov 10:00 UTC (Auckland Sun 23:00): alice's move is still not due =====
select tests.freeze_time('2026-11-22 10:00:00+00');
select tests.authenticate_as('alice');
select is((select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, done_count, counted_today,
          target_met, ord)),
  'due_today:Run, due_today:Garage, starts_next_week:Yoga',
  'Sunday in London: Run at risk and Garage due today, Yoga next week, Gym (no Sunday) not listed');

-- ===== Sun 22 Nov 12:00 UTC (Auckland Mon 01:00): carol's move behind, old zone's Monday came =====
select tests.freeze_time('2026-11-22 12:00:00+00');
select tests.authenticate_as('carol');
select is(
  (select s.member_today::text || '|' || s.week_start::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '2026-11-22|2026-11-16',
  'carol''s get_today_summary: London''s Sunday, still the week of 16 Nov (two-step rule)'
);

select * from finish();
rollback;
