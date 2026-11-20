-- Streaks (Story 4.2): private.streak_through_week, private.current_streak,
-- private.streak_back_to_zero and public.get_streaks. Fixed days: a run with a miss in the middle
-- resetting to 0, a frozen session skipped, today's open session not breaking, the week bound of
-- streak_through_week, a streak surviving a schedule change (two versions), a latest miss giving 0
-- ("back to 0") and a never-kept commitment (0, not "back to 0"). Times per week: target met,
-- missed (reset), a pro-rated week (fewer rows), a zero-session week (all rows frozen) neutral, the
-- current week neutral while open and adding once met. A task returns null. A DST-change week
-- counts sessions by their stored bounds. get_streaks: not_member, rows of current members only
-- (an ended membership excluded), grants per role (AD-16).
--
-- Cast: alice (UTC) creates "Crew"; bob (America/New_York) and dave (UTC) join; dave leaves.
-- carol is in no group. The clock is frozen at Fri 20 Nov 2026 12:00 UTC: alice's current week
-- W = Mon 16 Nov. Plans, sessions and check-ins are written directly as the table owner. Frozen
-- sessions do not exist before Epic 5, so the fixture replaces private.session_status inside this
-- rolled-back transaction to read frozen ids from a test table. session_status and current_streak
-- call now() unqualified; their search_path is pointed at test_overrides so tests.freeze_time
-- moves their clock.
begin;
set local timezone = 'UTC';
select plan(34);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');

-- ===== Shape and grants (AD-16) =====
select ok(
  pg_catalog.to_regprocedure('private.streak_through_week(uuid, date)') is not null
  and pg_catalog.to_regprocedure('private.current_streak(uuid)') is not null
  and pg_catalog.to_regprocedure('private.streak_back_to_zero(uuid)') is not null
  and pg_catalog.to_regprocedure('public.get_streaks(uuid)') is not null,
  'the streak functions and get_streaks exist'
);
select ok(
  (select bool_and(p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig))
   from pg_catalog.pg_proc p
   where p.oid in ('private.streak_through_week(uuid, date)'::regprocedure,
                   'private.current_streak(uuid)'::regprocedure,
                   'private.streak_back_to_zero(uuid)'::regprocedure,
                   'public.get_streaks(uuid)'::regprocedure)),
  'streak functions and get_streaks are stable security definer with an empty search_path'
);
select ok(
  (select bool_and(not has_function_privilege(r.role, f.fn, 'EXECUTE'))
   from (values ('public'), ('anon'), ('authenticated')) r(role)
   cross join (values ('private.streak_through_week(uuid, date)'),
                      ('private.current_streak(uuid)'),
                      ('private.streak_back_to_zero(uuid)')) f(fn)),
  'the private streak functions are not executable by PUBLIC, anon or authenticated'
);
select ok(
  has_function_privilege('authenticated', 'public.get_streaks(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_streaks(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_streaks(uuid)', 'EXECUTE'),
  'get_streaks: authenticated only'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'America/New_York');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select public.join_group(current_setting('test.code'));

-- ===== Fixture helpers (temporary, as the table owner) =====
reset role;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
-- The frozen clock (Fri 20 Nov 12:00 UTC), set before anything reads session_status.
select tests.freeze_time('2026-11-20 12:00:00+00');

-- Frozen sessions by fixture (Epic 5 adds the real status): session_status reads this table first.
create table tests.frozen_sessions (id uuid primary key);
create or replace function private.session_status(s public.sessions)
returns text
language sql
stable
security invoker
set search_path = test_overrides, pg_catalog
as $$
  select case
    when exists (select 1 from tests.frozen_sessions f where f.id = s.id) then 'frozen'
    when exists (select 1 from public.checkins c where c.session_id = s.id) then 'done'
    when s.ends_at <= now() then 'missed'
    else 'open'
  end;
$$;

