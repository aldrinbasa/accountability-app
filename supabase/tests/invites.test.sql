-- Invites and joining (Story 1.7): table shape, RLS, grants per role (AD-16), and the
-- create_invite, get_invite and join_group RPCs, including the 7-day expiry (tests.freeze_time)
-- and the 10-member cap.
--
-- Cast: alice creates "Hikers" (admin). bob joins and is a plain member. carol joins, leaves and
-- rejoins. dave has no profile. erin has a profile and never joins. frank tries an expired code.
-- m04 to m11 fill the group up to the cap (m11 is the 11th and is turned away).
-- Group id and codes are kept in transaction-local settings (test.g1, test.c1, ...) so every role
-- can read them.
--
-- The three RPCs call now() unqualified. Below, as the owner, their search_path is pointed at
-- test_overrides first so tests.freeze_time moves their clock; the rollback undoes it.
begin;
select plan(95);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('frank');
select tests.create_supabase_user('m' || pg_catalog.lpad(n::text, 2, '0'))
from pg_catalog.generate_series(4, 11) as n;

-- ===== Shape: invites =====
select has_table('public', 'invites', 'table public.invites exists');
select col_is_pk('public', 'invites', 'id', 'invites.id is the primary key');
select col_type_is('public', 'invites', 'id', 'uuid', 'invites.id is uuid');
select col_not_null('public', 'invites', 'group_id', 'invites.group_id is not null');
select fk_ok('public', 'invites', 'group_id', 'public', 'groups', 'id', 'invites.group_id references groups');
select ok(
  (select c.confdeltype = 'c' from pg_catalog.pg_constraint c
   where c.conrelid = 'public.invites'::regclass and c.contype = 'f'
     and c.confrelid = 'public.groups'::regclass),
  'invites.group_id cascades on group delete'
);
select col_not_null('public', 'invites', 'code', 'invites.code is not null');
select col_type_is('public', 'invites', 'code', 'text', 'invites.code is text');
select col_is_unique('public', 'invites', 'code', 'invites.code is unique');
select col_type_is('public', 'invites', 'created_by', 'uuid', 'invites.created_by is uuid');
select fk_ok('public', 'invites', 'created_by', 'public', 'profiles', 'id', 'invites.created_by references profiles');
select col_not_null('public', 'invites', 'expires_at', 'invites.expires_at is not null');
select col_type_is('public', 'invites', 'expires_at', 'timestamp with time zone', 'invites.expires_at is timestamptz');
select col_not_null('public', 'invites', 'created_at', 'invites.created_at is not null');
select col_not_null('public', 'invites', 'updated_at', 'invites.updated_at is not null');
select has_trigger('public', 'invites', 'invites_set_updated_at', 'invites has the updated_at trigger');
select ok(
  exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and tablename = 'invites'
            and indexname = 'invites_group_id_expires_at_idx'),
  'index on invites (group_id, expires_at)'
);
select tests.rls_enabled('public', 'invites');

-- ===== Grants per role: table =====
select ok(has_table_privilege('authenticated', 'public.invites', 'SELECT'), 'authenticated: SELECT on invites');
select ok(
  not has_table_privilege('authenticated', 'public.invites', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated: no write privileges on invites'
);
select ok(
  not has_any_column_privilege('authenticated', 'public.invites', 'INSERT, UPDATE, REFERENCES'),
  'authenticated: no column write privileges on invites'
);
select ok(
  not has_table_privilege('anon', 'public.invites', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon: no privileges on invites'
);
select ok(
  not has_any_column_privilege('anon', 'public.invites', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon: no column privileges on invites'
);

-- ===== Grants per role: functions =====
select has_function('public', 'create_invite', array['uuid', 'boolean'], 'public.create_invite(uuid, boolean) exists');
select has_function('public', 'get_invite', array['text'], 'public.get_invite(text) exists');
select has_function('public', 'join_group', array['text'], 'public.join_group(text) exists');
select function_returns('public', 'join_group', array['text'], 'uuid', 'join_group returns uuid');
select has_function('private', 'generate_invite_code', array[]::text[], 'private.generate_invite_code() exists');
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('public.create_invite(uuid, boolean)'::regprocedure, 'public.get_invite(text)'::regprocedure,
                   'public.join_group(text)'::regprocedure)),
  'the three RPCs are security definer'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.create_invite(uuid, boolean)'::regprocedure, 'public.get_invite(text)'::regprocedure,
                   'public.join_group(text)'::regprocedure, 'private.generate_invite_code()'::regprocedure)),
  'the three RPCs and the code generator pin search_path to empty'
);
select ok(
  has_function_privilege('authenticated', 'public.create_invite(uuid, boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_invite(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.join_group(text)', 'EXECUTE'),
  'authenticated can execute the three RPCs'
);
select ok(
  not has_function_privilege('anon', 'public.create_invite(uuid, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_invite(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.join_group(text)', 'EXECUTE'),
  'anon cannot execute any of the three RPCs'
);
select ok(
  not has_function_privilege('public', 'public.create_invite(uuid, boolean)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_invite(text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.join_group(text)', 'EXECUTE'),
  'PUBLIC cannot execute any of the three RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'private.generate_invite_code()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.generate_invite_code()', 'EXECUTE')
  and not has_function_privilege('public', 'private.generate_invite_code()', 'EXECUTE'),
  'no client role can execute the code generator'
);

