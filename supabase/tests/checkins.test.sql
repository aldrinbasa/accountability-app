-- Check-ins (Story 3.2): the checkins table and its RLS, the `checkins` bucket and its Storage
-- policies, the AD-4 functions private.session_status / private.counted_checkins, post_checkin
-- (timing, late label, every rejection, session matching, extras, idempotency, conflicts, a late
-- arrival on a missed session, a DST week), the Today reads' done / counted fields and the
-- picker read get_checkin_targets, plus grants per role (AD-16).
--
-- Cast: alice, bob, carol and erin (all Europe/London) are in "Crew" (alice's group, London zone);
-- dave (Europe/London) is alone in "Other". London is on GMT in November (London time = UTC).
-- October (DST): erin paints on fixed day Sunday from Mon 19 Oct; London falls back from BST to
-- GMT at 02:00 on Sun 25 Oct, so that Sunday runs Sat 24 Oct 23:00 UTC to Mon 26 Oct 00:00 UTC.
-- November, week Mon 16 to Sun 22 Nov 2026 (locks Thu 26 Nov 00:00): alice has Gym fixed days
-- Mon Wed Fri and Run 2 times per week; bob has Walk 7 times per week; carol has Study 3 times
-- per week. Photos are put in Storage as service_role (the uploads' stand-in).
-- The routines under test call now() unqualified; as the owner their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(84);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

-- ===== Shape =====
select columns_are('public', 'checkins',
  array['id', 'group_id', 'user_id', 'commitment_id', 'session_id', 'captured_at', 'received_at',
        'counted_at', 'is_late', 'caption', 'full_pruned_at', 'created_at', 'updated_at'],
  'checkins has the story''s columns');
select col_hasnt_default('public', 'checkins', 'id', 'checkins.id has no default (client-generated)');
select col_is_null('public', 'checkins', 'session_id', 'session_id is nullable (null = extra)');
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.checkins'::regclass),
  'RLS is enabled on checkins'
);
select ok(
  pg_catalog.to_regprocedure('public.post_checkin(uuid, uuid, timestamptz, text)') is not null
  and pg_catalog.to_regprocedure('public.get_checkin_targets(uuid)') is not null
  and pg_catalog.to_regprocedure('private.session_status(public.sessions)') is not null
  and pg_catalog.to_regprocedure('private.counted_checkins(uuid, date)') is not null,
  'post_checkin, get_checkin_targets, session_status and counted_checkins exist'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in (
     'public.post_checkin(uuid, uuid, timestamptz, text)'::regprocedure,
     'public.get_checkin_targets(uuid)'::regprocedure,
     'private.session_status(public.sessions)'::regprocedure,
     'private.counted_checkins(uuid, date)'::regprocedure)),
  'the new functions pin search_path to empty'
);
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p
   where p.oid = 'public.post_checkin(uuid, uuid, timestamptz, text)'::regprocedure)
  and (select bool_and(not p.prosecdef and p.provolatile = 's') from pg_catalog.pg_proc p
       where p.oid in (
         'public.get_checkin_targets(uuid)'::regprocedure,
         'private.session_status(public.sessions)'::regprocedure,
         'private.counted_checkins(uuid, date)'::regprocedure)),
  'post_checkin is security definer; the reads and the AD-4 functions are stable security invoker'
);
select ok(
  (select b.public = false and b.file_size_limit = 1048576 and b.allowed_mime_types = array['image/webp']
   from storage.buckets b where b.id = 'checkins'),
  'bucket checkins is private, WebP only, 1 MB'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
      and p.policyname like 'checkins%' and p.cmd in ('UPDATE', 'DELETE', 'ALL')
  ),
  'no UPDATE or DELETE policy on the checkins bucket (no upsert)'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.post_checkin(uuid, uuid, timestamptz, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_checkin_targets(uuid)', 'EXECUTE'),
  'authenticated can execute post_checkin and get_checkin_targets'
);
select ok(
  not has_function_privilege('anon', 'public.post_checkin(uuid, uuid, timestamptz, text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.post_checkin(uuid, uuid, timestamptz, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_checkin_targets(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_checkin_targets(uuid)', 'EXECUTE'),
  'anon and PUBLIC cannot execute post_checkin or get_checkin_targets'
);
select ok(
  has_function_privilege('authenticated', 'private.session_status(public.sessions)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.counted_checkins(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.session_status(public.sessions)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.counted_checkins(uuid, date)', 'EXECUTE')
  and not has_function_privilege('public', 'private.session_status(public.sessions)', 'EXECUTE')
  and not has_function_privilege('public', 'private.counted_checkins(uuid, date)', 'EXECUTE'),
  'the AD-4 functions are executable by authenticated only'
);
select ok(
  has_table_privilege('authenticated', 'public.checkins', 'SELECT')
  and not has_table_privilege('authenticated', 'public.checkins', 'INSERT')
  and not has_table_privilege('authenticated', 'public.checkins', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.checkins', 'DELETE')
  and not has_table_privilege('anon', 'public.checkins', 'SELECT')
  and not has_table_privilege('anon', 'public.checkins', 'INSERT')
  and not has_table_privilege('anon', 'public.checkins', 'UPDATE')
  and not has_table_privilege('anon', 'public.checkins', 'DELETE'),
  'checkins: SELECT for authenticated only, no writes for anon or authenticated'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'Europe/London');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'Europe/London');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select pg_catalog.set_config('test.g2', public.create_group('Other')::text, true);

