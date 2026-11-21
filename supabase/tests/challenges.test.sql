-- Challenges (Story 5.1): create_challenge (every refusal, the 24 h edge, the closes_at cap at the
-- week's lock, a DST week, the double challenge, the waiting group), private.close_vote (2-person
-- immediate Fake, lone challenger at the timeout, idempotent on a closed row, the miss stamp of an
-- ended session with no miss event), tick step 3 (catch-up after a pause, closing before the lock
-- step in one run), private.checkin_removed folded into session_status / counted_checkins (score and
-- streak recomputed, the session free for a new post), the Storage SELECT policy, feed_items (hidden
-- check-in, challenge columns, ruling rows), RLS and grants per role (AD-16).
--
-- Cast: alice creates "Crew" (Europe/London); bob and carol join it, gina joins and later leaves.
-- dave creates "Duo" (UTC) with erin. fiona is alone in "Solo" (UTC). harry is in no group. Every
-- membership is back-dated to 1 Oct so members count as present at every opened_at and lock_at.
-- Week Mon 16 to Sun 22 Nov 2026 (London = UTC in November; locks Thu 26 Nov 00:00): bob has Gym
-- Mon Wed Fri, carol Walk Mon Tue, gina Paint Mon, erin Run Mon, fiona Clean Mon. Check-ins are
-- written directly as the table owner (one is posted through post_checkin). The routines under test
-- call now() unqualified; their search_path is pointed at test_overrides so tests.freeze_time moves
-- their clock (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(58);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('fiona');
select tests.create_supabase_user('gina');
select tests.create_supabase_user('harry');

-- ===== Shape =====
select has_table('public', 'challenges', 'challenges exists');
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.create_challenge(uuid)'::regprocedure,
                   'private.close_vote(uuid)'::regprocedure,
                   'private.tick_step_3_close_votes()'::regprocedure,
                   'private.checkin_removed(uuid)'::regprocedure,
                   'private.checkin_lock_at(uuid)'::regprocedure)),
  'the new functions have an empty search_path'
);
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.create_challenge(uuid)'::regprocedure)
  and (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'private.checkin_removed(uuid)'::regprocedure),
  'create_challenge and checkin_removed are security definer'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'for update') > 0 from pg_catalog.pg_proc p
   where p.oid = 'public.create_challenge(uuid)'::regprocedure),
  'create_challenge locks the check-in row for update'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'private.tick_step_2_time_zones()')
            < pg_catalog.strpos(p.prosrc, 'private.tick_step_3_close_votes()')
          and pg_catalog.strpos(p.prosrc, 'private.tick_step_3_close_votes()')
            < pg_catalog.strpos(p.prosrc, 'private.tick_step_4_misses()')
          and pg_catalog.strpos(p.prosrc, 'private.tick_step_4_misses()')
            < pg_catalog.strpos(p.prosrc, 'private.lock_due_weeks()')
   from pg_catalog.pg_proc p where p.oid = 'private.tick()'::regprocedure),
  'tick: step 3 runs after step 2 and before steps 4 and 5'
);
select is(
  (select pg_catalog.array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a
   where a.attrelid = 'public.feed_items'::regclass and a.attnum > 24 and not a.attisdropped),
  array['challenge_id', 'challenge_status', 'challenge_closes_at', 'challenge_until']::text[],
  'feed_items appends the four challenge columns'
);
select ok(
  not exists (select 1 from pg_catalog.pg_indexes i
              where i.schemaname = 'public' and i.indexname = 'checkins_one_per_session')
  and exists (select 1 from pg_catalog.pg_indexes i
              where i.schemaname = 'public' and i.indexname = 'checkins_session_id_idx'),
  'the session index is no longer unique'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.create_challenge(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_challenge(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.create_challenge(uuid)', 'EXECUTE'),
  'create_challenge: authenticated only'
);
select ok(
  not has_function_privilege('authenticated', 'private.close_vote(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.close_vote(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'private.close_vote(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.tick_step_3_close_votes()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.tick_step_3_close_votes()', 'EXECUTE'),
  'close_vote and step 3 are not executable by client roles'
);
select ok(
  has_table_privilege('authenticated', 'public.challenges', 'SELECT')
  and not has_table_privilege('authenticated', 'public.challenges', 'INSERT')
  and not has_table_privilege('authenticated', 'public.challenges', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.challenges', 'DELETE')
  and not has_table_privilege('anon', 'public.challenges', 'SELECT'),
  'challenges: authenticated may only read; anon nothing'
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
select public.save_profile('Erin', 'UTC');
select tests.authenticate_as('fiona');
select public.save_profile('Fiona', 'UTC');
select tests.authenticate_as('gina');
select public.save_profile('Gina', 'Europe/London');
select tests.authenticate_as('harry');
select public.save_profile('Harry', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('gina');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select pg_catalog.set_config('test.g2', public.create_group('Duo')::text, true);
select pg_catalog.set_config('test.code2', (select code from public.create_invite(current_setting('test.g2')::uuid, false)), true);
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code2'));
select tests.authenticate_as('fiona');
select pg_catalog.set_config('test.g3', public.create_group('Solo')::text, true);

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.create_challenge(uuid) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_3_close_votes() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_4_misses() set search_path = test_overrides, pg_catalog;
alter function private.tick() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_8_heartbeat(smallint, text, timestamptz) set search_path = test_overrides, pg_catalog;
alter function private.lock_week(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.lock_due_weeks() set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function public.post_checkin(uuid, uuid, timestamptz, text) set search_path = test_overrides, pg_catalog;
alter function private.checkin_challenge_until(uuid, timestamptz) set search_path = test_overrides, pg_catalog;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

-- A fixed-days commitment with one version, written directly. p_group is a setting name.
create function pg_temp.add_plan(p_user text, p_group text, p_preset text, p_days smallint[], p_first date)
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
  values (v_group, v_membership, v_uid, 'commitment', v_activity, 'fixed_days')
  returning id into v_id;
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values (v_id, v_group, p_first, p_days, null);
  return v_id;
end;
$$;

-- The session of a commitment (setting name) in the November week, by slot.
create function pg_temp.sess(p_commitment text, p_slot integer)
returns public.sessions
language sql
as $$
  select s.* from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = '2026-11-16' and s.slot = p_slot;
$$;

-- A check-in (setting name p_id) written directly. Session by slot (null = extra).
create function pg_temp.checkin(
  p_id text, p_commitment text, p_slot integer, p_counted timestamptz, p_received timestamptz
)
returns void
language sql
as $$
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select current_setting('test.' || p_id)::uuid, c.group_id, c.user_id, c.id,
         (select s.id from public.sessions s
          where s.commitment_id = c.id and s.week_start = '2026-11-16' and s.slot = p_slot),
         p_counted, p_received, p_counted, p_received - p_counted > interval '10 minutes'
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid;
$$;

-- The challenge of a check-in (setting name).
create function pg_temp.ch(p_id text)
returns public.challenges
language sql
as $$
  select ch.* from public.challenges ch where ch.checkin_id = current_setting('test.' || p_id)::uuid;
$$;

-- The ruling events of a check-in (setting name).
create function pg_temp.rulings(p_id text)
returns setof public.feed_events
language sql
as $$
  select e.* from public.feed_events e
  where e.kind = 'ruling' and e.payload ->> 'checkin_id' = current_setting('test.' || p_id);
$$;

select pg_catalog.set_config('test.b1', '00000000-0000-4000-a000-0000000051b1', true);
select pg_catalog.set_config('test.b2', '00000000-0000-4000-a000-0000000051b2', true);
select pg_catalog.set_config('test.b3', '00000000-0000-4000-a000-0000000051b3', true);
select pg_catalog.set_config('test.c1', '00000000-0000-4000-a000-0000000051c1', true);
select pg_catalog.set_config('test.c2', '00000000-0000-4000-a000-0000000051c2', true);
select pg_catalog.set_config('test.c3', '00000000-0000-4000-a000-0000000051c3', true);
select pg_catalog.set_config('test.e1', '00000000-0000-4000-a000-0000000051e1', true);
select pg_catalog.set_config('test.e2', '00000000-0000-4000-a000-0000000051e2', true);
select pg_catalog.set_config('test.f1', '00000000-0000-4000-a000-0000000051f1', true);
select pg_catalog.set_config('test.g1c', '00000000-0000-4000-a000-0000000051a1', true);

select pg_catalog.set_config('test.gym', pg_temp.add_plan('bob', 'g1', 'gym', array[1, 3, 5]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('carol', 'g1', 'walk', array[1, 2]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.paint', pg_temp.add_plan('gina', 'g1', 'paint', array[1]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.run', pg_temp.add_plan('erin', 'g2', 'run', array[1]::smallint[], '2026-11-16')::text, true);
select pg_catalog.set_config('test.clean', pg_temp.add_plan('fiona', 'g3', 'clean', array[1]::smallint[], '2026-11-16')::text, true);

select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

-- Mon 08:00 posts; carol's Tuesday Walk on Tue 08:00; bob's Friday Gym sent late on Wed 25 Nov
-- 10:00 (taken Fri 23:00, so it completes Friday); bob's extra from Sun 25 Oct 23:30 (London is
-- on GMT again) sent late on Wed 28 Oct 06:00; carol's extra from Sun 15 Nov 23:00 sent on Wed 18
-- Nov 23:30 (week of 9 Nov, which locks Thu 19 Nov 00:00).
select pg_temp.checkin('b1', 'gym', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');
select pg_temp.checkin('b2', 'gym', 5, '2026-11-20 23:00:00+00', '2026-11-25 10:00:00+00');
select pg_temp.checkin('b3', 'gym', null, '2026-10-25 23:30:00+00', '2026-10-28 06:00:00+00');
select pg_temp.checkin('c1', 'walk', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');
select pg_temp.checkin('c2', 'walk', 2, '2026-11-17 08:00:00+00', '2026-11-17 08:00:00+00');
select pg_temp.checkin('c3', 'walk', null, '2026-11-15 23:00:00+00', '2026-11-18 23:30:00+00');
select pg_temp.checkin('g1c', 'paint', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');
select pg_temp.checkin('e1', 'run', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');
select pg_temp.checkin('f1', 'clean', 1, '2026-11-16 08:00:00+00', '2026-11-16 08:00:00+00');

set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.g2') || '/' || current_setting('test.e2') || '/' || s.size || '.webp',
       tests.get_supabase_uid('erin')::text
from (values ('1080'), ('360')) s(size);
reset role;

-- ===== Refusals =====
select tests.freeze_time('2026-11-16 10:00:00+00');
select tests.authenticate_as('gina');
select public.leave_group(current_setting('test.g1')::uuid);

select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.b1')),
  'P0001', 'own_checkin', 'own check-in: own_checkin'
);
select tests.authenticate_as('harry');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.b1')),
  'P0001', 'not_member', 'a non-member: not_member'
);
select tests.authenticate_as('alice');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.g1c')),
  'P0001', 'not_member', 'an owner who left: not_member'
);
select throws_ok(
  'select * from public.create_challenge(''00000000-0000-4000-a000-000000000000'')',
  'P0001', 'not_member', 'an unknown check-in: not_member'
);
select tests.authenticate_as('fiona');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.f1')),
  'P0001', 'group_waiting', 'a waiting group (one member): group_waiting'
);
select tests.authenticate_as('alice');
select is(
  (select count(*)::integer from public.challenges),
  0, 'no refused call wrote a row'
);

-- ===== 2-person group: ruled Fake at once =====
reset role;
select ok(
  exists (
    select 1 from private.badge_criteria_met(
      (select m.id from public.memberships m
       where m.group_id = current_setting('test.g2')::uuid and m.user_id = tests.get_supabase_uid('erin')),
      '2026-11-16') k
    where k = 'first_proof'),
  'badges (control): before the challenge erin''s check-in earns First Proof'
);
select tests.authenticate_as('dave');
select is(
  (select r.status || '|' || (r.closes_at = '2026-11-17 10:00:00+00')::text
   from public.create_challenge(current_setting('test.e1')::uuid) r),
  'fake|true',
  '2 members: create_challenge returns the Fake ruling (closes_at still the 24 h cap)'
);
reset role;
select is(
  (select ch.status || '|' || ch.fake_count || '|' || ch.real_count || '|' || ch.closed_at::text
          || '|' || ch.opened_at::text || '|' || (ch.challenger_id = tests.get_supabase_uid('dave'))::text
          || '|' || (ch.subject_user_id = tests.get_supabase_uid('erin'))::text
   from pg_temp.ch('e1') ch),
  'fake|1|0|2026-11-16 10:00:00+00|2026-11-16 10:00:00+00|true|true',
  'the challenge row is closed Fake, 1 to 0, at the same moment it opened'
);
select is(
  (select count(*)::text || '|' || max(e.payload ->> 'variant') || '|' || max(e.payload ->> 'outcome')
          || '|' || max(e.payload ->> 'fake_count') || '|' || max(e.payload ->> 'real_count')
          || '|' || max(e.payload ->> 'actor_name') || '|' || max(e.payload ->> 'subject_name')
          || '|' || max(e.payload ->> 'activity_name') || '|' || max(e.payload ->> 'commitment_kind')
          || '|' || bool_and(e.actor_id = tests.get_supabase_uid('dave'))::text
          || '|' || bool_and(e.subject_id = tests.get_supabase_uid('erin'))::text
   from pg_temp.rulings('e1') e),
  '1|two_person|fake|1|0|Dave|Erin|Run|commitment|true|true',
  'one ruling event: two_person variant, counts, names and activity'
);
select ok(
  private.checkin_removed(current_setting('test.e1')::uuid)
  and not private.checkin_removed(current_setting('test.b1')::uuid),
  'checkin_removed: true for the Fake-ruled check-in only'
);
select ok(
  not exists (
    select 1 from private.badge_criteria_met(
      (select m.id from public.memberships m
       where m.group_id = current_setting('test.g2')::uuid and m.user_id = tests.get_supabase_uid('erin')),
      '2026-11-16') k
    where k = 'first_proof'),
  'badges: a Fake-ruled check-in does not earn First Proof'
);
select is(
  (select private.session_status(s) || '|' || coalesce(s.miss_recorded_at::text, 'null')
   from public.sessions s
   where s.commitment_id = current_setting('test.run')::uuid and s.week_start = '2026-11-16'),
  'open|null',
  'the removed check-in''s session has not ended: it reads open again, no miss stamped'
);
select tests.authenticate_as('dave');
select is(
  (select count(*) filter (where f.item_kind = 'checkin')::text
          || '|' || count(*) filter (where f.item_kind = 'ruling')::text
   from public.feed_items f where f.group_id = current_setting('test.g2')::uuid),
  '0|1',
  'Feed: the Fake-ruled check-in is gone; the ruling sticky is there'
);
select is(
  (select f.activity_name || '|' || f.commitment_kind || '|' || f.actor_name || '|' || f.subject_name
   from public.feed_items f where f.group_id = current_setting('test.g2')::uuid and f.item_kind = 'ruling'),
  'Run|commitment|Dave|Erin',
  'the ruling row carries the activity and both names'
);
select ok(
  not private.can_read_checkin_photo(
    current_setting('test.g2') || '/' || current_setting('test.e1') || '/1080.webp',
    tests.get_supabase_uid('erin')::text),
  'Storage: another member can no longer read the removed photo'
);
select tests.authenticate_as('erin');
select ok(
  not private.can_read_checkin_photo(
    current_setting('test.g2') || '/' || current_setting('test.e1') || '/360.webp',
    tests.get_supabase_uid('erin')::text),
  'Storage: the owner cannot read it either while the ruling stands'
);

-- The owner checks in again on the freed session.
reset role;
select tests.freeze_time('2026-11-16 11:00:00+00');
select tests.authenticate_as('erin');
select is(
  (select (r.session_id = (select s.id from public.sessions s
                           where s.commitment_id = current_setting('test.run')::uuid
                             and s.week_start = '2026-11-16'))::text
          || '|' || r.counted::text || '|' || r.done_count || '/' || r.target
   from public.post_checkin(current_setting('test.e2')::uuid, current_setting('test.run')::uuid,
                            '2026-11-16 11:00:00+00') r),
  'true|true|1/1',
  'a new post completes the session freed by the Fake ruling (counts once)'
);
select ok(
  private.can_read_checkin_photo(
    current_setting('test.g2') || '/' || current_setting('test.e2') || '/1080.webp',
    tests.get_supabase_uid('erin')::text),
  'Storage: the new check-in''s photo is readable'
);
select tests.authenticate_as('dave');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.e1')),
  'P0001', 'already_challenged', 'a ruled check-in cannot be challenged again'
);

-- ===== 3+ members: the 24 h edge, an open challenge =====
reset role;
select tests.freeze_time('2026-11-17 07:59:59+00');
select tests.authenticate_as('alice');
select is(
  (select r.status || '|' || r.closes_at::text
   from public.create_challenge(current_setting('test.c1')::uuid) r),
  'open|2026-11-18 07:59:59+00',
  'one second before 24 h: the challenge opens, closing 24 h later'
);
select is(
  (select coalesce(ch.fake_count::text, 'null') || '|' || coalesce(ch.real_count::text, 'null')
          || '|' || coalesce(ch.closed_at::text, 'null')
   from public.challenges ch where ch.checkin_id = current_setting('test.c1')::uuid),
  'null|null|null',
  'counts stay null while open'
);
reset role;
select is(
  (select count(*)::integer from pg_temp.rulings('c1')),
  0, 'no ruling while open'
);
select tests.authenticate_as('bob');
select is(
  (select f.challenge_status || '|' || f.challenge_closes_at::text || '|' || f.challenge_until::text
   from public.feed_items f where f.item_id = current_setting('test.c1')::uuid),
  'open|2026-11-18 07:59:59+00|2026-11-17 08:00:00+00',
  'Feed: the check-in shows its open challenge, closes_at and challenge_until'
);
select is(
  (select coalesce(f.challenge_status, 'null') || '|' || f.challenge_until::text
   from public.feed_items f where f.item_id = current_setting('test.b1')::uuid),
  'null|2026-11-17 08:00:00+00',
  'Feed: an unchallenged check-in has no status and its challenge_until'
);
reset role;
select is(
  (select private.session_status(s) from pg_temp.sess('walk', 1) s)
  || '|' || private.weekly_points(
       (select m.id from public.memberships m
        where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('carol')),
       '2026-11-16')::text
  || '|' || private.current_streak(current_setting('test.walk')::uuid)::text,
  'done|100|2',
  'while open the check-in counts provisionally: session done, 100 points, streak 2'
);
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.c1')),
  'P0001', 'already_challenged', 'a second challenge on the same check-in: already_challenged'
);
select tests.authenticate_as('harry');
select is(
  (select count(*)::integer from public.challenges),
  0, 'RLS: a non-member reads no challenges'
);
select tests.authenticate_as('carol');
select is(
  (select count(*)::integer from public.challenges ch where ch.group_id = current_setting('test.g1')::uuid),
  1, 'RLS: a current member reads the group''s challenge'
);

reset role;
select tests.freeze_time('2026-11-17 08:00:00+00');
select tests.authenticate_as('carol');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.b1')),
  'P0001', 'challenge_expired', 'at exactly 24 h: challenge_expired'
);

-- ===== Lone challenger at the timeout, after a paused tick =====
-- closes_at Wed 07:59:59; the next tick runs an hour late. bob (the only other voter at opened_at)
-- is marked as left meanwhile: the ruling still reads lone, not 2-person (restored afterwards).
reset role;
update public.memberships set ended_at = '2026-11-17 12:00:00+00', end_reason = 'left'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('bob');
select tests.freeze_time('2026-11-18 09:00:00+00');
select private.tick();
select is(
  (select ch.status || '|' || ch.fake_count || '|' || ch.real_count || '|' || ch.closed_at::text
   from pg_temp.ch('c1') ch),
  'fake|1|0|2026-11-18 09:00:00+00',
  'catch-up: the paused tick still closes the due challenge, ruled Fake 1 to 0'
);
select is(
  (select count(*)::text || '|' || max(e.payload ->> 'variant') || '|' || max(e.payload ->> 'outcome')
   from pg_temp.rulings('c1') e),
  '1|lone|fake',
  'nobody else voted: one ruling event with the lone variant (a voter leaving later keeps it lone)'
);
update public.memberships set ended_at = null, end_reason = null
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('bob');
select is(
  (select private.session_status(s) || '|' || s.miss_recorded_at::text from pg_temp.sess('walk', 1) s),
  'missed|2026-11-18 09:00:00+00',
  'Fake on an ended day session: it reads missed and the miss is stamped at the ruling'
);
select is(
  (select count(*)::integer from public.feed_events e
   where e.kind = 'miss' and e.payload ->> 'commitment_id' = current_setting('test.walk')),
  0, 'no miss event for it (step 4 ran after step 3 and found it stamped)'
);
select is(
  private.weekly_points(
    (select m.id from public.memberships m
     where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('carol')),
    '2026-11-16')::text
  || '|' || private.current_streak(current_setting('test.walk')::uuid)::text
  || '|' || (select count(*) from private.counted_checkins(
       (select m.id from public.memberships m
        where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('carol')),
       '2026-11-16'))::text,
  '50|1|1',
  'score and streak recomputed: 50 points, streak 1, one counted check-in'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.feed_items f where f.item_id = current_setting('test.c1')::uuid),
  0, 'the removed check-in is gone from another member''s Feed'
);
reset role;

-- close_vote on a closed row changes nothing.
select private.close_vote((select ch.id from pg_temp.ch('c1') ch));
select is(
  (select ch.closed_at::text || '|' || ch.status from pg_temp.ch('c1') ch)
  || '|' || (select count(*)::text from pg_temp.rulings('c1')),
  '2026-11-18 09:00:00+00|fake|1',
  'close_vote is idempotent on a closed challenge'
);

-- ===== A check-in in a locked week =====
select tests.freeze_time('2026-11-19 00:00:00+00');
select tests.authenticate_as('alice');
select throws_ok(
  format('select * from public.create_challenge(%L)', current_setting('test.c3')),
  'P0001', 'week_locked', 'a check-in of a week whose lock has passed: week_locked'
);

-- ===== Challenged Wednesday evening: closes at the lock; closed before the lock step =====
reset role;
select tests.freeze_time('2026-11-25 20:00:00+00');
select tests.authenticate_as('carol');
select is(
  (select r.status || '|' || r.closes_at::text
   from public.create_challenge(current_setting('test.b2')::uuid) r),
  'open|2026-11-26 00:00:00+00',
  'Wednesday evening: closes_at is capped at the week''s lock'
);
select is(
  (select f.challenge_until::text from public.feed_items f where f.item_id = current_setting('test.b2')::uuid),
  '2026-11-26 00:00:00+00',
  'Feed: challenge_until is capped at the lock too, not received_at + 24 h'
);
reset role;
select is(
  (select gw.lock_at::text from public.group_weeks gw
   where gw.group_id = current_setting('test.g1')::uuid and gw.week_start = '2026-11-16'),
  '2026-11-26 00:00:00+00',
  'that is the group week''s lock_at'
);
select tests.freeze_time('2026-11-26 00:00:00+00');
select private.tick();
select is(
  (select ch.status || '|' || ch.closed_at::text from pg_temp.ch('b2') ch)
  || '|' || (select coalesce(gw.locked_at::text, 'null') from public.group_weeks gw
             where gw.group_id = current_setting('test.g1')::uuid and gw.week_start = '2026-11-16'),
  'fake|2026-11-26 00:00:00+00|2026-11-26 00:00:00+00',
  'one tick at the lock: step 3 closes the challenge, then step 5 locks the week'
);
select is(
  (select wr.weekly_points from public.week_results wr
   where wr.group_id = current_setting('test.g1')::uuid and wr.week_start = '2026-11-16'
     and wr.user_id = tests.get_supabase_uid('bob')),
  33,
  'the frozen result already leaves the removed Friday out (1 of 3 Gym sessions: 33)'
);
select is(
  (select wr.weekly_points from public.week_results wr
   where wr.group_id = current_setting('test.g1')::uuid and wr.week_start = '2026-11-16'
     and wr.user_id = tests.get_supabase_uid('carol')),
  50,
  'carol''s frozen result is 50 (Monday removed)'
);

-- ===== DST week: the lock in group time =====
-- bob's extra was taken Sun 25 Oct 23:30 (London went back to GMT that morning); the week of 19 Oct
-- locks Thu 29 Oct 00:00 London = 00:00 UTC (not 23:00 UTC as under BST).
select tests.freeze_time('2026-10-28 12:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select r.status || '|' || r.closes_at::text
   from public.create_challenge(current_setting('test.b3')::uuid) r),
  'open|2026-10-29 00:00:00+00',
  'DST week: closes_at is capped at Thursday 00:00 London time'
);
reset role;
select is(
  private.checkin_lock_at(current_setting('test.b3')::uuid)::text,
  '2026-10-29 00:00:00+00',
  'checkin_lock_at: the week of the check-in''s counted_at in the owner''s zone'
);

-- ===== A failing step 3 is recorded and blocks the lock =====
create or replace function private.tick_step_3_close_votes()
returns text
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'step three broke';
end;
$$;
select tests.freeze_time('2026-12-03 00:00:00+00');
select lives_ok($$ select private.tick() $$, 'a failing step 3 does not fail the tick');
select ok(
  (select h.last_error_step = 3 and h.last_error = 'step three broke' from public.heartbeat h)
  and (select gw.locked_at is null and gw.lock_at <= '2026-12-03 00:00:00+00' from public.group_weeks gw
       where gw.group_id = current_setting('test.g1')::uuid and gw.week_start = '2026-11-23'),
  'the heartbeat records step 3 and the due week does not lock'
);

select * from finish();
rollback;
