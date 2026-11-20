-- Misses (Story 3.5): private.session_status (open, done, missed), tick step 4 "stamp misses"
-- (fixed-day miss at the member's local midnight in a DST week, task miss at the end of the
-- deadline day, times-per-week count at week end, idempotent re-run and catch-up after a 2-hour
-- pause, no stamp for an ended membership or after a commitment's end, a waiting group, the tease
-- never repeated twice in a row), the miss feed events, private.tick() with step 4 in its slot,
-- the feed_items view hiding a miss after a late arrival and counting the sessions still missed,
-- get_friends_today, and grants per role (AD-16).
--
-- Cast: alice creates "Crew" (Europe/London); bob, carol and erin join it. dave (UTC) is alone in
-- "Solo" (a waiting group). London falls back from BST to GMT at 02:00 on Sun 25 Oct 2026, so that
-- Sunday runs Sat 24 Oct 23:00 UTC to Mon 26 Oct 00:00 UTC; in November London time = UTC.
-- October: erin paints on Sundays (week of 19 Oct only). November, week Mon 16 to Sun 22 Nov
-- (locks Thu 26 Nov 00:00): alice has Gym Mon Wed Fri, Meditate every day, Yoga Tue (ended the
-- week before, written directly) and Run Thu (end date Wed 18 Nov, written directly); bob has Walk
-- 3 times per week; carol has the task "Tax forms" due Wed 18 Nov; erin has Draw Mon and leaves;
-- dave has Clean Mon. Plans are written directly as the table owner; photos are put in Storage as
-- service_role. The routines under test call now() unqualified; their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(56);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('fiona');

-- ===== Shape =====
select ok(
  pg_catalog.to_regprocedure('private.tick_step_4_misses()') is not null
  and pg_catalog.to_regprocedure('public.get_friends_today(uuid)') is not null,
  'tick_step_4_misses and get_friends_today exist'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig) and not p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('private.tick_step_4_misses()'::regprocedure, 'private.tick()'::regprocedure,
                   'public.get_friends_today(uuid)'::regprocedure,
                   'private.session_status(public.sessions)'::regprocedure)),
  'step 4, the tick, get_friends_today and session_status are security invoker with an empty search_path'
);
select ok(
  (select p.provolatile = 's' from pg_catalog.pg_proc p
   where p.oid = 'public.get_friends_today(uuid)'::regprocedure)
  and (select p.provolatile = 's' from pg_catalog.pg_proc p
       where p.oid = 'private.session_status(public.sessions)'::regprocedure),
  'get_friends_today and session_status are stable'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'private.tick_step_2_time_zones()')
            < pg_catalog.strpos(p.prosrc, 'private.tick_step_4_misses()')
          and pg_catalog.strpos(p.prosrc, 'private.tick_step_4_misses()')
            < pg_catalog.strpos(p.prosrc, 'if not v_failed_before_lock then')
   from pg_catalog.pg_proc p where p.oid = 'private.tick()'::regprocedure),
  'tick: step 4 runs after step 2 and before the lock guard'
);
select is(
  (select a.attname::text from pg_catalog.pg_attribute a
   where a.attrelid = 'public.feed_items'::regclass and a.attnum > 0 and not a.attisdropped
   order by a.attnum desc limit 1),
  'miss_count',
  'feed_items gains miss_count as its last column'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes i
          where i.schemaname = 'public' and i.indexname = 'sessions_unstamped_ends_at_idx'),
  'the partial index on unstamped sessions exists'
);

-- ===== Grants per role (AD-16) =====
select ok(
  not has_function_privilege('authenticated', 'private.tick_step_4_misses()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.tick_step_4_misses()', 'EXECUTE')
  and not has_function_privilege('public', 'private.tick_step_4_misses()', 'EXECUTE'),
  'step 4 is not executable by client roles'
);
select ok(
  has_function_privilege('authenticated', 'public.get_friends_today(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_friends_today(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_friends_today(uuid)', 'EXECUTE'),
  'get_friends_today: authenticated only'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'Europe/London');
select tests.authenticate_as('fiona');
select public.save_profile('Fiona', 'Asia/Manila');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('fiona');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_4_misses() set search_path = test_overrides, pg_catalog;
alter function private.tick() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_8_heartbeat(smallint, text, timestamptz) set search_path = test_overrides, pg_catalog;
alter function public.post_checkin(uuid, uuid, timestamptz, text) set search_path = test_overrides, pg_catalog;
alter function public.get_friends_today(uuid) set search_path = test_overrides, pg_catalog;

