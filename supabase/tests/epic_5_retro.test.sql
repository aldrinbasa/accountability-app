-- Epic 5 retro fixes (F1, F6, F7; spec-epic-5-retro-fixes.md): an admin overturn cancels every
-- pending or approved freeze on the overturned check-in's session (the session reads done, never
-- done and frozen; points and streak as with no freeze; the freeze_result sticky leaves the Feed;
-- the freeze card reads its cancelled status), a freeze on another row of a times-per-week week
-- stays, a cancelled request is left alone by close_vote and tick step 3, its ballot stays, and
-- freeze ballots (one on a cancelled request) count toward Fair Judge. A denied freeze on an
-- overturned session stays denied with its sticky; a result whose request row is gone stays shown.
--
-- Cast: alice creates "Pair" (Europe/London, admin) with bob; memberships back-dated to 1 Oct.
-- Week Mon 16 to Sun 22 Nov 2026 (London = UTC; locks Thu 26 Nov 00:00). bob has Gym Mon Wed
-- (fixed days) and Walk 2 times per week, both from that week. Check-ins are written directly as
-- the table owner. The routines under test call now() unqualified; their search_path is pointed at
-- test_overrides so tests.freeze_time moves their clock.
begin;
set local timezone = 'UTC';
select plan(22);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');

-- ===== Shape =====
select ok(
  (select pg_catalog.strpos(p.prosrc, 'where cm.id = v_checkin.commitment_id for update') > 0
   from pg_catalog.pg_proc p where p.oid = 'public.overturn_ruling(uuid)'::regprocedure)
  and (select 'search_path=""' = any (p.proconfig) and p.prosecdef
       from pg_catalog.pg_proc p where p.oid = 'public.overturn_ruling(uuid)'::regprocedure),
  'overturn_ruling takes the commitment lock, keeps an empty search_path and security definer'
);
select ok(
  has_function_privilege('authenticated', 'public.overturn_ruling(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.overturn_ruling(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.overturn_ruling(uuid)', 'EXECUTE'),
  'overturn_ruling: authenticated only'
);
select is(
  (select count(*)::integer from pg_catalog.pg_attribute a
   where a.attrelid = 'public.feed_items'::regclass and a.attnum > 0 and not a.attisdropped),
  28, 'feed_items keeps its 28 columns'
);

-- ===== Profiles and group =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g', public.create_group('Pair')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));

reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';

alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.create_challenge(uuid) set search_path = test_overrides, pg_catalog;
alter function public.cast_vote(text, uuid, text) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function public.overturn_ruling(uuid) set search_path = test_overrides, pg_catalog;
alter function private.ruling_can_overturn(uuid) set search_path = test_overrides, pg_catalog;
alter function public.request_freeze(uuid, text, uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.badge_criteria_met(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_3_close_votes() set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.checkin_challenge_until(uuid, timestamptz) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

-- A commitment with one version (fixed days when p_days is set, else times per week with
-- p_target), written directly.
create function pg_temp.add_plan(p_user text, p_preset text, p_days smallint[], p_target smallint)
returns uuid
language plpgsql
as $$
declare
  v_uid uuid := tests.get_supabase_uid(p_user);
  v_group uuid := current_setting('test.g')::uuid;
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
  values (v_id, v_group, '2026-11-16', p_days, p_target);
  return v_id;
end;
$$;

-- The session id of a commitment (setting name) this week, by slot.
create function pg_temp.sid(p_commitment text, p_slot integer)
returns uuid
language sql
security definer
as $$
  select s.id from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = '2026-11-16' and s.slot = p_slot;
$$;

-- The status of that session.
create function pg_temp.st(p_commitment text, p_slot integer)
returns text
language sql
security definer
as $$
  select private.session_status(s) from public.sessions s
  where s.id = pg_temp.sid(p_commitment, p_slot);
$$;

-- A check-in (setting name p_id) written directly on a session, taken and received at p_at.
create function pg_temp.checkin(p_id text, p_commitment text, p_slot integer, p_at timestamptz)
returns void
language plpgsql
as $$
begin
  perform pg_catalog.set_config('test.' || p_id, pg_catalog.gen_random_uuid()::text, true);
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select current_setting('test.' || p_id)::uuid, c.group_id, c.user_id, c.id,
         pg_temp.sid(p_commitment, p_slot), p_at, p_at, p_at, false
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid;
end;
$$;

-- A freeze request (setting name): status|cancel_reason|cancelled by alice|closed_at.
create function pg_temp.fr(p_request text)
returns text
language sql
security definer
as $$
  select f.status || '|' || coalesce(f.cancel_reason, '-') || '|'
    || coalesce((f.cancelled_by = tests.get_supabase_uid('alice'))::text, '-') || '|'
    || coalesce(f.closed_at::text, '-')
  from public.freeze_requests f
  where f.id = current_setting('test.' || p_request)::uuid;
$$;

-- The challenge id of a check-in (setting name).
create function pg_temp.ch(p_checkin text)
returns uuid
language sql
security definer
as $$
  select ch.id from public.challenges ch where ch.checkin_id = current_setting('test.' || p_checkin)::uuid;
$$;

grant execute on function pg_temp.sid(text, integer), pg_temp.st(text, integer), pg_temp.fr(text),
  pg_temp.ch(text) to authenticated;

select pg_catalog.set_config('test.gym', pg_temp.add_plan('bob', 'gym', array[1, 3]::smallint[], null)::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('bob', 'walk', null, 2::smallint)::text, true);
select pg_catalog.set_config('test.mid', (select m.id::text from public.memberships m
  where m.group_id = current_setting('test.g')::uuid and m.user_id = tests.get_supabase_uid('bob')), true);
select pg_catalog.set_config('test.amid', (select m.id::text from public.memberships m
  where m.group_id = current_setting('test.g')::uuid and m.user_id = tests.get_supabase_uid('alice')), true);

select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

-- ===== Approved freeze, then overturn (Gym Mon) =====
-- 07:00 bob's check-in; 08:00 alice questions it (a group of two: ruled at once, the session is
-- still open); 09:00 bob asks to freeze it (allowed while open, Aldrin 2026-11-24); 09:01 alice
-- approves; 09:01:10 the request closes approved.
select pg_temp.checkin('m1', 'gym', 1, '2026-11-16 07:00:00+00');
select tests.freeze_time('2026-11-16 08:00:00+00');
select tests.authenticate_as('alice');
select public.create_challenge(current_setting('test.m1')::uuid);
select tests.freeze_time('2026-11-16 09:00:00+00');
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.r1', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.gym')::uuid, 'flu, in bed', pg_temp.sid('gym', 1), null) r)::text, true);
select tests.freeze_time('2026-11-16 09:01:00+00');
select tests.authenticate_as('alice');
select public.cast_vote('freeze', current_setting('test.r1')::uuid, 'approve');
select tests.freeze_time('2026-11-16 09:01:10+00');
reset role;
select private.close_vote(current_setting('test.r1')::uuid);
select is(
  pg_temp.fr('r1') || '|' || pg_temp.st('gym', 1)
  || '|' || private.weekly_points(current_setting('test.mid')::uuid, '2026-11-16')::text,
  'approved|-|-|2026-11-16 09:01:10+00|frozen|0',
  'control: ruled doesn''t count, then frozen while open (Monday off the plan)'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.feed_items f
   where f.item_kind = 'freeze_result' and f.payload ->> 'freeze_request_id' = current_setting('test.r1')),
  1, 'control: the "Freeze approved" sticky is on the wall'
);

-- 10:00 alice overturns the ruling.
select tests.freeze_time('2026-11-16 10:00:00+00');
select tests.authenticate_as('alice');
select lives_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('m1')), 'alice overturns the ruling');
reset role;
select is(
  pg_temp.fr('r1') || '|' || pg_temp.st('gym', 1),
  'cancelled|overturned|true|2026-11-16 09:01:10+00|done',
  'the approved freeze is cancelled (reason overturned, by alice, closed_at kept); Monday reads done'
);
select is(
  private.weekly_points(current_setting('test.mid')::uuid, '2026-11-16')::text
  || '|' || private.current_streak(current_setting('test.gym')::uuid)::text
  || '|' || (select count(*)::text from public.sessions s
             where s.commitment_id = current_setting('test.gym')::uuid
               and private.session_status(s) = 'frozen'),
  '25|1|0',
  'points and streak as with no freeze: 1 of 4 planned done (Gym Mon Wed, Walk 2), streak 1, nothing frozen'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.feed_items f
   where f.item_kind = 'freeze_result' and f.payload ->> 'freeze_request_id' = current_setting('test.r1')),
  0, 'the "Freeze approved" sticky leaves the wall (the event is kept)'
);
select is(
  (select (f.payload ->> 'status') || '|' || (f.payload ->> 'cancel_reason')
          || '|' || ((f.payload ->> 'cancelled_by_id')::uuid = tests.get_supabase_uid('alice'))::text
   from public.feed_items f
   where f.item_kind = 'freeze' and f.item_id = current_setting('test.r1')::uuid),
  'cancelled|overturned|true',
  'the freeze card reads cancelled, reason overturned, by the admin'
);
reset role;
select is(
  (select count(*)::integer from public.feed_events e
   where e.kind = 'freeze_result' and e.payload ->> 'freeze_request_id' = current_setting('test.r1')),
  1, 'the freeze_result event itself stays in the log'
);

