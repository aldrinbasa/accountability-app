-- Freeze requests (Story 5.4): request_freeze (same-day request, a pending duplicate, someone
-- else's session, a blank and an 81-character reason, the wrong target for the schedule type, a
-- done session, a frozen session, a Fake-ruling miss, an ended session with no miss recorded, one
-- second before and at the next member-local midnight after a miss, the DST week window, one
-- second before and at the lock, times per week: this week's row choice, the target already met,
-- last week's window edges, a week outside both), the solo request approved at once (miss removed,
-- `freeze_result`), tick step 3 approving an unvoted group request at closes_at, post_checkin
-- (withdrawing a pending day freeze, preferring a times-per-week row with no pending freeze and
-- withdrawing it when only that row is left, a frozen day session refused), my_freeze_options and
-- my_freeze_requests rows, RLS and the grants per role (AD-16).
--
-- Cast: alice creates "Crew" (Europe/London, admin) with bob and carol. sam creates "Solo" (UTC)
-- alone. harry is in no group. Every membership is back-dated to 1 Oct. Week A is Mon 9 to Sun 15
-- Nov 2026 (locks Thu 19 Nov 00:00), week B Mon 16 to Sun 22 Nov (locks Thu 26 Nov 00:00); London =
-- UTC in November. The DST week is Mon 19 to Sun 25 Oct (London falls back on Sun 25 Oct 01:00 UTC;
-- locks Thu 29 Oct 00:00). bob has Study every day from 19 Oct and Gym 3 times a week from week A,
-- carol Walk every day and sam Run every day from week B. Plans, check-ins and miss stamps are
-- written directly as the table owner. The routines under test call now() unqualified; their
-- search_path is pointed at test_overrides so tests.freeze_time moves their clock.
begin;
set local timezone = 'UTC';
select plan(82);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('sam');
select tests.create_supabase_user('harry');

-- ===== Shape =====
select has_table('public', 'freeze_requests', 'freeze_requests exists');
select columns_are('public', 'freeze_requests',
  array['id', 'group_id', 'requester_id', 'commitment_id', 'session_id', 'week_start', 'reason',
        'opened_at', 'closes_at', 'early_close_at', 'closed_at', 'status', 'cancel_reason',
        'created_at', 'updated_at', 'cancelled_by'],
  'freeze_requests has the story''s columns (cancelled_by added by Story 5.6)');
