-- Epic 4 retro fixes (spec-epic-4-retro-fixes.md; sprint-status items 17-20). Aldrin's decisions of
-- 2026-11-21: the monthly goal counts every week of the month with a goal average and is always
-- judged at the month's last lock (also solo or with no scorer; no average anywhere = no result);
-- Team Player is earned on every hit; the late-joiner rule stays (members current at the lock).
-- Covers: a solo closing week, a no-scorer closing week, a month with no value, a weekly-to-monthly
-- switch mid-month, repeat Team Player (and award_count), re-runs, last_result per period,
-- month_value_now equal to the closing lock's value, the lock's feed order (winner above goal, a
-- catch-up run never interleaving weeks), a whole month locked in one catch-up run (V1, with
-- Dynasty), get_board of a locked week after the group's size changed (V2), the winner award and
-- event beside a goal (V3), and a join between week end and lock (V4).
--
-- Clock and weeks (UTC groups): a week's lock is the Thursday 10 days after its Monday. November's
-- locks: weeks of 26 Oct, 2, 9 and 16 Nov; 16 Nov closes November (23 Nov locks Thu 3 Dec).
-- Solo  (ann admin, ben): monthly 80 from 26 Oct; 26 Oct 100/80 = 90.0, 2 Nov 100/60 = 80.0; ben
--       leaves 14 Nov, so 9 and 16 Nov are solo; November = 85.0, hit at 16 Nov (ann alone).
-- Quiet (cal admin, dee): monthly 70 from 2 Nov; 2 Nov 100/60 = 80.0; 9 and 16 Nov nothing planned;
--       November = 80.0, hit at 16 Nov.
-- Empty (eve admin, fay): monthly 60 from 2 Nov; nothing planned: no result.
-- Mix   (gus admin, hal): weekly 50 from 26 Oct; 26 Oct 100/50 = 75.0 hit, 2 Nov 100/20 = 60.0 hit
--       (both locked in one catch-up run); monthly 80 from 9 Nov; 9 Nov 100/100, 16 Nov 100/80 =
--       90.0; November = (75 + 60 + 100 + 90) / 4 = 81.25 → 81.3, hit at 16 Nov.
-- Run   (ivy admin, jon): monthly 50 from 26 Oct; ivy 100, jon 50 every week; all four November
--       weeks lock in one run (V1).
-- Late  (kay admin; lee joins Tue 17 Nov): 9 Nov kay 100, solo when it ended (V4); lee leaves on 20
--       Nov (V2).
-- Grow  (nia admin; ola joins on 20 Nov): 9 Nov nia 100, a solo locked week (V2).
begin;
set local timezone = 'UTC';
select plan(49);

select tests.create_supabase_user(u)
from (values ('ann'), ('ben'), ('cal'), ('dee'), ('eve'), ('fay'), ('gus'), ('hal'), ('ivy'),
             ('jon'), ('kay'), ('lee'), ('nia'), ('ola')) v(u);

-- ===== Grants (AD-16) =====
select ok(
  (select bool_and(not has_function_privilege(r.role, 'private.goal_month_value(uuid, date, numeric)', 'EXECUTE'))
   from (values ('authenticated'), ('anon'), ('public')) r(role))
  and (select p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig)
       from pg_catalog.pg_proc p
       where p.oid = 'private.goal_month_value(uuid, date, numeric)'::regprocedure)
  and has_function_privilege('authenticated', 'public.get_group_goal(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_group_goal(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_member_profile(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_member_profile(uuid, uuid)', 'EXECUTE'),
  'goal_month_value is closed to clients; get_group_goal and get_member_profile stay for signed-in members'
);

-- ===== Groups =====
create function pg_temp.pair(p_admin text, p_admin_name text, p_other text, p_other_name text,
                             p_group text, p_name text)
returns void
language plpgsql
as $$
begin
  perform tests.authenticate_as(p_admin);
  perform public.save_profile(p_admin_name, 'UTC');
  perform pg_catalog.set_config('test.' || p_group, public.create_group(p_name)::text, true);
  perform pg_catalog.set_config('test.code',
    (select code from public.create_invite(current_setting('test.' || p_group)::uuid, false)), true);
  if p_other is not null then
    perform tests.authenticate_as(p_other);
    perform public.save_profile(p_other_name, 'UTC');
    perform public.join_group(current_setting('test.code'));
  end if;