-- ===== Frozen clock =====
reset role;
alter function public.post_checkin(uuid, uuid, timestamptz, text) set search_path = test_overrides, pg_catalog;
alter function public.get_today_items(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_today_summary(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_checkin_targets(uuid) set search_path = test_overrides, pg_catalog;
alter function public.add_task(uuid, text, uuid, text, text, date) set search_path = test_overrides, pg_catalog;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function public.end_commitment(uuid) set search_path = test_overrides, pg_catalog;

-- Ids. Every check-in id below is fixed; photos are keyed by them.
select pg_catalog.set_config('test.e1', '00000000-0000-4000-a000-0000000000e1', true);
select pg_catalog.set_config('test.e2', '00000000-0000-4000-a000-0000000000e2', true);
select pg_catalog.set_config('test.a1', '00000000-0000-4000-a000-0000000000a1', true);
select pg_catalog.set_config('test.a3', '00000000-0000-4000-a000-0000000000a3', true);
select pg_catalog.set_config('test.a4', '00000000-0000-4000-a000-0000000000a4', true);
select pg_catalog.set_config('test.a5', '00000000-0000-4000-a000-0000000000a5', true);
select pg_catalog.set_config('test.a6', '00000000-0000-4000-a000-0000000000a6', true);
select pg_catalog.set_config('test.a7', '00000000-0000-4000-a000-0000000000a7', true);
select pg_catalog.set_config('test.a8', '00000000-0000-4000-a000-0000000000a8', true);
select pg_catalog.set_config('test.a9', '00000000-0000-4000-a000-0000000000a9', true);
select pg_catalog.set_config('test.t1', '00000000-0000-4000-a000-0000000000f1', true);
select pg_catalog.set_config('test.t2', '00000000-0000-4000-a000-0000000000f2', true);
select pg_catalog.set_config('test.c1', '00000000-0000-4000-a000-0000000000c1', true);
select pg_catalog.set_config('test.c2', '00000000-0000-4000-a000-0000000000c2', true);
select pg_catalog.set_config('test.r1', '00000000-0000-4000-a000-0000000000d1', true);
select pg_catalog.set_config('test.x1', '00000000-0000-4000-a000-0000000000d2', true);
select pg_catalog.set_config('test.b1', '00000000-0000-4000-a000-0000000000b1', true);
select pg_catalog.set_config('test.b2', '00000000-0000-4000-a000-0000000000b2', true);
select pg_catalog.set_config('test.b3', '00000000-0000-4000-a000-0000000000b3', true);
select pg_catalog.set_config('test.b4', '00000000-0000-4000-a000-0000000000b4', true);
select pg_catalog.set_config('test.b5', '00000000-0000-4000-a000-0000000000b5', true);
select pg_catalog.set_config('test.b6', '00000000-0000-4000-a000-0000000000b6', true);
select pg_catalog.set_config('test.m1', '00000000-0000-4000-a000-000000000101', true);
select pg_catalog.set_config('test.m2', '00000000-0000-4000-a000-000000000102', true);
select pg_catalog.set_config('test.m3', '00000000-0000-4000-a000-000000000103', true);
select pg_catalog.set_config('test.m4', '00000000-0000-4000-a000-000000000104', true);

-- Both renditions for every id that should pass the photo check (owner = the poster, group Crew),
-- plus the photo_missing cases: m2 has only 1080, m3 belongs to bob, m4 sits under "Other".
set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.g1') || '/' || current_setting('test.' || p.id) || '/' || s.size || '.webp',
       tests.get_supabase_uid(p.owner)::text
from (values ('e1', 'erin'), ('e2', 'erin'), ('a1', 'alice'), ('a3', 'alice'), ('a4', 'alice'),
             ('a5', 'alice'), ('a6', 'alice'), ('a7', 'alice'), ('a8', 'alice'), ('a9', 'alice'),
             ('t1', 'alice'), ('t2', 'alice'), ('c1', 'carol'), ('c2', 'carol'), ('r1', 'alice'),
             ('x1', 'alice'), ('b1', 'bob'), ('b2', 'bob'), ('b3', 'bob'), ('b4', 'bob'),
             ('b5', 'bob'), ('b6', 'bob'),
             ('m3', 'bob')) p(id, owner)
cross join (values ('1080'), ('360')) s(size);
insert into storage.objects (bucket_id, name, owner_id)
values
  ('checkins', current_setting('test.g1') || '/' || current_setting('test.m2') || '/1080.webp',
   tests.get_supabase_uid('alice')::text),
  ('checkins', current_setting('test.g2') || '/' || current_setting('test.m4') || '/1080.webp',
   tests.get_supabase_uid('alice')::text),
  ('checkins', current_setting('test.g2') || '/' || current_setting('test.m4') || '/360.webp',
   tests.get_supabase_uid('alice')::text);
reset role;

-- ===== October: a DST week (London falls back on Sun 25 Oct) =====
select tests.freeze_time('2026-10-13 12:00:00+00');
select tests.authenticate_as('erin');
select pg_catalog.set_config('test.paint', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'paint',
    p_schedule_type => 'fixed_days', p_days => array[7]) a), true);