select ok(
  (select pg_catalog.pg_get_indexdef(i.indexrelid) like '%(session_id)%WHERE (status = ''pending''::text)%'
          and i.indisunique
   from pg_catalog.pg_index i
   where i.indexrelid = 'public.freeze_requests_one_pending_per_session'::regclass),
  'a partial unique index allows one pending request per session'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.request_freeze(uuid, text, uuid, date)'::regprocedure,
                   'public.my_freeze_options(uuid)'::regprocedure,
                   'public.my_freeze_requests(uuid)'::regprocedure,
                   'private.session_frozen(uuid)'::regprocedure,
                   'private.session_status(public.sessions)'::regprocedure,
                   'private.close_vote(uuid)'::regprocedure,
                   'private.tick_step_3_close_votes()'::regprocedure,
                   'public.post_checkin(uuid, uuid, timestamptz, text)'::regprocedure)),
  'the new and redefined functions have an empty search_path'
);
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('public.request_freeze(uuid, text, uuid, date)'::regprocedure,
                   'public.my_freeze_options(uuid)'::regprocedure,
                   'public.my_freeze_requests(uuid)'::regprocedure,
                   'private.session_frozen(uuid)'::regprocedure))
  and not (select p.prosecdef from pg_catalog.pg_proc p
           where p.oid = 'private.session_status(public.sessions)'::regprocedure),
  'the RPCs and session_frozen are security definer; session_status stays security invoker'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'for update') > 0 from pg_catalog.pg_proc p
   where p.oid = 'public.request_freeze(uuid, text, uuid, date)'::regprocedure),
  'request_freeze locks the commitment row for update'
);
select ok(
  (select pg_catalog.pg_get_constraintdef(c.oid) like '%freeze_result%'
          and pg_catalog.pg_get_constraintdef(c.oid) like '%overturn%'
          and pg_catalog.pg_get_constraintdef(c.oid) like '%ruling%'
   from pg_catalog.pg_constraint c
   where c.conname = 'feed_events_kind_check' and c.conrelid = 'public.feed_events'::regclass),
  'feed_events accepts freeze_result and keeps the earlier kinds'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'public.request_freeze(uuid, text, uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.request_freeze(uuid, text, uuid, date)', 'EXECUTE')
  and not has_function_privilege('public', 'public.request_freeze(uuid, text, uuid, date)', 'EXECUTE'),
  'request_freeze: authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'public.my_freeze_options(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_freeze_options(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.my_freeze_options(uuid)', 'EXECUTE'),
  'my_freeze_options: authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'public.my_freeze_requests(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.my_freeze_requests(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.my_freeze_requests(uuid)', 'EXECUTE'),
  'my_freeze_requests: authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'private.session_frozen(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.session_frozen(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.freeze_week_counts(uuid, date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.next_local_midnight(timestamptz, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.session_fake_ruling_miss(public.sessions)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.close_vote(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.tick_step_3_close_votes()', 'EXECUTE'),
  'session_frozen serves session_status to authenticated; the other helpers, close_vote and step 3 stay closed'
);
select ok(
  has_table_privilege('authenticated', 'public.freeze_requests', 'SELECT')
  and not has_table_privilege('authenticated', 'public.freeze_requests', 'INSERT')
  and not has_table_privilege('authenticated', 'public.freeze_requests', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.freeze_requests', 'DELETE')
  and not has_table_privilege('anon', 'public.freeze_requests', 'SELECT')
  and not has_table_privilege('anon', 'public.freeze_requests', 'INSERT'),
  'freeze_requests: authenticated may only read; anon nothing'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('sam');
select public.save_profile('Sam', 'UTC');
select tests.authenticate_as('harry');
select public.save_profile('Harry', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('sam');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';

alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.request_freeze(uuid, text, uuid, date) set search_path = test_overrides, pg_catalog;
alter function public.my_freeze_options(uuid) set search_path = test_overrides, pg_catalog;
alter function public.my_freeze_requests(uuid) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_3_close_votes() set search_path = test_overrides, pg_catalog;
alter function public.create_challenge(uuid) set search_path = test_overrides, pg_catalog;
alter function public.post_checkin(uuid, uuid, timestamptz, text) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

-- A commitment with one version (fixed days when p_days is set, else times per week with
-- p_target), written directly. p_group is a setting name.
create function pg_temp.add_plan(p_user text, p_group text, p_preset text, p_days smallint[],
                                 p_target smallint, p_first date)
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
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values (v_id, v_group, p_first, p_days, p_target);
  return v_id;
end;
$$;

-- The session id of a commitment (setting name) in a week, by slot.
create function pg_temp.sid(p_commitment text, p_week date, p_slot integer)
returns uuid
language sql
security definer
as $$
  select s.id from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = p_week and s.slot = p_slot;
$$;

-- The status of that session (private.session_status, as the table owner).
create function pg_temp.st(p_commitment text, p_week date, p_slot integer)
returns text
language sql
security definer
as $$
  select private.session_status(s) from public.sessions s
  where s.id = pg_temp.sid(p_commitment, p_week, p_slot);
$$;

-- The latest freeze request on that session: status, plus closed_at set or not.
create function pg_temp.fr(p_commitment text, p_week date, p_slot integer)
returns text
language sql
security definer
as $$
  select f.status || '|' || (f.closed_at is not null)::text from public.freeze_requests f
  where f.session_id = pg_temp.sid(p_commitment, p_week, p_slot)
  order by f.created_at desc, f.opened_at desc
  limit 1;
$$;

-- A check-in (setting name p_id) written directly on the session of a week by slot; counted and
-- received at p_at.
create function pg_temp.checkin(p_id text, p_commitment text, p_week date, p_slot integer, p_at timestamptz)
returns void
language sql
as $$
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select current_setting('test.' || p_id)::uuid, c.group_id, c.user_id, c.id,
         pg_temp.sid(p_commitment, p_week, p_slot), p_at, p_at, p_at, false
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid;
$$;

grant execute on function pg_temp.sid(text, date, integer), pg_temp.st(text, date, integer),
  pg_temp.fr(text, date, integer) to authenticated;

select pg_catalog.set_config('test.study', pg_temp.add_plan('bob', 'g1', 'study', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-10-19')::text, true);
select pg_catalog.set_config('test.gym', pg_temp.add_plan('bob', 'g1', 'gym', null, 3::smallint, '2026-11-09')::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('carol', 'g1', 'walk', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-16')::text, true);
select pg_catalog.set_config('test.run', pg_temp.add_plan('sam', 'g2', 'run', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null, '2026-11-16')::text, true);

select pg_catalog.set_config('test.b1', '00000000-0000-4000-a000-0000000054b1', true);
select pg_catalog.set_config('test.b2', '00000000-0000-4000-a000-0000000054b2', true);
select pg_catalog.set_config('test.b3', '00000000-0000-4000-a000-0000000054b3', true);
select pg_catalog.set_config('test.b4', '00000000-0000-4000-a000-0000000054b4', true);
select pg_catalog.set_config('test.b5', '00000000-0000-4000-a000-0000000054b5', true);
select pg_catalog.set_config('test.c1', '00000000-0000-4000-a000-0000000054c1', true);

-- Both photo renditions for every check-in posted through post_checkin.
set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.g1') || '/' || current_setting('test.' || p.id) || '/' || s.size || '.webp',
       tests.get_supabase_uid(p.owner)::text
from (values ('b1', 'bob'), ('b2', 'bob'), ('b3', 'bob'), ('b4', 'bob'), ('c1', 'carol')) p(id, owner)
cross join (values ('1080'), ('360')) s(size);
reset role;

select tests.freeze_time('2026-10-19 00:30:00+00');
select private.tick_step_1_sessions();
select tests.freeze_time('2026-11-09 00:30:00+00');
select private.tick_step_1_sessions();
select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

-- Week A's Gym rows had no check-in: their misses were stamped Mon 16 Nov 00:10.
update public.sessions set miss_recorded_at = '2026-11-16 00:10:00+00'
where commitment_id = current_setting('test.gym')::uuid and week_start = '2026-11-09';

-- ===== DST week: the next London midnight after a miss stamped Sun 25 Oct 00:30 BST =====
-- bob's Saturday 24 Oct Study ended Sat 23:00 UTC; its miss was stamped Sat 23:30 UTC (Sunday
-- 00:30 BST). The next local midnight is Mon 26 Oct 00:00 GMT = 00:00 UTC, 24.5 h later.
update public.sessions set miss_recorded_at = '2026-10-24 23:30:00+00'
where id = pg_temp.sid('study', '2026-10-19', 6);
select tests.freeze_time('2026-10-26 00:00:00+00');
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-10-19', 6)),
  'P0001', 'freeze_window_closed', 'DST week: at the next London midnight after the miss: freeze_window_closed');
select tests.freeze_time('2026-10-25 23:59:59+00');
select is(
  (select r.status from public.request_freeze(current_setting('test.study')::uuid, 'flu',
     pg_temp.sid('study', '2026-10-19', 6), null) r),
  'pending',
  'DST week: one second before the next London midnight (not + 24 h): pending'
);

-- ===== Mon 16 Nov 09:00: same-day day requests =====
select tests.freeze_time('2026-11-16 09:00:00+00');
select tests.authenticate_as('bob');
select is(
  (select r.status || '|' || r.closes_at::text || '|' || (r.session_id = pg_temp.sid('study', '2026-11-16', 1))::text
   from public.request_freeze(current_setting('test.study')::uuid, '  flu, in bed  ',
     pg_temp.sid('study', '2026-11-16', 1), null) r),
  'pending|2026-11-17 09:00:00+00|true',
  'same day: pending, closes_at = opened_at + 24 h, on the named session'
);
reset role;
select is(
  (select f.reason || '|' || f.opened_at::text || '|' || f.week_start::text || '|'
          || (f.requester_id = tests.get_supabase_uid('bob'))::text || '|'
          || (f.early_close_at is null)::text
   from public.freeze_requests f where f.session_id = pg_temp.sid('study', '2026-11-16', 1)),
  'flu, in bed|2026-11-16 09:00:00+00|2026-11-16|true|true',
  'the row stores the trimmed reason, opened_at = now(), the week and the requester'
);
select is(pg_temp.st('study', '2026-11-16', 1), 'open', 'a pending freeze leaves the session open');
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'again',
         pg_temp.sid('study', '2026-11-16', 1)),
  'P0001', 'freeze_pending', 'a second request on a pending session: freeze_pending');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), '   ',
         pg_temp.sid('study', '2026-11-16', 2)),
  'P0001', 'reason_required', 'a reason blank after trimming: reason_required');
select throws_ok(
  format('select * from public.request_freeze(%L, null, %L, null)', current_setting('test.study'),
         pg_temp.sid('study', '2026-11-16', 2)),
  'P0001', 'reason_required', 'no reason: reason_required');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'),
         repeat('x', 81), pg_temp.sid('study', '2026-11-16', 2)),
  'P0001', 'reason_required', 'an 81-character reason: reason_required');
select is(
  (select r.status from public.request_freeze(current_setting('test.study')::uuid, repeat('y', 80),
     pg_temp.sid('study', '2026-11-16', 7), null) r),
  'pending',
  'an 80-character reason is accepted (a future session of the week)'
);
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, %L)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-16', 2), '2026-11-16'),
  'P0001', 'invalid_freeze', 'fixed days with a week as well: invalid_freeze');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('walk', '2026-11-16', 2)),
  'P0001', 'invalid_freeze', 'a session of another commitment: invalid_freeze');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.gym'), 'flu',
         pg_temp.sid('gym', '2026-11-16', 1)),
  'P0001', 'invalid_freeze', 'times per week with a session: invalid_freeze');
