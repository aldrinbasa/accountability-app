-- Week lock and frozen results (Story 4.4): the result tables (columns, unique keys, RLS, grants),
-- tick step 5 private.lock_due_weeks() in its slot, the lock itself (not one second before
-- lock_at, a DST week, catch-up of two overdue weeks in one run, idempotent re-runs), who gets a
-- row (left before lock excluded, left after included, joined after excluded, an unscored member
-- with null points), ranks and winners (tied on points but split by sessions: both win; all at 0:
-- nobody), a group of one (2026-11-20 decision: scored, not ranked, its points kept, no winner), a
-- late check-in received just before lock_at counted and one after rejected, a locked week
-- unchanged by later check-ins, the streak functions equal before and after the stored rows exist
-- (and reading them, and resetting after a later miss), private.all_time_points, get_board reading
-- a locked week (an anonymized row skipped), a week with nobody current at its lock (scored = false),
-- and the tick: step 5 skipped after a failing step 1, a failing week recorded as step 5 with its
-- group's later week waiting while other groups lock.
--
-- Cast: alice (UTC) creates "Crew"; bob, carol, dave and erin join; dave leaves before P's lock,
-- erin after it (before the delayed tick); hank joins after it. frank is alone in "Solo". gus
-- creates "Zeroes", ivy joins. jill is alone in "Eastern" (America/New_York). kim is in no group.
-- Weeks: A = Mon 2 Nov 2026 (locks Thu 12 Nov 00:00 UTC), P = Mon 9 Nov (locks Thu 19 Nov), W = Mon
-- 16 Nov. Plans, sessions and check-ins are written directly as the table owner; post_checkin's
-- photos are put in Storage as service_role. The routines that read the clock get their
-- search_path pointed at test_overrides so tests.freeze_time moves it.
begin;
set local timezone = 'UTC';
select plan(62);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('frank');
select tests.create_supabase_user('gus');
select tests.create_supabase_user('hank');
select tests.create_supabase_user('ivy');
select tests.create_supabase_user('jill');
select tests.create_supabase_user('kim');

-- ===== Shape, RLS and grants (AD-3, AD-16) =====
select columns_are('public', 'week_results',
  array['id', 'group_id', 'membership_id', 'user_id', 'week_start', 'weekly_points', 'sessions_done',
        'sessions_planned', 'sessions_frozen', 'rank', 'created_at', 'updated_at'],
  'week_results has the story''s columns');
select columns_are('public', 'week_commitment_results',
  array['id', 'group_id', 'commitment_id', 'membership_id', 'week_start', 'planned', 'done', 'frozen',
        'target_met', 'streak_after', 'created_at', 'updated_at'],
  'week_commitment_results has the story''s columns');
select columns_are('public', 'group_week_results',
  array['id', 'group_id', 'week_start', 'scored', 'ranked', 'goal_target', 'goal_period',
        'goal_average', 'goal_hit', 'winner_user_ids', 'created_at', 'updated_at'],
  'group_week_results has the story''s columns plus ranked');