reset role;
select tests.freeze_time('2026-10-19 00:30:00+00');
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes erin''s DST week');

-- Sat 24 Oct 22:30 UTC is still Saturday 23:30 in London (BST): not a Paint day, so an extra.
select tests.freeze_time('2026-10-24 22:30:00+00');
select tests.authenticate_as('erin');
select is(
  (select r.counted::text || '|' || coalesce(r.session_id::text, 'null')
   from public.post_checkin(current_setting('test.e1')::uuid, current_setting('test.paint')::uuid,
     '2026-10-24 22:29:00+00', null) r),
  'false|null',
  'DST week: Saturday 23:30 BST is not Sunday, so it is an extra'
);
-- Sat 24 Oct 23:30 UTC is Sunday 00:30 in London: the Sunday session (25 hours long) takes it.
select tests.freeze_time('2026-10-24 23:30:00+00');
select is(
  (select r.counted::text || '|' || s.slot::text || '|' || r.is_late::text
   from public.post_checkin(current_setting('test.e2')::uuid, current_setting('test.paint')::uuid,
     '2026-10-24 23:29:00+00', null) r
   join public.sessions s on s.id = r.session_id),
  'true|7|false',
  'DST week: Sunday 00:30 BST counts for the Sunday session'
);
select is(
  (select s.starts_at::text || '|' || s.ends_at::text from public.sessions s
   where s.commitment_id = current_setting('test.paint')::uuid and s.week_start = '2026-10-19'),
  '2026-10-24 23:00:00+00|2026-10-26 00:00:00+00',
  'the DST Sunday session is 25 hours long'
);

-- ===== November: plans and the week's sessions =====
select tests.freeze_time('2026-11-10 12:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.gym', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym',
    p_schedule_type => 'fixed_days', p_days => array[1, 3, 5]) a), true);
select pg_catalog.set_config('test.run', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run',
    p_schedule_type => 'times_per_week', p_target => 2) a), true);
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.walk', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk',
    p_schedule_type => 'times_per_week', p_target => 7) a), true);
select pg_catalog.set_config('test.sports', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'sports',
    p_schedule_type => 'fixed_days', p_days => array[1, 2, 3, 4, 5, 6, 7]) a), true);