select tests.authenticate_as('carol');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-16', 2)),
  'P0001', 'not_member', 'someone else''s session: not_member');
select tests.authenticate_as('harry');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-16', 2)),
  'P0001', 'not_member', 'a non-member: not_member');
select throws_ok(
  format('select * from public.my_freeze_options(%L)', current_setting('test.g1')),
  'P0001', 'not_member', 'my_freeze_options for a non-member: not_member');
select throws_ok(
  format('select * from public.my_freeze_requests(%L)', current_setting('test.g1')),
  'P0001', 'not_member', 'my_freeze_requests for a non-member: not_member');
select is((select count(*)::integer from public.freeze_requests), 0,
  'RLS: a non-member reads no freeze request');
select tests.authenticate_as('alice');
select is((select count(*)::integer from public.freeze_requests f
           where f.group_id = current_setting('test.g1')::uuid), 3,
  'RLS: a current member reads the group''s requests');
-- carol asks to freeze her Monday Walk (the tick closes it at Tue 09:00 with no vote).
select tests.authenticate_as('carol');
select is(
  (select r.status from public.request_freeze(current_setting('test.walk')::uuid, 'work trip',
     pg_temp.sid('walk', '2026-11-16', 1), null) r),
  'pending',
  'carol''s same-day Walk request: pending'
);

