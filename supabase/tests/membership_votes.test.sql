-- Membership vote side effects (Story 5.6): private.end_membership cancels a leaver's open
-- challenges (as challenger or check-in owner) and pending freeze requests (status, closed_at,
-- cancel_reason = the end reason, cancelled_by = the leaver), deletes their ballots on open votes
-- (closed votes keep theirs), and re-checks all-voted on every remaining open vote (early_close_at
-- after the last remaining undo window, closed at once when every remaining ballot is final or no
-- eligible voter remains). Leave and remove (remove_member) as voter, challenger, owner and
-- requester; tallies recount; a rejoined member is not eligible and their old ballot stays gone;
-- a removed member's ballots are unreadable to others; a drop to 1 member approves the remaining
-- member's pending freeze with a freeze_result event, then create_challenge and cast_vote raise
-- group_waiting and a new request_freeze is approved at once; feed_items rows of cancelled cards
-- (owner left: the row stays with its activity, photo_visible false; cancelled_by_id), a closed
-- challenge whose owner left stays hidden, a cancelled freeze card keeps its habit and day; shape
-- and grants per role (AD-16).
--
-- Cast: alice creates "Crew" (London) with bob, carol, dan and eve. gina creates "Pack" (London)
-- with hank, jill, kim and lee. erin creates "Duo" (London) with fay. All memberships back-dated to
-- 1 Oct. Week Mon 16 to Sun 22 Nov 2026 (London = UTC; locks Thu 26 Nov 00:00). Plans and
-- check-ins are written directly as the table owner. The routines under test call now()
-- unqualified; their search_path is pointed at test_overrides so tests.freeze_time moves the clock.
begin;
set local timezone = 'UTC';
select plan(91);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dan');
select tests.create_supabase_user('eve');
select tests.create_supabase_user('gina');
select tests.create_supabase_user('hank');
select tests.create_supabase_user('jill');
select tests.create_supabase_user('kim');
select tests.create_supabase_user('lee');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('fay');