end;
$$;
grant execute on function pg_temp.pair(text, text, text, text, text, text) to authenticated;

select pg_temp.pair('ann', 'Ann', 'ben', 'Ben', 'solo', 'Solo');
select pg_temp.pair('cal', 'Cal', 'dee', 'Dee', 'quiet', 'Quiet');
select pg_temp.pair('eve', 'Eve', 'fay', 'Fay', 'empty', 'Empty');
select pg_temp.pair('gus', 'Gus', 'hal', 'Hal', 'mix', 'Mix');
select pg_temp.pair('ivy', 'Ivy', 'jon', 'Jon', 'run', 'Run');
select pg_temp.pair('kay', 'Kay', 'lee', 'Lee', 'late', 'Late');
select pg_temp.pair('nia', 'Nia', null, null, 'grow', 'Grow');
select pg_catalog.set_config('test.grow_code', current_setting('test.code'), true);
select tests.authenticate_as('ola');
select public.save_profile('Ola', 'UTC');
reset role;

-- ===== Fixture (temporary, as the table owner) =====
update public.memberships set joined_at = '2026-10-01 00:00:00+00' where ended_at is null;
-- lee joined the Late group on Tue 17 Nov, after the week of 9 Nov ended and before its lock.
update public.memberships set joined_at = '2026-11-17 10:00:00+00'
where group_id = current_setting('test.late')::uuid and user_id = tests.get_supabase_uid('lee');

alter function private.lock_week(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.lock_due_weeks() set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function public.get_member_profile(uuid, uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_group_goal(uuid) set search_path = test_overrides, pg_catalog;
alter function public.get_board(uuid, date) set search_path = test_overrides, pg_catalog;

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

-- A goal version written directly.
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

-- A group's goal_result events: week:period:target:average:hit, by week.
create function pg_temp.events(p_group text)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(
    (e.payload ->> 'week_start') || ':' || (e.payload ->> 'period') || ':' || (e.payload ->> 'target')
    || ':' || (e.payload ->> 'average') || ':' || (e.payload ->> 'hit'),
    ',' order by e.payload ->> 'week_start'), '')
  from public.feed_events e
  where e.group_id = current_setting('test.' || p_group)::uuid
    and e.kind = 'goal_result';
$$;

-- Awards of one badge in a group: Name@week, by name and week.
create function pg_temp.awards(p_group text, p_key text)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(p.display_name || '@' || a.week_start, ','
                                        order by p.display_name, a.week_start), '')
  from public.badge_awards a
  join public.profiles p on p.id = a.user_id
  where a.group_id = current_setting('test.' || p_group)::uuid
    and a.badge_key = p_key;
$$;

-- The lock's stickies on the group's Feed, in the Feed's order (sort_at desc, item_id desc):
-- kind@week.
create function pg_temp.lock_feed(p_group text)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(f.item_kind || '@' || (f.payload ->> 'week_start'), ','
                                        order by f.sort_at desc, f.item_id desc), '')
  from public.feed_items f
  where f.group_id = current_setting('test.' || p_group)::uuid
    and f.item_kind in ('weekly_winner', 'goal_result');
$$;

-- One badge in get_member_profile (as the calling user): status|award_count|awarded week (UTC).
create function pg_temp.badge(p_group text, p_user text, p_key text)
returns text
language sql
as $$
  select (b ->> 'status') || '|' || (b ->> 'award_count')
  from public.get_member_profile(current_setting('test.' || p_group)::uuid,
                                 tests.get_supabase_uid(p_user)) gp
  cross join lateral pg_catalog.jsonb_array_elements(gp.badges) b
  where b ->> 'key' = p_key;
$$;

-- get_group_goal (as the calling user): member_count|month_value_now|last_result period:week:average
-- (or "none").
create function pg_temp.panel(p_group text)
returns text
language sql
as $$
  select gg.member_count || '|' || coalesce(gg.month_value_now::text, 'null') || '|'
         || coalesce((gg.last_result ->> 'period') || ':' || (gg.last_result ->> 'week_start') || ':'
                     || (gg.last_result ->> 'average'), 'none')
  from public.get_group_goal(current_setting('test.' || p_group)::uuid) gg;
