-- Board podium (Story 4.3): public.get_board's new fields. miss_count counts the week's missed
-- sessions (a fixed day once it ends; a times-per-week row only once the member's week has ended),
-- best_streak is the highest current streak over the member's commitments, plan lists the
-- commitments with sessions that week (activity, schedule type, days or target of the version in
-- effect) and task_count the tasks; lock_at, is_current_week and time_zone repeat on every row.
-- A waiting group still returns its member's weekly points with rank null. not_member and grants
-- (AD-16) are kept.
--
-- Cast: alice (UTC) creates "Crew", bob (UTC) joins; carol is in no group; frank (Asia/Manila) is
-- alone in "Solo", a group in his zone. The clock is frozen at Fri 20 Nov 2026 12:00 UTC: week W = Mon 16 Nov (locks Thu 26 Nov),
-- the previous week P = Mon 9 Nov (locks Thu 19 Nov). Plans, sessions and check-ins are written
-- directly as the table owner. get_board, session_status, current_streak and commitment_is_active
-- call now() unqualified; their search_path is pointed at test_overrides so tests.freeze_time moves
-- their clock.
begin;
set local timezone = 'UTC';
select plan(14);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('frank');

-- ===== Shape and grants (AD-16) =====
select ok(
  (select p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig)
   from pg_catalog.pg_proc p
   where p.oid = 'public.get_board(uuid, date)'::regprocedure),
  'get_board stays stable security definer with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.get_board(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_board(uuid, date)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_board(uuid, date)', 'EXECUTE'),
  'get_board: authenticated only'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result('public.get_board(uuid, date)'::regprocedure),
    'rank integer, waiting boolean, miss_count integer, best_streak integer, plan jsonb, '
    || 'task_count integer, lock_at timestamp with time zone, is_current_week boolean, time_zone text'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_function_result('public.get_board(uuid, date)'::regprocedure),
    'user_id uuid, display_name text, avatar_path text, weekly_points integer'
  ) > 0,
  'get_board keeps every earlier column and adds the seven Board fields'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('frank');
select public.save_profile('Frank', 'Asia/Manila');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('frank');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);

-- ===== Fixture helpers (temporary, as the table owner) =====
reset role;
alter function public.get_board(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
select tests.freeze_time('2026-11-20 12:00:00+00');

-- A commitment (one version from 26 Oct) or, with p_kind 'task', a task; p_group is a setting
-- name (g1, g2). p_made orders the plan list (created_at).
create function pg_temp.add_plan(
  p_user text, p_group text, p_preset text, p_days smallint[], p_target smallint,
  p_made timestamptz, p_kind text default 'commitment'
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
      (group_id, membership_id, user_id, kind, group_activity_id, name, deadline, deadline_day_starts_at,
       created_at)
    values (v_group, v_membership, v_uid, 'task', v_activity, 'Tax forms', '2026-11-22',
            '2026-11-22 00:00:00+00', p_made)
    returning id into v_id;
  else
    insert into public.commitments
      (group_id, membership_id, user_id, kind, group_activity_id, schedule_type, created_at)
    values (v_group, v_membership, v_uid, 'commitment', v_activity,
            case when p_days is null then 'times_per_week' else 'fixed_days' end, p_made)
    returning id into v_id;
    insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
    values (v_id, v_group, '2026-10-26', p_days, p_target);
  end if;
  return v_id;
end;
$$;

-- A session of a commitment (setting name): a fixed day (slot = ISO weekday, one UTC day) or a
-- whole-week row (times per week slot 1..N, a task slot 0).
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
         s.starts_at + interval '9 hours', s.starts_at + interval '9 hours',
         s.starts_at + interval '9 hours', false
  from public.sessions s
  where s.id = p_session;
$$;

-- A member's row of get_board, as text, for the caller.
create function pg_temp.board_row(p_group text, p_week date, p_user text)
returns text
language sql
as $$
  select coalesce(b.weekly_points::text, 'null') || '|' || coalesce(b.rank::text, 'null') || '|'
         || b.miss_count || '|' || b.best_streak || '|' || b.task_count || '|' || b.plan::text
  from public.get_board(current_setting('test.' || p_group)::uuid, p_week) b
  where b.user_id = tests.get_supabase_uid(p_user);
$$;
-- Called as a member (get_board runs as the caller's auth.uid()).
grant execute on function pg_temp.board_row(text, date, text) to authenticated;

-- ===== Plans =====
-- alice: Gym Mon Wed Fri (Mon Wed from W), Read Tue, Walk 2 times per week, task Tax forms (W).
--   P: Gym Mon, Wed, Fri done; Walk 1 of 2 done (ended: 1 missed row).
--   W: Gym (now Mon Wed) Mon and Wed done; Read Tue missed; Walk 1 done, 1 open; task open.
--   Gym's streak: P's three + W's two = 5. Read: 0. Walk: P below target, W open = 0.
-- bob: task only (W), open: 0 points.
-- frank (Solo): task only (W), done: 100 points, unranked.
select pg_catalog.set_config('test.gym', pg_temp.add_plan('alice', 'g1', 'gym', array[1, 3, 5]::smallint[], null, '2026-10-20 10:00+00')::text, true);
-- Gym changes to Mon Wed from W (a second version): P shows MWF, W shows Mon Wed.
insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
values (current_setting('test.gym')::uuid, current_setting('test.g1')::uuid, '2026-11-16',
        array[1, 3]::smallint[], null);
select pg_catalog.set_config('test.read', pg_temp.add_plan('alice', 'g1', 'read', array[2]::smallint[], null, '2026-10-21 10:00+00')::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('alice', 'g1', 'walk', null, 2::smallint, '2026-10-22 10:00+00')::text, true);
select pg_catalog.set_config('test.tax', pg_temp.add_plan('alice', 'g1', 'groceries', null, null, '2026-10-23 10:00+00', 'task')::text, true);
select pg_catalog.set_config('test.btask', pg_temp.add_plan('bob', 'g1', 'groceries', null, null, '2026-10-24 10:00+00', 'task')::text, true);
select pg_catalog.set_config('test.ftask', pg_temp.add_plan('frank', 'g2', 'groceries', null, null, '2026-10-25 10:00+00', 'task')::text, true);

select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 1, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 3, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 5, true));
select pg_temp.check_in(pg_temp.add_session('walk', '2026-11-09', 1, false));
select pg_temp.add_session('walk', '2026-11-09', 2, false);

select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 1, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 3, true));
select pg_temp.add_session('read', '2026-11-16', 2, true);
select pg_temp.check_in(pg_temp.add_session('walk', '2026-11-16', 1, false));
select pg_temp.add_session('walk', '2026-11-16', 2, false);
select pg_temp.add_session('tax', '2026-11-16', 0, false);
select pg_temp.add_session('btask', '2026-11-16', 0, false);
select pg_temp.check_in(pg_temp.add_session('ftask', '2026-11-16', 0, false));