-- ===== Pending freeze, then overturn (Gym Wed) =====
select tests.freeze_time('2026-11-18 07:00:00+00');
select pg_temp.checkin('w1', 'gym', 3, '2026-11-18 07:00:00+00');
select tests.freeze_time('2026-11-18 08:00:00+00');
select tests.authenticate_as('alice');
select public.create_challenge(current_setting('test.w1')::uuid);
select tests.freeze_time('2026-11-18 09:00:00+00');
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.r2', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.gym')::uuid, 'knee', pg_temp.sid('gym', 3), null) r)::text, true);
select tests.freeze_time('2026-11-18 09:30:00+00');
select tests.authenticate_as('alice');
select public.cast_vote('freeze', current_setting('test.r2')::uuid, 'approve');
select tests.freeze_time('2026-11-18 09:30:03+00');
select lives_ok(format('select * from public.overturn_ruling(%L)', pg_temp.ch('w1')),
  'alice overturns while the freeze is pending (her ballot still in its undo window)');
reset role;
select is(
  pg_temp.fr('r2') || '|' || pg_temp.st('gym', 3),
  'cancelled|overturned|true|2026-11-18 09:30:03+00|done',
  'the pending request is cancelled at the overturn; Wednesday reads done'
);
-- Past its deadline: close_vote and tick step 3 leave the cancelled request alone.
select tests.freeze_time('2026-11-19 10:00:00+00');
select private.close_vote(current_setting('test.r2')::uuid);
select private.tick_step_3_close_votes();
select is(
  pg_temp.fr('r2')
  || '|' || (select count(*)::text from public.feed_events e
             where e.kind = 'freeze_result' and e.payload ->> 'freeze_request_id' = current_setting('test.r2'))
  || '|' || (select count(*)::text from public.votes v where v.freeze_request_id = current_setting('test.r2')::uuid),
  'cancelled|overturned|true|2026-11-18 09:30:03+00|0|1',
  'close_vote and the tick leave it cancelled: no result event; alice''s ballot stays'
);
select is(
  private.weekly_points(current_setting('test.mid')::uuid, '2026-11-16')::text
  || '|' || private.current_streak(current_setting('test.gym')::uuid)::text,
  '50|2',
  'both Gym sessions done: 2 of 4 planned (50 points), streak 2'
);

-- ===== Times per week: a freeze on another row stays =====
-- Walk row 1 gets a check-in ruled doesn't count; bob freezes the week (the server picks row 2,
-- the highest slot not done); approved; the overturn restores row 1 and leaves row 2 frozen.
select tests.freeze_time('2026-11-19 11:00:00+00');
select pg_temp.checkin('k1', 'walk', 1, '2026-11-19 11:00:00+00');
select tests.freeze_time('2026-11-19 12:00:00+00');
select tests.authenticate_as('alice');
select public.create_challenge(current_setting('test.k1')::uuid);
select tests.freeze_time('2026-11-19 13:00:00+00');
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.r3', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.walk')::uuid, 'away', null, '2026-11-16') r)::text, true);
reset role;
select is(
  (select (f.session_id = pg_temp.sid('walk', 2))::text from public.freeze_requests f
   where f.id = current_setting('test.r3')::uuid),
  'true', 'control: the week freeze picked row 2, not the ruled row'
);
select tests.freeze_time('2026-11-19 13:01:00+00');
select tests.authenticate_as('alice');
select public.cast_vote('freeze', current_setting('test.r3')::uuid, 'approve');
select tests.freeze_time('2026-11-19 13:01:10+00');
reset role;
select private.close_vote(current_setting('test.r3')::uuid);
select tests.freeze_time('2026-11-19 14:00:00+00');
select tests.authenticate_as('alice');
select public.overturn_ruling(pg_temp.ch('k1'));
reset role;
select is(
  pg_temp.fr('r3') || '|' || pg_temp.st('walk', 1) || '|' || pg_temp.st('walk', 2),
  'approved|-|-|2026-11-19 13:01:10+00|done|frozen',
  'the freeze on the other row stays approved; row 1 done, row 2 frozen'
);