-- ===== Shape =====
select ok(
  (select pg_catalog.pg_get_constraintdef(c.oid) like '%FOREIGN KEY (cancelled_by) REFERENCES %profiles(id) ON DELETE SET NULL%'
   from pg_catalog.pg_constraint c
   where c.conrelid = 'public.challenges'::regclass and c.contype = 'f'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%(cancelled_by)%'),
  'challenges.cancelled_by references profiles (on delete set null)'
);
select ok(
  (select pg_catalog.pg_get_constraintdef(c.oid) like '%FOREIGN KEY (cancelled_by) REFERENCES %profiles(id) ON DELETE SET NULL%'
   from pg_catalog.pg_constraint c
   where c.conrelid = 'public.freeze_requests'::regclass and c.contype = 'f'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%(cancelled_by)%'),
  'freeze_requests.cancelled_by references profiles (on delete set null)'
);
select ok(
  (select bool_and(not a.attnotnull) from pg_catalog.pg_attribute a
   where a.attname = 'cancelled_by'
     and a.attrelid in ('public.challenges'::regclass, 'public.freeze_requests'::regclass)),
  'both cancelled_by columns are nullable'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig) and p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('private.end_membership(uuid, text)'::regprocedure,
                   'private.checkin_subject(uuid)'::regprocedure,
                   'private.commitment_subject(uuid)'::regprocedure,
                   'private.freeze_session_day(uuid)'::regprocedure)),
  'end_membership and the new helpers are security definer with an empty search_path'
);
select is(
  (select pg_catalog.count(*)::integer from information_schema.columns
   where table_schema = 'public' and table_name = 'feed_items'),
  28,
  'feed_items keeps its 28 columns'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_function_privilege('authenticated', 'private.checkin_subject(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.commitment_subject(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.freeze_session_day(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.checkin_subject(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.commitment_subject(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.freeze_session_day(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'private.checkin_subject(uuid)', 'EXECUTE'),
  'the feed helpers serve feed_items to authenticated only'
);
select ok(
  not has_function_privilege('authenticated', 'private.end_membership(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.end_membership(uuid, text)', 'EXECUTE')
  and not has_function_privilege('public', 'private.end_membership(uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.close_vote(uuid)', 'EXECUTE'),
  'end_membership and close_vote stay closed to clients'
);
select ok(
  has_table_privilege('authenticated', 'public.feed_items', 'SELECT')
  and not has_table_privilege('anon', 'public.feed_items', 'SELECT')
  and not has_table_privilege('authenticated', 'public.challenges', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.freeze_requests', 'UPDATE'),
  'feed_items: authenticated may read; no client writes on challenges or freeze_requests'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('dan');
select public.save_profile('Dan', 'Europe/London');
select tests.authenticate_as('eve');
select public.save_profile('Eve', 'Europe/London');
select tests.authenticate_as('gina');
select public.save_profile('Gina', 'Europe/London');
select tests.authenticate_as('hank');
select public.save_profile('Hank', 'Europe/London');
select tests.authenticate_as('jill');
select public.save_profile('Jill', 'Europe/London');
select tests.authenticate_as('kim');
select public.save_profile('Kim', 'Europe/London');
select tests.authenticate_as('lee');
select public.save_profile('Lee', 'Europe/London');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'Europe/London');
select tests.authenticate_as('fay');
select public.save_profile('Fay', 'Europe/London');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('dan');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('eve');
select public.join_group(current_setting('test.code1'));

select tests.authenticate_as('gina');
select pg_catalog.set_config('test.g2', public.create_group('Pack')::text, true);
select pg_catalog.set_config('test.code2', (select code from public.create_invite(current_setting('test.g2')::uuid, false)), true);
select tests.authenticate_as('hank');
select public.join_group(current_setting('test.code2'));
select tests.authenticate_as('jill');
select public.join_group(current_setting('test.code2'));
select tests.authenticate_as('kim');
select public.join_group(current_setting('test.code2'));
select tests.authenticate_as('lee');
select public.join_group(current_setting('test.code2'));

select tests.authenticate_as('erin');
select pg_catalog.set_config('test.g3', public.create_group('Duo')::text, true);
select pg_catalog.set_config('test.code3', (select code from public.create_invite(current_setting('test.g3')::uuid, false)), true);
select tests.authenticate_as('fay');
select public.join_group(current_setting('test.code3'));

-- ===== Frozen clock and test helpers (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00';

alter function private.end_membership(uuid, text) set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.create_challenge(uuid) set search_path = test_overrides, pg_catalog;
alter function public.request_freeze(uuid, text, uuid, date) set search_path = test_overrides, pg_catalog;
alter function public.cast_vote(text, uuid, text) set search_path = test_overrides, pg_catalog;
alter function public.undo_vote(text, uuid) set search_path = test_overrides, pg_catalog;
alter function public.vote_tallies(uuid) set search_path = test_overrides, pg_catalog;
alter function private.close_vote(uuid) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.tick_step_3_close_votes() set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.checkin_challenge_until(uuid, timestamptz) set search_path = test_overrides, pg_catalog;

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

-- A fixed-days commitment with one version, written directly. p_group is a setting name.
create function pg_temp.add_plan(p_user text, p_group text, p_preset text, p_days smallint[])
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
  values (v_id, v_group, '2026-11-16', p_days, null);
  return v_id;
end;
$$;

-- The session id of a commitment (setting name) in week 16 Nov, by slot.
create function pg_temp.sid(p_commitment text, p_slot integer)
returns uuid
language sql
security definer
as $$
  select s.id from public.sessions s
  where s.commitment_id = current_setting('test.' || p_commitment)::uuid
    and s.week_start = '2026-11-16' and s.slot = p_slot;
$$;

-- The status of that session (private.session_status, as the table owner).
create function pg_temp.st(p_commitment text, p_slot integer)
returns text
language sql
security definer
as $$
  select private.session_status(s) from public.sessions s
  where s.id = pg_temp.sid(p_commitment, p_slot);
$$;

-- A check-in (setting name p_id) received Mon 16 Nov 07:00, written directly. Session by slot
-- (null = extra).
create function pg_temp.checkin(p_id text, p_commitment text, p_slot integer)
returns void
language sql
as $$
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select current_setting('test.' || p_id)::uuid, c.group_id, c.user_id, c.id,
         (select s.id from public.sessions s
          where s.commitment_id = c.id and s.week_start = '2026-11-16' and s.slot = p_slot),
         '2026-11-16 07:00:00+00', '2026-11-16 07:00:00+00', '2026-11-16 07:00:00+00', false
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid;
$$;

-- A challenge (setting name): status|cancel_reason|cancelled_by name|early_close_at (or '-').
create function pg_temp.chs(p_id text)
returns text
language sql
security definer
as $$
  select ch.status || '|' || coalesce(ch.cancel_reason, '-') || '|'
         || coalesce((select p.display_name from public.profiles p where p.id = ch.cancelled_by), '-')
         || '|' || coalesce(ch.early_close_at::text, '-')
  from public.challenges ch
  where ch.id = current_setting('test.' || p_id)::uuid;
$$;

-- A freeze request (setting name): status|cancel_reason|cancelled_by name|early_close_at (or '-').
create function pg_temp.frs(p_id text)
returns text
language sql
security definer
as $$
  select f.status || '|' || coalesce(f.cancel_reason, '-') || '|'
         || coalesce((select p.display_name from public.profiles p where p.id = f.cancelled_by), '-')
         || '|' || coalesce(f.early_close_at::text, '-')
  from public.freeze_requests f
  where f.id = current_setting('test.' || p_id)::uuid;
$$;

-- The ballots a user holds on a vote (setting name), as the table owner.
create function pg_temp.ballots(p_user text, p_id text)
returns integer
language sql
security definer
as $$
  select pg_catalog.count(*)::integer from public.votes v
  where v.voter_id = tests.get_supabase_uid(p_user)
    and current_setting('test.' || p_id)::uuid in (v.challenge_id, v.freeze_request_id);
$$;

-- The caller's tally for a vote (setting names): voted/eligible, or 'none'.
create function pg_temp.tally(p_group text, p_id text)
returns text
language sql
as $$
  select coalesce(
    (select t.voted_count || '/' || t.eligible_count
     from public.vote_tallies(current_setting('test.' || p_group)::uuid) t
     where t.target_id = current_setting('test.' || p_id)::uuid),
    'none');
$$;

-- The caller's feed_items row for a vote (setting name), as one text line, or 'none'.
create function pg_temp.card(p_id text)
returns text
language sql
as $$
  select coalesce(
    (select f.item_kind || '|' || f.actor_name || '|' || coalesce(f.subject_name, '-') || '|'
            || coalesce(f.commitment_kind, '-') || '|' || coalesce(f.activity_name, '-') || '|'
            || coalesce(f.preset_key, '-') || '|' || coalesce(f.payload ->> 'status', f.challenge_status) || '|'
            || coalesce(f.payload ->> 'cancel_reason', '-') || '|'
            || coalesce((select p.display_name from public.profiles p
                         where p.id = (f.payload ->> 'cancelled_by_id')::uuid), '-') || '|'
            || coalesce(f.payload ->> 'photo_visible', '-')
     from public.feed_items f
     where f.item_kind in ('challenge', 'freeze') and f.item_id = current_setting('test.' || p_id)::uuid),
    'none');
$$;

-- The freeze_result events of a request (setting name): outcome list.
create function pg_temp.results(p_id text)
returns text
language sql
security definer
as $$
  select coalesce(pg_catalog.string_agg(e.payload ->> 'outcome', ',' order by e.created_at), 'none')
  from public.feed_events e
  where e.kind = 'freeze_result' and e.payload ->> 'freeze_request_id' = current_setting('test.' || p_id);
$$;

-- The ruling event variant of a challenge (setting name).
create function pg_temp.ruling(p_id text)
returns text
language sql
security definer
as $$
  select coalesce(pg_catalog.string_agg((e.payload ->> 'outcome') || ':' || (e.payload ->> 'variant'), ','), 'none')
  from public.feed_events e
  where e.kind = 'ruling' and e.payload ->> 'challenge_id' = current_setting('test.' || p_id);
$$;

grant execute on function pg_temp.sid(text, integer), pg_temp.st(text, integer), pg_temp.chs(text),
  pg_temp.frs(text), pg_temp.ballots(text, text), pg_temp.tally(text, text), pg_temp.card(text),
  pg_temp.results(text), pg_temp.ruling(text) to authenticated;

select pg_catalog.set_config('test.gym', pg_temp.add_plan('bob', 'g1', 'gym', array[1, 3, 5]::smallint[])::text, true);
select pg_catalog.set_config('test.study', pg_temp.add_plan('bob', 'g1', 'study', array[1, 2, 3, 4, 5, 6, 7]::smallint[])::text, true);
select pg_catalog.set_config('test.dwalk', pg_temp.add_plan('dan', 'g1', 'walk', array[1, 2]::smallint[])::text, true);
select pg_catalog.set_config('test.jwalk', pg_temp.add_plan('jill', 'g2', 'walk', array[1, 2]::smallint[])::text, true);
select pg_catalog.set_config('test.jstudy', pg_temp.add_plan('jill', 'g2', 'study', array[1, 2, 3, 4, 5, 6, 7]::smallint[])::text, true);
select pg_catalog.set_config('test.kpaint', pg_temp.add_plan('kim', 'g2', 'paint', array[1]::smallint[])::text, true);
select pg_catalog.set_config('test.lrun', pg_temp.add_plan('lee', 'g2', 'run', array[1]::smallint[])::text, true);
select pg_catalog.set_config('test.erun', pg_temp.add_plan('erin', 'g3', 'run', array[1]::smallint[])::text, true);
select pg_catalog.set_config('test.fwalk', pg_temp.add_plan('fay', 'g3', 'walk', array[1, 2, 3, 4, 5, 6, 7]::smallint[])::text, true);

select tests.freeze_time('2026-11-16 00:30:00+00');
select private.tick_step_1_sessions();

select pg_catalog.set_config('test.b1', '00000000-0000-4000-a000-0000000056b1', true);
select pg_catalog.set_config('test.d1', '00000000-0000-4000-a000-0000000056d1', true);
select pg_catalog.set_config('test.j1', '00000000-0000-4000-a000-0000000056a1', true);
select pg_catalog.set_config('test.j2', '00000000-0000-4000-a000-0000000056a2', true);
select pg_catalog.set_config('test.k1', '00000000-0000-4000-a000-0000000056c1', true);
select pg_catalog.set_config('test.k2', '00000000-0000-4000-a000-0000000056c2', true);
select pg_catalog.set_config('test.l1', '00000000-0000-4000-a000-0000000056e1', true);
select pg_catalog.set_config('test.e1', '00000000-0000-4000-a000-0000000056f1', true);
select pg_temp.checkin('b1', 'gym', 1);
select pg_temp.checkin('d1', 'dwalk', 1);
select pg_temp.checkin('j1', 'jwalk', 1);
select pg_temp.checkin('j2', 'jwalk', null);
select pg_temp.checkin('k1', 'kpaint', 1);
select pg_temp.checkin('k2', 'kpaint', null);
select pg_temp.checkin('l1', 'lrun', 1);
select pg_temp.checkin('e1', 'erun', 1);

-- ===== Crew, 08:00: ch0 on dan's Walk, voted by bob, carol and eve, closed =====
select tests.freeze_time('2026-11-16 08:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.ch0', (select r.challenge_id::text from public.create_challenge(current_setting('test.d1')::uuid) r), true);
select tests.freeze_time('2026-11-16 08:01:00+00');
select tests.authenticate_as('bob');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch0')), 'bob votes on ch0');
select tests.authenticate_as('carol');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch0')), 'carol votes on ch0');
select tests.authenticate_as('eve');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch0')), 'eve votes on ch0');
reset role;
select tests.freeze_time('2026-11-16 08:02:00+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 closes ch0');
select is(split_part(pg_temp.chs('ch0'), '|', 1), 'real', 'ch0 is closed (2 doesn''t count, 2 counts: a tie keeps it)');

-- ===== Crew, 09:00: ch1 on bob's Gym (alice) and bob's freeze fr1 on Study Mon =====
-- ch1 eligible: carol, dan, eve. fr1 eligible: alice, carol, dan, eve.
select tests.freeze_time('2026-11-16 09:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.ch1', (select r.challenge_id::text from public.create_challenge(current_setting('test.b1')::uuid) r), true);
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.fr1', (select r.freeze_request_id::text from public.request_freeze(
  current_setting('test.study')::uuid, 'flu, in bed', pg_temp.sid('study', 1), null) r), true);
