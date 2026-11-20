-- Badges and titles (Story 4.6): the 15-badge catalog and the titles table (shape, RLS, grants),
-- private.badge_criteria_met at each threshold and one below, private.title_for_points at 299/300
-- and 9,999/10,000, the criteria awards written by the lock step (pending before the lock, earned
-- after it, once per membership, Weekly Winner per week, a solo week, an unscored week, no
-- revocation) and get_member_profile (badges, title, streaks, a left member, not_member).
--
-- Lab (never locked: the criteria read live counts): one member per threshold case, D = Mon 9 Nov
-- 2026, the clock on Wed 18 Nov 12:00 UTC, so every session of D and before has ended.
-- Crew (alice, bob) and Solo (frank) lock P = Mon 9 Nov (Thu 19 Nov) and W = Mon 16 Nov (Thu 26 Nov).
-- Plans, sessions, check-ins and awards are written directly as the table owner; the routines that
-- read the clock get their search_path pointed at test_overrides.
begin;
set local timezone = 'UTC';
select plan(53);

select tests.create_supabase_user('boss');
select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('frank');
select tests.create_supabase_user('kim');
select tests.create_supabase_user('sam');

-- ===== Shape, RLS and grants (AD-5, AD-16) =====
select is(
  (select pg_catalog.string_agg(b.name, ',' order by b.sort_order) from public.badges b),
  'First Proof,Hat Trick,On a Roll,Unbreakable,Clean Sheet,Back-to-Back,Monthly Machine,Comeback,'
  || 'Weekly Winner,Dynasty,Team Player,Fair Judge,Early Bird,Night Owl,Task Slayer',
  'the catalog holds the 15 badges in display order'
);
select is(
  (select pg_catalog.string_agg(b.key || '|' || b.line, ';' order by b.sort_order)
   from public.badges b where b.key in ('first_proof', 'dynasty', 'task_slayer')),
  'first_proof|Pics or it didn''t happen. It happened.;dynasty|Three crowns. Someone stop them.;'
  || 'task_slayer|Ten chores down. Adulting unlocked.',
  'catalog lines come from EXPERIENCE.md'
);
select is(
  (select pg_catalog.count(distinct b.icon)::integer from public.badges b), 15,
  'every badge has its own icon'
);
select columns_are('public', 'titles',
  array['key', 'name', 'min_points', 'sort_order', 'created_at', 'updated_at'],
  'titles has the story''s columns');
select is(
  (select pg_catalog.string_agg(t.name || ':' || t.min_points, ',' order by t.sort_order)
   from public.titles t),
  'Couch Potato:0,Warming Up:300,Regular:1000,Grinder:2500,Machine:5000,Legend:10000',
  'titles holds the 6 thresholds'
);
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.titles'::regclass)
  and (select pg_catalog.count(*) = 1 from pg_catalog.pg_policies p
       where p.schemaname = 'public' and p.tablename = 'titles'
         and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[])
  and has_table_privilege('authenticated', 'public.titles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.titles', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('anon', 'public.titles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'),
  'titles: RLS with one SELECT policy for authenticated, SELECT only, nothing for anon'
);
select ok(
  has_function_privilege('authenticated', 'public.get_member_profile(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_member_profile(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_member_profile(uuid, uuid)', 'EXECUTE')
  and (select p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig)
       from pg_catalog.pg_proc p where p.oid = 'public.get_member_profile(uuid, uuid)'::regprocedure),
  'get_member_profile: stable security definer, empty search_path, authenticated only'
);
select ok(
  (select bool_and(not has_function_privilege(r.role, f.fn, 'EXECUTE'))
   from (values ('private.badge_criteria_met(uuid, date)'), ('private.member_week_tally(uuid, date)'),
                ('private.title_for_points(integer)')) f(fn)
   cross join (values ('authenticated'), ('anon'), ('public')) r(role))
  and (select bool_and(p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig))
       from pg_catalog.pg_proc p
       where p.oid in ('private.badge_criteria_met(uuid, date)'::regprocedure,
                       'private.member_week_tally(uuid, date)'::regprocedure,
                       'private.title_for_points(integer)'::regprocedure)),
  'the helpers: stable security definer, empty search_path, closed to clients'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result('public.get_winner_week(uuid, date)'::regprocedure),
    'week_start date, lock_at timestamp with time zone, scored boolean, ranked boolean, '
    || 'winner_user_ids uuid[], user_id uuid, display_name text, avatar_path text, '
    || 'weekly_points integer, rank integer, is_winner boolean, badge_name text, badge_line text'
  ) > 0
  and has_function_privilege('authenticated', 'public.get_winner_week(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_winner_week(uuid, date)', 'EXECUTE'),
  'get_winner_week keeps every column, adds badge_name and badge_line, authenticated only'
);