select pg_catalog.set_config('test.yoga', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'yoga',
    p_schedule_type => 'fixed_days', p_days => array[1, 2, 3, 4, 5, 6, 7]) a), true);
select tests.authenticate_as('carol');
select pg_catalog.set_config('test.study', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'study',
    p_schedule_type => 'times_per_week', p_target => 3) a), true);

reset role;
select tests.freeze_time('2026-11-16 00:30:00+00');
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the November week');

-- ===== Wed 18 Nov 08:00: an on-time post =====
select tests.freeze_time('2026-11-18 08:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.checkin_id::text || '|' || r.counted::text || '|' || r.is_late::text || '|'
          || r.done_count::text || '|' || r.target::text || '|' || s.slot::text
   from public.post_checkin(current_setting('test.a1')::uuid, current_setting('test.gym')::uuid,
     '2026-11-18 07:58:00+00', '  leg day  ') r
   join public.sessions s on s.id = r.session_id),
  current_setting('test.a1') || '|true|false|1|3|3',
  'on time: Wednesday''s Gym session, not late, 1 of 3'
);
reset role;
select is(
  (select c.received_at::text || '|' || c.counted_at::text || '|' || c.captured_at::text || '|' || c.caption
          || '|' || c.group_id::text || '|' || c.user_id::text
   from public.checkins c where c.id = current_setting('test.a1')::uuid),
  '2026-11-18 08:00:00+00|2026-11-18 08:00:00+00|2026-11-18 07:58:00+00|leg day|'
    || current_setting('test.g1') || '|' || tests.get_supabase_uid('alice')::text,
  'received_at = now(), counted_at = received_at within 10 min, caption trimmed, group and author set'
);
select is(
  (select private.session_status(s) from public.sessions s
   where s.commitment_id = current_setting('test.gym')::uuid and s.slot = 3),
  'done',
  'session_status: the Wednesday session is done'
);
select is(
  (select private.session_status(s) from public.sessions s
   where s.commitment_id = current_setting('test.gym')::uuid and s.slot = 5),
  'open',
  'session_status: Friday''s session is open'
);
select pg_catalog.set_config('test.a1_updated', (select c.updated_at::text from public.checkins c
  where c.id = current_setting('test.a1')::uuid), true);

-- The same call again: the stored result, no new writes, no window checks.
select tests.freeze_time('2026-11-18 08:05:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.checkin_id::text || '|' || r.counted::text || '|' || r.done_count::text || '|' || r.target::text
   from public.post_checkin(current_setting('test.a1')::uuid, current_setting('test.gym')::uuid,
     '2026-11-18 07:58:00+00', 'leg day') r),
  current_setting('test.a1') || '|true|1|3',
  'idempotent repeat: same payload returns the stored result'
);
reset role;
select is(
  (select count(*)::text || '|' || max(c.updated_at)::text || '|' || max(c.received_at)::text
   from public.checkins c where c.id = current_setting('test.a1')::uuid),
  '1|' || current_setting('test.a1_updated') || '|2026-11-18 08:00:00+00',
  'idempotent repeat: no new row and the stored row is unchanged'
);
select tests.authenticate_as('alice');
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, %L)', current_setting('test.a1'),
    current_setting('test.gym'), '2026-11-18 07:58:00+00', 'another caption'),
  'P0001', 'checkin_conflict', 'checkin_conflict: same id, another caption'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, %L)', current_setting('test.a1'),
    current_setting('test.gym'), '2026-11-18 07:57:00+00', 'leg day'),
  'P0001', 'checkin_conflict', 'checkin_conflict: same id, another capture time'
);
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, %L)', current_setting('test.a1'),
    current_setting('test.walk'), '2026-11-18 07:58:00+00', 'leg day'),
  'P0001', 'checkin_conflict', 'checkin_conflict: another caller on the same id'
);

-- ===== Wed 18 Nov 08:30: carol posts; RLS reads =====
select tests.freeze_time('2026-11-18 08:30:00+00');
select tests.authenticate_as('carol');
select is(
  (select r.counted from public.post_checkin(current_setting('test.c1')::uuid,
     current_setting('test.study')::uuid, '2026-11-18 08:29:00+00', null) r),
  true,
  'carol''s Study post counts'
);
select tests.authenticate_as('bob');
select is((select count(*)::integer from public.checkins c where c.group_id = current_setting('test.g1')::uuid
           and c.created_at is not null), 4,
  'RLS: a current member reads the group''s check-ins (erin x2, alice, carol)');