$$;

grant execute on function pg_temp.badge(text, text, text) to authenticated;
grant execute on function pg_temp.panel(text) to authenticated;

select pg_temp.goal('solo', 80::smallint, 'monthly', '2026-10-26', 'ann');
select pg_temp.goal('quiet', 70::smallint, 'monthly', '2026-11-02', 'cal');
select pg_temp.goal('empty', 60::smallint, 'monthly', '2026-11-02', 'eve');
select pg_temp.goal('mix', 50::smallint, 'weekly', '2026-10-26', 'gus');
select pg_temp.goal('mix', 80::smallint, 'monthly', '2026-11-09', 'gus');
select pg_temp.goal('run', 50::smallint, 'monthly', '2026-10-26', 'ivy');

-- Solo: 26 Oct ann 1/1, ben 4/5; 2 Nov ann 1/1, ben 3/5; 9 and 16 Nov ann 1/1.
select pg_catalog.set_config('test.ann', pg_temp.plan('ann', 'solo')::text, true);
select pg_catalog.set_config('test.ben', pg_temp.plan('ben', 'solo')::text, true);
select pg_temp.week(current_setting('test.ann')::uuid, w, 1, 1)
from (values ('2026-10-26'::date), ('2026-11-02'), ('2026-11-09'), ('2026-11-16')) v(w);
select pg_temp.week(current_setting('test.ben')::uuid, '2026-10-26', 5, 4);
select pg_temp.week(current_setting('test.ben')::uuid, '2026-11-02', 5, 3);
-- Quiet: 2 Nov cal 1/1, dee 3/5.
select pg_temp.week(pg_temp.plan('cal', 'quiet'), '2026-11-02', 1, 1);
select pg_temp.week(pg_temp.plan('dee', 'quiet'), '2026-11-02', 5, 3);
-- Mix: gus 1/1 every week; hal 26 Oct 1/2, 2 Nov 1/5, 9 Nov 1/1, 16 Nov 4/5.
select pg_catalog.set_config('test.gus', pg_temp.plan('gus', 'mix')::text, true);
select pg_catalog.set_config('test.hal', pg_temp.plan('hal', 'mix')::text, true);
select pg_temp.week(current_setting('test.gus')::uuid, w, 1, 1)
from (values ('2026-10-26'::date), ('2026-11-02'), ('2026-11-09'), ('2026-11-16')) v(w);
select pg_temp.week(current_setting('test.hal')::uuid, '2026-10-26', 2, 1);
select pg_temp.week(current_setting('test.hal')::uuid, '2026-11-02', 5, 1);
select pg_temp.week(current_setting('test.hal')::uuid, '2026-11-09', 1, 1);
select pg_temp.week(current_setting('test.hal')::uuid, '2026-11-16', 5, 4);
-- Run: ivy 1/1, jon 1/2 every November week.
select pg_catalog.set_config('test.ivy', pg_temp.plan('ivy', 'run')::text, true);
select pg_catalog.set_config('test.jon', pg_temp.plan('jon', 'run')::text, true);
select pg_temp.week(current_setting('test.ivy')::uuid, w, 1, 1)
from (values ('2026-10-26'::date), ('2026-11-02'), ('2026-11-09'), ('2026-11-16')) v(w);
select pg_temp.week(current_setting('test.jon')::uuid, w, 2, 1)
from (values ('2026-10-26'::date), ('2026-11-02'), ('2026-11-09'), ('2026-11-16')) v(w);
-- Late and Grow: 9 Nov kay 1/1, nia 1/1.
select pg_temp.week(pg_temp.plan('kay', 'late'), '2026-11-09', 1, 1);
select pg_temp.week(pg_temp.plan('nia', 'grow'), '2026-11-09', 1, 1);