-- ===== Times per week, this week: row choice, target, options =====
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, null, null)', current_setting('test.gym'), 'flu'),
  'P0001', 'invalid_freeze', 'times per week without a week: invalid_freeze');
select is(
  (select o.which || '|' || o.target || '|' || o.frozen || '|' || o.target_after || '|'
          || o.window_ends_at::text || '|' || o.missed::text || '|' || o.time_zone
   from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.option_kind = 'week' and o.commitment_id = current_setting('test.gym')::uuid
     and o.week_start = '2026-11-16'),
  'this|3|0|2|2026-11-23 00:00:00+00|false|Europe/London',
  'options: Gym this week, target 3, nothing frozen, 2 after, window to the week''s end'
);
select is(
  (select o.which || '|' || o.target || '|' || o.target_after || '|' || o.window_ends_at::text || '|'
          || o.missed::text
   from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.option_kind = 'week' and o.commitment_id = current_setting('test.gym')::uuid
     and o.week_start = '2026-11-09'),
  'last|3|2|2026-11-17 00:00:00+00|true',
  'options: Gym last week, until the next London midnight after its misses were stamped'
);
select is(
  (select pg_catalog.string_agg(extract(isodow from (o.starts_at at time zone o.time_zone))::text, ','
                                order by o.starts_at)
   from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.option_kind = 'day' and o.commitment_id = current_setting('test.study')::uuid),
  '2,3,4,5,6',
  'options: bob''s Study Tue to Sat (Mon and Sun pending; ended unstamped and earlier weeks out)'
);
select is(
  (select o.window_ends_at::text || '|' || o.missed::text || '|' || o.which
   from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.session_id = pg_temp.sid('study', '2026-11-16', 2)),
  '2026-11-18 00:00:00+00|false|this',
  'options: a day session not yet ended is freezable until it ends'
);
select is(
  (select r.status || '|' || (r.session_id = pg_temp.sid('gym', '2026-11-16', 3))::text
   from public.request_freeze(current_setting('test.gym')::uuid, 'knee', null, '2026-11-16') r),
  'pending|true',
  'times per week: the server picks the highest-slot free row'
);
select is(
  (select o.target || '|' || o.frozen || '|' || o.target_after
   from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.option_kind = 'week' and o.week_start = '2026-11-16'),
  '2|1|1',
  'options: a pending week freeze lowers the target by 1'
);
select is(
  (select pg_catalog.string_agg(q.option_kind || ':' || q.status || ':' || coalesce(q.target_after::text, '-'), ','
                                order by q.option_kind, q.starts_at)
   from public.my_freeze_requests(current_setting('test.g1')::uuid) q),
  'day:pending:-,day:pending:-,week:pending:2',
  'my_freeze_requests: bob''s pending day requests and the week request (2 after it), unlocked weeks only'
);
select is(
  (select q.reason || '|' || q.closes_at::text
   from public.my_freeze_requests(current_setting('test.g1')::uuid) q
   where q.session_id = pg_temp.sid('study', '2026-11-16', 1)),
  'flu, in bed|2026-11-17 09:00:00+00',
  'my_freeze_requests: reason and closes_at'
);