select tests.authenticate_as('dave');
select is((select count(*)::integer from public.checkins), 0, 'RLS: a non-member reads none');
select tests.authenticate_as('alice');
select throws_ok(
  format('insert into public.checkins (id, group_id, user_id, commitment_id, captured_at, received_at, counted_at, is_late) values (%L, %L, %L, %L, now(), now(), now(), false)',
    '00000000-0000-4000-a000-0000000009f9', current_setting('test.g1'),
    tests.get_supabase_uid('alice'), current_setting('test.gym')),
  '42501', null, 'authenticated cannot insert into checkins'
);

-- ===== Wed 18 Nov 08:45: open rows before done rows in a section =====
select tests.freeze_time('2026-11-18 08:45:00+00');
select tests.authenticate_as('bob');
select * from public.post_checkin(current_setting('test.b5')::uuid, current_setting('test.sports')::uuid,
  '2026-11-18 08:44:00+00', null);
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name), ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, done_count, counted_today,
          target_met, ord)),
  'due_today:Yoga, due_today:Walk, due_today:Sports',
  'Today: a done row (Sports, checked in today) sorts below the open rows of its section'
);
-- Bob ends Yoga: its sessions run through this Sunday, then it is over.
select public.end_commitment(current_setting('test.yoga')::uuid);

-- ===== Wed 18 Nov 09:00-10:00: times per week, one count per day =====
select tests.freeze_time('2026-11-18 09:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.counted::text || '|' || r.done_count::text || '|' || r.target::text
   from public.post_checkin(current_setting('test.a3')::uuid, current_setting('test.run')::uuid,
     '2026-11-18 08:59:00+00', null) r),
  'true|1|2',
  'times per week: the first Run of the day counts, 1 of 2'
);
select tests.freeze_time('2026-11-18 10:00:00+00');
select is(
  (select r.counted::text || '|' || coalesce(r.session_id::text, 'null') || '|' || r.done_count::text
   from public.post_checkin(current_setting('test.a4')::uuid, current_setting('test.run')::uuid,
     '2026-11-18 09:59:00+00', null) r),
  'false|null|1',
  'extra: a second same-day times-per-week post does not count'
);
reset role;
select is(
  (select c.session_id is null from public.checkins c where c.id = current_setting('test.a4')::uuid),
  true,
  'the extra is stored with session_id null'
);

-- Today and the picker on Wednesday 10:00.
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.string_agg(t.section || ':' || coalesce(t.name, t.activity_name) || ':'
            || t.done_count::text || ':' || t.counted_today::text || ':' || t.target_met::text
            || ':' || t.counted::text, ', ' order by t.ord)
   from public.get_today_items(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, section, preset_key, custom_name, activity_name, name, schedule_type,
          days, target, counted, deadline, starts_on, can_delete, done_count, counted_today,
          target_met, ord)),
  'due_today:Gym:1:true:false:1, this_week:Run:1:true:false:1',
  'Today: done_count, counted_today and target_met per row'
);
select is(
  (select s.planned::text || '|' || s.done::text || '|' || s."left"::text
   from public.get_today_summary(current_setting('test.g1')::uuid) s),
  '5|2|2',
  'summary: 5 planned, 2 done, 2 open left (Friday''s Gym and one Run)'
);
select is(
  (select pg_catalog.string_agg(t.activity_name || ':' || t.due_today::text || ':'
            || coalesce(t.wont_count, '-') || ':' || t.done_count::text || '/' || t.target::text
            || ':' || t.member_today::text, ', ' order by t.ord)
   from public.get_checkin_targets(current_setting('test.g1')::uuid) with ordinality
     as t(commitment_id, kind, preset_key, custom_name, activity_name, name, schedule_type,
          due_today, member_today, deadline, target, done_count, wont_count, ord)),
  'Gym:true:counted_today:1/3:2026-11-18, Run:false:counted_today:1/2:2026-11-18',
  'picker on Wednesday: Gym done today, Run already counted today'
);