select tests.freeze_time('2026-11-16 09:01:00+00');
select tests.authenticate_as('carol');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch1')), 'carol votes on ch1');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.fr1')), 'carol approves fr1');
select tests.freeze_time('2026-11-16 09:03:00+00');
select tests.authenticate_as('eve');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch1')), 'eve votes on ch1');
select tests.authenticate_as('alice');
select is(pg_temp.tally('g1', 'ch1'), '2/4', 'ch1 tally before anyone leaves: the challenger and carol of 4 (eve''s ballot is still in its undo window)');
select is(pg_temp.tally('g1', 'fr1'), '1/4', 'fr1 tally before anyone leaves: carol of 4');

-- ===== Leave as a voter (carol, 09:10) =====
select tests.freeze_time('2026-11-16 09:10:00+00');
select tests.authenticate_as('carol');
select lives_ok(format('select public.leave_group(%L)', current_setting('test.g1')), 'carol leaves Crew');
select is(pg_temp.ballots('carol', 'ch1') || ',' || pg_temp.ballots('carol', 'fr1'), '0,0',
  'carol''s ballots on the open challenge and the pending freeze are deleted');
select is(pg_temp.ballots('carol', 'ch0'), 1, 'carol''s ballot on the closed ch0 stays (Fair Judge)');
select is(pg_temp.chs('ch1') || ',' || pg_temp.frs('fr1'), 'open|-|-|-,pending|-|-|-',
  'neither vote is all-voted (dan has no ballot): both stay open with no early close');