-- ===== Week W, Friday =====
select tests.authenticate_as('bob');
select is(
  pg_temp.board_row('g1', '2026-11-16', 'alice'),
  '50|1|1|5|1|[{"days": [1, 3], "target": null, "activity_name": "Gym", "schedule_type": "fixed_days"}, '
  || '{"days": [2], "target": null, "activity_name": "Read", "schedule_type": "fixed_days"}, '
  || '{"days": null, "target": 2, "activity_name": "Walk", "schedule_type": "times_per_week"}]',
  'W: alice 3 of 6 = 50, rank 1, 1 miss (Read Tue; Walk''s open week row not yet), best streak 5 (Gym), 1 task, plan in order made with Gym''s W version'
);
select is(
  pg_temp.board_row('g1', '2026-11-16', 'bob'),
  '0|2|0|0|1|[]',
  'W: bob 0 points, rank 2, no misses, no streak, 1 task, an empty plan list'
);
select is(
  (select pg_catalog.count(distinct b.lock_at::text || '|' || b.is_current_week || '|' || b.time_zone)::text
          || '|' || pg_catalog.min(b.lock_at::text || '|' || b.is_current_week || '|' || b.time_zone)
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b),
  '1|2026-11-26 00:00:00+00|true|UTC',
  'W: every row carries the same lock_at (Thu 26 Nov 00:00), is_current_week true and the group zone'
);

-- ===== Week P (the previous week) =====
select is(
  pg_temp.board_row('g1', '2026-11-09', 'alice'),
  '80|1|1|5|0|[{"days": [1, 3, 5], "target": null, "activity_name": "Gym", "schedule_type": "fixed_days"}, '
  || '{"days": null, "target": 2, "activity_name": "Walk", "schedule_type": "times_per_week"}]',
  'P: alice 4 of 5 = 80, 1 miss (Walk''s week ended below target), only the commitments with sessions in P (Gym''s first version), no task'
);
select is(
  (select b.lock_at::text || '|' || b.is_current_week || '|' || b.time_zone
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-09') b
   where b.user_id = tests.get_supabase_uid('alice')),
  '2026-11-19 00:00:00+00|false|UTC',
  'P: lock_at Thu 19 Nov 00:00, not the current week'
);

-- ===== Solo group =====
select tests.authenticate_as('frank');
select is(
  (select b.weekly_points::text || '|' || coalesce(b.rank::text, 'null') || '|' || b.waiting
          || '|' || b.task_count || '|' || b.lock_at::text || '|' || b.time_zone || '|' || b.is_current_week
   from public.get_board(current_setting('test.g2')::uuid, '2026-11-16') b),
  '100|null|true|1|2026-11-25 16:00:00+00|Asia/Manila|true',
  'a waiting group in Asia/Manila: the solo member''s points, rank null, waiting; the lock is Thu 00:00 Manila (Wed 16:00 UTC) and the zone is the group''s'
);

-- ===== not_member =====
select tests.authenticate_as('carol');
select throws_ok(
  format('select * from public.get_board(%L, %L)', current_setting('test.g1'), '2026-11-16'),
  'P0001', 'not_member', 'get_board: not_member for a non-member'
);

-- ===== Week W after it ended (Tue 24 Nov) =====
reset role;
select tests.freeze_time('2026-11-24 12:00:00+00');
select tests.authenticate_as('bob');
select is(
  (select b.miss_count::text || '|' || b.is_current_week
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b
   where b.user_id = tests.get_supabase_uid('alice')),
  '3|false',
  'W ended: Read Tue, Walk''s unmet row and the task are all misses now; W is no longer current'
);
select is(
  (select b.miss_count::text
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b
   where b.user_id = tests.get_supabase_uid('bob')),
  '1',
  'W ended: bob''s open task became a miss'
);
select is(
  (select b.best_streak::text
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b
   where b.user_id = tests.get_supabase_uid('alice')),
  '5',
  'W ended without a Gym miss: alice''s best streak stays 5'
);

-- ===== An ended commitment no longer feeds the flame =====
reset role;
select tests.freeze_time('2026-11-20 12:00:00+00');
update public.commitments set ends_after_week_start = '2026-11-09'
where id = current_setting('test.gym')::uuid;
select tests.authenticate_as('bob');
select is(
  (select b.best_streak::text
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b
   where b.user_id = tests.get_supabase_uid('alice')),
  '0',
  'best_streak skips a commitment that ended before the current week'
);

select * from finish();
rollback;
