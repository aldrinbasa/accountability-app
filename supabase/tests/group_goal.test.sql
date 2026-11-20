-- Group goal (Story 4.7): group_goals (shape, RLS, grants), set_group_goal (not_member, not_admin,
-- invalid_goal at 45, 47 and 105; 55 accepted), version selection (two edits in one week, an edit
-- after a lock), the lock's goal values (weekly hit exactly at target, missed by 0.5, members without
-- a score left out, a solo week and an unscored week left out), monthly closing detection (private.
-- lock_month across a month boundary in the group zone, a lock on the 1st; the closing lock decides
-- with the month's averages), one goal_result feed event per decided result, Team Player for every
-- member current at the lock (and pending before it), and get_group_goal.
--
-- The clock starts on Wed 18 Nov 2026 12:00 UTC: the current week W = Mon 16 Nov, P = Mon 9 Nov
-- (locks Thu 19 Nov), Mon 2 Nov locked on Thu 12 Nov. November's locks: weeks of 26 Oct, 2, 9 and
-- 16 Nov; W closes November (the week of 23 Nov locks on Thu 3 Dec).
-- Crew (alice admin, bob, cara): weekly 85 from 2 Nov; P: alice 100, bob 70, cara no score = 85.0.
-- Pair (dave admin, erin): weekly 85 from 2 Nov; P: 100 and 69 = 84.5 (missed by 0.5).
-- Month (gina admin, hank): monthly 80 from 2 Nov; 2 Nov: 60 and 80 = 70.0; P: nobody scored; W:
-- 100 and 90 = 95.0; November = (70 + 95) / 2 = 82.5, hit at W.
-- Solo (frank): weekly 50 from 2 Nov; P: 100, a solo week.
begin;
set local timezone = 'UTC';
select plan(49);

select tests.create_supabase_user(u)
from (values ('alice'), ('bob'), ('cara'), ('dave'), ('erin'), ('gina'), ('hank'), ('frank'),
             ('kim'), ('mia')) v(u);

-- ===== Shape, RLS and grants (AD-5, AD-16) =====
select columns_are('public', 'group_goals',
  array['id', 'group_id', 'target_pct', 'period', 'effective_week_start', 'created_by',
        'created_at', 'updated_at'],
  'group_goals has the story''s columns');
select has_column('public', 'group_week_results', 'goal_result_average',
  'group_week_results gains goal_result_average');
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.group_goals'::regclass)
  and (select pg_catalog.count(*) = 1 from pg_catalog.pg_policies p
       where p.schemaname = 'public' and p.tablename = 'group_goals'
         and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[])
  and has_table_privilege('authenticated', 'public.group_goals', 'SELECT')
  and not has_table_privilege('authenticated', 'public.group_goals', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('anon', 'public.group_goals', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),
  'group_goals: RLS with one SELECT policy for authenticated, SELECT only, nothing for anon'
);
select ok(
  (select bool_and(has_function_privilege('authenticated', f.fn, 'EXECUTE')
                   and not has_function_privilege('anon', f.fn, 'EXECUTE')
                   and not has_function_privilege('public', f.fn, 'EXECUTE'))
   from (values ('public.set_group_goal(uuid, integer, text)'), ('public.get_group_goal(uuid)')) f(fn))
  and (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig))
       from pg_catalog.pg_proc p
       where p.oid in ('public.set_group_goal(uuid, integer, text)'::regprocedure,
                       'public.get_group_goal(uuid)'::regprocedure))
  and (select p.provolatile = 's' from pg_catalog.pg_proc p
       where p.oid = 'public.get_group_goal(uuid)'::regprocedure),
  'set_group_goal and get_group_goal: security definer, empty search_path, authenticated only'
);
select ok(
  (select bool_and(not has_function_privilege(r.role, f.fn, 'EXECUTE'))
   from (values ('private.goal_for_week(uuid, date)'), ('private.lock_month(uuid, date)'),
                ('private.goal_live_average(uuid, date)'), ('private.goal_week_hit(uuid, date)')) f(fn)
   cross join (values ('authenticated'), ('anon'), ('public')) r(role))
  and (select bool_and(p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig))
       from pg_catalog.pg_proc p
       where p.oid in ('private.goal_for_week(uuid, date)'::regprocedure,
                       'private.lock_month(uuid, date)'::regprocedure,
                       'private.goal_live_average(uuid, date)'::regprocedure,
                       'private.goal_week_hit(uuid, date)'::regprocedure)),
  'the goal helpers: stable security definer, empty search_path, closed to clients'
);
select ok(
  pg_catalog.strpos(
    (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
     where c.conname = 'feed_events_kind_check'),
    'goal_result'
  ) > 0
  and pg_catalog.strpos(
    (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
     where c.conname = 'feed_events_kind_check'),
    'weekly_winner'
  ) > 0,
  'feed_events accepts goal_result and keeps weekly_winner'
);