-- ===== post_checkin: withdrawing a pending day freeze; preferring a row with no pending freeze =====
select tests.freeze_time('2026-11-16 12:00:00+00');
select is(
  (select r.counted::text || '|' || (r.session_id = pg_temp.sid('study', '2026-11-16', 1))::text
   from public.post_checkin(current_setting('test.b1')::uuid, current_setting('test.study')::uuid,
     '2026-11-16 11:59:00+00', null) r),
  'true|true',
  'a check-in on Monday''s Study counts for that session'
);
select is(pg_temp.fr('study', '2026-11-16', 1), 'withdrawn|true',
  'the check-in withdrew the pending freeze on that session');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-16', 1)),
  'P0001', 'session_done', 'a done session: session_done');
select is(
  (select (r.session_id = pg_temp.sid('gym', '2026-11-16', 1))::text
   from public.post_checkin(current_setting('test.b2')::uuid, current_setting('test.gym')::uuid,
     '2026-11-16 11:59:00+00', null) r),
  'true',
  'times per week: the check-in takes slot 1, not the pending row'
);
select is(pg_temp.fr('gym', '2026-11-16', 3), 'pending|false', 'the week freeze stays pending');
select tests.freeze_time('2026-11-17 12:00:00+00');
select is(
  (select (r.session_id = pg_temp.sid('gym', '2026-11-16', 2))::text
   from public.post_checkin(current_setting('test.b3')::uuid, current_setting('test.gym')::uuid,
     '2026-11-17 11:59:00+00', null) r),
  'true',
  'the next day''s check-in takes slot 2, still skipping the pending row'
);
select throws_ok(
  format('select * from public.request_freeze(%L, %L, null, %L)', current_setting('test.gym'), 'flu', '2026-11-16'),
  'P0001', 'target_met', 'counted 2 of an effective target of 2: target_met');