select has_column('public', 'group_weeks', 'locked_at', 'group_weeks has the locked_at marker');
select ok(
  (select bool_and(i.indisunique)
   from pg_catalog.pg_index i
   where i.indexrelid in ('public.week_results_one_per_membership_week'::regclass,
                          'public.week_commitment_results_one_per_commitment_week'::regclass,
                          'public.group_week_results_one_per_group_week'::regclass))
  and (select pg_catalog.count(*) = 3 from pg_catalog.pg_index i
       where i.indexrelid in ('public.week_results_one_per_membership_week'::regclass,
                              'public.week_commitment_results_one_per_commitment_week'::regclass,
                              'public.group_week_results_one_per_group_week'::regclass)),
  'unique keys: (membership_id, week_start), (commitment_id, week_start), (group_id, week_start)'
);
select ok(
  (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('public.week_results'::regclass, 'public.week_commitment_results'::regclass,
                   'public.group_week_results'::regclass))
  and (select pg_catalog.count(*) = 3 from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename in ('week_results', 'week_commitment_results', 'group_week_results')
         and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[])
  and (select pg_catalog.count(*) = 3 from pg_catalog.pg_policies p
       where p.schemaname = 'public'
         and p.tablename in ('week_results', 'week_commitment_results', 'group_week_results')),
  'the result tables have RLS with one SELECT policy each for authenticated and nothing else'
);
select ok(
  (select bool_and(has_table_privilege('authenticated', t.tbl, 'SELECT')
                   and not has_table_privilege('authenticated', t.tbl, 'INSERT, UPDATE, DELETE, TRUNCATE')
                   and not has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'))
   from (values ('public.week_results'), ('public.week_commitment_results'),
                ('public.group_week_results')) t(tbl)),
  'grants: authenticated SELECT only on the result tables; anon nothing'
);
select ok(
  (select bool_and(not has_function_privilege(r.role, f.fn, 'EXECUTE'))
   from (values ('public'), ('anon'), ('authenticated')) r(role)
   cross join (values ('private.lock_due_weeks()'), ('private.lock_week(uuid, date)'),
                      ('private.week_ranking(uuid, date, timestamp with time zone)'),
                      ('private.all_time_points(uuid)'),
                      ('private.group_current_week(uuid, timestamp with time zone)'),
                      ('private.week_lock_at(uuid, date)')) f(fn)),
  'the lock and helper functions are not executable by PUBLIC, anon or authenticated'
);
select ok(
  (select bool_and(p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig))
   from pg_catalog.pg_proc p
   where p.oid in ('private.week_ranking(uuid, date, timestamp with time zone)'::regprocedure,
                   'private.all_time_points(uuid)'::regprocedure,
                   'private.streak_through_week(uuid, date)'::regprocedure,
                   'private.streak_back_to_zero(uuid)'::regprocedure,
                   'public.get_board(uuid, date)'::regprocedure)),
  'the AD-4 functions and get_board stay stable security definer with an empty search_path'
);
select ok(
  (select pg_catalog.strpos(p.prosrc, 'private.tick_step_4_misses()')
            < pg_catalog.strpos(p.prosrc, 'if not v_failed_before_lock then')
          and pg_catalog.strpos(p.prosrc, 'if not v_failed_before_lock then')
            < pg_catalog.strpos(p.prosrc, 'private.lock_due_weeks()')
          and pg_catalog.strpos(p.prosrc, 'private.lock_due_weeks()')
            < pg_catalog.strpos(p.prosrc, 'private.tick_step_8_heartbeat(')
   from pg_catalog.pg_proc p where p.oid = 'private.tick()'::regprocedure),
  'tick: step 5 calls lock_due_weeks after step 4, guarded by steps 1 to 4, before the heartbeat'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result('public.get_board(uuid, date)'::regprocedure),
    'user_id uuid, display_name text, avatar_path text, weekly_points integer, sessions_done integer, '
    || 'sessions_planned integer, sessions_frozen integer, rank integer, waiting boolean, miss_count integer, '
    || 'best_streak integer, plan jsonb, task_count integer, lock_at timestamp with time zone, '
    || 'is_current_week boolean, time_zone text, locked boolean'
  ) > 0,
  'get_board keeps every earlier column and adds locked'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select tests.authenticate_as('frank');
select public.save_profile('Frank', 'UTC');
select tests.authenticate_as('gus');
select public.save_profile('Gus', 'UTC');
select tests.authenticate_as('hank');
select public.save_profile('Hank', 'UTC');
select tests.authenticate_as('ivy');
select public.save_profile('Ivy', 'UTC');
select tests.authenticate_as('jill');
select public.save_profile('Jill', 'America/New_York');
select tests.authenticate_as('kim');
select public.save_profile('Kim', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('dave');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('frank');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);
select tests.authenticate_as('gus');
select pg_catalog.set_config('test.g3', public.create_group('Zeroes')::text, true);
select pg_catalog.set_config('test.code3', (select code from public.create_invite(current_setting('test.g3')::uuid, false)), true);
select tests.authenticate_as('ivy');
select public.join_group(current_setting('test.code3'));
select tests.authenticate_as('jill');
select pg_catalog.set_config('test.g4', public.create_group('Eastern')::text, true);