-- ===== Code generator =====
select ok(
  (select bool_and(private.generate_invite_code() ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$')
   from pg_catalog.generate_series(1, 200)),
  'generated codes are 6 characters from the unambiguous alphabet'
);
select ok(
  pg_catalog.pg_get_functiondef('private.generate_invite_code()'::regprocedure) !~ 'random\(\)',
  'the code generator does not use random()'
);
select throws_ok(
  $$ insert into public.invites (group_id, code, expires_at)
     values (pg_catalog.gen_random_uuid(), 'ABC10O', pg_catalog.now()) $$,
  '23514', null,
  'a code outside the alphabet violates the check constraint'
);

-- ===== Profiles (dave stays without one) and the group =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Asia/Manila');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select tests.authenticate_as('frank');
select public.save_profile('Frank', 'UTC');
reset role;
insert into public.profiles (id, display_name, time_zone)
select tests.get_supabase_uid('m' || pg_catalog.lpad(n::text, 2, '0')), 'M' || n, 'UTC'
from pg_catalog.generate_series(4, 11) as n;

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Hikers')::text, true);

-- ===== Frozen clock =====
reset role;
alter function public.create_invite(uuid, boolean) set search_path = test_overrides, pg_catalog;
alter function public.get_invite(text) set search_path = test_overrides, pg_catalog;
alter function public.join_group(text) set search_path = test_overrides, pg_catalog;
select tests.freeze_time('2026-11-17 10:00:00+00');

-- ===== create_invite: create, reuse, fresh =====
select tests.authenticate_as('alice');
select lives_ok(
  $$ select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid)), true) $$,
  'the admin creates an invite'
);
select ok(current_setting('test.c1') ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$', 'the code is 6 characters from the alphabet');
select is(
  (select expires_at from public.create_invite(current_setting('test.g1')::uuid)),
  '2026-11-24 10:00:00+00'::timestamptz,
  'the invite expires 7 days after creation'
);
select is(
  (select code from public.create_invite(current_setting('test.g1')::uuid)),
  current_setting('test.c1'),
  'a second call reuses the unexpired invite'
);
select is(
  (select code from public.create_invite(current_setting('test.g1')::uuid, false)),
  current_setting('test.c1'),
  'p_new = false reuses the unexpired invite'
);
-- A minute later, so the two invites do not tie on created_at/expires_at inside this one transaction.
select tests.freeze_time('2026-11-17 10:01:00+00');
select tests.authenticate_as('alice');
select lives_ok(
  $$ select pg_catalog.set_config('test.c2', (select code from public.create_invite(current_setting('test.g1')::uuid, true)), true) $$,
  'p_new = true makes a new invite'
);
select isnt(current_setting('test.c2'), current_setting('test.c1'), 'the new invite has a fresh code');
select is(
  (select code from public.create_invite(current_setting('test.g1')::uuid)),
  current_setting('test.c2'),
  'after p_new, the newest unexpired invite is reused'
);
select results_eq(
  $$ select code collate "C", created_by from public.invites order by code collate "C" $$,
  $$ select c collate "C", tests.get_supabase_uid('alice')
     from pg_catalog.unnest(array[current_setting('test.c1'), current_setting('test.c2')]) as c
     order by c collate "C" $$,
  'the admin reads exactly the two invites, both created by her'
);

-- ===== create_invite: not_member / not_admin =====
select tests.authenticate_as('erin');
select throws_ok(
  $$ select * from public.create_invite(current_setting('test.g1')::uuid) $$,
  'P0001', 'not_member',
  'a non-member raises not_member'
);

-- ===== get_invite: valid, normalized, unknown =====
select results_eq(
  $$ select group_id, group_name, admin_display_name, member_count, status
     from public.get_invite(current_setting('test.c1')) $$,
  $$ values (current_setting('test.g1')::uuid, 'Hikers'::text, 'Alice'::text, 1, 'valid'::text) $$,
  'get_invite returns group, admin name, member count and valid'
);
select is(
  (select status from public.get_invite('  ' || pg_catalog.lower(current_setting('test.c1')) || ' ')),
  'valid',
  'get_invite trims and upper-cases the code'
);
select throws_ok(
  $$ select * from public.get_invite('000000') $$,
  'P0001', 'invite_not_found',
  'get_invite with an unknown code raises invite_not_found'
);
select throws_ok(
  $$ select * from public.get_invite(null) $$,
  'P0001', 'invite_not_found',
  'get_invite with a null code raises invite_not_found'
);

-- ===== join_group: first join makes a 2-person group =====
select tests.authenticate_as('bob');
select is(
  public.join_group(current_setting('test.c2')),
  current_setting('test.g1')::uuid,
  'bob joins with a valid code and gets the group id'
);
select results_eq(
  $$ select user_id, role from public.memberships
     where group_id = current_setting('test.g1')::uuid and ended_at is null
     order by role, user_id $$,
  $$ values (tests.get_supabase_uid('alice'), 'admin'::text), (tests.get_supabase_uid('bob'), 'member'::text) $$,
  'after one join the group has 2 current members: the admin and the new member'
);
select is(
  (select status from public.get_invite(current_setting('test.c2'))),
  'member',
  'get_invite reports member for a current member'
);
select is(
  public.join_group(current_setting('test.c2')),
  current_setting('test.g1')::uuid,
  're-join of a current member returns the group id'
);
select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('bob')),
  1, 're-join of a current member adds no row (idempotent)'
);
select throws_ok(
  $$ select * from public.create_invite(current_setting('test.g1')::uuid) $$,
  'P0001', 'not_admin',
  'a member who is not admin raises not_admin'
);