select is(
  (select count(*)::integer from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.option_kind = 'week' and o.week_start = '2026-11-16'),
  0,
  'options: no Gym week once the effective target is met'
);
select tests.freeze_time('2026-11-18 12:00:00+00');
select is(
  (select (r.session_id = pg_temp.sid('gym', '2026-11-16', 3))::text
   from public.post_checkin(current_setting('test.b4')::uuid, current_setting('test.gym')::uuid,
     '2026-11-18 11:59:00+00', null) r),
  'true',
  'only the pending row is left: the check-in takes it'
);
select is(pg_temp.fr('gym', '2026-11-16', 3), 'withdrawn|true',
  'and withdraws its pending freeze');

-- ===== Last week's times-per-week window edges (Gym week A, stamped Mon 16 Nov 00:10) =====
select tests.freeze_time('2026-11-17 00:00:00+00');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, null, %L)', current_setting('test.gym'), 'flu', '2026-11-09'),
  'P0001', 'freeze_window_closed', 'last week at the next local midnight after the stamp: freeze_window_closed');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, null, %L)', current_setting('test.gym'), 'flu', '2026-11-23'),
  'P0001', 'freeze_window_closed', 'a week that is neither this nor last: freeze_window_closed');
select tests.freeze_time('2026-11-16 23:59:59+00');
select is(
  (select r.status || '|' || (r.session_id = pg_temp.sid('gym', '2026-11-09', 3))::text || '|'
          || r.closes_at::text
   from public.request_freeze(current_setting('test.gym')::uuid, 'flu', null, '2026-11-09') r),
  'pending|true|2026-11-17 23:59:59+00',
  'last week one second before the next local midnight: pending on the highest missed row'
);

-- ===== Tick step 3 approves an unvoted group request at closes_at =====
reset role;
select tests.freeze_time('2026-11-17 08:59:59+00');
select private.tick_step_3_close_votes();
select is(pg_temp.fr('walk', '2026-11-16', 1), 'pending|false',
  'one second before closes_at the tick leaves carol''s request pending');
select tests.freeze_time('2026-11-17 09:00:00+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs without error');
select is(pg_temp.fr('walk', '2026-11-16', 1), 'approved|true',
  'at closes_at with no votes the request is approved');
select is(pg_temp.st('walk', '2026-11-16', 1), 'frozen', 'the approved session reads frozen');
select is(
  (select e.payload ->> 'outcome' || '|' || (e.payload ->> 'approve_count') || '|'
          || (e.payload ->> 'deny_count') || '|' || (e.payload ->> 'miss_removed') || '|'
          || (e.payload ->> 'reason') || '|' || (e.payload ->> 'session_day') || '|'
          || (e.payload ->> 'schedule_type') || '|' || (e.payload ->> 'actor_name') || '|'
          || (e.actor_id = tests.get_supabase_uid('carol'))::text
   from public.feed_events e
   where e.kind = 'freeze_result'
     and e.payload ->> 'session_id' = pg_temp.sid('walk', '2026-11-16', 1)::text),
  'approved|0|0|false|work trip|2026-11-16|fixed_days|Carol|true',
  'one freeze_result event with the outcome, counts, reason and day'
);
select private.close_vote((select f.id from public.freeze_requests f
                           where f.session_id = pg_temp.sid('gym', '2026-11-16', 3)));