select tests.authenticate_as('alice');
select is(pg_temp.tally('g1', 'ch1'), '2/3', 'ch1 recounts without carol: the challenger and eve of 3');
select is(pg_temp.tally('g1', 'fr1'), '0/3', 'fr1 recounts without carol: none of 3');

-- ===== Rejoin (carol, 09:20): not eligible, the old ballot stays gone =====
select tests.freeze_time('2026-11-16 09:20:00+00');
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code1'));
select throws_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.ch1')),
  'P0001', 'not_eligible', 'rejoined carol cannot vote on ch1: not_eligible');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.fr1')),
  'P0001', 'not_eligible', 'rejoined carol cannot vote on fr1: not_eligible');
select is(pg_temp.ballots('carol', 'ch1') || ',' || pg_temp.ballots('carol', 'fr1'), '0,0',
  'carol''s old ballots stay deleted after the rejoin');
select tests.authenticate_as('alice');
select is(pg_temp.tally('g1', 'ch1'), '2/3', 'the rejoin does not change ch1''s tally');

-- ===== dan votes (09:25); removing eve (a voter) leaves dan as the only eligible voter =====
select tests.freeze_time('2026-11-16 09:25:00+00');
select tests.authenticate_as('dan');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.ch1')), 'dan votes on ch1');
select is(pg_temp.chs('ch1'), 'open|-|-|2026-11-16 09:25:06+00', 'all voted: early_close_at = dan''s cast_at + 6 s');
select tests.freeze_time('2026-11-16 09:30:00+00');
select tests.authenticate_as('alice');
select lives_ok(format('select public.remove_member(%L, %L)', current_setting('test.g1'), tests.get_supabase_uid('eve')),
  'alice removes eve (a voter on ch1)');
