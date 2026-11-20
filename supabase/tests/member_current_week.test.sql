-- The member's current week and zone (Epic 2 retro A4, D1, F5): private.member_current_week, its
-- shape and grants, the zone rule with and without a pending zone, and plan_preview while a pending
-- zone ahead is due but not yet promoted by tick step 2.
--
-- Cast: alice (Europe/London) creates "Crew"; bob (Pacific/Auckland) and dave (Europe/London) are
-- in no group; erin has no profile. The week under test: Mon 16 Nov to Sun 22 Nov 2026; next
-- Monday is 23 Nov. November is GMT in London and NZDT (UTC+13) in Auckland, so Auckland's Monday
-- 23 Nov 00:00 is Sun 22 Nov 11:00 UTC. Pending zones are written directly (as the table owner);
-- set_time_zone is covered by time_zones.test.sql. The helper takes the instant as a parameter, so
-- only plan_preview needs the frozen clock (its search_path is pointed at test_overrides, rolled
-- back with everything else).
begin;
select plan(18);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

-- ===== Shape =====
select ok(
  pg_catalog.to_regprocedure('private.member_current_week(uuid, timestamptz)') is not null,
  'private.member_current_week(uuid, timestamptz) exists'
);
select is(
  (select pg_catalog.pg_get_function_result(p.oid) from pg_catalog.pg_proc p
   where p.oid = 'private.member_current_week(uuid, timestamptz)'::regprocedure),
  'TABLE(week_start date, time_zone text)',
  'it returns (week_start date, time_zone text)'
);
select ok(
  (select 'search_path=""' = any (p.proconfig) and not p.prosecdef and p.provolatile = 's'
   from pg_catalog.pg_proc p where p.oid = 'private.member_current_week(uuid, timestamptz)'::regprocedure),
  'it is stable, security invoker and pins search_path to empty'
);

-- ===== Grants per role =====
select ok(
  has_function_privilege('authenticated', 'private.member_current_week(uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.member_current_week(uuid, timestamptz)', 'EXECUTE')
  and not has_function_privilege('public', 'private.member_current_week(uuid, timestamptz)', 'EXECUTE'),
  'member_current_week is executable by authenticated only'
);

-- ===== Profiles and group =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Pacific/Auckland');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'Europe/London');

reset role;

-- "week_start|time_zone" for a user at an instant; '-' when there is no row.
create function pg_temp.cw(p_user text, p_at timestamptz)
returns text
language sql
as $$
  select coalesce(
    (select w.week_start::text || '|' || w.time_zone
     from private.member_current_week(tests.get_supabase_uid(p_user), p_at) w),
    '-');
$$;

-- ===== No pending zone =====
select is(pg_temp.cw('alice', '2026-11-18 12:00:00+00'), '2026-11-16|Europe/London',
  'no pending zone: the week and zone of profiles.time_zone');
select is(pg_temp.cw('alice', '2026-11-23 00:00:00+00'), '2026-11-23|Europe/London',
  'no pending zone: a new week starts at local Monday 00:00');

-- ===== Move ahead: London to Auckland from Mon 23 Nov =====
update public.profiles
set pending_time_zone = 'Pacific/Auckland', pending_week_start = '2026-11-23'
where id = tests.get_supabase_uid('alice');

select is(pg_temp.cw('alice', '2026-11-18 12:00:00+00'), '2026-11-16|Europe/London',
  'move ahead, mid-week: still the current zone');
select is(pg_temp.cw('alice', '2026-11-22 10:00:00+00'), '2026-11-16|Europe/London',
  'move ahead, not yet due (Auckland Sun 23:00): still the current zone');
select is(pg_temp.cw('alice', '2026-11-22 11:00:00+00'), '2026-11-23|Pacific/Auckland',
  'move ahead, due at Auckland Mon 00:00: the new zone''s week');
select is(pg_temp.cw('alice', '2026-11-22 11:30:00+00'), '2026-11-23|Pacific/Auckland',
  'move ahead, due but not promoted (Auckland Mon 00:30): the new zone''s week (F5)');
select is(pg_temp.cw('alice', '2026-11-23 00:30:00+00'), '2026-11-23|Pacific/Auckland',
  'move ahead, after the old zone''s Monday too: still the new zone''s week');

-- ===== Move behind: Auckland to London from Mon 23 Nov =====
update public.profiles
set pending_time_zone = 'Europe/London', pending_week_start = '2026-11-23'
where id = tests.get_supabase_uid('bob');

select is(pg_temp.cw('bob', '2026-11-22 10:00:00+00'), '2026-11-16|Pacific/Auckland',
  'move behind, before the old zone''s Monday (Auckland Sun 23:00): the current zone');
select is(pg_temp.cw('bob', '2026-11-22 12:00:00+00'), '2026-11-16|Europe/London',
  'move behind, old-zone Monday came: the new zone, still in its week of 16 Nov (as before)');

-- ===== No profile =====
select is(pg_temp.cw('erin', '2026-11-18 12:00:00+00'), '-', 'no profile: no row');

-- ===== As the client =====
select tests.authenticate_as('dave');
select is(
  (select w.week_start::text || '|' || w.time_zone
   from private.member_current_week(tests.get_supabase_uid('dave'), '2026-11-18 12:00:00+00') w),
  '2026-11-16|Europe/London',
  'a client reads its own week and zone'
);
select is(
  (select count(*)::integer
   from private.member_current_week(tests.get_supabase_uid('bob'), '2026-11-18 12:00:00+00')),
  0, 'a client gets no row for a profile its RLS hides (no shared group)'
);

-- ===== plan_preview while the move ahead is due but not promoted =====
reset role;
alter function public.plan_preview(uuid, integer, date) set search_path = test_overrides, pg_catalog;

select tests.freeze_time('2026-11-22 10:00:00+00');
select tests.authenticate_as('alice');
select is(
  (select p.member_today::text || '|' || p.week_start::text || '|' || p.starts_on::text
   from public.plan_preview(current_setting('test.g1')::uuid) p),
  '2026-11-22|2026-11-16|2026-11-23',
  'plan_preview before the new zone''s Monday: London''s Sunday and week'
);

select tests.freeze_time('2026-11-22 11:30:00+00');
select tests.authenticate_as('alice');
select is(
  (select p.member_today::text || '|' || p.week_start::text || '|' || p.starts_on::text
   from public.plan_preview(current_setting('test.g1')::uuid) p),
  '2026-11-23|2026-11-23|2026-11-30',
  'plan_preview with the move ahead due but not promoted: Auckland''s today and week of 23 Nov'
);

select * from finish();
rollback;