-- ===== Wed 18 Nov 11:00: a late arrival on a missed session =====
reset role;
update public.sessions set miss_recorded_at = '2026-11-17 00:00:00+00'
where commitment_id = current_setting('test.gym')::uuid and slot = 1;
select tests.freeze_time('2026-11-18 11:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.counted::text || '|' || r.is_late::text || '|' || s.slot::text || '|' || r.done_count::text
   from public.post_checkin(current_setting('test.a5')::uuid, current_setting('test.gym')::uuid,
     '2026-11-16 09:00:00+00', null) r
   join public.sessions s on s.id = r.session_id),
  'true|true|1|2',
  'a late arrival counted at captured_at completes the miss-stamped Monday session'
);
select is(
  (select private.session_status(s) from public.sessions s
   where s.commitment_id = current_setting('test.gym')::uuid and s.slot = 1),
  'done',
  'the missed Monday session is done now'
);
reset role;
select is(
  (select c.counted_at::text from public.checkins c where c.id = current_setting('test.a5')::uuid),
  '2026-11-16 09:00:00+00',
  'late post: counted_at = captured_at'
);
select is(
  (select pg_catalog.string_agg(k.checkin_id::text, ',' order by k.counted_at)
   from public.memberships m
   cross join lateral private.counted_checkins(m.id, '2026-11-16') k
   where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('alice')),
  current_setting('test.a5') || ',' || current_setting('test.a1') || ',' || current_setting('test.a3'),
  'counted_checkins: the member week''s counted check-ins, extras left out'
);

-- ===== Wed 18 Nov 12:00: rejections =====
select tests.freeze_time('2026-11-18 12:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.read', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'read',
    p_schedule_type => 'times_per_week', p_target => 4) a), true);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.r1'),
    current_setting('test.read'), '2026-11-18 11:59:00+00'),
  'P0001', 'commitment_ended', 'commitment_ended: a commitment that starts next week'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.x1'),
    '00000000-0000-4000-a000-00000000dead', '2026-11-18 11:59:00+00'),
  'P0001', 'commitment_ended', 'commitment_ended: no such commitment (a deleted task)'
);
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.b1'),
    current_setting('test.gym'), '2026-11-18 11:59:00+00'),
  'P0001', 'commitment_ended', 'commitment_ended: another member''s commitment'
);
select tests.authenticate_as('alice');
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, %L)', current_setting('test.x1'),
    current_setting('test.gym'), '2026-11-18 11:59:00+00', repeat('x', 81)),
  'P0001', 'invalid_caption', 'invalid_caption: over 80 characters'
);

select tests.authenticate_as('carol');
select public.leave_group(current_setting('test.g1')::uuid);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.c2'),
    current_setting('test.study'), '2026-11-18 11:59:00+00'),
  'P0001', 'not_member', 'not_member: a member who left'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.checkins c where c.user_id = tests.get_supabase_uid('carol')),
  0,
  'RLS: a left member''s check-ins disappear at once'
);

-- ===== Thu 19 Nov: an unscheduled day, photo_missing, a task =====
select tests.freeze_time('2026-11-19 09:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.counted::text || '|' || coalesce(r.session_id::text, 'null')
   from public.post_checkin(current_setting('test.a6')::uuid, current_setting('test.gym')::uuid,
     '2026-11-19 08:59:00+00', null) r),
  'false|null',
  'extra: Gym on Thursday (not a Gym day)'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.m1'),
    current_setting('test.gym'), '2026-11-19 08:59:00+00'),
  'P0001', 'photo_missing', 'photo_missing: no objects'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.m2'),
    current_setting('test.gym'), '2026-11-19 08:59:00+00'),
  'P0001', 'photo_missing', 'photo_missing: only one rendition'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.m3'),
    current_setting('test.gym'), '2026-11-19 08:59:00+00'),
  'P0001', 'photo_missing', 'photo_missing: both renditions owned by someone else'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.m4'),
    current_setting('test.gym'), '2026-11-19 08:59:00+00'),
  'P0001', 'photo_missing', 'photo_missing: both renditions under another group'
);
select is(
  (select coalesce(t.wont_count, '-') from public.get_checkin_targets(current_setting('test.g1')::uuid) t
   where t.commitment_id = current_setting('test.gym')::uuid),
  'not_today',
  'picker on Thursday: Gym is not today'
);

