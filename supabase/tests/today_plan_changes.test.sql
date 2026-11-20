-- Today after My plan changes (Epic 2 retro V2): get_today_items after update_commitment (the row
-- keeps this week's version while an edit waits; a commitment that starts next week shows the edited
-- first target) and after end_commitment (a commitment that has not started is gone; a started one
-- stays for the rest of its week), then the next week's rows after tick step 1.
--
-- Cast: alice (Europe/London) creates "Crew". Week under test: Mon 16 Nov to Sun 22 Nov 2026 (GMT
-- in London, so London time = UTC). Tue 10 Nov: Gym fixed days Mon Wed Fri and Run 3 times per
-- week (start Mon 16 Nov); tick step 1 writes the week's sessions on Mon 16 Nov. Wed 18 Nov: Read 4
-- times per week and Walk fixed days Tue Thu (start Mon 23 Nov).
-- The routines under test call now() unqualified; as the owner their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(13);

select tests.create_supabase_user('alice');

select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);

-- ===== Frozen clock =====
reset role;
alter function public.get_today_items(uuid) set search_path = test_overrides, pg_catalog;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function public.update_commitment(uuid, integer[], integer, date) set search_path = test_overrides, pg_catalog;
alter function public.end_commitment(uuid) set search_path = test_overrides, pg_catalog;
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

-- Mon 16 Nov 00:30: the tick writes the week's sessions.
select tests.freeze_time('2026-11-16 00:30:00+00');
reset role;
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the week''s sessions without error');

-- ===== Wed 18 Nov 10:00: commitments that start Mon 23 Nov, then edits =====
select tests.freeze_time('2026-11-18 10:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.read', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read',
    p_schedule_type => 'times_per_week', p_target => 4) a), true);
select * from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk',
  p_schedule_type => 'fixed_days', p_days => array[2, 4]);

select is(
  (select u.changes_from::text
   from public.update_commitment(current_setting('test.gym')::uuid, p_days => array[2, 4]) u),
  '2026-11-23',
  'update_commitment(Gym, Tue Thu) takes effect Mon 23 Nov'
);
select is(
  (select t.section || ' ' || t.days::text
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.activity_name = 'Gym'),
  'due_today {1,3,5}',
  'Today: Gym is still due on Wednesday with this week''s days Mon Wed Fri'
);

select is(
  (select u.changes_from::text
   from public.update_commitment(current_setting('test.run')::uuid, p_target => 5) u),
  '2026-11-23',
  'update_commitment(Run, 5) takes effect Mon 23 Nov'
);
select is(
  (select t.section || ' ' || t.target::text
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.activity_name = 'Run'),
  'this_week 3',
  'Today: Run keeps this week''s target 3'
);

select is(
  (select u.changes_from::text
   from public.update_commitment(current_setting('test.read')::uuid, p_target => 2) u),
  '2026-11-23',
  'update_commitment(Read, 2) changes its first week, Mon 23 Nov'
);
select is(
  (select t.section || ' ' || t.target::text || ' ' || t.starts_on::text
   from public.get_today_items(current_setting('test.g1')::uuid) t where t.activity_name = 'Read'),
  'starts_next_week 2 2026-11-23',
  'Today: Read starts next week with the edited target 2'
);

select is(
  (select e.ends_after_week_start::text from public.end_commitment(current_setting('test.read')::uuid) e),
  '2026-11-09',
  'end_commitment(Read) before it starts ends it after the week before'
);
select is(
  (select count(*)::integer from public.get_today_items(current_setting('test.g1')::uuid) t
   where t.activity_name = 'Read'),
  0,
  'Today: Read is gone from Starts next week'
);

select is(
  (select e.ends_after_week_start::text from public.end_commitment(current_setting('test.run')::uuid) e),
  '2026-11-16',
  'end_commitment(Run) ends it after this week'
);
select is(
  (select t.section from public.get_today_items(current_setting('test.g1')::uuid) t
   where t.activity_name = 'Run'),
  'this_week',
  'Today: Run is still listed this week'
);

-- ===== Mon 23 Nov 00:30: the next week; Tue 24 Nov 10:00 =====
select tests.freeze_time('2026-11-23 00:30:00+00');
reset role;
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the next week''s sessions without error');

select tests.freeze_time('2026-11-24 10:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name) || ' ' || t.days::text,
     ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, done_count, counted_today,
          target_met, ord)),
  'due_today:Gym {2,4}, due_today:Walk {2,4}',
  'Tuesday 24 Nov: Gym on its new days and Walk are due; ended Run and Read are not listed'
);

select * from finish();
rollback;