select is(pg_temp.ballots('eve', 'ch1'), 0, 'eve''s ballot on ch1 is deleted');
select is(pg_temp.chs('ch1'), 'real|-|-|2026-11-16 09:30:00+00',
  'every remaining ballot is final: ch1 closes at once (1 doesn''t count with the challenger, 1 counts: a tie keeps it)');
select is(pg_temp.ruling('ch1'), 'real:normal', 'ch1 wrote its ruling event');
select is((select pg_catalog.count(*)::integer from public.votes v where v.voter_id = tests.get_supabase_uid('eve')), 0,
  'a removed member''s ballots are unreadable to others');
select tests.authenticate_as('eve');
select is((select pg_catalog.count(*)::integer from public.votes v
           where v.challenge_id = current_setting('test.ch0')::uuid), 1,
  'eve still reads her own ballot on the closed ch0');

-- ===== Last non-voter leaves (dan, 09:40:03) after alice's ballot on fr1 (09:40:00) =====
select tests.freeze_time('2026-11-16 09:40:00+00');
select tests.authenticate_as('alice');
select is(pg_temp.tally('g1', 'fr1'), '0/2', 'fr1 eligible: alice and dan');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.fr1')), 'alice approves fr1');
select tests.freeze_time('2026-11-16 09:40:03+00');
select tests.authenticate_as('dan');
select lives_ok(format('select public.leave_group(%L)', current_setting('test.g1')), 'dan (no ballot on fr1) leaves');
select is(pg_temp.frs('fr1'), 'pending|-|-|2026-11-16 09:40:06+00',
  'all remaining voters voted: early_close_at = alice''s cast_at + 6 s, still pending');