-- ===== Fixture (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00' where ended_at is null;
update public.groups set time_zone = 'America/New_York' where id = current_setting('test.g4')::uuid;

alter function private.lock_week(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.lock_due_weeks() set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function public.get_board(uuid, date) set search_path = test_overrides, pg_catalog;
alter function public.post_checkin(uuid, uuid, timestamptz, text) set search_path = test_overrides, pg_catalog;
select tests.freeze_time('2026-11-05 04:59:59+00');

-- A commitment (one version from 26 Oct) or, with p_kind 'task', a task named p_name; p_group is a
-- setting name (g1, g2, ...). Returns its id.
create function pg_temp.add_plan(
  p_user text, p_group text, p_preset text, p_days smallint[], p_target smallint,
  p_kind text default 'commitment', p_name text default null
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
  if p_kind = 'task' then
    insert into public.commitments
      (group_id, membership_id, user_id, kind, group_activity_id, name, deadline, deadline_day_starts_at)
    values (v_group, v_membership, v_uid, 'task', v_activity, p_name, '2026-11-15',
            '2026-11-15 00:00:00+00')
    returning id into v_id;
  else
    insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
    values (v_group, v_membership, v_uid, 'commitment', v_activity,
            case when p_days is null then 'times_per_week' else 'fixed_days' end)
    returning id into v_id;
    insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
    values (v_id, v_group, '2026-10-26', p_days, p_target);
  end if;
  return v_id;
end;
$$;

-- A UTC session of a commitment (setting name): a fixed day (slot = ISO weekday, one UTC day) or
-- a whole-week row (times per week slot 1..N, a task slot 0).
create function pg_temp.add_session(p_commitment text, p_week date, p_slot integer, p_day boolean)
returns uuid
language sql
as $$
  insert into public.sessions (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
  select c.group_id, c.membership_id, c.user_id, c.id, p_week, p_slot::smallint,
         case when p_day then (p_week + p_slot - 1)::timestamp at time zone 'UTC'
              else p_week::timestamp at time zone 'UTC' end,
         case when p_day then (p_week + p_slot)::timestamp at time zone 'UTC'
              else (p_week + 7)::timestamp at time zone 'UTC' end
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid
  returning id;
$$;

-- A counted check-in on a session.
create function pg_temp.check_in(p_session uuid)
returns void
language sql
as $$
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select pg_catalog.gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
         s.starts_at + interval '1 hour', s.starts_at + interval '1 hour',
         s.starts_at + interval '1 hour', false
  from public.sessions s
  where s.id = p_session;
$$;

create function pg_temp.through(p_commitment text, p_week date)
returns integer
language sql
as $$
  select private.streak_through_week(current_setting('test.' || p_commitment)::uuid, p_week);
$$;

-- Every streak value the fixture checks, as one text.
create function pg_temp.streak_values()
returns text
language sql
as $$
  select pg_catalog.string_agg(x.v, ' ' order by x.n)
  from (values
    (1, 'gymA=' || pg_temp.through('gym', '2026-11-02')),
    (2, 'gymP=' || pg_temp.through('gym', '2026-11-09')),
    (3, 'gymW=' || pg_temp.through('gym', '2026-11-16')),
    (4, 'gymNow=' || private.current_streak(current_setting('test.gym')::uuid)),
    (5, 'runA=' || pg_temp.through('run', '2026-11-02')),
    (6, 'runP=' || pg_temp.through('run', '2026-11-09')),
    (7, 'runNow=' || private.current_streak(current_setting('test.run')::uuid)),
    (8, 'bikeP=' || pg_temp.through('bike', '2026-11-09')),
    (9, 'bikeNow=' || private.current_streak(current_setting('test.bike')::uuid)),
    (10, 'b0gym=' || private.streak_back_to_zero(current_setting('test.gym')::uuid)),
    (11, 'b0run=' || private.streak_back_to_zero(current_setting('test.run')::uuid)),
    (12, 'b0bike=' || private.streak_back_to_zero(current_setting('test.bike')::uuid))
  ) x(n, v);
$$;

-- A member's stored row for a week, as text: points|rank|done/planned.
create function pg_temp.result(p_group text, p_week date, p_user text)
returns text
language sql
as $$
  select coalesce(wr.weekly_points::text, 'null') || '|' || coalesce(wr.rank::text, 'null') || '|'
         || wr.sessions_done || '/' || wr.sessions_planned
  from public.week_results wr
  where wr.group_id = current_setting('test.' || p_group)::uuid
    and wr.week_start = p_week
    and wr.user_id = tests.get_supabase_uid(p_user);
$$;

-- The week's names in its stored rows, by name.
create function pg_temp.names(p_group text, p_week date)
returns text
language sql
as $$
  select pg_catalog.string_agg(p.display_name, ',' order by p.display_name)
  from public.week_results wr
  join public.profiles p on p.id = wr.user_id
  where wr.group_id = current_setting('test.' || p_group)::uuid
    and wr.week_start = p_week;
$$;

-- The week's group row, as text: scored|ranked|winner names.
create function pg_temp.group_result(p_group text, p_week date)
returns text
language sql
as $$
  select gr.scored || '|' || gr.ranked || '|' || coalesce((
    select pg_catalog.string_agg(p.display_name, ',' order by p.display_name)
    from pg_catalog.unnest(gr.winner_user_ids) u
    join public.profiles p on p.id = u
  ), '')
  from public.group_week_results gr
  where gr.group_id = current_setting('test.' || p_group)::uuid
    and gr.week_start = p_week;
$$;

create function pg_temp.is_locked(p_group text, p_week date)
returns boolean
language sql
as $$
  select gw.locked_at is not null
  from public.group_weeks gw
  where gw.group_id = current_setting('test.' || p_group)::uuid
    and gw.week_start = p_week;
$$;

-- ===== Lock edge and a DST week (jill, Eastern, week 26 Oct; clocks went back on Sun 1 Nov) =====
select private.ensure_group_week(current_setting('test.g4')::uuid, '2026-10-26');
select is(
  (select gw.lock_at from public.group_weeks gw
   where gw.group_id = current_setting('test.g4')::uuid and gw.week_start = '2026-10-26'),
  '2026-11-05 05:00:00+00'::timestamptz,
  'DST week: the lock is Thu 5 Nov 00:00 New York time, already EST (05:00 UTC)'
);
select is(private.lock_due_weeks(), null::text, 'one second before lock_at: the step runs clean');
select is(pg_temp.is_locked('g4', '2026-10-26'), false, 'one second before lock_at: not locked');
select tests.freeze_time('2026-11-05 05:00:00+00');
select is(private.lock_due_weeks(), null::text, 'at lock_at: the step runs clean');
select is(
  (select gw.locked_at from public.group_weeks gw
   where gw.group_id = current_setting('test.g4')::uuid and gw.week_start = '2026-10-26'),
  '2026-11-05 05:00:00+00'::timestamptz,
  'at lock_at (Thursday 00:00 group time): locked, locked_at = now()'
);
select is(pg_temp.group_result('g4', '2026-10-26'), 'true|false|',
  'a group of one: scored (its member''s row is kept), not ranked, no winner');
select is(pg_temp.result('g4', '2026-10-26', 'jill'), 'null|null|0/0',
  'the solo member without sessions: a row with null points and no rank');

-- ===== Plans for A, P and W =====
-- alice: Gym MWF and Run 2x. A: Gym Mon done, Wed missed, Fri done; Run 1 of 2 (60 points).
--   P: all done (100, 5 done). W: Gym Mon, Wed done, Fri open; Run 1 done, 1 open.
-- bob: a task in P, done (100, 1 done). carol: nothing. dave: a task in P, done (leaves before
-- the lock). erin: three tasks in P, one done, one by a late post, one missed (67).
-- frank (Solo): a task in P, done, and Bike 1x: A done, P missed (50). gus and ivy (Zeroes): a task
-- each in P, not done (0 and 0).
select pg_catalog.set_config('test.gym', pg_temp.add_plan('alice', 'g1', 'gym', array[1, 3, 5]::smallint[], null)::text, true);
select pg_catalog.set_config('test.run', pg_temp.add_plan('alice', 'g1', 'run', null, 2::smallint)::text, true);
select pg_catalog.set_config('test.bills', pg_temp.add_plan('bob', 'g1', 'groceries', null, null, 'task', 'Bills')::text, true);
select pg_catalog.set_config('test.dtask', pg_temp.add_plan('dave', 'g1', 'groceries', null, null, 'task', 'Errand')::text, true);
select pg_catalog.set_config('test.e1', pg_temp.add_plan('erin', 'g1', 'groceries', null, null, 'task', 'One')::text, true);
select pg_catalog.set_config('test.e2', pg_temp.add_plan('erin', 'g1', 'groceries', null, null, 'task', 'Two')::text, true);
select pg_catalog.set_config('test.e3', pg_temp.add_plan('erin', 'g1', 'groceries', null, null, 'task', 'Three')::text, true);
select pg_catalog.set_config('test.f1', pg_temp.add_plan('frank', 'g2', 'groceries', null, null, 'task', 'Forms')::text, true);
select pg_catalog.set_config('test.bike', pg_temp.add_plan('frank', 'g2', 'meditate', null, 1::smallint)::text, true);
select pg_catalog.set_config('test.gtask', pg_temp.add_plan('gus', 'g3', 'groceries', null, null, 'task', 'Gus job')::text, true);
select pg_catalog.set_config('test.itask', pg_temp.add_plan('ivy', 'g3', 'groceries', null, null, 'task', 'Ivy job')::text, true);

select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-02', 1, true));
select pg_temp.add_session('gym', '2026-11-02', 3, true);
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-02', 5, true));
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-02', 1, false));
select pg_temp.add_session('run', '2026-11-02', 2, false);
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 1, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 3, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 5, true));
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-09', 1, false));
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-09', 2, false));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 1, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 3, true));
select pg_temp.add_session('gym', '2026-11-16', 5, true);
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-16', 1, false));
select pg_temp.add_session('run', '2026-11-16', 2, false);
select pg_temp.check_in(pg_temp.add_session('bills', '2026-11-09', 0, false));
select pg_temp.check_in(pg_temp.add_session('dtask', '2026-11-09', 0, false));
select pg_temp.check_in(pg_temp.add_session('e1', '2026-11-09', 0, false));
select pg_temp.add_session('e2', '2026-11-09', 0, false);
select pg_temp.add_session('e3', '2026-11-09', 0, false);
select pg_temp.check_in(pg_temp.add_session('f1', '2026-11-09', 0, false));
select pg_temp.check_in(pg_temp.add_session('bike', '2026-11-02', 1, false));
select pg_temp.add_session('bike', '2026-11-09', 1, false);
select pg_catalog.set_config('test.gsession', pg_temp.add_session('gtask', '2026-11-09', 0, false)::text, true);
select pg_temp.add_session('itask', '2026-11-09', 0, false);

-- Photos for the two posts below.
select pg_catalog.set_config('test.p_erin', '00000000-0000-4000-a000-0000000044a1', true);
select pg_catalog.set_config('test.p_gus', '00000000-0000-4000-a000-0000000044a2', true);
set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.' || p.grp) || '/' || current_setting('test.' || p.id) || '/' || s.size || '.webp',
       tests.get_supabase_uid(p.owner)::text
from (values ('p_erin', 'erin', 'g1'), ('p_gus', 'gus', 'g3')) p(id, owner, grp)
cross join (values ('1080'), ('360')) s(size);
reset role;

-- ===== A late check-in received just before P's lock is counted =====
select tests.freeze_time('2026-11-18 23:59:30+00');
select tests.authenticate_as('erin');
select is(
  (select r.counted::text || '|' || r.is_late::text
   from public.post_checkin(current_setting('test.p_erin')::uuid, current_setting('test.e2')::uuid,
     '2026-11-15 12:00:00+00', null) r),
  'true|true',
  'a late check-in (taken Sunday) received 30 seconds before P''s lock is counted in P'
);

-- dave left before P's lock; erin leaves after it, before the delayed tick; hank joins after it.
reset role;
update public.memberships set ended_at = '2026-11-18 10:00:00+00', end_reason = 'left'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('dave');
update public.memberships set ended_at = '2026-11-19 03:00:00+00', end_reason = 'left'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('erin');
select tests.authenticate_as('hank');
select public.join_group(current_setting('test.code1'));
reset role;
update public.memberships set joined_at = '2026-11-19 04:00:00+00'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('hank');

-- The group weeks the tick would have written (A and P for Crew, P for Solo and Zeroes).
select private.ensure_group_week(current_setting('test.g1')::uuid, '2026-11-02');
select private.ensure_group_week(current_setting('test.g1')::uuid, '2026-11-09');
select private.ensure_group_week(current_setting('test.g2')::uuid, '2026-11-09');
select private.ensure_group_week(current_setting('test.g3')::uuid, '2026-11-09');

-- ===== A delayed tick (Thu 19 Nov 06:00): catch-up =====
select tests.freeze_time('2026-11-19 06:00:00+00');
create temp table streaks_before as select pg_temp.streak_values() as v;
select is(
  (select v from streaks_before),
  'gymA=1 gymP=4 gymW=6 gymNow=6 runA=0 runP=1 runNow=1 bikeP=0 bikeNow=0 b0gym=false b0run=false b0bike=true',
  'the streaks before any stored row (Story 4.2''s walk from the first session)'
);
select is(private.lock_due_weeks(), null::text, 'the delayed run locks every due week without an error');
select ok(
  pg_temp.is_locked('g1', '2026-11-02') and pg_temp.is_locked('g1', '2026-11-09')
  and pg_temp.is_locked('g2', '2026-11-09') and pg_temp.is_locked('g3', '2026-11-09'),
  'catch-up: both overdue Crew weeks (A and P) and the other groups'' P lock in one run'
);
select is(pg_temp.streak_values(), (select v from streaks_before),
  'the streak functions return the same values once stored rows exist');

-- ===== Who gets a row =====
select is(pg_temp.names('g1', '2026-11-09'), 'Alice,Bob,Carol,Erin',
  'P: dave (left before the lock) and hank (joined after it) get no row; erin (left after it) does');
select is(pg_temp.names('g1', '2026-11-02'), 'Alice,Bob,Carol,Dave,Erin',
  'A: dave and erin were both current at A''s lock');

-- ===== Points, ranks and winners =====
select is(pg_temp.result('g1', '2026-11-09', 'alice'), '100|1|5/5', 'P: alice 100, rank 1 (5 done)');
select is(pg_temp.result('g1', '2026-11-09', 'bob'), '100|2|1/1',
  'P: bob 100, rank 2 (same points, fewer sessions done)');
select is(pg_temp.result('g1', '2026-11-09', 'erin'), '67|3|2/3',
  'P: erin 2 of 3 = 67 (the late check-in counted), rank 3');
select is(pg_temp.result('g1', '2026-11-09', 'carol'), 'null|null|0/0',
  'P: carol, no sessions: a row with null points and no rank');
select is(pg_temp.group_result('g1', '2026-11-09'), 'true|true|Alice,Bob',
  'P: scored and ranked; tied on points but split by sessions, both are winners');
select is(pg_temp.result('g1', '2026-11-02', 'alice'), '60|1|3/5', 'A: alice 3 of 5 = 60, rank 1');
select is(pg_temp.group_result('g1', '2026-11-02'), 'true|true|Alice', 'A: alice wins alone');
select is(pg_temp.group_result('g3', '2026-11-09'), 'true|true|',
  'Zeroes: everyone on 0 points: ranked, no winner');
select is(pg_temp.result('g3', '2026-11-09', 'gus'), '0|1|0/1', 'Zeroes: gus 0, rank 1 (tied)');

-- ===== A group of one (2026-11-20 decision) =====
select is(pg_temp.group_result('g2', '2026-11-09'), 'true|false|',
  'Solo: scored, not ranked, no winner');
select is(pg_temp.result('g2', '2026-11-09', 'frank'), '50|null|1/2',
  'Solo: frank keeps his weekly points (1 of 2 = 50), rank null');

-- ===== Commitment rows =====
select is(
  (select pg_catalog.string_agg(r.planned || '/' || r.done || '/' || r.frozen || '/' || r.target_met
                                || '/' || coalesce(r.streak_after::text, 'null'), ' ' order by r.week_start, c.created_at)
   from public.week_commitment_results r
   join public.commitments c on c.id = r.commitment_id
   where r.commitment_id in (current_setting('test.gym')::uuid, current_setting('test.run')::uuid)),
  '3/2/0/false/1 2/1/0/false/0 3/3/0/true/4 2/2/0/true/1',
  'commitment rows: planned, done, frozen, target_met and streak_after for Gym and Run in A and P'
);
select is(
  (select pg_catalog.count(*)::text || '|' || pg_catalog.count(*) filter (where r.streak_after is null)
   from public.week_commitment_results r
   where r.group_id = current_setting('test.g1')::uuid and r.week_start = '2026-11-09'),
  '6|4',
  'P: a row per commitment or task with sessions of the members with a result (dave''s task left out); tasks have no streak'
);

-- ===== Re-runs are no-ops =====
select tests.freeze_time('2026-11-19 06:05:00+00');
select is(private.lock_due_weeks(), null::text, 're-run: clean');
select ok(
  (select pg_catalog.count(*) = 13 from public.week_results)
  and (select pg_catalog.count(*) = 5 from public.group_week_results)
  and (select bool_and(gw.locked_at = '2026-11-19 06:00:00+00'::timestamptz) from public.group_weeks gw
       where gw.week_start in ('2026-11-02', '2026-11-09')),
  're-run: no new rows and locked_at unchanged'
);
select is(private.lock_week(current_setting('test.g1')::uuid, '2026-11-09'), false,
  'lock_week on a locked week writes nothing and returns false');

-- ===== A check-in after the lock is rejected; the locked week does not change =====
select tests.freeze_time('2026-11-19 06:10:00+00');
select tests.authenticate_as('gus');
select throws_ok(
  format('select * from public.post_checkin(%L, %L, %L, null)', current_setting('test.p_gus'),
         current_setting('test.gtask'), '2026-11-15 12:00:00+00'),
  'P0001', 'week_locked', 'a late check-in for P received after its lock: week_locked'
);
reset role;
select is((select pg_catalog.count(*)::integer from public.checkins where id = current_setting('test.p_gus')::uuid),
  0, 'the rejected check-in left no row');
-- A check-in written straight into the locked week (no app path does this): live points move,
-- the stored result and get_board do not.
select pg_temp.check_in(current_setting('test.gsession')::uuid);
select is(
  (select private.weekly_points(m.id, '2026-11-09')::text || '|' || pg_temp.result('g3', '2026-11-09', 'gus')
   from public.memberships m
   where m.group_id = current_setting('test.g3')::uuid and m.user_id = tests.get_supabase_uid('gus')),
  '100|0|1|0/1',
  'after the lock, live points change but the stored result stays'
);

-- ===== get_board reads a locked week =====
select tests.authenticate_as('ivy');
select is(
  (select pg_catalog.string_agg(b.display_name || ':' || b.weekly_points || ':' || b.rank || ':' || b.locked, ' '
                                order by b.rank nulls last, b.display_name)
   from public.get_board(current_setting('test.g3')::uuid, '2026-11-09') b),
  'Gus:0:1:true Ivy:0:1:true',
  'get_board for a locked week: the stored points and ranks, locked = true'
);
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.string_agg(b.display_name || ':' || coalesce(b.weekly_points::text, 'null') || ':'
                                || coalesce(b.rank::text, 'null') || ':' || b.miss_count, ' '
                                order by b.rank nulls last, b.display_name)
   || '|' || pg_catalog.bool_and(b.locked) || '|' || pg_catalog.bool_or(b.waiting)
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-09') b),
  'Alice:100:1:0 Bob:100:2:0 Erin:67:3:1 Carol:null:null:0|true|false',
  'get_board for locked P: the stored rows (erin, who left after the lock, included), stored misses, not waiting'
);
select is(
  (select pg_catalog.bool_or(b.locked)::text || '|' || pg_catalog.count(*)
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b),
  'false|4',
  'get_board for unlocked W: live, locked = false, the current members (hank included)'
);
select tests.authenticate_as('frank');
select is(
  (select b.weekly_points || '|' || coalesce(b.rank::text, 'null') || '|' || b.waiting || '|' || b.locked
   from public.get_board(current_setting('test.g2')::uuid, '2026-11-09') b),
  '50|null|true|true',
  'get_board for a locked solo week: the points, no rank, waiting, locked'
);

-- ===== RLS =====
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.count(*)::text from public.week_results where group_id = current_setting('test.g1')::uuid)
  || '|' || (select pg_catalog.count(*) from public.week_commitment_results where group_id = current_setting('test.g1')::uuid)
  || '|' || (select pg_catalog.count(*) from public.group_week_results where group_id = current_setting('test.g1')::uuid)
  || '|' || (select pg_catalog.count(*) from public.week_results where group_id <> current_setting('test.g1')::uuid),
  '9|8|2|0',
  'a current member reads the group''s results (A 5 + P 4 members, 2 + 6 commitments, 2 weeks) and no other group''s'
);
select throws_ok(
  format('insert into public.week_results (group_id, membership_id, week_start, sessions_done, sessions_planned, sessions_frozen) '
         || 'select group_id, id, %L, 0, 0, 0 from public.memberships where user_id = auth.uid() limit 1', '2026-11-16'),
  '42501', null, 'a member cannot write results'
);
select tests.authenticate_as('erin');
select is(
  (select pg_catalog.count(*)::integer from public.week_results)
  + (select pg_catalog.count(*)::integer from public.week_commitment_results)
  + (select pg_catalog.count(*)::integer from public.group_week_results),
  0, 'a member who left reads no results'
);
select throws_ok(
  format('select * from public.get_board(%L, %L)', current_setting('test.g1'), '2026-11-09'),
  'P0001', 'not_member', 'get_board: not_member for a member who left'
);
select tests.authenticate_as('kim');
select is(
  (select pg_catalog.count(*)::integer from public.week_results)
  + (select pg_catalog.count(*)::integer from public.week_commitment_results)
  + (select pg_catalog.count(*)::integer from public.group_week_results),
  0, 'someone in no group reads no results'
);