select pg_catalog.set_config('test.task', (select a.commitment_id::text
  from public.add_task(current_setting('test.g1')::uuid, p_preset_key => 'clean',
    p_name => 'Grocery run', p_deadline => '2026-11-20') a), true);
select tests.freeze_time('2026-11-19 10:00:00+00');
select is(
  (select r.counted::text || '|' || r.done_count::text || '|' || r.target::text
   from public.post_checkin(current_setting('test.t1')::uuid, current_setting('test.task')::uuid,
     '2026-11-19 09:59:00+00', null) r),
  'true|1|1',
  'a task''s first post counts, 1 of 1'
);
select tests.freeze_time('2026-11-19 11:00:00+00');
select is(
  (select r.counted::text || '|' || r.done_count::text
   from public.post_checkin(current_setting('test.t2')::uuid, current_setting('test.task')::uuid,
     '2026-11-19 10:59:00+00', null) r),
  'false|1',
  'extra: a task already done'
);
select is(
  (select coalesce(t.wont_count, '-') from public.get_checkin_targets(current_setting('test.g1')::uuid) t
   where t.commitment_id = current_setting('test.task')::uuid),
  'done',
  'picker: a done task won''t count'
);
select is(
  (select t.section || ':' || t.target_met::text || ':' || t.done_count::text
   from public.get_today_items(current_setting('test.g1')::uuid) t
   where t.commitment_id = current_setting('test.task')::uuid),
  'this_week:true:1',
  'Today: the done task is at its target'
);

-- ===== Fri 20 Nov 00:02: captured late Thursday, received Friday =====
select tests.freeze_time('2026-11-20 00:02:00+00');
select is(
  (select r.counted::text || '|' || r.is_late::text || '|' || r.done_count::text || '|' || r.target::text
   from public.post_checkin(current_setting('test.a7')::uuid, current_setting('test.run')::uuid,
     '2026-11-19 23:55:00+00', null) r),
  'true|true|2|2',
  'different member-local days: late even within 10 min, counted at received_at (Friday)'
);
reset role;
select is(
  (select c.counted_at::text from public.checkins c where c.id = current_setting('test.a7')::uuid),
  '2026-11-20 00:02:00+00',
  'within 10 min: counted_at = received_at'
);

-- ===== Fri 20 Nov 18:00: late post counted at captured_at =====
select tests.freeze_time('2026-11-20 18:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.counted::text || '|' || r.is_late::text || '|' || s.slot::text || '|' || r.done_count::text
   from public.post_checkin(current_setting('test.a9')::uuid, current_setting('test.gym')::uuid,
     '2026-11-20 17:00:00+00', null) r
   join public.sessions s on s.id = r.session_id),
  'true|true|5|3',
  'a post an hour late counts for Friday''s session, 3 of 3'
);
reset role;
select is(
  (select c.counted_at::text from public.checkins c where c.id = current_setting('test.a9')::uuid),
  '2026-11-20 17:00:00+00',
  'over 10 min: counted_at = captured_at'
);

-- ===== Sat 21 Nov: over target, then bad_capture_time =====
select tests.freeze_time('2026-11-21 10:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select coalesce(t.wont_count, '-') from public.get_checkin_targets(current_setting('test.g1')::uuid) t
   where t.commitment_id = current_setting('test.run')::uuid),
  'target_met',
  'picker: Run at its target won''t add points'
);
select is(
  (select r.counted::text || '|' || coalesce(r.session_id::text, 'null') || '|' || r.done_count::text
   from public.post_checkin(current_setting('test.a8')::uuid, current_setting('test.run')::uuid,
     '2026-11-21 09:59:00+00', null) r),
  'false|null|2',
  'extra: over target'
);
select is(
  (select t.done_count::text || ':' || t.target_met::text
   from public.get_today_items(current_setting('test.g1')::uuid) t
   where t.commitment_id = current_setting('test.run')::uuid),
  '2:true',
  'Today: Run at its target'
);

select tests.freeze_time('2026-11-21 12:00:00+00');
select tests.authenticate_as('bob');
select lives_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.b1'),
    current_setting('test.walk'), '2026-11-21 12:01:00+00'),
  'bad_capture_time: exactly 1 min ahead is accepted'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.b2'),
    current_setting('test.walk'), '2026-11-21 12:01:01+00'),
  'P0001', 'bad_capture_time', 'bad_capture_time: just over 1 min ahead'
);