-- Week rows (Run's come just before its one catch-up run).
select private.ensure_group_week(current_setting('test.' || g)::uuid, w)
from (values ('solo'), ('mix')) v(g)
cross join (values ('2026-10-26'::date), ('2026-11-02'::date), ('2026-11-09'::date),
                   ('2026-11-16'::date)) x(w);
select private.ensure_group_week(current_setting('test.' || g)::uuid, w)
from (values ('quiet'), ('empty')) v(g)
cross join (values ('2026-11-02'::date), ('2026-11-09'::date), ('2026-11-16'::date)) x(w);
select private.ensure_group_week(current_setting('test.' || g)::uuid, '2026-11-09')
from (values ('late'), ('grow')) v(g);

-- ===== Thu 12 Nov: one catch-up run locks 26 Oct and 2 Nov =====
select tests.freeze_time('2026-11-12 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'the first catch-up run locks without an error');
select is(pg_temp.goal_row('mix', '2026-10-26') || ',' || pg_temp.goal_row('mix', '2026-11-02'),
  '50|weekly|75.0|true|75.0,50|weekly|60.0|true|60.0',
  'Mix: both weekly results decided in the one run');
select is(pg_temp.awards('mix', 'team_player'),
  'Gus@2026-10-26,Gus@2026-11-02,Hal@2026-10-26,Hal@2026-11-02',
  'Team Player is earned on every hit: two weeks, two awards each');
select is(pg_temp.lock_feed('mix'),
  'weekly_winner@2026-11-02,goal_result@2026-11-02,weekly_winner@2026-10-26,goal_result@2026-10-26',
  'Feed order: each week''s winner sticky right above its goal sticky, the newer week''s pair on top');
select is(
  (select pg_catalog.string_agg(e.kind || '=' || e.created_at, ',' order by e.created_at desc)
   from public.feed_events e
   where e.group_id = current_setting('test.mix')::uuid
     and e.payload ->> 'week_start' = '2026-11-02'
     and e.kind in ('weekly_winner', 'goal_result')),
  'weekly_winner=2026-11-12 00:00:00.001+00,goal_result=2026-11-12 00:00:00+00',
  'a catch-up run writes each week''s stickies at that week''s own lock time'
);
select tests.authenticate_as('gus');
select is(pg_temp.panel('mix'), '2|78.3|weekly:2026-11-02:60.0',
  'last_result: the weekly result of the newest locked week, with its own period although the goal is monthly now; month_value_now = (75 + 60 + live 100) / 3');
select is(pg_temp.badge('mix', 'gus', 'team_player'), 'earned|2',
  'get_member_profile: Team Player earned, award_count 2');
select is(pg_temp.badge('mix', 'gus', 'first_proof'), 'earned|1',
  'a one-time badge has award_count 1');
select is(pg_temp.badge('mix', 'gus', 'night_owl'), 'locked|0',
  'a badge never earned has award_count 0');
reset role;
select is(pg_temp.goal_row('solo', '2026-10-26') || ',' || pg_temp.goal_row('solo', '2026-11-02'),
  '80|monthly|90.0||,80|monthly|80.0||',
  'Solo: two ranked November weeks with an average, the month not decided yet');

-- ben leaves Solo on Sat 14 Nov: 9 and 16 Nov lock with ann alone.
update public.memberships set ended_at = '2026-11-14 12:00:00+00', end_reason = 'left'
where group_id = current_setting('test.solo')::uuid and user_id = tests.get_supabase_uid('ben');

-- ===== Thu 19 Nov: 9 Nov locks =====
select tests.freeze_time('2026-11-19 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'the 9 Nov weeks lock without an error');
select is(pg_temp.goal_row('mix', '2026-11-09'), '80|monthly|100.0||',
  'Mix 9 Nov: monthly from this week, mid-month, so only the values');
select is(pg_temp.goal_row('solo', '2026-11-09'), '||||',
  'Solo 9 Nov: a solo week mid-month gets no goal values');

-- V4: lee joined after the week ended and before its lock, so the week is ranked (decision 2).
select is(
  (select r.ranked || '|' || pg_catalog.array_length(r.winner_user_ids, 1)
   from public.group_week_results r
   where r.group_id = current_setting('test.late')::uuid and r.week_start = '2026-11-09'),
  'true|1', 'V4: a join between week end and lock makes the solo week ranked, with one winner');
select is(
  (select pg_catalog.string_agg(p.display_name || ':' || coalesce(w.weekly_points::text, 'null') || ':'
                                || coalesce(w.rank::text, 'null'), ',' order by p.display_name)
   from public.week_results w join public.profiles p on p.id = w.user_id
   where w.group_id = current_setting('test.late')::uuid and w.week_start = '2026-11-09'),
  'Kay:100:1,Lee:null:null',
  'V4: both members current at the lock get rows; kay ranks 1, lee has no score');
select is(pg_temp.awards('late', 'weekly_winner'), 'Kay@2026-11-09',
  'V4: kay earns Weekly Winner for that week');

-- Matrix: a weekly result is shown only while its week is the newest locked week.
select tests.authenticate_as('gus');
select is(pg_temp.panel('mix'), '2|81.3|none',
  'Mix now (16 Nov, monthly): last_result hidden (a later week locked), month_value_now = (75 + 60 + 100 + live 90) / 4');
select tests.authenticate_as('ann');
select is(pg_temp.panel('solo'), '1|85.0|none',
  'Solo now: ann alone, month_value_now from the month''s two weeks with an average');
select is(pg_temp.badge('solo', 'ann', 'team_player'), 'pending|0',
  'Solo: the solo closing week meets the monthly goal, so Team Player is pending');
select tests.authenticate_as('cal');
select is(pg_temp.panel('quiet'), '2|80.0|none',
  'Quiet now: nobody scored this week, month_value_now = 2 Nov''s 80.0');

-- V2: the locked weeks keep their stored rows after the group's size changes.
reset role;
update public.memberships set ended_at = '2026-11-20 08:00:00+00', end_reason = 'left'
where group_id = current_setting('test.late')::uuid and user_id = tests.get_supabase_uid('lee');
select tests.authenticate_as('ola');
select public.join_group(current_setting('test.grow_code'));
select tests.authenticate_as('kay');
select is(
  (select pg_catalog.string_agg(b.display_name || ':' || coalesce(b.rank::text, 'null'), ' '
                                order by b.display_name)
   || '|' || pg_catalog.bool_or(b.waiting) || '|' || pg_catalog.bool_and(b.locked)
   from public.get_board(current_setting('test.late')::uuid, '2026-11-09') b),
  'Kay:1 Lee:null|false|true',
  'V2: after lee leaves, the locked ranked week still has both stored rows and is not waiting');
select tests.authenticate_as('nia');
select is(
  (select pg_catalog.string_agg(b.display_name || ':' || coalesce(b.rank::text, 'null'), ' '
                                order by b.display_name)
   || '|' || pg_catalog.bool_or(b.waiting) || '|' || pg_catalog.bool_and(b.locked)
   from public.get_board(current_setting('test.grow')::uuid, '2026-11-09') b),
  'Nia:null|true|true',
  'V2: after ola joins, the locked solo week still has one row and stays waiting (not ranked)');

-- ===== Thu 26 Nov: 16 Nov closes November; Run's whole month locks in this one run (V1) =====
reset role;
select private.ensure_group_week(current_setting('test.run')::uuid, w)
from (values ('2026-10-26'::date), ('2026-11-02'::date), ('2026-11-09'::date),
             ('2026-11-16'::date)) x(w);
select tests.freeze_time('2026-11-26 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'the November closing run locks without an error');

select is(pg_temp.goal_row('solo', '2026-11-16') || ';' || pg_temp.events('solo'),
  '80|monthly||true|85.0;2026-11-16:monthly:80:85.0:true',
  'a solo closing week decides the month from the weeks with an average (goal_average null)');
select is(pg_temp.awards('solo', 'team_player'), 'Ann@2026-11-16',
  'the solo month hit: Team Player for the one member current at the lock');
select is(pg_temp.goal_row('quiet', '2026-11-16') || ';' || pg_temp.events('quiet'),
  '70|monthly||true|80.0;2026-11-16:monthly:70:80.0:true',
  'a closing week where nobody scored still decides the month');
select is(pg_temp.awards('quiet', 'team_player'), 'Cal@2026-11-16,Dee@2026-11-16',
  'no-scorer closing week: every member current at the lock earns Team Player');
select is(pg_temp.goal_row('empty', '2026-11-16') || ';' || pg_temp.events('empty') || ';'
          || pg_temp.awards('empty', 'team_player'),
  '||||;;', 'a month with no goal average anywhere: no result, no event, no Team Player');

select is(pg_temp.goal_row('mix', '2026-11-16'), '80|monthly|90.0|true|81.3',
  'period switch: the month averages every week with a value, the weekly-judged weeks included');
select is(pg_temp.events('mix'),
  '2026-10-26:weekly:50:75.0:true,2026-11-02:weekly:50:60.0:true,2026-11-16:monthly:80:81.3:true',
  'Mix: two weekly results and one monthly result');
select is(pg_temp.awards('mix', 'team_player'),
  'Gus@2026-10-26,Gus@2026-11-02,Gus@2026-11-16,Hal@2026-10-26,Hal@2026-11-02,Hal@2026-11-16',
  'a weekly hit then a monthly hit: Team Player again at the month');
select is(pg_temp.awards('mix', 'weekly_winner') like '%Gus@2026-11-16%', true,
  'V3: the goal lock also awards the week''s winner');
select is(pg_temp.lock_feed('mix'),
  'weekly_winner@2026-11-16,goal_result@2026-11-16,weekly_winner@2026-11-09,'
  || 'weekly_winner@2026-11-02,goal_result@2026-11-02,weekly_winner@2026-10-26,goal_result@2026-10-26',
  'V3 and Feed order: the 16 Nov winner sticky on top, the goal sticky right under it');

-- V1: Run's four weeks locked oldest first in one run.
select is(
  (select pg_catalog.count(*)::integer from public.group_weeks gw
   where gw.group_id = current_setting('test.run')::uuid and gw.locked_at is not null),
  4, 'V1: the whole month locked in one run');
select is(pg_temp.events('run') || '|' || pg_temp.goal_row('run', '2026-11-09'),
  '2026-11-16:monthly:50:75.0:true|50|monthly|75.0||',
  'V1: the month decided once, at its closing week');
select is(pg_temp.awards('run', 'weekly_winner'),
  'Ivy@2026-10-26,Ivy@2026-11-02,Ivy@2026-11-09,Ivy@2026-11-16',
  'V1: four Weekly Winner awards in the one run');
select is(pg_temp.awards('run', 'dynasty'), 'Ivy@2026-11-09',
  'V1: Dynasty on the third win, inside the same run');
select is(pg_temp.awards('run', 'team_player'), 'Ivy@2026-11-16,Jon@2026-11-16',
  'V1: Team Player once, at the month');

-- The panel after the close; month_value_now matched what the lock decided.
select tests.authenticate_as('gus');
select is(pg_temp.panel('mix'), '2|null|monthly:2026-11-16:81.3',
  'last_result: the monthly result (81.3, what month_value_now showed before the lock); December has no value yet');
select is(pg_temp.badge('mix', 'gus', 'team_player'), 'earned|3',
  'award_count 3 after three hits');

-- Re-runs write nothing.
reset role;
select is(private.lock_week(current_setting('test.mix')::uuid, '2026-11-16'), false,
  'a re-run of a locked week is a no-op');
select is(private.lock_due_weeks(), null::text, 'a second run finds nothing due');
select is(
  (select pg_catalog.count(*)::integer from public.badge_awards a
   where a.group_id = current_setting('test.mix')::uuid and a.badge_key = 'team_player')
  || '|' ||
  (select pg_catalog.count(*)::integer from public.feed_events e
   where e.group_id = current_setting('test.mix')::uuid and e.kind = 'goal_result'),
  '6|3', 're-runs: no new Team Player award and no new goal event');

-- ===== A monthly result stays through the next month, then goes =====
select private.ensure_group_week(current_setting('test.mix')::uuid, '2026-11-23');
select tests.freeze_time('2026-12-03 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'the week of 23 Nov locks');
select tests.authenticate_as('gus');
select is(pg_temp.panel('mix'), '2|null|monthly:2026-11-16:81.3',
  'a December lock with no decision: November''s result still shows');
reset role;
select private.ensure_group_week(current_setting('test.mix')::uuid, w)
from (values ('2026-11-30'::date), ('2026-12-07'::date), ('2026-12-14'::date),
             ('2026-12-21'::date), ('2026-12-28'::date)) x(w);
select tests.freeze_time('2027-01-07 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'December''s weeks and 28 Dec lock');
select is(pg_temp.goal_row('mix', '2026-12-21'), '||||',
  'December''s closing week with no average anywhere in the month: no result');
select tests.authenticate_as('gus');
select is(pg_temp.panel('mix'), '2|null|none',
  'once a January lock runs, November''s result is gone');

select * from finish();
rollback;