-- ===== RLS: members and strangers cannot read invites =====
select is((select count(*)::integer from public.invites), 0, 'a member cannot read the group''s invites');
select tests.authenticate_as('erin');
select is((select count(*)::integer from public.invites), 0, 'a non-member cannot read invites');
select results_eq(
  $$ select member_count, status from public.get_invite(current_setting('test.c1')) $$,
  $$ values (2, 'valid'::text) $$,
  'get_invite counts current members'
);

-- ===== join_group: errors =====
select throws_ok(
  $$ select public.join_group('000000') $$,
  'P0001', 'invite_not_found',
  'join_group with an unknown code raises invite_not_found'
);
select tests.authenticate_as('dave');
select throws_ok(
  $$ select public.join_group(current_setting('test.c1')) $$,
  'P0001', 'profile_required',
  'join_group without a profile raises profile_required'
);

-- ===== Direct writes denied =====
select tests.authenticate_as('alice');
select throws_ok(
  $$ insert into public.invites (group_id, code, expires_at)
     values (current_setting('test.g1')::uuid, 'AAAAAA', pg_catalog.now() + interval '1 year') $$,
  '42501', null,
  'a direct INSERT into invites is denied, even for the admin'
);
select throws_ok(
  $$ update public.invites set expires_at = pg_catalog.now() + interval '1 year' $$,
  '42501', null,
  'a direct UPDATE of invites is denied'
);
select throws_ok(
  $$ delete from public.invites $$,
  '42501', null,
  'a direct DELETE from invites is denied'
);

-- ===== Expiry: 6 days 23 hours works, exactly 7 days does not =====
select tests.freeze_time('2026-11-24 09:00:00+00');
select tests.authenticate_as('carol');
select is(
  (select status from public.get_invite(current_setting('test.c1'))),
  'valid',
  'at 6 days 23 hours the invite is still valid'
);
select is(
  public.join_group(current_setting('test.c1')),
  current_setting('test.g1')::uuid,
  'join at 6 days 23 hours works'
);

select tests.freeze_time('2026-11-24 10:00:00+00');
select tests.authenticate_as('frank');
select is(
  (select status from public.get_invite(current_setting('test.c1'))),
  'expired',
  'at exactly 7 days get_invite reports expired'
);
select throws_ok(
  $$ select public.join_group(current_setting('test.c1')) $$,
  'P0001', 'invite_expired',
  'join at exactly 7 days raises invite_expired'
);
select tests.authenticate_as('bob');
select is(
  (select status from public.get_invite(current_setting('test.c1'))),
  'member',
  'a current member sees member even on an expired code'
);