select is(pg_temp.fr('gym', '2026-11-16', 3), 'withdrawn|true', 'close_vote leaves a withdrawn request alone');

-- ===== A frozen day session refuses a check-in and a second request =====
select tests.freeze_time('2026-11-17 10:00:00+00');
select tests.authenticate_as('carol');
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.c1'),
         current_setting('test.walk'), '2026-11-16 20:00:00+00'),
  'P0001', 'session_frozen', 'a late check-in matching the frozen Monday: session_frozen');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.walk'), 'again',
         pg_temp.sid('walk', '2026-11-16', 1)),
  'P0001', 'session_frozen', 'a request on a frozen session: session_frozen');
select is(
  (select q.option_kind || '|' || q.status || '|' || q.reason
   from public.my_freeze_requests(current_setting('test.g1')::uuid) q),
  'day|approved|work trip',
  'my_freeze_requests lists the approved request'
);

-- ===== A Fake-ruling miss can never be frozen =====
reset role;
select pg_temp.checkin('b5', 'study', '2026-11-16', 2, '2026-11-17 08:00:00+00');
select tests.authenticate_as('alice');
select public.create_challenge(current_setting('test.b5')::uuid);
reset role;
select private.close_vote((select ch.id from public.challenges ch
                           where ch.checkin_id = current_setting('test.b5')::uuid));
select tests.freeze_time('2026-11-18 00:30:00+00');
select is(pg_temp.st('study', '2026-11-16', 2), 'missed', 'the Fake ruling left Tuesday missed');
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-16', 2)),
  'P0001', 'fake_ruling_miss', 'a Fake-ruling miss: fake_ruling_miss');
select is(
  (select count(*)::integer from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.session_id = pg_temp.sid('study', '2026-11-16', 2)),
  0,
  'options: a Fake-ruling miss is not offered'
);

-- ===== A recorded miss: one second before and at the next local midnight =====
reset role;
update public.sessions set miss_recorded_at = '2026-11-19 00:05:00+00'
where id = pg_temp.sid('study', '2026-11-16', 3);
select tests.freeze_time('2026-11-20 00:00:00+00');
select tests.authenticate_as('bob');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-16', 3)),
  'P0001', 'freeze_window_closed', 'at the next local midnight after the miss: freeze_window_closed');
select tests.freeze_time('2026-11-19 23:59:59+00');
select is(
  (select o.window_ends_at::text || '|' || o.missed::text
   from public.my_freeze_options(current_setting('test.g1')::uuid) o
   where o.session_id = pg_temp.sid('study', '2026-11-16', 3)),
  '2026-11-20 00:00:00+00|true',
  'options: a recorded miss is freezable until the next local midnight'
);
select is(
  (select r.status from public.request_freeze(current_setting('test.study')::uuid, 'flu',
     pg_temp.sid('study', '2026-11-16', 3), null) r),
  'pending',
  'one second before the next local midnight after the miss: pending'
);

-- ===== An ended session with no miss recorded; the lock =====
select tests.freeze_time('2026-11-18 23:59:59+00');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-09', 7)),
  'P0001', 'freeze_window_closed', 'an ended session with no miss recorded, before the lock: freeze_window_closed');
select tests.freeze_time('2026-11-19 00:00:00+00');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, %L, null)', current_setting('test.study'), 'flu',
         pg_temp.sid('study', '2026-11-09', 7)),
  'P0001', 'week_locked', 'at lock_at: week_locked');
select throws_ok(
  format('select * from public.request_freeze(%L, %L, null, %L)', current_setting('test.gym'), 'flu', '2026-11-09'),
  'P0001', 'week_locked', 'times per week, last week at its lock_at: week_locked');