-- ===== all_time_points =====
reset role;
select is(
  (select pg_catalog.string_agg(p.display_name || '=' || private.all_time_points(m.id), ' ' order by p.display_name)
   from public.memberships m
   join public.profiles p on p.id = m.user_id
   where m.user_id in (tests.get_supabase_uid('alice'), tests.get_supabase_uid('carol'),
                       tests.get_supabase_uid('frank'))),
  'Alice=160 Carol=0 Frank=50',
  'all_time_points: the sum of locked weekly points (A 60 + P 100), 0 with none, a solo member''s weeks included'
);

-- ===== The streak functions read the stored rows =====
update public.week_commitment_results set streak_after = 40
where commitment_id = current_setting('test.gym')::uuid and week_start = '2026-11-09';
select is(pg_temp.through('gym', '2026-11-16'), 42,
  'streak_through_week starts from P''s stored streak_after (40 here) and adds W''s two done sessions');

-- ===== A miss after the stored week resets the streak (the stored value is ignored) =====
-- Tue 24 Nov: W has ended unlocked: Gym's Fri was missed and Run met only 1 of 2.
select tests.freeze_time('2026-11-24 12:00:00+00');
select is(
  'gymW=' || pg_temp.through('gym', '2026-11-16') || ' runW=' || pg_temp.through('run', '2026-11-16')
  || ' gymNow=' || private.current_streak(current_setting('test.gym')::uuid)
  || ' b0gym=' || private.streak_back_to_zero(current_setting('test.gym')::uuid),
  'gymW=0 runW=0 gymNow=0 b0gym=true',
  'a miss (fixed days) or a broken week (times per week) after the stored week resets to 0, as Story 4.2'
);