-- ===== The week lock: Thu 26 Nov 00:00 London =====
select tests.freeze_time('2026-11-25 23:59:59+00');
select is(
  (select r.counted::text || '|' || r.is_late::text
   from public.post_checkin(current_setting('test.b3')::uuid, current_setting('test.walk')::uuid,
     '2026-11-22 13:00:00+00', null) r),
  'true|true',
  'week_locked: one second before the lock still posts (late, counted Sunday)'
);
select tests.freeze_time('2026-11-26 00:00:00+00');
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.b6'),
    current_setting('test.yoga'), '2026-11-25 23:59:30+00'),
  'P0001', 'commitment_ended', 'commitment_ended: a commitment ended last week'
);
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.b4'),
    current_setting('test.walk'), '2026-11-22 12:00:00+00'),
  'P0001', 'week_locked', 'week_locked: at lock_at'
);
-- Story 3.3: the exception's DETAIL names the lock time and the group zone of that week.
do $$
declare
  v_detail text;
begin
  perform * from public.post_checkin(current_setting('test.b4')::uuid,
    current_setting('test.walk')::uuid, '2026-11-22 12:00:00+00', null);
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  perform pg_catalog.set_config('test.lock_detail', coalesce(v_detail, ''), true);
end;
$$;
select is(
  (current_setting('test.lock_detail')::jsonb ->> 'lock_at')::timestamptz,
  '2026-11-26 00:00:00+00'::timestamptz,
  'week_locked: the detail carries lock_at (Thu 26 Nov 00:00 London)'
);
select is(
  current_setting('test.lock_detail')::jsonb ->> 'time_zone',
  'Europe/London',
  'week_locked: the detail carries the group zone of that week'
);

-- ===== Storage INSERT policy =====
select tests.authenticate_as('alice');
select lives_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('checkins', %L, %L)$q$,
    current_setting('test.g1') || '/00000000-0000-4000-a000-000000000201/1080.webp',
    tests.get_supabase_uid('alice')::text),
  'storage: a member uploads under the group for a new check-in id'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('checkins', %L, %L)$q$,
    current_setting('test.g1') || '/00000000-0000-4000-a000-000000000202/1080.webp',
    tests.get_supabase_uid('bob')::text),
  '42501', null, 'storage: wrong owner is refused'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('checkins', %L, %L)$q$,
    current_setting('test.g2') || '/00000000-0000-4000-a000-000000000203/1080.webp',
    tests.get_supabase_uid('alice')::text),
  '42501', null, 'storage: a path under a group the caller is not in is refused'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('checkins', %L, %L)$q$,
    current_setting('test.g1') || '/' || current_setting('test.a6') || '/1080.webp',
    tests.get_supabase_uid('alice')::text),
  '42501', null, 'storage: an id that already has a check-in is refused'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('checkins', %L, %L)$q$,
    current_setting('test.g1') || '/00000000-0000-4000-a000-000000000204/1080.jpg',
    tests.get_supabase_uid('alice')::text),
  '42501', null, 'storage: a non-webp name is refused'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('checkins', %L, %L)$q$,
    current_setting('test.g1') || '/00000000-0000-4000-a000-000000000205/720.webp',
    tests.get_supabase_uid('alice')::text),
  '42501', null, 'storage: a size other than 1080 or 360 is refused'
);
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/' || current_setting('test.a1') || '/%'),
  2,
  'storage: a member reads the photos of a visible check-in'
);
select tests.authenticate_as('dave');
select is(
  (select count(*)::integer from storage.objects o where o.bucket_id = 'checkins'
     and o.name like current_setting('test.g1') || '/%'),
  0,
  'storage: a non-member reads no photos of the group'
);

select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/' || current_setting('test.a1') || '/%'),
  2,
  'storage: another current member reads the photos of a visible check-in'
);
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/' || current_setting('test.c1') || '/%'),
  0,
  'storage: a left member''s photos disappear for the group'
);
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/00000000-0000-4000-a000-000000000201/%'),
  0,
  'storage: another member cannot read a pending upload with no check-in row'
);
select tests.authenticate_as('alice');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/00000000-0000-4000-a000-000000000201/%'),
  1,
  'storage: the owner reads their own pending upload'
);

select * from finish();
rollback;