-- A commitment (one version from 26 Oct) or, with p_kind 'task', a task; returns its id.
create function pg_temp.add_plan(
  p_user text, p_preset text, p_days smallint[], p_target smallint, p_kind text default 'commitment'
)
returns uuid
language plpgsql
as $$
declare
  v_uid uuid := tests.get_supabase_uid(p_user);
  v_group uuid := current_setting('test.g1')::uuid;
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
  where m.group_id = v_group and m.user_id = v_uid
  order by m.joined_at desc
  limit 1;
  if p_kind = 'task' then
    insert into public.commitments
      (group_id, membership_id, user_id, kind, group_activity_id, name, deadline, deadline_day_starts_at)
    values (v_group, v_membership, v_uid, 'task', v_activity, 'Tax forms', '2026-11-22',
            '2026-11-22 00:00:00+00')
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
         s.starts_at, s.starts_at, s.starts_at, false
  from public.sessions s
  where s.id = p_session;
$$;

create function pg_temp.freeze(p_session uuid)
returns void
language sql
as $$
  insert into tests.frozen_sessions (id) values (p_session);
$$;

create function pg_temp.through(p_commitment text, p_week date)
returns integer
language sql
as $$
  select private.streak_through_week(current_setting('test.' || p_commitment)::uuid, p_week);
$$;

create function pg_temp.now_streak(p_commitment text)
returns integer
language sql
as $$
  select private.current_streak(current_setting('test.' || p_commitment)::uuid);
$$;

create function pg_temp.back_to_zero(p_commitment text)
returns boolean
language sql
as $$
  select private.streak_back_to_zero(current_setting('test.' || p_commitment)::uuid);
$$;

-- ===== Fixed days =====
-- Gym every day. Week 9 Nov: Mon done, Tue done, Wed missed, Thu done, Fri frozen, Sat done, Sun
-- done. Week W: Mon to Thu done, Fri (today) open, Sat and Sun open.
select pg_catalog.set_config('test.gym', pg_temp.add_plan('alice', 'gym', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 1, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 2, true));
select pg_temp.add_session('gym', '2026-11-09', 3, true);
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 4, true));
select pg_temp.freeze(pg_temp.add_session('gym', '2026-11-09', 5, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 6, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 7, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 1, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 2, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 3, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 4, true));
select pg_temp.add_session('gym', '2026-11-16', 5, true);
select pg_temp.add_session('gym', '2026-11-16', 6, true);
select pg_temp.add_session('gym', '2026-11-16', 7, true);

select is(pg_temp.through('gym', '2026-11-09'), 3,
  'fixed days: the Wed miss resets the run; the frozen Fri neither breaks nor adds (Thu, Sat, Sun)');
select is(pg_temp.now_streak('gym'), 7,
  'fixed days: today''s open session and later open ones do not break the streak (3 + Mon to Thu)');
select is(pg_temp.through('gym', '2026-11-02'), 0, 'a week before the first session: 0');
select is(pg_temp.back_to_zero('gym'), false, 'a running streak is not "back to 0"');