-- This transaction holds the tick lock, so the real cron job's runs return at once.
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

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

-- The session of a commitment (setting name) for a week and slot.
create function pg_temp.sess(p_commitment text, p_week date, p_slot integer)
returns public.sessions
language sql
as $$
  select s.* from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = p_week and s.slot = p_slot;
$$;

-- The miss events of a commitment (setting name).
create function pg_temp.misses(p_commitment text)
returns setof public.feed_events
language sql
as $$
  select e.* from public.feed_events e
  where e.kind = 'miss' and e.payload ->> 'commitment_id' = current_setting('test.' || p_commitment)
  order by e.created_at, (e.payload ->> 'ends_at')::timestamptz;
$$;

select pg_catalog.set_config('test.a1', '00000000-0000-4000-a000-0000000035a1', true);
select pg_catalog.set_config('test.a2', '00000000-0000-4000-a000-0000000035a2', true);
select pg_catalog.set_config('test.a3', '00000000-0000-4000-a000-0000000035a3', true);
select pg_catalog.set_config('test.a4', '00000000-0000-4000-a000-0000000035a4', true);
select pg_catalog.set_config('test.b1', '00000000-0000-4000-a000-0000000035b1', true);
select pg_catalog.set_config('test.b2', '00000000-0000-4000-a000-0000000035b2', true);

set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.g1') || '/' || current_setting('test.' || p.id) || '/' || s.size || '.webp',
       tests.get_supabase_uid(p.owner)::text
from (values ('a1', 'alice'), ('a2', 'alice'), ('a3', 'alice'), ('a4', 'alice'), ('b1', 'bob'),
             ('b2', 'bob')) p(id, owner)
cross join (values ('1080'), ('360')) s(size);
reset role;

select pg_catalog.set_config('test.paint',
  pg_temp.add_plan('erin', 'g1', 'paint', array[7]::smallint[], null, '2026-10-19', '2026-10-25')::text, true);