select is(pg_temp.ballots('dan', 'ch1'), 1, 'dan''s ballot on the closed ch1 stays');
select tests.authenticate_as('alice');
select is(pg_temp.card('ch0'), 'none', 'a closed challenge whose check-in owner left stays out of the Feed');
reset role;
select tests.freeze_time('2026-11-16 09:40:05+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs one second before early_close_at');
select is(split_part(pg_temp.frs('fr1'), '|', 1), 'pending', 'fr1 still pending');
select tests.freeze_time('2026-11-16 09:40:06+00');
select is(private.tick_step_3_close_votes(), null, 'tick step 3 runs at early_close_at');
select is(split_part(pg_temp.frs('fr1'), '|', 1) || '|' || pg_temp.results('fr1'), 'approved|approved',
  'fr1 approved with alice''s ballot');

-- ===== Pack, 10:00: five open votes =====
-- chA hank questions jill's Walk (eligible gina, kim, lee); chB gina questions kim's Paint
-- (eligible hank, jill, lee); chC kim questions lee's Run (eligible gina, hank, jill); chD jill
-- questions kim's extra Paint (eligible gina, hank, lee); chE kim questions jill's extra Walk
-- (eligible gina, hank, lee); frJ jill's freeze on Study Mon (eligible gina, hank, kim, lee).
select tests.freeze_time('2026-11-16 10:00:00+00');
select tests.authenticate_as('hank');
select pg_catalog.set_config('test.chA', (select r.challenge_id::text from public.create_challenge(current_setting('test.j1')::uuid) r), true);
select tests.authenticate_as('gina');
select pg_catalog.set_config('test.chB', (select r.challenge_id::text from public.create_challenge(current_setting('test.k1')::uuid) r), true);
select tests.authenticate_as('kim');
select pg_catalog.set_config('test.chC', (select r.challenge_id::text from public.create_challenge(current_setting('test.l1')::uuid) r), true);
select pg_catalog.set_config('test.chE', (select r.challenge_id::text from public.create_challenge(current_setting('test.j2')::uuid) r), true);
select tests.authenticate_as('jill');
select pg_catalog.set_config('test.chD', (select r.challenge_id::text from public.create_challenge(current_setting('test.k2')::uuid) r), true);
select pg_catalog.set_config('test.frJ', (select r.freeze_request_id::text from public.request_freeze(
  current_setting('test.jstudy')::uuid, 'away', pg_temp.sid('jstudy', 1), null) r), true);

select tests.freeze_time('2026-11-16 10:01:00+00');
select tests.authenticate_as('gina');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.chA')), 'gina votes on chA');
select lives_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.frJ')), 'gina approves frJ');
select tests.authenticate_as('lee');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''real'')', current_setting('test.chB')), 'lee votes on chB');
select tests.authenticate_as('jill');
select lives_ok(format('select * from public.cast_vote(''challenge'', %L, ''fake'')', current_setting('test.chC')), 'jill votes on chC');
select tests.authenticate_as('gina');
select is(pg_temp.card('chB'), 'challenge|Gina|Kim|commitment|Paint|paint|open|-|-|true',
  'an open challenge card: the owner''s photo visible, nobody cancelled it');