-- Walk Mon Wed: two done, then the latest ended session missed: 0, "back to 0".
select pg_catalog.set_config('test.walk', pg_temp.add_plan('alice', 'walk', array[1, 3]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('walk', '2026-11-09', 1, true));
select pg_temp.check_in(pg_temp.add_session('walk', '2026-11-09', 3, true));
select pg_temp.add_session('walk', '2026-11-16', 1, true);
select pg_temp.add_session('walk', '2026-11-16', 3, true);
select is(pg_temp.now_streak('walk'), 0, 'fixed days: the latest ended session missed: 0');
select is(pg_temp.through('walk', '2026-11-09'), 2, 'through the week before the misses: 2');
select is(pg_temp.back_to_zero('walk'), true, 'a reset after a run is "back to 0"');

-- Read Tue: never kept (one miss): 0 and not "back to 0".
select pg_catalog.set_config('test.read', pg_temp.add_plan('alice', 'read', array[2]::smallint[], null)::text, true);
select pg_temp.add_session('read', '2026-11-16', 2, true);
select is(pg_temp.now_streak('read'), 0, 'a commitment never kept: 0');
select is(pg_temp.back_to_zero('read'), false, 'a commitment that never had a streak is not "back to 0"');

-- Yoga: version 1 Mon (from 26 Oct), version 2 Wed (from 9 Nov): one session done in each of three
-- weeks across the change.
select pg_catalog.set_config('test.yoga', pg_temp.add_plan('alice', 'yoga', array[1]::smallint[], null)::text, true);
insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
values (current_setting('test.yoga')::uuid, current_setting('test.g1')::uuid, '2026-11-09', array[3]::smallint[], null);
select pg_temp.check_in(pg_temp.add_session('yoga', '2026-11-02', 1, true));
select pg_temp.check_in(pg_temp.add_session('yoga', '2026-11-09', 3, true));
select pg_temp.check_in(pg_temp.add_session('yoga', '2026-11-16', 3, true));
select is(pg_temp.now_streak('yoga'), 3, 'the streak continues across a schedule change (new version)');

-- ===== Times per week =====
-- Run, 2 per week. 26 Oct: met. 2 Nov: 1 of 2 (ended, reset). 9 Nov: met. W: 1 of 2, still open.
select pg_catalog.set_config('test.run', pg_temp.add_plan('alice', 'run', null, 2::smallint)::text, true);
select pg_temp.check_in(pg_temp.add_session('run', '2026-10-26', 1, false));
select pg_temp.check_in(pg_temp.add_session('run', '2026-10-26', 2, false));
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-02', 1, false));
select pg_temp.add_session('run', '2026-11-02', 2, false);
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-09', 1, false));
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-09', 2, false));
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-16', 1, false));
select pg_catalog.set_config('test.run_w2', pg_temp.add_session('run', '2026-11-16', 2, false)::text, true);
select is(pg_temp.through('run', '2026-10-26'), 1, 'times per week: a met week adds 1');
select is(pg_temp.through('run', '2026-11-02'), 0, 'times per week: a past week below target resets to 0');
select is(pg_temp.through('run', '2026-11-09'), 1, 'times per week: counting restarts after the reset');
select is(pg_temp.now_streak('run'), 1,
  'times per week: the current week below target but still open neither breaks nor adds');
select pg_temp.check_in(current_setting('test.run_w2')::uuid);
select is(pg_temp.now_streak('run'), 2, 'times per week: the current week adds 1 once its target is met');

-- Swim, 3 per week. 26 Oct: met (3 of 3). 2 Nov: both rows frozen (0 non-frozen, neutral). 9 Nov:
-- pro-rated to 1 row, done (met). W: 3 open rows, none done yet.
select pg_catalog.set_config('test.swim', pg_temp.add_plan('alice', 'sports', null, 3::smallint)::text, true);
select pg_temp.check_in(pg_temp.add_session('swim', '2026-10-26', 1, false));
select pg_temp.check_in(pg_temp.add_session('swim', '2026-10-26', 2, false));
select pg_temp.check_in(pg_temp.add_session('swim', '2026-10-26', 3, false));
select pg_temp.freeze(pg_temp.add_session('swim', '2026-11-02', 1, false));
select pg_temp.freeze(pg_temp.add_session('swim', '2026-11-02', 2, false));
select pg_temp.check_in(pg_temp.add_session('swim', '2026-11-09', 1, false));
select pg_temp.add_session('swim', '2026-11-16', 1, false);
select pg_temp.add_session('swim', '2026-11-16', 2, false);
select pg_temp.add_session('swim', '2026-11-16', 3, false);
select is(pg_temp.through('swim', '2026-11-02'), 1, 'times per week: a week with 0 non-frozen rows is neutral');
select is(pg_temp.through('swim', '2026-11-09'), 2,
  'times per week: a pro-rated week meets its lowered target (1 row)');
select is(pg_temp.now_streak('swim'), 2, 'times per week: an open current week with nothing done yet');
select is(pg_temp.back_to_zero('swim'), false, 'a running times-per-week streak is not "back to 0"');

-- Bike, 1 per week. 2 Nov: met. 9 Nov: missed. W: open. 0 now, "back to 0".
select pg_catalog.set_config('test.bike', pg_temp.add_plan('alice', 'meditate', null, 1::smallint)::text, true);
select pg_temp.check_in(pg_temp.add_session('bike', '2026-11-02', 1, false));
select pg_temp.add_session('bike', '2026-11-09', 1, false);
select pg_temp.add_session('bike', '2026-11-16', 1, false);
select is(pg_temp.now_streak('bike'), 0, 'times per week: a missed past week resets to 0 now');
select is(pg_temp.back_to_zero('bike'), true, 'a times-per-week reset after a met week is "back to 0"');

-- ===== Tasks =====
select pg_catalog.set_config('test.tax', pg_temp.add_plan('alice', 'groceries', null, null, 'task')::text, true);
select pg_temp.check_in(pg_temp.add_session('tax', '2026-11-16', 0, false));
select is(pg_temp.through('tax', '2026-11-16'), null::integer, 'a task has no streak (streak_through_week)');
select is(pg_temp.now_streak('tax'), null::integer, 'a task has no streak (current_streak)');
select is(pg_temp.back_to_zero('tax'), false, 'a task is never "back to 0"');

-- ===== get_streaks =====
-- dave: Paint Mon done in W, then leaves: his commitment is not listed.
select pg_catalog.set_config('test.paint', pg_temp.add_plan('dave', 'paint', array[1]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('paint', '2026-11-16', 1, true));
update public.memberships set ended_at = '2026-11-17 10:00:00+00', end_reason = 'left'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('dave');

-- bob (America/New_York): Draw every day, DST week 26 Oct (clocks go back Sun 1 Nov 02:00 local).
-- Sat 31 Oct [04:00Z, 1 Nov 04:00Z) done; Sun 1 Nov is 25 hours long: [1 Nov 04:00Z, 2 Nov 05:00Z).
select pg_catalog.set_config('test.draw', pg_temp.add_plan('bob', 'draw', array[1, 2, 3, 4, 5, 6, 7]::smallint[], null)::text, true);
insert into public.sessions (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
select c.group_id, c.membership_id, c.user_id, c.id, '2026-10-26', d.slot, d.starts_at, d.ends_at
from public.commitments c
cross join (values (6::smallint, '2026-10-31 04:00:00+00'::timestamptz, '2026-11-01 04:00:00+00'::timestamptz),
                   (7::smallint, '2026-11-01 04:00:00+00'::timestamptz, '2026-11-02 05:00:00+00'::timestamptz)) d(slot, starts_at, ends_at)
where c.id = current_setting('test.draw')::uuid;
select pg_temp.check_in(s.id) from public.sessions s
where s.commitment_id = current_setting('test.draw')::uuid and s.slot = 6;

select tests.authenticate_as('carol');
select throws_ok(
  format('select * from public.get_streaks(%L)', current_setting('test.g1')),
  'P0001', 'not_member', 'get_streaks: not_member for a non-member'
);
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.count(*)::integer from public.get_streaks(current_setting('test.g1')::uuid)),
  9,
  'get_streaks: every commitment and task of the current members (dave, who left, excluded)'
);
select is(
  (select g.current_streak::text || '|' || g.back_to_zero::text || '|' || (g.user_id = tests.get_supabase_uid('alice'))::text
   from public.get_streaks(current_setting('test.g1')::uuid) g
   where g.commitment_id = current_setting('test.walk')::uuid),
  '0|true|true',
  'get_streaks: a groupmate''s commitment with its streak and back_to_zero'
);
select is(
  (select coalesce(g.current_streak::text, 'null') || '|' || g.back_to_zero::text
   from public.get_streaks(current_setting('test.g1')::uuid) g
   where g.commitment_id = current_setting('test.tax')::uuid),
  'null|false',
  'get_streaks: a task''s row has a null streak'
);

-- ===== DST: stored bounds =====
reset role;
-- 2 Nov 04:30Z is still Sun 1 Nov 23:30 in New York: Sunday's session is open, the streak holds.
select tests.freeze_time('2026-11-02 04:30:00+00');
select is(pg_temp.now_streak('draw'), 1,
  'DST week: a 25-hour Sunday is still open past 04:00Z (stored bounds), the streak holds at 1');
-- 2 Nov 05:30Z: Sunday has ended unkept: missed, back to 0.
select tests.freeze_time('2026-11-02 05:30:00+00');
select is(pg_temp.now_streak('draw'), 0, 'DST week: once the stored end has passed the session is missed');

select * from finish();
rollback;