-- ===== Fair Judge counts freeze ballots (F6) =====
-- alice has 3 freeze ballots (r1, r2 cancelled, r3) and no challenge ballot (a challenger's
-- implicit vote is none). 7 more on closed requests make 10.
insert into public.freeze_requests
  (id, group_id, requester_id, commitment_id, session_id, week_start, reason, opened_at, closes_at,
   status, closed_at)
select pg_catalog.gen_random_uuid(), current_setting('test.g')::uuid, tests.get_supabase_uid('bob'),
       current_setting('test.gym')::uuid, pg_temp.sid('gym', 1), '2026-11-16', 'old ' || n,
       '2026-11-17 08:00:00+00', '2026-11-18 08:00:00+00', 'denied', '2026-11-18 08:00:00+00'
from pg_catalog.generate_series(1, 7) n;
insert into public.votes (group_id, freeze_request_id, voter_id, choice, cast_at)
select f.group_id, f.id, tests.get_supabase_uid('alice'), 'deny', '2026-11-17 09:00:00+00'
from public.freeze_requests f
where f.reason like 'old %';
select is(
  (select count(*)::integer from public.votes v
   where v.voter_id = tests.get_supabase_uid('alice') and v.challenge_id is null)
  || '|' || (select count(*)::text from private.badge_criteria_met(current_setting('test.amid')::uuid, '2026-11-16') k
             where k = 'fair_judge'),
  '10|1',
  'Fair Judge: 10 freeze ballots (one on a cancelled request) earn it'
);
delete from public.votes v
where v.freeze_request_id = (select f.id from public.freeze_requests f where f.reason = 'old 1');
select is(
  (select count(*)::integer from private.badge_criteria_met(current_setting('test.amid')::uuid, '2026-11-16') k
   where k = 'fair_judge'),
  0, 'Fair Judge: 9 freeze ballots are not enough'
);

-- ===== A denied freeze stays denied; a result whose request row is gone stays on the wall =====
-- bob's Study on Sat: ruled doesn't count, freeze denied, then overturned.
select pg_catalog.set_config('test.study', pg_temp.add_plan('bob', 'study', array[6]::smallint[], null)::text, true);
select tests.freeze_time('2026-11-21 00:30:00+00');
select private.tick_step_1_sessions();
select pg_temp.checkin('s1', 'study', 6, '2026-11-21 08:00:00+00');
select tests.freeze_time('2026-11-21 09:00:00+00');
select tests.authenticate_as('alice');
select public.create_challenge(current_setting('test.s1')::uuid);
select tests.freeze_time('2026-11-21 09:30:00+00');
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.r4', (select r.freeze_request_id from public.request_freeze(
  current_setting('test.study')::uuid, 'tired', pg_temp.sid('study', 6), null) r)::text, true);
select tests.freeze_time('2026-11-21 09:31:00+00');
select tests.authenticate_as('alice');
select public.cast_vote('freeze', current_setting('test.r4')::uuid, 'deny');
select tests.freeze_time('2026-11-21 09:31:10+00');
reset role;
select private.close_vote(current_setting('test.r4')::uuid);
select tests.freeze_time('2026-11-21 10:00:00+00');
select tests.authenticate_as('alice');
select public.overturn_ruling(pg_temp.ch('s1'));
reset role;
select is(
  pg_temp.fr('r4') || '|' || pg_temp.st('study', 6),
  'denied|-|-|2026-11-21 09:31:10+00|done',
  'a denied freeze on the overturned session stays denied; Saturday reads done'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.feed_items f
   where f.item_kind = 'freeze_result' and f.payload ->> 'freeze_request_id' = current_setting('test.r4')),
  1, 'its "Freeze denied" sticky stays on the wall'
);
-- The request row of an approved result is gone (its habit deleted: cascade): the sticky stays.
reset role;
delete from public.freeze_requests f where f.id = current_setting('test.r3')::uuid;
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.feed_items f
   where f.item_kind = 'freeze_result' and f.payload ->> 'freeze_request_id' = current_setting('test.r3')),
  1, 'a result whose request row is gone stays on the wall'
);
reset role;

select * from finish();
rollback;