select pg_catalog.set_config('test.gym',
  pg_temp.add_plan('alice', 'g1', 'gym', array[1, 3, 5]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.meditate',
  pg_temp.add_plan('alice', 'g1', 'meditate', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.yoga',
  pg_temp.add_plan('alice', 'g1', 'yoga', array[2]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.run',
  pg_temp.add_plan('alice', 'g1', 'run', array[4]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.walk',
  pg_temp.add_plan('bob', 'g1', 'walk', null, 3::smallint, '2026-11-16')::text, true);
select pg_catalog.set_config('test.draw',
  pg_temp.add_plan('erin', 'g1', 'draw', array[1]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.clean',
  pg_temp.add_plan('dave', 'g2', 'clean', array[1]::smallint[], null, '2026-11-16')::text, true);

-- ===== October: a fixed-day miss in a DST week =====
select tests.freeze_time('2026-10-19 00:30:00+00');
select private.tick_step_1_sessions();

-- Sun 25 Oct 23:30 UTC: 24 hours after the Sunday started, but still Sunday in London.
select tests.freeze_time('2026-10-25 23:30:00+00');
select is(private.tick_step_4_misses(), null, 'step 4 runs clean');
select is(
  (select coalesce(s.miss_recorded_at::text, 'null') || '|' || private.session_status(s)
   from pg_temp.sess('paint', '2026-10-19', 7) s),
  'null|open',
  'DST week: 24 hours after it started the 25-hour Sunday session is still open and unstamped'
);

select tests.freeze_time('2026-10-26 00:00:00+00');
select private.tick_step_4_misses();
select is(
  (select s.miss_recorded_at::text || '|' || private.session_status(s)
   from pg_temp.sess('paint', '2026-10-19', 7) s),
  '2026-10-26 00:00:00+00|missed',
  'DST week: stamped at London''s local midnight (Mon 00:00 GMT), not 24 hours after the start'
);
select is(
  (select (e.payload ->> 'count') || '|' || (e.payload ->> 'missed_on') || '|' || (e.payload ->> 'week_start')
          || '|' || (e.payload ->> 'schedule_type') || '|' || (e.payload ->> 'commitment_kind')
          || '|' || (e.payload ->> 'activity_name') || '|' || coalesce(e.payload ->> 'task_name', 'null')
          || '|' || (e.payload ->> 'actor_name')
          || '|' || (e.payload -> 'session_ids' = pg_catalog.jsonb_build_array((select s.id from pg_temp.sess('paint', '2026-10-19', 7) s)))::text
          || '|' || ((e.payload ->> 'ends_at')::timestamptz = '2026-10-26 00:00:00+00')::text
          || '|' || (e.payload ->> 'tease' in ('couch_wins', 'couch_regards', 'couch_comfortable', 'couch_thanks', 'couch_loses'))::text
          || '|' || (e.actor_id = tests.get_supabase_uid('erin'))::text
          || '|' || (e.group_id = current_setting('test.g1')::uuid)::text
          || '|' || (e.payload ->> 'membership_id' = (select c.membership_id::text from public.commitments c
                                                      where c.id = current_setting('test.paint')::uuid))::text
   from pg_temp.misses('paint') e),
  '1|2026-10-25|2026-10-19|fixed_days|commitment|Paint|null|Erin|true|true|true|true|true|true',
  'one miss event: count 1, the missed day, the session id, a tease key, actor = the member'
);

select tests.freeze_time('2026-10-26 00:01:00+00');
select private.tick_step_4_misses();
select is(
  (select count(*)::text || '|' || max(s.miss_recorded_at)::text
   from pg_temp.misses('paint') e, pg_temp.sess('paint', '2026-10-19', 7) s),
  '1|2026-10-26 00:00:00+00',
  'a re-run stamps nothing again and writes no second event'
);

-- ===== November: the week's sessions, a task, two ended plans, erin leaves =====
select tests.freeze_time('2026-11-16 00:30:00+00');
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the November week');

insert into public.group_activities (group_id, preset_key, created_by)
values (current_setting('test.g1')::uuid, 'groceries', tests.get_supabase_uid('carol'));
insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type,
                                name, deadline, deadline_day_starts_at)
select current_setting('test.g1')::uuid, m.id, m.user_id, 'task', ga.id, null,
       'Tax forms', '2026-11-18', '2026-11-18 00:00:00+00'
from public.memberships m, public.group_activities ga
where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('carol')
  and ga.group_id = current_setting('test.g1')::uuid and ga.preset_key = 'groceries';
select pg_catalog.set_config('test.task',
  (select c.id::text from public.commitments c where c.kind = 'task' and c.group_id = current_setting('test.g1')::uuid), true);
insert into public.sessions (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
select c.group_id, c.membership_id, c.user_id, c.id, '2026-11-16', 0, '2026-11-16 00:30:00+00', '2026-11-19 00:00:00+00'
from public.commitments c where c.id = current_setting('test.task')::uuid;

-- Yoga ended the week before (its Tuesday session already existed); Run's end date moves to Wed.
update public.commitments set ends_after_week_start = '2026-11-09' where id = current_setting('test.yoga')::uuid;
update public.commitment_versions set end_date = '2026-11-18' where commitment_id = current_setting('test.run')::uuid;

select tests.authenticate_as('erin');
select public.leave_group(current_setting('test.g1')::uuid);
reset role;

select is(
  (select private.session_status(s) from pg_temp.sess('gym', '2026-11-16', 1) s),
  'open', 'session_status: Monday''s Gym is open during Monday'
);

-- Mon 23:00: a tick run; nothing has ended yet.
select tests.freeze_time('2026-11-16 23:00:00+00');
select private.tick();
select is(
  (select count(*)::integer from public.sessions s where s.week_start = '2026-11-16' and s.miss_recorded_at is not null),
  0, 'before Monday''s local midnight nothing of the week is stamped'
);

-- A 2-hour pause: the next run is Tue 01:00.
select tests.freeze_time('2026-11-17 01:00:00+00');
select private.tick();
select is(
  (select s.miss_recorded_at::text || '|' || private.session_status(s) from pg_temp.sess('gym', '2026-11-16', 1) s),
  '2026-11-17 01:00:00+00|missed',
  'catch-up: the next run after the pause stamps Monday''s Gym'
);
select is(
  (select count(*)::integer from pg_temp.misses('gym')) + (select count(*)::integer from pg_temp.misses('meditate')),
  2, 'one miss event each for Monday''s Gym and Meditate'
);
select is((select h.last_run_at from public.heartbeat h), '2026-11-17 01:00:00+00'::timestamptz,
  'the tick run with step 4 still writes the heartbeat');
select is(
  (select coalesce(s.miss_recorded_at::text, 'null') from pg_temp.sess('draw', '2026-11-16', 1) s)
  || '|' || (select count(*)::text from pg_temp.misses('draw')),
  'null|0',
  'an ended membership: erin''s Monday Draw is never stamped and has no event'
);
select is(
  (select s.miss_recorded_at::text from pg_temp.sess('clean', '2026-11-16', 1) s),
  '2026-11-17 01:00:00+00',
  'a waiting group (one member) is stamped as usual'
);
select tests.authenticate_as('dave');
select is(
  (select f.item_kind || '|' || f.miss_count::text || '|' || f.activity_name || '|' || f.actor_name
   from public.feed_items f where f.group_id = current_setting('test.g2')::uuid),
  'miss|1|Clean|Dave',
  'the waiting group''s member sees their own miss in the Feed'
);
reset role;

select tests.freeze_time('2026-11-17 01:01:00+00');
select private.tick();
select is(
  (select count(*)::integer from public.feed_events e where e.kind = 'miss'
     and e.group_id in (current_setting('test.g1')::uuid, current_setting('test.g2')::uuid))::text
  || '|' || (select s.miss_recorded_at::text from pg_temp.sess('gym', '2026-11-16', 1) s),
  '4|2026-11-17 01:00:00+00',
  'idempotent: a second run writes no new event and keeps the first stamp'
);

-- ===== A late arrival on the missed Monday =====
select tests.freeze_time('2026-11-17 01:30:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.counted::text || '|' || r.is_late::text || '|' || s.slot::text
   from public.post_checkin(current_setting('test.a1')::uuid, current_setting('test.gym')::uuid,
     '2026-11-16 09:00:00+00', null) r
   join public.sessions s on s.id = r.session_id),
  'true|true|1',
  'post_checkin matches the missed (and stamped) Monday session'
);
reset role;
select is(
  (select private.session_status(s) from pg_temp.sess('gym', '2026-11-16', 1) s),
  'done', 'session_status: the late arrival makes Monday''s Gym done'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'miss'
     and f.commitment_id = current_setting('test.gym')::uuid),
  0,
  'feed_items hides the Gym miss once its session is done'
);
select is(
  (select f.is_late::text || '|' || f.item_kind from public.feed_items f where f.item_id = current_setting('test.a1')::uuid),
  'true|checkin',
  'the late polaroid shows in the Feed'
);
select is(
  (select f.miss_count::text || '|' || f.activity_name || '|' || f.preset_key || '|' || f.commitment_kind
          || '|' || f.actor_name || '|' || coalesce(f.task_name, 'null')
          || '|' || (f.actor_id = tests.get_supabase_uid('alice'))::text
   from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'miss'
     and f.commitment_id = current_setting('test.meditate')::uuid),
  '1|Meditate|meditate|commitment|Alice|null|true',
  'Monday''s Meditate miss stays, with its activity and a count of 1'
);
select is(
  (select count(*)::integer from public.feed_events e where e.kind = 'miss'
     and e.payload ->> 'commitment_id' = current_setting('test.gym')),
  1,
  'the hidden event is not deleted'
);
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'miss'
     and f.commitment_id = current_setting('test.paint')::uuid),
  0,
  'a left member''s misses leave the Feed (their sessions are out of sight)'
);

-- ===== Wed 10:00: bob counts one Walk =====
select tests.freeze_time('2026-11-18 10:00:00+00');
select tests.authenticate_as('bob');
select is(
  (select r.counted from public.post_checkin(current_setting('test.b1')::uuid, current_setting('test.walk')::uuid,
     '2026-11-18 09:59:00+00', null) r),
  true, 'bob''s Wednesday Walk counts'
);
reset role;
select is(
  (select private.session_status(s) from pg_temp.sess('walk', '2026-11-16', 1) s)
  || '|' || (select private.session_status(s) from pg_temp.sess('walk', '2026-11-16', 2) s),
  'done|open',
  'session_status: a counted times-per-week row is done, the others open while the week runs'
);

-- ===== The task: missed at the end of its deadline day =====
select tests.freeze_time('2026-11-18 23:59:00+00');
select private.tick_step_4_misses();
select is(
  (select coalesce(s.miss_recorded_at::text, 'null') from pg_temp.sess('task', '2026-11-16', 0) s),
  'null', 'a task is not stamped during its deadline day'
);
select tests.freeze_time('2026-11-19 00:00:00+00');
select is(private.tick_step_4_misses(), null, 'step 4 runs clean at Thursday 00:00');
select is(
  (select s.miss_recorded_at::text from pg_temp.sess('task', '2026-11-16', 0) s),
  '2026-11-19 00:00:00+00',
  'the task is stamped at the end of its deadline day'
);
select is(
  (select (e.payload ->> 'commitment_kind') || '|' || (e.payload ->> 'task_name') || '|'
          || coalesce(e.payload ->> 'schedule_type', 'null') || '|' || (e.payload ->> 'missed_on')
          || '|' || (e.payload ->> 'count') || '|' || (e.payload ->> 'activity_name')
   from pg_temp.misses('task') e),
  'task|Tax forms|null|2026-11-18|1|Groceries',
  'the task''s miss event carries the task name and the deadline day'
);
select tests.authenticate_as('carol');
select is(
  (select f.task_name || '|' || f.commitment_kind || '|' || f.miss_count::text || '|' || f.activity_name
   from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'miss'
     and f.commitment_id = current_setting('test.task')::uuid),
  'Tax forms|task|1|Groceries',
  'feed_items: the task miss row'
);
reset role;
select is(
  (select coalesce(s.miss_recorded_at::text, 'null') from pg_temp.sess('yoga', '2026-11-16', 2) s)
  || '|' || (select count(*)::text from pg_temp.misses('yoga')),
  'null|0',
  'no stamp after the commitment ended (ends_after_week_start before the week)'
);

-- ===== End of the week: times per week =====
select tests.freeze_time('2026-11-22 23:59:00+00');
select private.tick_step_4_misses();
select is(
  (select count(*)::integer from public.sessions s
   where s.commitment_id = current_setting('test.walk')::uuid and s.miss_recorded_at is not null),
  0, 'times per week: nothing is stamped before the end of the member''s week'
);
select tests.freeze_time('2026-11-23 00:00:00+00');
select private.tick_step_4_misses();
select is(
  (select pg_catalog.string_agg(s.slot::text || ':' || coalesce(s.miss_recorded_at::text, 'null'), ',' order by s.slot)
   from public.sessions s where s.commitment_id = current_setting('test.walk')::uuid),
  '1:null,2:2026-11-23 00:00:00+00,3:2026-11-23 00:00:00+00',
  'times per week (target 3, 1 counted): the 2 unmatched rows are stamped at the week''s end'
);
select is(
  (select count(*)::text || '|' || max(e.payload ->> 'count') || '|' || max(e.payload ->> 'missed_on')
          || '|' || max(e.payload ->> 'schedule_type')
          || '|' || bool_and(e.payload -> 'session_ids' = pg_catalog.jsonb_build_array(
               (select s.id from pg_temp.sess('walk', '2026-11-16', 2) s),
               (select s.id from pg_temp.sess('walk', '2026-11-16', 3) s)))::text
   from pg_temp.misses('walk') e),
  '1|2|2026-11-22|times_per_week|true',
  'one event for the week, count 2, with both session ids'
);
select tests.authenticate_as('carol');
select is(
  (select f.miss_count from public.feed_items f
   where f.item_kind = 'miss' and f.commitment_id = current_setting('test.walk')::uuid),
  2, 'feed_items: the times-per-week miss counts 2'
);
reset role;
select is(
  (select coalesce(s.miss_recorded_at::text, 'null') from pg_temp.sess('run', '2026-11-16', 4) s)
  || '|' || (select count(*)::text from pg_temp.misses('run')),
  'null|0',
  'no stamp for a session after the version''s end date'
);
select is(
  (select count(*)::integer from public.feed_events e
   where e.kind = 'miss' and e.actor_id = tests.get_supabase_uid('alice')),
  10,
  'alice: Gym Mon Wed Fri and Meditate every day are 10 miss events'
);
select is(
  (select count(*)::integer from (
     select e.payload ->> 'tease' as tease,
            pg_catalog.lag(e.payload ->> 'tease') over (
              order by e.created_at, (e.payload ->> 'ends_at')::timestamptz, e.payload ->> 'commitment_id') as prev
     from public.feed_events e
     where e.kind = 'miss' and e.actor_id = tests.get_supabase_uid('alice')
       and e.group_id = current_setting('test.g1')::uuid) t
   where t.tease = t.prev),
  0,
  'the tease never repeats the member''s previous miss tease in the group'
);
select is(
  (select count(*)::integer from public.feed_events e
   where e.kind = 'miss' and e.group_id = current_setting('test.g1')::uuid
     and e.payload ->> 'tease' not in ('couch_wins', 'couch_regards', 'couch_comfortable', 'couch_thanks', 'couch_loses')),
  0, 'every tease is one of the five keys'
);

-- ===== A late times-per-week arrival lowers the count =====
select tests.freeze_time('2026-11-23 00:30:00+00');
select tests.authenticate_as('bob');
select is(
  (select r.counted::text || '|' || s.slot::text
   from public.post_checkin(current_setting('test.b2')::uuid, current_setting('test.walk')::uuid,
     '2026-11-22 10:00:00+00', null) r
   join public.sessions s on s.id = r.session_id),
  'true|2',
  'a late Sunday Walk completes the first missed row'
);
select tests.authenticate_as('carol');
select is(
  (select f.miss_count from public.feed_items f
   where f.item_kind = 'miss' and f.commitment_id = current_setting('test.walk')::uuid),
  1, 'feed_items: the times-per-week miss now counts 1'
);

-- ===== get_friends_today =====
select tests.freeze_time('2026-11-23 09:00:00+00');
select tests.authenticate_as('alice');
select * from public.post_checkin(current_setting('test.a2')::uuid, current_setting('test.meditate')::uuid,
  '2026-11-23 08:59:00+00', null);
select tests.freeze_time('2026-11-23 10:00:00+00');
select tests.authenticate_as('carol');
select is(
  (select pg_catalog.string_agg(f.item_id::text, ',' order by o)
   from public.get_friends_today(current_setting('test.g1')::uuid) with ordinality as f(
     group_id, item_kind, item_id, sort_at, actor_id, actor_name, actor_avatar_path, subject_id,
     subject_name, commitment_id, commitment_kind, activity_name, preset_key, task_name, captured_at,
     received_at, is_late, is_extra, caption, full_pruned_at, counted_position, target, payload,
     miss_count, o)),
  current_setting('test.a2') || ',' || current_setting('test.b2'),
  'get_friends_today: check-ins received since the caller''s local midnight, newest first'
);
select is(
  (select count(*)::integer from public.get_friends_today(current_setting('test.g1')::uuid) f
   where f.item_kind <> 'checkin'),
  0, 'get_friends_today returns check-ins only'
);
select tests.authenticate_as('dave');
select is(
  (select count(*)::integer from public.get_friends_today(current_setting('test.g1')::uuid)),
  0, 'get_friends_today: a non-member gets nothing'
);
select tests.clear_authentication();
select throws_ok(
  format('select * from public.get_friends_today(%L)', current_setting('test.g1')),
  '42501', null, 'anon cannot call get_friends_today'
);
select tests.authenticate_as('alice');
select throws_ok(
  $$ select private.tick_step_4_misses() $$,
  '42501', null, 'a client cannot run step 4'
);

-- A caller far from UTC (fiona, Asia/Manila = UTC+8): her midnight is 16:00 UTC. A post received
-- one minute before it is yesterday for her; one minute after is today. A UTC-midnight or 24-hour
-- cutoff would include both.
select tests.freeze_time('2026-11-23 15:59:00+00');
select tests.authenticate_as('alice');
select * from public.post_checkin(current_setting('test.a3')::uuid, current_setting('test.meditate')::uuid,
  '2026-11-23 15:58:00+00', null);
select tests.freeze_time('2026-11-23 16:01:00+00');
select * from public.post_checkin(current_setting('test.a4')::uuid, current_setting('test.meditate')::uuid,
  '2026-11-23 16:00:00+00', null);
select tests.freeze_time('2026-11-23 17:00:00+00');
select tests.authenticate_as('fiona');
select is(
  (select pg_catalog.string_agg(f.item_id::text, ',' order by f.sort_at desc)
   from public.get_friends_today(current_setting('test.g1')::uuid) f),
  current_setting('test.a4'),
  'get_friends_today: the cutoff is the caller''s own local midnight (Manila), not UTC''s'
);

-- ===== A failing step 4 is recorded and counts before the lock =====
reset role;
create or replace function private.tick_step_4_misses()
returns text
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'step four broke';
end;
$$;
select tests.freeze_time('2026-11-23 11:00:00+00');
select lives_ok($$ select private.tick() $$, 'a failing step 4 does not fail the tick');
select ok(
  (select h.last_run_at = '2026-11-23 11:00:00+00'::timestamptz
          and h.last_error_step = 4
          and h.last_error = 'step four broke'
          and h.last_error_at = '2026-11-23 11:00:00+00'::timestamptz
   from public.heartbeat h),
  'the heartbeat records step 4 and step 8 still runs'
);

select * from finish();
rollback;