-- ===== Leave as a challenger (hank, 10:05) =====
select tests.freeze_time('2026-11-16 10:05:00+00');
select tests.authenticate_as('gina');
select is(pg_temp.tally('g2', 'chB'), '2/4', 'chB before hank leaves: the challenger and lee of 4');
select tests.authenticate_as('hank');
select lives_ok(format('select public.leave_group(%L)', current_setting('test.g2')), 'hank leaves Pack');
select is(pg_temp.chs('chA'), 'cancelled|left|Hank|-', 'chA (hank questioned it) is cancelled: left, by hank');
select tests.authenticate_as('gina');
select is((select (ch.closed_at = '2026-11-16 10:05:00+00')::text || '|' || coalesce(ch.fake_count::text, '-')
           from public.challenges ch where ch.id = current_setting('test.chA')::uuid),
  'true|-', 'chA closed_at = now(), no counts');
select is(pg_temp.ruling('chA'), 'none', 'a cancelled challenge writes no ruling event');
select is(pg_temp.ballots('gina', 'chA'), 1, 'gina''s ballot on the cancelled chA stays');
select is(pg_temp.tally('g2', 'chB'), '2/3', 'chB recounts without hank: the challenger and lee of 3');
select is(pg_temp.card('chA'), 'challenge|Hank|Jill|commitment|Walk|walk|cancelled|left|Hank|true',
  'chA card: cancelled, left, cancelled_by hank, jill''s photo still visible');

-- ===== Leave as the check-in owner and a voter (lee, 10:06) =====
select tests.freeze_time('2026-11-16 10:06:00+00');
select tests.authenticate_as('lee');
select lives_ok(format('select public.leave_group(%L)', current_setting('test.g2')), 'lee leaves Pack');
select is(pg_temp.chs('chC'), 'cancelled|left|Lee|-', 'chC (lee''s check-in) is cancelled: left, by lee');
select is(pg_temp.ballots('lee', 'chB'), 0, 'lee''s final ballot on the open chB is deleted');
select is(pg_temp.ballots('jill', 'chC'), 1, 'jill''s ballot on the cancelled chC stays');
select is(pg_temp.chs('chB') || ',' || pg_temp.chs('chD') || ',' || pg_temp.chs('chE') || ',' || pg_temp.frs('frJ'),
  'open|-|-|-,open|-|-|-,open|-|-|-,pending|-|-|-',
  'chB (jill missing), chD and chE (gina missing) and frJ (kim missing) stay open');
select tests.authenticate_as('gina');
select is(pg_temp.tally('g2', 'chB'), '1/2', 'chB recounts without lee: the challenger of 2');
select is(pg_temp.card('chC'), 'challenge|Kim|Lee|commitment|Run|run|cancelled|left|Lee|false',
  'owner left: the chC card stays with its habit, photo_visible false');
select is(
  (select (f.commitment_id::text = current_setting('test.lrun'))::text || '|'
          || (f.captured_at = '2026-11-16 07:00:00+00')::text || '|'
          || (f.received_at = '2026-11-16 07:00:00+00')::text || '|'
          || (f.payload ->> 'checkin_id' = current_setting('test.l1'))::text || '|'
          || (f.payload ->> 'cancelled_by_id' = tests.get_supabase_uid('lee')::text)::text
   from public.feed_items f
   where f.item_kind = 'challenge' and f.item_id = current_setting('test.chC')::uuid),
  'true|true|true|true|true',
  'owner left: the chC row keeps the commitment, check-in times, check-in id and cancelled_by_id'
);
select is((select pg_catalog.count(*)::integer from public.checkins c where c.id = current_setting('test.l1')::uuid), 0,
  'control: lee''s check-in itself is no longer readable');
select tests.authenticate_as('lee');
select is(pg_temp.card('chC'), 'none', 'the leaver no longer reads the group''s cards');

-- ===== Remove as challenger, owner, requester and voter (jill, 10:10) =====
select tests.freeze_time('2026-11-16 10:10:00+00');
select tests.authenticate_as('gina');
select lives_ok(format('select public.remove_member(%L, %L)', current_setting('test.g2'), tests.get_supabase_uid('jill')),
  'gina removes jill');
