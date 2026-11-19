-- Profile visibility needs overlapping memberships (Epic 1 retro F2): private.shares_group is true
-- only when one of the caller's memberships and one of the other person's, in the same group,
-- overlapped in time. Bounds are inclusive; a current membership runs to infinity.
--
-- Cast, all in "Crew" (alice creates it; dates set as the owner, 2026):
--   alice  admin, joined 1 Jan, current
--   rita   joined 2 Jan, removed 10 Jan
--   lena   joined 3 Jan, left 5 Jan
--   olly   joined 4 Jan, left 15 Jan
--   bob    joined 8 Jan, current
--   tess   joined 15 Jan (the moment olly left), current
--   nina   joined 20 Jan, current (the newcomer)
-- erin has a profile and never joins.
-- The group id is kept in a transaction-local setting (test.g1) so every role can read it.
begin;
select plan(20);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('rita');
select tests.create_supabase_user('lena');
select tests.create_supabase_user('olly');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('tess');
select tests.create_supabase_user('nina');
select tests.create_supabase_user('erin');

-- ===== Profiles and the group =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('rita');
select public.save_profile('Rita', 'UTC');
select tests.authenticate_as('lena');
select public.save_profile('Lena', 'UTC');
select tests.authenticate_as('olly');
select public.save_profile('Olly', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('tess');
select public.save_profile('Tess', 'UTC');
select tests.authenticate_as('nina');
select public.save_profile('Nina', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);

-- ===== Seed the memberships as the owner =====
reset role;
update public.memberships
set joined_at = '2026-01-01 00:00:00+00'
where group_id = current_setting('test.g1')::uuid
  and user_id = tests.get_supabase_uid('alice');

insert into public.memberships (group_id, user_id, role, joined_at, ended_at, end_reason)
values
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('rita'), 'member',
   '2026-01-02 00:00:00+00', '2026-01-10 00:00:00+00', 'removed'),
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('lena'), 'member',
   '2026-01-03 00:00:00+00', '2026-01-05 00:00:00+00', 'left'),
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('olly'), 'member',
   '2026-01-04 00:00:00+00', '2026-01-15 00:00:00+00', 'left'),
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('bob'), 'member',
   '2026-01-08 00:00:00+00', null, null),
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('tess'), 'member',
   '2026-01-15 00:00:00+00', null, null),
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('nina'), 'member',
   '2026-01-20 00:00:00+00', null, null);

-- ===== Shape: signature, security and grants unchanged =====
select has_function('private', 'shares_group', array['uuid'], 'private.shares_group(uuid) still exists');
select function_returns('private', 'shares_group', array['uuid'], 'boolean', 'shares_group still returns boolean');
select ok(
  (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_catalog.pg_proc p
   where p.oid = 'private.shares_group(uuid)'::regprocedure),
  'shares_group is still security definer with an empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'private.shares_group(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.shares_group(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'private.shares_group(uuid)', 'EXECUTE'),
  'only authenticated can execute shares_group'
);

-- ===== (a) A removed member cannot see people who joined after the removal =====
select tests.authenticate_as('rita');
select is(
  (select pg_catalog.array_agg(display_name collate "C" order by display_name collate "C")
   from public.profiles),
  array['Alice', 'Bob', 'Lena', 'Olly', 'Rita']::text[],
  'a removed member reads only the profiles of people whose membership overlapped hers'
);
select ok(not private.shares_group(tests.get_supabase_uid('nina')),
  'removed rita does not share a group with nina, who joined after the removal');
select ok(not private.shares_group(tests.get_supabase_uid('tess')),
  'removed rita does not share a group with tess, who joined after the removal');

-- ===== (b) A newcomer cannot see people who left before they joined =====
select tests.authenticate_as('nina');
select is(
  (select pg_catalog.array_agg(display_name collate "C" order by display_name collate "C")
   from public.profiles),
  array['Alice', 'Bob', 'Nina', 'Tess']::text[],
  'a newcomer reads the current members, not people who left before she joined'
);
select ok(not private.shares_group(tests.get_supabase_uid('lena')),
  'newcomer nina does not share a group with lena, who left before she joined');
select ok(not private.shares_group(tests.get_supabase_uid('olly')),
  'newcomer nina does not share a group with olly, who left before she joined');
select ok(not private.shares_group(tests.get_supabase_uid('rita')),
  'newcomer nina does not share a group with rita, removed before she joined');

-- ===== (c) Overlapping ex-members still see each other =====
select tests.authenticate_as('olly');
select is(
  (select pg_catalog.array_agg(display_name collate "C" order by display_name collate "C")
   from public.profiles),
  array['Alice', 'Bob', 'Lena', 'Olly', 'Rita', 'Tess']::text[],
  'an ex-member reads everyone whose membership overlapped his, ended or current'
);
select ok(private.shares_group(tests.get_supabase_uid('rita')),
  'two ended memberships that overlapped still share a group');
select ok(private.shares_group(tests.get_supabase_uid('tess')),
  'a join at the very moment of the other person''s end counts as overlapping');

select tests.authenticate_as('lena');
select ok(not private.shares_group(tests.get_supabase_uid('bob')),
  'lena (left 5 Jan) does not share a group with bob (joined 8 Jan)');

-- ===== (d) Current co-members see each other =====
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.array_agg(display_name collate "C" order by display_name collate "C")
   from public.profiles),
  array['Alice', 'Bob', 'Nina', 'Olly', 'Rita', 'Tess']::text[],
  'a current member reads every current co-member and the ex-members who overlapped him'
);
select is(
  (select pg_catalog.array_agg(p.display_name collate "C" order by p.display_name collate "C")
   from public.memberships m
   join public.profiles p on p.id = m.user_id
   where m.group_id = current_setting('test.g1')::uuid and m.ended_at is null),
  array['Alice', 'Bob', 'Nina', 'Tess']::text[],
  'the current members list (memberships joined to profiles) shows every current member''s name'
);

select tests.authenticate_as('alice');
select is(
  (select pg_catalog.array_agg(display_name collate "C" order by display_name collate "C")
   from public.profiles),
  array['Alice', 'Bob', 'Lena', 'Nina', 'Olly', 'Rita', 'Tess']::text[],
  'the admin, a member from the start, reads everyone who was ever in the group'
);

select tests.authenticate_as('erin');
select is(
  (select pg_catalog.array_agg(display_name collate "C" order by display_name collate "C")
   from public.profiles),
  array['Erin']::text[],
  'a user who never joined reads only her own profile'
);
select ok(not private.shares_group(tests.get_supabase_uid('alice')),
  'a stranger shares no group');

select * from finish();
rollback;