-- ===== A week with nobody current at its lock: scored = false, no member rows =====
select tests.authenticate_as('kim');
select pg_catalog.set_config('test.g5', public.create_group('Late')::text, true);
reset role;
update public.memberships set joined_at = '2026-11-20 00:00:00+00'
where group_id = current_setting('test.g5')::uuid;
select private.ensure_group_week(current_setting('test.g5')::uuid, '2026-11-09');
select pg_catalog.set_config('test.g5_locked',
  private.lock_week(current_setting('test.g5')::uuid, '2026-11-09')::text, true);
select is(
  current_setting('test.g5_locked') || '|'
  || pg_temp.group_result('g5', '2026-11-09') || '|'
  || (select pg_catalog.count(*) from public.week_results where group_id = current_setting('test.g5')::uuid),
  'true|false|false||0',
  'nobody current at lock_at (kim joined after it): locked, scored = false, not ranked, no member rows'
);

-- ===== An anonymized row (Epic 7) is skipped by get_board =====
update public.week_results set user_id = null
where group_id = current_setting('test.g3')::uuid and week_start = '2026-11-09'
  and user_id = tests.get_supabase_uid('ivy');
select tests.authenticate_as('gus');
select is(
  (select pg_catalog.string_agg(b.display_name, ',') from public.get_board(current_setting('test.g3')::uuid, '2026-11-09') b),
  'Gus',
  'get_board for a locked week skips a row whose user_id was anonymized'
);
reset role;