-- ===== Titles =====
select is(
  private.title_for_points(0) || ',' || private.title_for_points(299) || ','
  || private.title_for_points(300) || ',' || private.title_for_points(9999) || ','
  || private.title_for_points(10000) || ',' || private.title_for_points(25000),
  'couch_potato,couch_potato,warming_up,machine,legend,legend',
  'title thresholds: 299 / 300 and 9,999 / 10,000'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('boss');
select public.save_profile('Boss', 'UTC');
select pg_catalog.set_config('test.lab', public.create_group('Lab')::text, true);
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('sam');
select public.save_profile('Sam', 'UTC');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('frank');
select public.save_profile('Frank', 'UTC');
select pg_catalog.set_config('test.g3', public.create_group('Solo')::text, true);
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
select tests.freeze_time('2026-11-18 12:00:00+00');

-- A Lab member (a new user with a profile in p_zone and a current Lab membership).
create function pg_temp.lab_user(p_name text, p_zone text)
returns void
language plpgsql
as $$
begin
  perform tests.create_supabase_user(p_name);
  insert into public.profiles (id, display_name, time_zone)
  values (tests.get_supabase_uid(p_name), p_name, p_zone);
  insert into public.memberships (group_id, user_id, role, joined_at)
  values (current_setting('test.lab')::uuid, tests.get_supabase_uid(p_name), 'member',
          '2026-10-01 00:00:00+00');
end;
$$;

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

-- A commitment of p_user in a group: fixed days every day (p_target null) or times per week.
create function pg_temp.plan(p_user text, p_group text, p_target smallint)
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
  values (v_group, 'gym', v_uid)
  on conflict do nothing;
  select ga.id into v_activity from public.group_activities ga
  where ga.group_id = v_group and ga.preset_key = 'gym';
  insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
  values (v_group, pg_temp.mid(p_user, p_group), v_uid, 'commitment', v_activity,
          case when p_target is null then 'fixed_days' else 'times_per_week' end)
  returning id into v_id;
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values (v_id, v_group, '2026-10-12',
          case when p_target is null then array[1, 2, 3, 4, 5, 6, 7]::smallint[] end, p_target);
  return v_id;
end;
$$;

-- One session of a commitment: a fixed day (p_slot = its ISO weekday) or the whole week, with a
-- counted check-in taken at p_taken (null: no check-in).
create function pg_temp.session(p_commitment uuid, p_day date, p_whole_week boolean, p_slot smallint,
                                p_taken timestamptz)
returns void
language plpgsql
as $$
declare
  v_week date := p_day - (extract(isodow from p_day)::integer - 1);
  v_session uuid;
begin
  insert into public.sessions
    (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
  select c.group_id, c.membership_id, c.user_id, c.id, v_week, p_slot,
         case when p_whole_week then v_week else p_day end::timestamp at time zone 'UTC',
         case when p_whole_week then v_week + 7 else p_day + 1 end::timestamp at time zone 'UTC'
  from public.commitments c
  where c.id = p_commitment
  returning id into v_session;
  if p_taken is not null then
    insert into public.checkins
      (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
    select pg_catalog.gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
           p_taken, p_taken, p_taken, false
    from public.sessions s
    where s.id = v_session;
  end if;
end;
$$;

-- p_done kept daily sessions in a row ending on p_last (fixed days, every day).
create function pg_temp.daily(p_commitment uuid, p_last date, p_done integer)
returns void
language plpgsql
as $$
declare
  v_day date;
begin
  for i in 1 .. p_done loop
    v_day := p_last - (p_done - i);
    perform pg_temp.session(p_commitment, v_day, false, extract(isodow from v_day)::smallint,
                            (v_day + time '12:00') at time zone 'UTC');
  end loop;
end;
$$;

-- p_count whole-week sessions of a times-per-week commitment in a week; the first p_done done.
create function pg_temp.week(p_commitment uuid, p_week date, p_count integer, p_done integer)
returns void
language plpgsql
as $$
begin
  for i in 1 .. p_count loop
    perform pg_temp.session(p_commitment, p_week, true, i::smallint,
                            case when i <= p_done then (p_week + time '12:00') at time zone 'UTC' end);
  end loop;
end;
$$;

-- Check-ins taken at the given instants (one whole-week session each) in a week.
create function pg_temp.taken(p_commitment uuid, p_week date, p_at timestamptz[])
returns void
language plpgsql
as $$
begin
  for i in 1 .. pg_catalog.cardinality(p_at) loop
    perform pg_temp.session(p_commitment, p_week, true, i::smallint, p_at[i]);
  end loop;
end;
$$;

-- p_done tasks of p_user in Lab, each with its one session done in week 9 Nov.
create function pg_temp.tasks(p_user text, p_done integer)
returns void
language plpgsql
as $$
declare
  v_id uuid;
begin
  for i in 1 .. p_done loop
    insert into public.commitments
      (group_id, membership_id, user_id, kind, group_activity_id, name, deadline, deadline_day_starts_at)
    select current_setting('test.lab')::uuid, pg_temp.mid(p_user, 'lab'), tests.get_supabase_uid(p_user),
           'task', ga.id, 'Task ' || i, '2026-11-15', '2026-11-15 00:00:00+00'
    from public.group_activities ga
    where ga.group_id = current_setting('test.lab')::uuid and ga.preset_key = 'gym'
    returning id into v_id;
    perform pg_temp.session(v_id, '2026-11-09', true, 0::smallint, '2026-11-10 12:00:00+00');
  end loop;
end;
$$;

-- Whether a Lab member meets a badge's criteria for week p_week (default D = 9 Nov).
create function pg_temp.met(p_user text, p_key text, p_week date default '2026-11-09')
returns boolean
language sql
as $$
  select exists (
    select 1 from private.badge_criteria_met(pg_temp.mid(p_user, 'lab'), p_week) k
    where k = p_key
  );
$$;

-- Keys a member has earned in a group (setting name), by key, with the earning week.
create function pg_temp.earned(p_user text, p_group text)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(a.badge_key || '@' || a.week_start, ',' order by a.badge_key, a.week_start), '')
  from public.badge_awards a
  join public.memberships m on m.id = a.membership_id
  where m.group_id = current_setting('test.' || p_group)::uuid
    and m.user_id = tests.get_supabase_uid(p_user);
$$;

-- The status of each of a member's badges in get_member_profile, as key:status for the given keys.
create function pg_temp.statuses(p_group text, p_user text, p_keys text[])
returns text
language sql
as $$
  select pg_catalog.string_agg(b ->> 'key' || ':' || (b ->> 'status'), ',' order by o)
  from public.get_member_profile(current_setting('test.' || p_group)::uuid,
                                 tests.get_supabase_uid(p_user)) gp
  cross join lateral pg_catalog.jsonb_array_elements(gp.badges) with ordinality as x(b, o)
  where b ->> 'key' = any (p_keys);
$$;

grant execute on function pg_temp.statuses(text, text, text[]) to authenticated;

-- An activity for the Lab members.
insert into public.group_activities (group_id, preset_key, created_by)
values (current_setting('test.lab')::uuid, 'gym', tests.get_supabase_uid('boss'));

-- ===== Lab: criteria at each threshold and one below =====
select pg_temp.lab_user(n, z)
from (values ('First', 'UTC'), ('Nothing', 'UTC'), ('Three', 'UTC'), ('Two', 'UTC'), ('Ten', 'UTC'),
             ('Nine', 'UTC'), ('TwentyFive', 'UTC'), ('TwentyFour', 'UTC'), ('Month', 'UTC'),
             ('ThreeWeeks', 'UTC'), ('Perfect2', 'UTC'), ('HalfThen', 'UTC'), ('Comeback', 'UTC'),
             ('FreshPerfect', 'UTC'), ('Half', 'UTC'), ('Manila', 'Asia/Manila'), ('AlmostEarly', 'UTC'),
             ('Owl', 'UTC'), ('AlmostOwl', 'UTC'), ('Slayer', 'UTC'), ('NineTasks', 'UTC'),
             ('Crowns', 'UTC')) u(n, z);

select pg_temp.daily(pg_temp.plan('First', 'lab', null), '2026-11-15', 1);
select pg_temp.session(pg_temp.plan('Nothing', 'lab', null), '2026-11-15', false, 7::smallint, null);
select pg_temp.daily(pg_temp.plan('Three', 'lab', null), '2026-11-15', 3);
select pg_temp.daily(pg_temp.plan('Two', 'lab', null), '2026-11-15', 2);
select pg_temp.daily(pg_temp.plan('Ten', 'lab', null), '2026-11-15', 10);
select pg_temp.daily(pg_temp.plan('Nine', 'lab', null), '2026-11-15', 9);
select pg_temp.daily(pg_temp.plan('TwentyFive', 'lab', null), '2026-11-15', 25);
select pg_temp.daily(pg_temp.plan('TwentyFour', 'lab', null), '2026-11-15', 24);

select pg_catalog.set_config('test.month', pg_temp.plan('Month', 'lab', 1::smallint)::text, true);
select pg_temp.week(current_setting('test.month')::uuid, w, 1, 1)
from (values ('2026-10-19'::date), ('2026-10-26'), ('2026-11-02'), ('2026-11-09')) v(w);
select pg_catalog.set_config('test.three_weeks', pg_temp.plan('ThreeWeeks', 'lab', 1::smallint)::text, true);
select pg_temp.week(current_setting('test.three_weeks')::uuid, w, 1, 1)
from (values ('2026-10-26'::date), ('2026-11-02'), ('2026-11-09')) v(w);

select pg_catalog.set_config('test.p2', pg_temp.plan('Perfect2', 'lab', 2::smallint)::text, true);
select pg_temp.week(current_setting('test.p2')::uuid, '2026-11-02', 2, 2);
select pg_temp.week(current_setting('test.p2')::uuid, '2026-11-09', 2, 2);
select pg_catalog.set_config('test.half_then', pg_temp.plan('HalfThen', 'lab', 2::smallint)::text, true);
select pg_temp.week(current_setting('test.half_then')::uuid, '2026-11-02', 2, 1);
select pg_temp.week(current_setting('test.half_then')::uuid, '2026-11-09', 2, 2);
select pg_catalog.set_config('test.comeback', pg_temp.plan('Comeback', 'lab', 3::smallint)::text, true);
select pg_temp.week(current_setting('test.comeback')::uuid, '2026-11-02', 3, 1);
select pg_temp.week(current_setting('test.comeback')::uuid, '2026-11-09', 3, 3);
select pg_temp.week(pg_temp.plan('FreshPerfect', 'lab', 1::smallint), '2026-11-09', 1, 1);
select pg_temp.week(pg_temp.plan('Half', 'lab', 2::smallint), '2026-11-09', 2, 1);

-- 22:30 UTC is 06:30 in Manila: early there, late in UTC.
select pg_temp.taken(pg_temp.plan('Manila', 'lab', 5::smallint), '2026-11-02',
  array['2026-11-02 22:30+00', '2026-11-03 22:30+00', '2026-11-04 22:30+00', '2026-11-05 22:30+00',
        '2026-11-06 22:30+00']::timestamptz[]);
select pg_temp.taken(pg_temp.plan('AlmostEarly', 'lab', 5::smallint), '2026-11-02',
  array['2026-11-02 06:59+00', '2026-11-03 06:59+00', '2026-11-04 06:59+00', '2026-11-05 06:59+00',
        '2026-11-06 07:00+00']::timestamptz[]);
select pg_temp.taken(pg_temp.plan('Owl', 'lab', 5::smallint), '2026-11-02',
  array['2026-11-02 22:00+00', '2026-11-03 22:00+00', '2026-11-04 23:59+00', '2026-11-05 22:00+00',
        '2026-11-06 22:00+00']::timestamptz[]);
select pg_temp.taken(pg_temp.plan('AlmostOwl', 'lab', 5::smallint), '2026-11-02',
  array['2026-11-02 22:00+00', '2026-11-03 22:00+00', '2026-11-04 22:00+00', '2026-11-05 22:00+00',
        '2026-11-06 21:59+00']::timestamptz[]);

select pg_temp.tasks('Slayer', 10);
select pg_temp.tasks('NineTasks', 9);

insert into public.badge_awards (group_id, membership_id, user_id, badge_key, week_start)
select current_setting('test.lab')::uuid, pg_temp.mid('Crowns', 'lab'), tests.get_supabase_uid('Crowns'),
       'weekly_winner', w
from (values ('2026-10-19'::date), ('2026-10-26'), ('2026-11-09')) v(w);

select is(pg_temp.met('First', 'first_proof')::text || pg_temp.met('Nothing', 'first_proof')::text,
  'truefalse', 'First Proof: 1 check-in yes, none (a missed session) no');
select is(pg_temp.met('Three', 'hat_trick')::text || pg_temp.met('Two', 'hat_trick')::text,
  'truefalse', 'Hat Trick: streak 3 yes, 2 no');
select is(pg_temp.met('Ten', 'on_a_roll')::text || pg_temp.met('Nine', 'on_a_roll')::text,
  'truefalse', 'On a Roll: streak 10 yes, 9 no');
select is(pg_temp.met('TwentyFive', 'unbreakable')::text || pg_temp.met('TwentyFour', 'unbreakable')::text,
  'truefalse', 'Unbreakable: streak 25 yes, 24 no');
select is(pg_temp.met('Month', 'monthly_machine')::text || pg_temp.met('ThreeWeeks', 'monthly_machine')::text
  || pg_temp.met('ThreeWeeks', 'hat_trick')::text,
  'truefalsetrue', 'Monthly Machine: 4 target-met weeks yes, 3 no (3 weeks is a Hat Trick)');
select is(pg_temp.met('Month', 'monthly_machine', '2026-11-02')::text, 'false',
  'Monthly Machine reads the streak through D (3 weeks through 2 Nov)');
select is(pg_temp.met('FreshPerfect', 'clean_sheet')::text || pg_temp.met('Half', 'clean_sheet')::text
  || pg_temp.met('Nothing', 'clean_sheet')::text,
  'truefalsefalse', 'Clean Sheet: every session done yes, 1 of 2 no, a missed week no');
select is(pg_temp.met('Perfect2', 'back_to_back')::text || pg_temp.met('HalfThen', 'back_to_back')::text,
  'truefalse', 'Back-to-Back: two perfect weeks yes, a half week before no');
select is(pg_temp.met('Comeback', 'comeback')::text || pg_temp.met('HalfThen', 'comeback')::text
  || pg_temp.met('FreshPerfect', 'comeback')::text,
  'truefalsefalse', 'Comeback: after 33 points yes, after 50 no, after no score no');
select is(pg_temp.met('Manila', 'early_bird')::text || pg_temp.met('Manila', 'night_owl')::text
  || pg_temp.met('AlmostEarly', 'early_bird')::text,
  'truefalsefalse', 'Early Bird: 5 before 07:00 in the member''s zone yes; 4 (07:00 is not before) no');
select is(pg_temp.met('Owl', 'night_owl')::text || pg_temp.met('AlmostOwl', 'night_owl')::text,
  'truefalse', 'Night Owl: 5 at or after 22:00 yes, 4 (21:59 is not) no');
select is(pg_temp.met('Slayer', 'task_slayer')::text || pg_temp.met('NineTasks', 'task_slayer')::text,
  'truefalse', 'Task Slayer: 10 tasks done yes, 9 no');
select is(pg_temp.met('Crowns', 'dynasty')::text || pg_temp.met('Crowns', 'dynasty', '2026-11-02')::text,
  'truefalse', 'Dynasty: 3 Weekly Winner awards up to D yes, 2 no');
select is(
  (select pg_catalog.count(*)::integer
   from public.memberships m
   cross join lateral private.badge_criteria_met(m.id, '2026-11-09') k
   where m.group_id = current_setting('test.lab')::uuid
     and k in ('team_player', 'fair_judge', 'weekly_winner')),
  0, 'Team Player, Fair Judge and Weekly Winner are never met by the criteria here'
);

-- ===== Crew and Solo: awards at the lock =====
-- alice (fixed days every day): P 7 of 7, W 7 of 7. bob (1 a week): 3 target-met weeks to P (Hat
-- Trick at P), then W 0 of 1. sam: nothing planned. frank (Solo, 1 a week): P 1 of 1.
select pg_catalog.set_config('test.a', pg_temp.plan('alice', 'g1', null)::text, true);
select pg_temp.daily(current_setting('test.a')::uuid, '2026-11-15', 7);
select pg_catalog.set_config('test.b', pg_temp.plan('bob', 'g1', 1::smallint)::text, true);
select pg_temp.week(current_setting('test.b')::uuid, w, 1, 1)
from (values ('2026-10-26'::date), ('2026-11-02'), ('2026-11-09')) v(w);
select pg_temp.week(current_setting('test.b')::uuid, '2026-11-16', 1, 0);
select pg_temp.week(pg_temp.plan('frank', 'g3', 1::smallint), '2026-11-09', 1, 1);

select private.ensure_group_week(g.id, w.week)
from (values (current_setting('test.g1')::uuid), (current_setting('test.g3')::uuid)) g(id)
cross join (values ('2026-11-09'::date), ('2026-11-16'::date), ('2026-11-23'::date)) w(week);

-- Before P locks (Wed 18 Nov): alice's P badges are pending, with P's lock.
select tests.authenticate_as('alice');
select is(
  pg_temp.statuses('g1', 'alice', array['first_proof', 'clean_sheet', 'hat_trick', 'weekly_winner', 'task_slayer']),
  'first_proof:pending,hat_trick:pending,clean_sheet:pending,weekly_winner:locked,task_slayer:locked',
  'before the lock: met badges are pending, Weekly Winner and unmet ones locked'
);
select is(
  (select b ->> 'pending_lock_at'
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('alice')) gp
   cross join lateral pg_catalog.jsonb_array_elements(gp.badges) b
   where b ->> 'key' = 'clean_sheet')::timestamptz,
  '2026-11-19 00:00:00+00'::timestamptz,
  'a pending badge carries the lock of the earliest unlocked week that meets it'
);
reset role;
select is(pg_temp.earned('alice', 'g1'), '', 'no award before the lock');

select tests.freeze_time('2026-11-19 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'P locks without an error');
select is(pg_temp.earned('alice', 'g1'),
  'clean_sheet@2026-11-09,first_proof@2026-11-09,hat_trick@2026-11-09,weekly_winner@2026-11-09',
  'alice at P: First Proof, Hat Trick, Clean Sheet and the Weekly Winner badge');
select is(pg_temp.earned('bob', 'g1'),
  'back_to_back@2026-11-09,clean_sheet@2026-11-09,first_proof@2026-11-09,hat_trick@2026-11-09,weekly_winner@2026-11-09',
  'bob at P (3 target-met weeks, the week before perfect too): Back-to-Back as well, co-winner on 100');
select is(pg_temp.earned('sam', 'g1'), '', 'sam (nothing planned, unscored): nothing');
select is(pg_temp.earned('frank', 'g3'), 'clean_sheet@2026-11-09,first_proof@2026-11-09',
  'a solo week awards plan badges, never Weekly Winner');
select is(
  (select pg_catalog.count(*)::integer from public.badge_awards a
   where a.group_id = current_setting('test.g1')::uuid and a.awarded_at <> '2026-11-19 00:00:01+00'),
  0, 'awards are stamped with the lock time'
);

select tests.authenticate_as('alice');
select is(
  pg_temp.statuses('g1', 'alice', array['first_proof', 'clean_sheet', 'weekly_winner', 'back_to_back']),
  'first_proof:earned,clean_sheet:earned,back_to_back:locked,weekly_winner:earned',
  'after the lock: earned; Back-to-Back stays locked while W has no sessions'
);

-- ===== W locks: once per membership, Weekly Winner per week, no revocation =====
reset role;
select pg_temp.daily(current_setting('test.a')::uuid, '2026-11-22', 7);
select tests.freeze_time('2026-11-26 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'W locks without an error');
select is(pg_temp.earned('alice', 'g1'),
  'back_to_back@2026-11-16,clean_sheet@2026-11-09,first_proof@2026-11-09,hat_trick@2026-11-09,'
  || 'on_a_roll@2026-11-16,weekly_winner@2026-11-09,weekly_winner@2026-11-16',
  'alice at W: Back-to-Back and On a Roll (14) are new; Clean Sheet is not earned twice; a second Weekly Winner');
select is(pg_temp.earned('bob', 'g1'),
  'back_to_back@2026-11-09,clean_sheet@2026-11-09,first_proof@2026-11-09,hat_trick@2026-11-09,weekly_winner@2026-11-09',
  'bob missed W (streak back to 0): Hat Trick stays (never revoked), nothing new');
select is(
  (select pg_catalog.count(*)::integer from private.badge_criteria_met(pg_temp.mid('bob', 'g1'), '2026-11-16') k
   where k = 'hat_trick'),
  0, 'bob no longer meets Hat Trick at W, yet keeps the award'
);
select is(private.lock_week(current_setting('test.g1')::uuid, '2026-11-16'), false,
  'a re-run on W is a no-op');
select is(
  (select pg_catalog.count(*)::integer from public.badge_awards where group_id = current_setting('test.g1')::uuid),
  12, 're-runs add no award'
);

-- ===== An unscored week (nobody current at its lock): no award =====
select tests.authenticate_as('kim');
select pg_catalog.set_config('test.g4', public.create_group('Late')::text, true);
reset role;
update public.memberships set joined_at = '2026-11-25 00:00:00+00'
where group_id = current_setting('test.g4')::uuid;
select pg_temp.week(pg_temp.plan('kim', 'g4', 1::smallint), '2026-11-09', 1, 1);
select private.ensure_group_week(current_setting('test.g4')::uuid, '2026-11-09');
select is(
  private.lock_week(current_setting('test.g4')::uuid, '2026-11-09')::text || '|' || pg_temp.earned('kim', 'g4'),
  'true|', 'an unscored week locks and awards nothing'
);

-- ===== get_member_profile =====
-- Titles from all-time points: alice has 200 (Couch Potato); 100 more stored points make 300.
select tests.authenticate_as('bob');
select is(
  (select gp.display_name || '|' || gp.is_current_member || '|' || gp.all_time_points || '|'
          || gp.title_key || '|' || gp.time_zone || '|' || pg_catalog.jsonb_array_length(gp.badges)
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('alice')) gp),
  'Alice|true|200|couch_potato|UTC|15',
  'another member''s profile: name, membership, all-time points, title, zone, 15 badges'
);
select is(
  (select pg_catalog.string_agg(b ->> 'key', ',' order by o)
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('alice')) gp
   cross join lateral pg_catalog.jsonb_array_elements(gp.badges) with ordinality as x(b, o)),
  'first_proof,hat_trick,on_a_roll,unbreakable,clean_sheet,back_to_back,monthly_machine,comeback,'
  || 'weekly_winner,dynasty,team_player,fair_judge,early_bird,night_owl,task_slayer',
  'badges come in catalog order'
);
select is(
  (select (b ->> 'name') || '|' || (b ->> 'line') || '|' || (b ->> 'icon') || '|' || (b ->> 'awarded_at')::timestamptz
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('alice')) gp
   cross join lateral pg_catalog.jsonb_array_elements(gp.badges) b
   where b ->> 'key' = 'weekly_winner'),
  'Weekly Winner|Top of the board. Enjoy it while it lasts.|trophy|2026-11-26 00:00:01+00',
  'an earned badge carries the catalog copy and its latest award'
);
select is(
  (select pg_catalog.string_agg((s ->> 'activity_name') || ':' || (s ->> 'current_streak') || ':' || (s ->> 'back_to_zero'), ',')
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('bob')) gp
   cross join lateral pg_catalog.jsonb_array_elements(gp.streaks) s),
  'Gym:0:true',
  'streaks: each active commitment with its streak and back to 0'
);
reset role;
insert into public.week_results (group_id, membership_id, user_id, week_start, weekly_points,
                                 sessions_done, sessions_planned, sessions_frozen, rank)