select is(pg_temp.chs('chD'), 'cancelled|removed|Jill|-', 'chD (jill questioned it) is cancelled: removed, by jill');
select is(pg_temp.chs('chE'), 'cancelled|removed|Jill|-', 'chE (jill''s check-in) is cancelled: removed, by jill');
select is(pg_temp.frs('frJ'), 'cancelled|removed|Jill|-', 'frJ (jill''s request) is cancelled: removed, by jill');
select is((select (f.closed_at = '2026-11-16 10:10:00+00')::text from public.freeze_requests f
           where f.id = current_setting('test.frJ')::uuid), 'true', 'frJ closed_at = now()');
select is(pg_temp.results('frJ'), 'none', 'a cancelled freeze writes no freeze_result event');
select is(pg_temp.ballots('gina', 'frJ'), 1, 'gina''s ballot on the cancelled frJ stays');
select is(pg_temp.chs('chB'), 'fake|-|-|2026-11-16 10:10:00+00',
  'chB has no eligible voter left: closed at once, the challenge alone rules it doesn''t count');
select is(pg_temp.ruling('chB'), 'fake:lone', 'chB''s ruling is lone');
select is(pg_temp.card('chE'), 'challenge|Kim|Jill|commitment|Walk|walk|cancelled|removed|Jill|false',
  'removed owner: the chE card stays with its habit, photo_visible false');
select is(pg_temp.card('frJ'), 'freeze|Jill|-|commitment|Study|study|cancelled|removed|Jill|-',
  'cancelled freeze card: the requester''s habit keeps its title, cancel_reason removed, cancelled_by_id');
select is((select f.payload ->> 'session_day' from public.feed_items f
           where f.item_kind = 'freeze' and f.item_id = current_setting('test.frJ')::uuid),
  '2026-11-16', 'the cancelled freeze card keeps its day');
select tests.authenticate_as('jill');
select is((select pg_catalog.count(*)::integer from public.votes v
           where v.challenge_id = current_setting('test.chC')::uuid), 1,
  'jill still reads her own ballot after the removal');
select tests.authenticate_as('kim');
select is((select pg_catalog.count(*)::integer from public.votes v where v.voter_id = tests.get_supabase_uid('jill')), 0,
  'the removed member''s ballots are unreadable to others');

-- ===== Duo: drop to 1 approves the remaining member's freeze =====
select tests.freeze_time('2026-11-16 11:00:00+00');
select tests.authenticate_as('fay');
select pg_catalog.set_config('test.frF', (select r.freeze_request_id::text from public.request_freeze(
  current_setting('test.fwalk')::uuid, 'sick', pg_temp.sid('fwalk', 1), null) r), true);
select is(split_part(pg_temp.frs('frF'), '|', 1), 'pending', 'fay''s request waits on erin');
select tests.freeze_time('2026-11-16 11:05:00+00');
select tests.authenticate_as('erin');
select lives_ok(format('select public.leave_group(%L)', current_setting('test.g3')), 'erin leaves Duo');
select is(pg_temp.frs('frF'), 'approved|-|-|2026-11-16 11:05:00+00',
  'fay alone: her pending freeze is approved at once');
select is(pg_temp.results('frF'), 'approved', 'a freeze_result event is written');
select is(pg_temp.st('fwalk', 1), 'frozen', 'the session is frozen');
select tests.authenticate_as('fay');
select throws_ok(format('select * from public.cast_vote(''freeze'', %L, ''approve'')', current_setting('test.frF')),
  'P0001', 'group_waiting', 'cast_vote in a group of one: group_waiting');
select throws_ok(format('select * from public.create_challenge(%L)', current_setting('test.e1')),
  'P0001', 'group_waiting', 'create_challenge in a group of one: group_waiting');
select is(
  (select r.status from public.request_freeze(current_setting('test.fwalk')::uuid, 'still sick', pg_temp.sid('fwalk', 2), null) r),
  'approved', 'a new request_freeze in a group of one is approved at once'
);

select * from finish();
rollback;