-- Once every invite has expired (c2 at 10:01), create_invite (p_new false) makes a new one.
select tests.freeze_time('2026-11-24 10:05:00+00');
select tests.authenticate_as('alice');
select lives_ok(
  $$ select pg_catalog.set_config('test.c3', (select code from public.create_invite(current_setting('test.g1')::uuid)), true) $$,
  'create_invite after expiry succeeds'
);
select ok(
  current_setting('test.c3') not in (current_setting('test.c1'), current_setting('test.c2')),
  'create_invite after expiry returns a new code'
);
select is(
  (select expires_at from public.create_invite(current_setting('test.g1')::uuid)),
  '2026-12-01 10:05:00+00'::timestamptz,
  'the new invite expires 7 days after its own creation'
);

-- ===== A member who left can rejoin with a new membership row =====
reset role;
update public.memberships
set ended_at = pg_catalog.now(), end_reason = 'left'
where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('carol');

select tests.authenticate_as('carol');
select is(
  (select status from public.get_invite(current_setting('test.c3'))),
  'valid',
  'a member who left sees valid, not member'
);
select is(
  public.join_group(current_setting('test.c3')),
  current_setting('test.g1')::uuid,
  'a member who left rejoins'
);
reset role;
select results_eq(
  $$ select role, ended_at is null, end_reason from public.memberships
     where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('carol')
     order by ended_at nulls last $$,
  $$ values ('member'::text, false, 'left'::text), ('member'::text, true, null::text) $$,
  'the rejoin is a new current row; the ended row stays'
);

-- ===== The 10-member cap =====
-- Current: alice, bob, carol (3). m04 to m10 bring it to 10; m11 is turned away.
select tests.authenticate_as('m04');
select is(public.join_group(current_setting('test.c3')), current_setting('test.g1')::uuid, 'member 4 joins');
select tests.authenticate_as('m05');
select is(public.join_group(current_setting('test.c3')), current_setting('test.g1')::uuid, 'member 5 joins');
select tests.authenticate_as('m06');
select is(public.join_group(current_setting('test.c3')), current_setting('test.g1')::uuid, 'member 6 joins');
select tests.authenticate_as('m07');
select is(public.join_group(current_setting('test.c3')), current_setting('test.g1')::uuid, 'member 7 joins');
select tests.authenticate_as('m08');
select is(public.join_group(current_setting('test.c3')), current_setting('test.g1')::uuid, 'member 8 joins');
select tests.authenticate_as('m09');
select is(public.join_group(current_setting('test.c3')), current_setting('test.g1')::uuid, 'member 9 joins');
select tests.authenticate_as('m10');
select is(
  (select status from public.get_invite(current_setting('test.c3'))),
  'valid',
  'with 9 members the invite is still valid'
);
select is(public.join_group(current_setting('test.c3')), current_setting('test.g1')::uuid, 'the 10th member joins');
select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and ended_at is null),
  10, 'the group has 10 current members'
);

select tests.authenticate_as('m11');
select results_eq(
  $$ select member_count, status from public.get_invite(current_setting('test.c3')) $$,
  $$ values (10, 'full'::text) $$,
  'with 10 members get_invite reports full'
);
select throws_ok(
  $$ select public.join_group(current_setting('test.c3')) $$,
  'P0001', 'group_full',
  'the 11th member raises group_full'
);
select tests.authenticate_as('bob');
select is(
  public.join_group(current_setting('test.c3')),
  current_setting('test.g1')::uuid,
  'a current member re-joining a full group is still idempotent'
);
reset role;
select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and ended_at is null),
  10, 'the group still has 10 current members'
);

-- ===== anon gets nothing =====
select tests.clear_authentication();
select throws_ok($$ select * from public.invites $$, '42501', null, 'anon cannot read invites');
select throws_ok(
  $$ select * from public.create_invite(current_setting('test.g1')::uuid) $$,
  '42501', null,
  'anon cannot execute create_invite'
);
select throws_ok(
  $$ select * from public.get_invite(current_setting('test.c3')) $$,
  '42501', null,
  'anon cannot execute get_invite'
);
select throws_ok(
  $$ select public.join_group(current_setting('test.c3')) $$,
  '42501', null,
  'anon cannot execute join_group'
);

-- ===== Owner's view: denied writes changed nothing, and group delete cascades =====
reset role;
select is(
  (select count(*)::integer from public.invites where group_id = current_setting('test.g1')::uuid),
  3, 'the group has exactly the three invites made through create_invite'
);
delete from public.groups where id = current_setting('test.g1')::uuid;
select is(
  (select count(*)::integer from public.invites where group_id = current_setting('test.g1')::uuid),
  0, 'deleting a group cascades to its invites'
);

select * from finish();
rollback;