-- ===== Through the tick: step 5 waits for steps 1 to 4, and a failing week =====
-- Thu 3 Dec 00:00:30: due are Solo's W, and Zeroes' W and 23 Nov. Steps 1, 2 and 4 are stubbed
-- (step 1 fails first); Zeroes' W group row fails by trigger (its 23 Nov week would succeed).
select tests.freeze_time('2026-12-03 00:00:30+00');
alter function private.tick() set search_path = test_overrides, pg_catalog;
select private.ensure_group_week(current_setting('test.g2')::uuid, '2026-11-16');
select private.ensure_group_week(current_setting('test.g3')::uuid, '2026-11-16');
select private.ensure_group_week(current_setting('test.g3')::uuid, '2026-11-23');
-- gus's task gets a W session, so the failing lock also writes a week_commitment_results row first.
select pg_temp.add_session('gtask', '2026-11-16', 0, false);
create or replace function private.tick_step_1_sessions() returns text language sql as $$ select 'step one broke'::text $$;
create or replace function private.tick_step_2_time_zones() returns text language sql as $$ select null::text $$;
create or replace function private.tick_step_4_misses() returns text language sql as $$ select null::text $$;
create function tests.fail_zeroes() returns trigger language plpgsql as $$
begin
  if new.group_id = current_setting('test.g3')::uuid and new.week_start = '2026-11-16' then
    raise exception 'zeroes broke';
  end if;
  return new;