values (current_setting('test.g1')::uuid, pg_temp.mid('alice', 'g1'), tests.get_supabase_uid('alice'),
        '2026-11-02', 100, 1, 1, 0, null);
select tests.authenticate_as('bob');
select is(
  (select gp.all_time_points || '|' || gp.title_key
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('alice')) gp),
  '300|warming_up',
  'the title follows private.all_time_points (300: Warming Up)'
);
select tests.authenticate_as('sam');
select public.leave_group(current_setting('test.g1')::uuid);
select tests.authenticate_as('bob');
select is(
  (select gp.display_name || '|' || gp.is_current_member || '|' || pg_catalog.jsonb_array_length(gp.badges)
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('sam')) gp),
  'Sam|false|0',
  'a member who left: the name, not current, no badges'
);
select is(
  (select pg_catalog.count(*)::integer
   from public.get_member_profile(current_setting('test.g1')::uuid, tests.get_supabase_uid('frank'))),
  0, 'someone never in the group: no row'
);
select tests.authenticate_as('kim');
select throws_ok(
  format('select * from public.get_member_profile(%L::uuid, %L::uuid)',
         current_setting('test.g1'), tests.get_supabase_uid('alice')),
  'P0001', 'not_member',
  'get_member_profile raises not_member for a caller outside the group'
);
select tests.authenticate_as('frank');
select is(
  pg_temp.statuses('g3', 'frank', array['first_proof', 'clean_sheet', 'weekly_winner']),
  'first_proof:earned,clean_sheet:earned,weekly_winner:locked',
  'a solo member''s profile: plan badges earned, Weekly Winner locked'
);
select tests.authenticate_as('kim');
select is((select pg_catalog.count(*)::integer from public.titles), 6, 'any signed-in user reads the titles');
select throws_ok(
  $$insert into public.titles (key, name, min_points, sort_order) values ('x', 'X', 1, 9)$$,
  '42501', null, 'no client writes to titles'
);

-- get_winner_week carries the catalog's Weekly Winner copy.
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.string_agg(distinct w.badge_name || '|' || w.badge_line, ';')
   from public.get_winner_week(current_setting('test.g1')::uuid, '2026-11-09') w),
  'Weekly Winner|Top of the board. Enjoy it while it lasts.',
  'get_winner_week returns the badge name and line from the catalog'
);

select * from finish();
rollback;