-- ===== Groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select pg_catalog.set_config('test.crew', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.crew')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('cara');
select public.save_profile('Cara', 'UTC');
select public.join_group(current_setting('test.code'));

select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');
select pg_catalog.set_config('test.pair', public.create_group('Pair')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.pair')::uuid, false)), true);
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select public.join_group(current_setting('test.code'));

select tests.authenticate_as('gina');
select public.save_profile('Gina', 'UTC');
select pg_catalog.set_config('test.month', public.create_group('Month')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.month')::uuid, false)), true);
select tests.authenticate_as('hank');
select public.save_profile('Hank', 'UTC');
select public.join_group(current_setting('test.code'));

select tests.authenticate_as('frank');
select public.save_profile('Frank', 'UTC');
select pg_catalog.set_config('test.solo', public.create_group('Solo')::text, true);

select tests.authenticate_as('mia');
select public.save_profile('Mia', 'Asia/Manila');
select pg_catalog.set_config('test.manila', public.create_group('Manila')::text, true);

select tests.authenticate_as('kim');
select public.save_profile('Kim', 'UTC');

-- ===== Fixture (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00' where ended_at is null;

alter function private.lock_week(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.lock_due_weeks() set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function public.get_member_profile(uuid, uuid) set search_path = test_overrides, pg_catalog;
alter function public.set_group_goal(uuid, integer, text) set search_path = test_overrides, pg_catalog;
alter function public.get_group_goal(uuid) set search_path = test_overrides, pg_catalog;
select tests.freeze_time('2026-11-18 12:00:00+00');

-- A member's current membership in a group (setting name).
create function pg_temp.mid(p_user text, p_group text)
returns uuid
language sql
as $$
  select m.id from public.memberships m
  where m.group_id = current_setting('test.' || p_group)::uuid
    and m.user_id = tests.get_supabase_uid(p_user)
    and m.ended_at is null;
$$;

-- A times-per-week commitment of p_user in a group (from 12 Oct) on a preset activity.
create function pg_temp.plan(p_user text, p_group text, p_preset text default 'gym')
returns uuid
language plpgsql
as $$
declare
  v_uid uuid := tests.get_supabase_uid(p_user);
  v_group uuid := current_setting('test.' || p_group)::uuid;
  v_activity uuid;
  v_id uuid;
begin
  insert into public.group_activities (group_id, preset_key, created_by)
  values (v_group, p_preset, v_uid)
  on conflict do nothing;
  select ga.id into v_activity from public.group_activities ga
  where ga.group_id = v_group and ga.preset_key = p_preset;
  insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
  values (v_group, pg_temp.mid(p_user, p_group), v_uid, 'commitment', v_activity, 'times_per_week')
  returning id into v_id;
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values (v_id, v_group, '2026-10-12', null, 7);
  return v_id;
end;
$$;

-- p_count (at most 7) whole-week sessions of a commitment in a week; the first p_done done.
create function pg_temp.week(p_commitment uuid, p_week date, p_count integer, p_done integer)
returns void
language plpgsql
as $$
declare
  v_session uuid;
begin
  for i in 1 .. p_count loop
    insert into public.sessions
      (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
    select c.group_id, c.membership_id, c.user_id, c.id, p_week, i,
           p_week::timestamp at time zone 'UTC', (p_week + 7)::timestamp at time zone 'UTC'
    from public.commitments c
    where c.id = p_commitment
    returning id into v_session;
    if i <= p_done then
      insert into public.checkins
        (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
      select pg_catalog.gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
             (p_week + time '12:00') at time zone 'UTC', (p_week + time '12:00') at time zone 'UTC',
             (p_week + time '12:00') at time zone 'UTC', false
      from public.sessions s
      where s.id = v_session;
    end if;
  end loop;
end;
$$;

-- A goal version written directly (an earlier edit).
create function pg_temp.goal(p_group text, p_target smallint, p_period text, p_week date, p_by text)
returns void
language sql
as $$
  insert into public.group_goals (group_id, target_pct, period, effective_week_start, created_by)
  values (current_setting('test.' || p_group)::uuid, p_target, p_period, p_week,
          tests.get_supabase_uid(p_by));
$$;

-- A locked week's goal columns: target|period|average|hit|result (empty for null).
create function pg_temp.goal_row(p_group text, p_week date)
returns text
language sql
as $$
  select coalesce(r.goal_target::text, '') || '|' || coalesce(r.goal_period, '') || '|'
         || coalesce(r.goal_average::text, '') || '|' || coalesce(r.goal_hit::text, '') || '|'
         || coalesce(r.goal_result_average::text, '')
  from public.group_week_results r
  where r.group_id = current_setting('test.' || p_group)::uuid
    and r.week_start = p_week;
$$;

-- A group's goal_result feed events: period:target:average:hit, oldest first.
create function pg_temp.events(p_group text)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(
    (e.payload ->> 'week_start') || ':' || (e.payload ->> 'period') || ':' || (e.payload ->> 'target')
    || ':' || (e.payload ->> 'average') || ':' || (e.payload ->> 'hit'),
    ',' order by e.created_at, e.payload ->> 'week_start'), '')
  from public.feed_events e
  where e.group_id = current_setting('test.' || p_group)::uuid
    and e.kind = 'goal_result';
$$;

-- Members of a group holding Team Player, by name.
create function pg_temp.team_players(p_group text)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(p.display_name || '@' || a.week_start, ',' order by p.display_name), '')
  from public.badge_awards a
  join public.profiles p on p.id = a.user_id
  where a.group_id = current_setting('test.' || p_group)::uuid
    and a.badge_key = 'team_player';
$$;

-- The status of one badge in get_member_profile (as the calling user).
create function pg_temp.status(p_group text, p_user text, p_key text)
returns text
language sql
as $$
  select b ->> 'status'
  from public.get_member_profile(current_setting('test.' || p_group)::uuid,
                                 tests.get_supabase_uid(p_user)) gp
  cross join lateral pg_catalog.jsonb_array_elements(gp.badges) b
  where b ->> 'key' = p_key;
$$;

grant execute on function pg_temp.status(text, text, text) to authenticated;

select pg_temp.goal('crew', 85::smallint, 'weekly', '2026-11-02', 'alice');
select pg_temp.goal('pair', 85::smallint, 'weekly', '2026-11-02', 'dave');
select pg_temp.goal('month', 80::smallint, 'monthly', '2026-11-02', 'gina');
select pg_temp.goal('solo', 50::smallint, 'weekly', '2026-11-02', 'frank');

-- Crew P: alice 1 of 1 (100), bob 7 of 10 (70), cara nothing planned (no score).
select pg_temp.week(pg_temp.plan('alice', 'crew'), '2026-11-09', 1, 1);
select pg_temp.week(pg_temp.plan('bob', 'crew'), '2026-11-09', 5, 5);
select pg_temp.week(pg_temp.plan('bob', 'crew', 'run'), '2026-11-09', 5, 2);
-- Pair P: dave 100, erin 9 of 13 (69).
select pg_temp.week(pg_temp.plan('dave', 'pair'), '2026-11-09', 1, 1);
select pg_temp.week(pg_temp.plan('erin', 'pair'), '2026-11-09', 7, 7);
select pg_temp.week(pg_temp.plan('erin', 'pair', 'run'), '2026-11-09', 6, 2);
-- Month: 2 Nov gina 3 of 5 (60), hank 4 of 5 (80); P nothing; W gina 100, hank 9 of 10 (90).
select pg_catalog.set_config('test.g', pg_temp.plan('gina', 'month')::text, true);
select pg_catalog.set_config('test.h', pg_temp.plan('hank', 'month')::text, true);
select pg_temp.week(current_setting('test.g')::uuid, '2026-11-02', 5, 3);
select pg_temp.week(current_setting('test.h')::uuid, '2026-11-02', 5, 4);
select pg_temp.week(current_setting('test.g')::uuid, '2026-11-16', 1, 1);
select pg_temp.week(current_setting('test.h')::uuid, '2026-11-16', 5, 5);
select pg_temp.week(pg_temp.plan('hank', 'month', 'run'), '2026-11-16', 5, 4);
-- Solo P: frank 100.
select pg_temp.week(pg_temp.plan('frank', 'solo'), '2026-11-09', 1, 1);

select private.ensure_group_week(current_setting('test.' || g)::uuid, w)
from (values ('crew'), ('pair'), ('month'), ('solo')) v(g)
cross join (values ('2026-11-09'::date), ('2026-11-16'::date), ('2026-11-23'::date)) x(w);
select private.ensure_group_week(current_setting('test.month')::uuid, '2026-11-02');

-- ===== set_group_goal =====
select tests.authenticate_as('kim');
select throws_ok(
  format('select public.set_group_goal(%L::uuid, 85, %L)', current_setting('test.crew'), 'weekly'),
  'P0001', 'not_member', 'set_group_goal: not_member for someone outside the group');
select tests.authenticate_as('bob');
select throws_ok(
  format('select public.set_group_goal(%L::uuid, 85, %L)', current_setting('test.crew'), 'weekly'),
  'P0001', 'not_admin', 'set_group_goal: not_admin for a member');
select tests.authenticate_as('alice');
select throws_ok(
  format('select public.set_group_goal(%L::uuid, 45, %L)', current_setting('test.crew'), 'weekly'),
  'P0001', 'invalid_goal', 'set_group_goal: 45 is below 50');
select throws_ok(
  format('select public.set_group_goal(%L::uuid, 47, %L)', current_setting('test.crew'), 'weekly'),
  'P0001', 'invalid_goal', 'set_group_goal: 47 is not a step of 5');
select throws_ok(
  format('select public.set_group_goal(%L::uuid, 105, %L)', current_setting('test.crew'), 'weekly'),
  'P0001', 'invalid_goal', 'set_group_goal: 105 is above 100');
select throws_ok(
  format('select public.set_group_goal(%L::uuid, 85, %L)', current_setting('test.crew'), 'daily'),
  'P0001', 'invalid_goal', 'set_group_goal: the period is weekly or monthly');
select lives_ok(
  format('select public.set_group_goal(%L::uuid, 55, %L)', current_setting('test.crew'), 'weekly'),
  'set_group_goal: 55 is a valid step');
select lives_ok(
  format('select public.set_group_goal(%L::uuid, 80, %L)', current_setting('test.crew'), 'weekly'),
  'set_group_goal: a second edit in the same week');
select is(
  (select pg_catalog.string_agg(g.target_pct || ':' || g.effective_week_start || ':'
                                || (g.created_by = tests.get_supabase_uid('alice')), ','
                                order by g.created_at)
   from public.group_goals g where g.group_id = current_setting('test.crew')::uuid),
  '85:2026-11-02:true,55:2026-11-16:true,80:2026-11-16:true',
  'every edit is kept, effective from the current week, by the admin'
);
reset role;
select is(
  (select g.target_pct || ':' || g.period from private.goal_for_week(current_setting('test.crew')::uuid, '2026-11-16') g)
  || ',' ||
  (select g.target_pct || ':' || g.period from private.goal_for_week(current_setting('test.crew')::uuid, '2026-11-09') g),
  '80:weekly,85:weekly',
  'version selection: the latest edit of the week wins for W; P keeps the earlier version'
);
select is(
  (select pg_catalog.count(*)::integer from private.goal_for_week(current_setting('test.crew')::uuid, '2026-10-26')),
  0, 'no version before the first one'
);

-- RLS: members read their group's goals; others see nothing.
select tests.authenticate_as('kim');
select is((select pg_catalog.count(*)::integer from public.group_goals), 0,
  'group_goals: someone in no group reads nothing');
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.count(*)::integer from public.group_goals g
   where g.group_id = current_setting('test.crew')::uuid)
  || '|' ||
  (select pg_catalog.count(*)::integer from public.group_goals g
   where g.group_id <> current_setting('test.crew')::uuid),
  '3|0', 'group_goals: a member reads only their group''s versions');

-- ===== Month boundaries in the group zone =====
reset role;
select is(
  private.lock_month(current_setting('test.crew')::uuid, '2026-11-16')::text || ','
  || private.lock_month(current_setting('test.crew')::uuid, '2026-11-23')::text || ','
  || private.lock_month(current_setting('test.crew')::uuid, '2026-09-14')::text || ','
  || private.lock_month(current_setting('test.crew')::uuid, '2026-09-21')::text,
  '2026-11-01,2026-12-01,2026-09-01,2026-10-01',
  'lock months: W (Thu 26 Nov) is November, the next (Thu 3 Dec) December; a lock on Thu 1 Oct belongs to October'
);
select is(
  private.lock_month(current_setting('test.manila')::uuid, '2026-09-21')::text,
  '2026-10-01',
  'Manila: the lock at Thu 1 Oct 00:00 local (30 Sep 16:00 UTC) falls in October in group time'
);
-- Already locked, so the lock step later leaves it alone.
insert into public.group_weeks (group_id, week_start, lock_at, locked_at)
values (current_setting('test.manila')::uuid, '2026-09-21', '2026-09-30 16:00:00+00',
        '2026-09-30 16:00:00+00');
update public.groups set time_zone = 'America/New_York'
where id = current_setting('test.manila')::uuid;
select is(
  private.lock_month(current_setting('test.manila')::uuid, '2026-09-21')::text,
  '2026-10-01',
  'after the group moves west, that past lock (30 Sep 12:00 in New York) still belongs to October'
);

-- ===== Before P locks: live values and pending Team Player =====
select tests.authenticate_as('bob');
select is(pg_temp.status('crew', 'bob', 'team_player'), 'pending',
  'P''s live average meets the target: Team Player is pending before the lock');
select tests.authenticate_as('erin');
select is(pg_temp.status('pair', 'erin', 'team_player'), 'locked',
  'Pair''s live average (84.5) misses 85: Team Player stays locked');
select tests.authenticate_as('frank');
select is(pg_temp.status('solo', 'frank', 'team_player'), 'locked',
  'a group of one: Team Player is never pending');

-- ===== P locks =====
reset role;
select tests.freeze_time('2026-11-19 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'the due weeks lock without an error');
select is(pg_temp.goal_row('crew', '2026-11-09'), '85|weekly|85.0|true|85.0',
  'weekly hit exactly at target: 85.0 >= 85 (cara, with no score, is left out)');
select is(pg_temp.goal_row('pair', '2026-11-09'), '85|weekly|84.5|false|84.5',
  'weekly missed by 0.5: 84.5 < 85');
select is(pg_temp.goal_row('month', '2026-11-02'), '80|monthly|70.0||',
  'monthly, not the month''s last lock: values written, goal_hit left null');
select is(pg_temp.goal_row('month', '2026-11-09'), '||||',
  'a ranked week where nobody scored: no goal values');
select is(pg_temp.goal_row('solo', '2026-11-09'), '||||',
  'a solo week: no goal values');
select is(pg_temp.events('crew') || ';' || pg_temp.events('pair') || ';' || pg_temp.events('month')
          || ';' || pg_temp.events('solo'),
  '2026-11-09:weekly:85:85.0:true;2026-11-09:weekly:85:84.5:false;;',
  'one goal_result event per decided result: Crew hit, Pair missed; none mid-month or solo');
select is(
  (select e.actor_id is null and e.created_at = '2026-11-19 00:00:01+00'
   from public.feed_events e
   where e.group_id = current_setting('test.crew')::uuid and e.kind = 'goal_result'),
  true, 'the event names nobody and carries the lock time');
select is(pg_temp.team_players('crew'), 'Alice@2026-11-09,Bob@2026-11-09,Cara@2026-11-09',
  'goal hit: every member current at the lock earns Team Player, a member without a score too');
select is(pg_temp.team_players('pair') || '|' || pg_temp.team_players('solo') || '|'
          || pg_temp.team_players('month'),
  '||', 'a missed, solo or undecided goal awards no Team Player');

-- ===== get_group_goal =====
select tests.authenticate_as('kim');
select throws_ok(
  format('select * from public.get_group_goal(%L::uuid)', current_setting('test.crew')),
  'P0001', 'not_member', 'get_group_goal raises not_member for a caller outside the group');
select tests.authenticate_as('bob');
select is(
  (select gg.week_start || '|' || gg.member_count || '|' || gg.target_pct || '|' || gg.period || '|'
          || coalesce(gg.live_average::text, 'null') || '|' || gg.month_weeks::text || '|'
          || coalesce(gg.month_average::text, 'null')
   from public.get_group_goal(current_setting('test.crew')::uuid) gg),
  '2026-11-16|3|80|weekly|null|[]|null',
  'Crew now: W''s version (80 weekly), nobody scored yet this week, no month weeks'
);
select is(
  (select gg.last_result::text from public.get_group_goal(current_setting('test.crew')::uuid) gg),
  '{"hit": true, "period": "weekly", "target": 85, "average": 85.0, "week_start": "2026-11-09"}',
  'last_result: the most recent locked week''s decided result'
);
select is(
  (select gg.contributions::text from public.get_group_goal(current_setting('test.crew')::uuid) gg),
  '[{"name": "Alice", "user_id": "' || tests.get_supabase_uid('alice') || '", "weekly_points": null}, '
  || '{"name": "Bob", "user_id": "' || tests.get_supabase_uid('bob') || '", "weekly_points": null}, '
  || '{"name": "Cara", "user_id": "' || tests.get_supabase_uid('cara') || '", "weekly_points": null}]',
  'contributions: every current member, no score this week yet'
);
select tests.authenticate_as('gina');
select is(
  (select gg.target_pct || '|' || gg.period || '|' || gg.live_average || '|' || gg.month_weeks::text
          || '|' || gg.month_average || '|' || coalesce(gg.last_result::text, 'null')
   from public.get_group_goal(current_setting('test.month')::uuid) gg),
  '80|monthly|95.0|[{"week_start": "2026-11-02", "goal_average": 70.0}]|70.0|null',
  'Month now: the live average, November''s locked weeks with an average (P left out), no decided result yet'
);
select is(
  (select pg_catalog.string_agg((c ->> 'name') || ':' || coalesce(c ->> 'weekly_points', '-'), ',' order by o)
   from public.get_group_goal(current_setting('test.month')::uuid) gg
   cross join lateral pg_catalog.jsonb_array_elements(gg.contributions) with ordinality x(c, o)),
  'Gina:100,Hank:90',
  'contributions come in ranking order with their weekly points'
);
select is(pg_temp.status('month', 'gina', 'team_player'), 'pending',
  'monthly: W closes the month and (70.0 + 95.0) / 2 meets 80, so Team Player is pending');

-- An edit after P's lock applies to W and never touches P.
select tests.authenticate_as('alice');
select public.set_group_goal(current_setting('test.crew')::uuid, 95, 'monthly');
reset role;
select is(
  pg_temp.goal_row('crew', '2026-11-09') || ',' ||
  (select g.target_pct || ':' || g.period from private.goal_for_week(current_setting('test.crew')::uuid, '2026-11-16') g),
  '85|weekly|85.0|true|85.0,95:monthly',
  'an edit after a lock: W reads the new version, the locked week keeps its values'
);

-- ===== W locks: the month closes =====
select tests.freeze_time('2026-11-26 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'W locks without an error');
select is(pg_temp.goal_row('month', '2026-11-16'), '80|monthly|95.0|true|82.5',
  'the closing lock decides the month: the average of 70.0 and 95.0 (the unscored week left out)');
select is(pg_temp.events('month'), '2026-11-16:monthly:80:82.5:true',
  'one monthly goal_result event at the closing lock');
select is(pg_temp.team_players('month'), 'Gina@2026-11-16,Hank@2026-11-16',
  'monthly hit: both members earn Team Player at the closing lock');
select is(pg_temp.goal_row('crew', '2026-11-16') || ';' || pg_temp.events('crew'),
  '||||;2026-11-09:weekly:85:85.0:true',
  'Crew at W: nobody scored, so no goal values and no new event');
select is(
  (select pg_catalog.count(*)::integer from public.badge_awards a
   where a.group_id = current_setting('test.crew')::uuid and a.badge_key = 'team_player'),
  3, 'Team Player is earned once per membership'
);

select * from finish();
rollback;