end;
$$;
-- On the last insert, after week_results and week_commitment_results were written: the rollback
-- has to undo those.
create trigger group_week_results_fail_zeroes before insert on public.group_week_results
  for each row execute function tests.fail_zeroes();

-- Hold the tick's lock (a cron run would make private.tick() return at once); it is re-entrant.
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));
select private.tick();
select ok(
  not pg_temp.is_locked('g2', '2026-11-16')
  and (select h.last_error_step = 1 from public.heartbeat h),
  'tick: with step 1 failing, step 5 is skipped and a due week stays unlocked'
);
create or replace function private.tick_step_1_sessions() returns text language sql as $$ select null::text $$;
select private.tick();
select is(pg_temp.is_locked('g2', '2026-11-16'), true, 'tick: step 5 locks a due week once steps 1 to 4 pass');
select ok(
  (select h.last_error_step = 5
          and h.last_error = 'group ' || current_setting('test.g3') || ' week 2026-11-16: zeroes broke'
   from public.heartbeat h),
  'tick: a failing week is recorded as step 5, naming the group and the week'
);
select ok(
  not pg_temp.is_locked('g3', '2026-11-16') and not pg_temp.is_locked('g3', '2026-11-23')
  and not exists (select 1 from public.week_results r
                  where r.group_id = current_setting('test.g3')::uuid and r.week_start = '2026-11-16')
  and not exists (select 1 from public.week_commitment_results r
                  where r.group_id = current_setting('test.g3')::uuid and r.week_start = '2026-11-16')
  and not exists (select 1 from public.group_week_results r
                  where r.group_id = current_setting('test.g3')::uuid and r.week_start = '2026-11-16'),
  'the failing week''s earlier writes rolled back, and its group''s later week waits'
);

select * from finish();
rollback;