-- ===== Solo: approved at once, the recorded miss removed =====
reset role;
update public.sessions set miss_recorded_at = '2026-11-17 00:05:00+00'
where id = pg_temp.sid('run', '2026-11-16', 1);
insert into public.feed_events (group_id, kind, actor_id, payload)
values (current_setting('test.g2')::uuid, 'miss', tests.get_supabase_uid('sam'),
        pg_catalog.jsonb_build_object(
          'session_ids', pg_catalog.jsonb_build_array(pg_temp.sid('run', '2026-11-16', 1)),
          'commitment_id', current_setting('test.run')));
select tests.freeze_time('2026-11-17 12:00:00+00');
select tests.authenticate_as('sam');
select is((select count(*)::integer from public.feed_items f where f.item_kind = 'miss'), 1,
  'solo: the miss sticky shows before the freeze');
select is(
  (select r.status || '|' || (r.session_id = pg_temp.sid('run', '2026-11-16', 1))::text
   from public.request_freeze(current_setting('test.run')::uuid, 'sick', pg_temp.sid('run', '2026-11-16', 1), null) r),
  'approved|true',
  'solo: the request is approved at once'
);
select is(pg_temp.st('run', '2026-11-16', 1), 'frozen', 'solo: the session reads frozen');
select is((select count(*)::integer from public.feed_items f where f.item_kind = 'miss'), 0,
  'solo: the miss sticky is gone');
reset role;
select is(
  (select e.payload ->> 'outcome' || '|' || (e.payload ->> 'miss_removed') || '|' || (e.payload ->> 'reason')
   from public.feed_events e
   where e.kind = 'freeze_result' and e.group_id = current_setting('test.g2')::uuid),
  'approved|true|sick',
  'solo: one freeze_result event, miss removed'
);
select is(
  (select t.planned || '|' || t.frozen
   from private.member_week_tally(
     (select m.id from public.memberships m where m.group_id = current_setting('test.g2')::uuid),
     '2026-11-16') t),
  '7|1',
  'solo: the frozen session is dropped from the score (planned - frozen)'
);

-- ===== Solo times per week: a check-in skips the approved-frozen row =====
-- sam adds Yoga 2 times a week from week B; the week freeze is approved at once on slot 2. Tue's
-- check-in takes slot 1; Wed's finds only the frozen row left, so it is an extra (no session).
select pg_catalog.set_config('test.swim', pg_temp.add_plan('sam', 'g2', 'yoga', null, 2::smallint, '2026-11-16')::text, true);
select private.tick_step_1_sessions();
select pg_catalog.set_config('test.s1', '00000000-0000-4000-a000-0000000054e1', true);
select pg_catalog.set_config('test.s2', '00000000-0000-4000-a000-0000000054e2', true);
set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.g2') || '/' || current_setting('test.' || p.id) || '/' || s.size || '.webp',
       tests.get_supabase_uid('sam')::text
from (values ('s1'), ('s2')) p(id)
cross join (values ('1080'), ('360')) s(size);
reset role;
select tests.authenticate_as('sam');
select is(
  (select r.status || '|' || (r.session_id = pg_temp.sid('swim', '2026-11-16', 2))::text
   from public.request_freeze(current_setting('test.swim')::uuid, 'ear infection', null, '2026-11-16') r),
  'approved|true',
  'solo times per week: approved at once on the highest free slot'
);
select is(
  (select (r.session_id = pg_temp.sid('swim', '2026-11-16', 1))::text
   from public.post_checkin(current_setting('test.s1')::uuid, current_setting('test.swim')::uuid,
     '2026-11-17 11:59:00+00', null) r),
  'true',
  'solo times per week: the check-in takes slot 1, not the frozen row'
);
select tests.freeze_time('2026-11-18 12:00:00+00');
select is(
  (select (r.session_id is null)::text || '|' || r.counted::text
   from public.post_checkin(current_setting('test.s2')::uuid, current_setting('test.swim')::uuid,
     '2026-11-18 11:59:00+00', null) r),
  'true|false',
  'solo times per week: only the frozen row left, the check-in is an extra'
);
select is(pg_temp.st('swim', '2026-11-16', 2), 'frozen',
  'solo times per week: the frozen slot still reads frozen');

select * from finish();
rollback;
