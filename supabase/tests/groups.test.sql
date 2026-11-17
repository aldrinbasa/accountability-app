-- Groups (Story 1.6): table shape, indexes, RLS helpers, RLS, widened profile reads, grants per
-- role and the create_group RPC.
--
-- Cast: alice creates "Hikers" (admin). bob is a current member, carol an ended member (left).
-- erin has a profile but never shares a group. dave has no profile.
-- Group ids are kept in transaction-local settings (test.g1, test.g2) so every role can read them.
begin;
select plan(110);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

-- ===== Shape: groups =====
select has_table('public', 'groups', 'table public.groups exists');
select col_is_pk('public', 'groups', 'id', 'groups.id is the primary key');
select col_type_is('public', 'groups', 'id', 'uuid', 'groups.id is uuid');
select col_not_null('public', 'groups', 'name', 'groups.name is not null');
select col_type_is('public', 'groups', 'name', 'text', 'groups.name is text');
select col_not_null('public', 'groups', 'time_zone', 'groups.time_zone is not null');
select col_type_is('public', 'groups', 'created_by', 'uuid', 'groups.created_by is uuid');
select fk_ok('public', 'groups', 'created_by', 'public', 'profiles', 'id', 'groups.created_by references profiles');
select col_not_null('public', 'groups', 'created_at', 'groups.created_at is not null');
select col_not_null('public', 'groups', 'updated_at', 'groups.updated_at is not null');
select has_trigger('public', 'groups', 'groups_set_updated_at', 'groups has the updated_at trigger');
select tests.rls_enabled('public', 'groups');

-- ===== Shape: memberships =====
select has_table('public', 'memberships', 'table public.memberships exists');
select col_is_pk('public', 'memberships', 'id', 'memberships.id is the primary key');
select col_type_is('public', 'memberships', 'id', 'uuid', 'memberships.id is uuid');
select col_not_null('public', 'memberships', 'group_id', 'memberships.group_id is not null');
select fk_ok('public', 'memberships', 'group_id', 'public', 'groups', 'id', 'memberships.group_id references groups');
select ok(
  (select c.confdeltype = 'c' from pg_catalog.pg_constraint c
   where c.conrelid = 'public.memberships'::regclass and c.contype = 'f'
     and c.confrelid = 'public.groups'::regclass),
  'memberships.group_id cascades on group delete'
);
select col_not_null('public', 'memberships', 'user_id', 'memberships.user_id is not null');
select fk_ok('public', 'memberships', 'user_id', 'public', 'profiles', 'id', 'memberships.user_id references profiles');
select col_not_null('public', 'memberships', 'role', 'memberships.role is not null');
select col_not_null('public', 'memberships', 'joined_at', 'memberships.joined_at is not null');
select col_has_default('public', 'memberships', 'joined_at', 'memberships.joined_at has a default');
select col_is_null('public', 'memberships', 'ended_at', 'memberships.ended_at is nullable');
select col_is_null('public', 'memberships', 'end_reason', 'memberships.end_reason is nullable');
select col_not_null('public', 'memberships', 'created_at', 'memberships.created_at is not null');
select col_not_null('public', 'memberships', 'updated_at', 'memberships.updated_at is not null');
select has_trigger('public', 'memberships', 'memberships_set_updated_at', 'memberships has the updated_at trigger');
select tests.rls_enabled('public', 'memberships');
select ok(
  exists (select 1 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indexrelid
          where c.relname = 'memberships_one_current_per_user' and i.indrelid = 'public.memberships'::regclass
            and i.indisunique and i.indpred is not null
            and pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(ended_at IS NULL)'),
  'partial unique index: one current membership per user and group'
);
select ok(
  exists (select 1 from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indexrelid
          where c.relname = 'memberships_one_admin_per_group' and i.indrelid = 'public.memberships'::regclass
            and i.indisunique and i.indpred is not null),
  'partial unique index: one current admin per group'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and tablename = 'memberships' and indexname = 'memberships_user_id_idx'),
  'index on memberships.user_id'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and tablename = 'memberships' and indexname = 'memberships_group_id_idx'),
  'index on memberships.group_id'
);

-- ===== Grants per role: tables =====
select ok(has_table_privilege('authenticated', 'public.groups', 'SELECT'), 'authenticated: SELECT on groups');
select ok(
  not has_table_privilege('authenticated', 'public.groups', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated: no write privileges on groups'
);
select ok(
  not has_any_column_privilege('authenticated', 'public.groups', 'INSERT, UPDATE, REFERENCES'),
  'authenticated: no column write privileges on groups'
);
select ok(has_table_privilege('authenticated', 'public.memberships', 'SELECT'), 'authenticated: SELECT on memberships');
select ok(
  not has_table_privilege('authenticated', 'public.memberships', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated: no write privileges on memberships'
);
select ok(
  not has_any_column_privilege('authenticated', 'public.memberships', 'INSERT, UPDATE, REFERENCES'),
  'authenticated: no column write privileges on memberships'
);
select ok(
  not has_table_privilege('anon', 'public.groups', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon: no privileges on groups'
);
select ok(
  not has_any_column_privilege('anon', 'public.groups', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon: no column privileges on groups'
);
select ok(
  not has_table_privilege('anon', 'public.memberships', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon: no privileges on memberships'
);
select ok(
  not has_any_column_privilege('anon', 'public.memberships', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon: no column privileges on memberships'
);

-- ===== Grants per role: private helpers =====
select ok(has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated has USAGE on private');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no USAGE on private');

select has_function('private', 'is_member', array['uuid'], 'private.is_member(uuid) exists');
select has_function('private', 'is_admin', array['uuid'], 'private.is_admin(uuid) exists');
select has_function('private', 'shares_group', array['uuid'], 'private.shares_group(uuid) exists');
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('private.is_member(uuid)'::regprocedure, 'private.is_admin(uuid)'::regprocedure, 'private.shares_group(uuid)'::regprocedure)),
  'the three helpers are security definer'
);
select ok(
  (select bool_and(p.provolatile = 's') from pg_catalog.pg_proc p
   where p.oid in ('private.is_member(uuid)'::regprocedure, 'private.is_admin(uuid)'::regprocedure, 'private.shares_group(uuid)'::regprocedure)),
  'the three helpers are stable'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('private.is_member(uuid)'::regprocedure, 'private.is_admin(uuid)'::regprocedure, 'private.shares_group(uuid)'::regprocedure)),
  'the three helpers pin search_path to empty'
);
select ok(has_function_privilege('authenticated', 'private.is_member(uuid)', 'EXECUTE'), 'authenticated can execute is_member');
select ok(has_function_privilege('authenticated', 'private.is_admin(uuid)', 'EXECUTE'), 'authenticated can execute is_admin');
select ok(has_function_privilege('authenticated', 'private.shares_group(uuid)', 'EXECUTE'), 'authenticated can execute shares_group');
select ok(
  not has_function_privilege('anon', 'private.is_member(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.is_admin(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.shares_group(uuid)', 'EXECUTE'),
  'anon cannot execute any helper'
);
select ok(
  not has_function_privilege('public', 'private.is_member(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'private.is_admin(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'private.shares_group(uuid)', 'EXECUTE'),
  'PUBLIC cannot execute any helper'
);

-- ===== Grants per role: create_group =====
select has_function('public', 'create_group', array['text'], 'public.create_group(text) exists');
select function_returns('public', 'create_group', array['text'], 'uuid', 'create_group returns uuid');
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.create_group(text)'::regprocedure),
  'create_group is security definer'
);
select ok(
  (select 'search_path=""' = any (p.proconfig) from pg_catalog.pg_proc p where p.oid = 'public.create_group(text)'::regprocedure),
  'create_group pins search_path to empty'
);
select ok(not has_function_privilege('public', 'public.create_group(text)', 'EXECUTE'), 'PUBLIC cannot execute create_group');
select ok(not has_function_privilege('anon', 'public.create_group(text)', 'EXECUTE'), 'anon cannot execute create_group');
select ok(has_function_privilege('authenticated', 'public.create_group(text)', 'EXECUTE'), 'authenticated can execute create_group');

-- ===== Profiles for the cast (dave stays without one) =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Asia/Manila');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'Europe/Paris');

-- ===== create_group behaviour =====
select tests.authenticate_as('alice');
select lives_ok(
  $$ select pg_catalog.set_config('test.g1', public.create_group('  Hikers  ')::text, true) $$,
  'create_group succeeds for a caller with a profile'
);
select results_eq(
  $$ select name, time_zone, created_by from public.groups where id = current_setting('test.g1')::uuid $$,
  $$ values ('Hikers'::text, 'Asia/Manila'::text, tests.get_supabase_uid('alice')) $$,
  'the group has the trimmed name, the caller''s profile zone and created_by = caller'
);
select results_eq(
  $$ select user_id, role, ended_at is null from public.memberships where group_id = current_setting('test.g1')::uuid $$,
  $$ values (tests.get_supabase_uid('alice'), 'admin'::text, true) $$,
  'the caller is the one current admin of the new group'
);
select lives_ok(
  $$ select pg_catalog.set_config('test.g2', public.create_group(pg_catalog.repeat('n', 32))::text, true) $$,
  'a 32-character name is accepted'
);
select throws_ok(
  $$ select public.create_group('   ') $$,
  'P0001', 'invalid_group_name',
  'a blank name raises invalid_group_name'
);
select throws_ok(
  $$ select public.create_group(null) $$,
  'P0001', 'invalid_group_name',
  'a null name raises invalid_group_name'
);
select throws_ok(
  $$ select public.create_group(pg_catalog.repeat('n', 33)) $$,
  'P0001', 'invalid_group_name',
  'a 33-character name raises invalid_group_name'
);

select tests.authenticate_as('dave');
select throws_ok(
  $$ select public.create_group('Dave''s crew') $$,
  'P0001', 'profile_required',
  'a caller without a profile raises profile_required'
);

-- ===== Seed bob (current member) and carol (ended member) as the owner =====
reset role;
insert into public.memberships (group_id, user_id, role)
values (current_setting('test.g1')::uuid, tests.get_supabase_uid('bob'), 'member');
insert into public.memberships (group_id, user_id, role, ended_at, end_reason)
values (current_setting('test.g1')::uuid, tests.get_supabase_uid('carol'), 'member', pg_catalog.now(), 'left');

-- ===== Constraints and indexes =====
select throws_ok(
  $$ insert into public.memberships (group_id, user_id, role)
     values (current_setting('test.g1')::uuid, tests.get_supabase_uid('erin'), 'admin') $$,
  '23505', 'duplicate key value violates unique constraint "memberships_one_admin_per_group"',
  'a second current admin row is rejected by the index'
);
select throws_ok(
  $$ insert into public.memberships (group_id, user_id, role)
     values (current_setting('test.g1')::uuid, tests.get_supabase_uid('bob'), 'member') $$,
  '23505', 'duplicate key value violates unique constraint "memberships_one_current_per_user"',
  'a duplicate current membership is rejected by the index'
);
select lives_ok(
  $$ insert into public.memberships (group_id, user_id, role, ended_at, end_reason)
     values (current_setting('test.g1')::uuid, tests.get_supabase_uid('bob'), 'admin', pg_catalog.now(), 'removed') $$,
  'ended rows do not count against either index'
);
select throws_ok(
  $$ insert into public.memberships (group_id, user_id, role)
     values (current_setting('test.g2')::uuid, tests.get_supabase_uid('bob'), 'owner') $$,
  '23514', null,
  'a role outside admin/member violates the check constraint'
);
select throws_ok(
  $$ insert into public.memberships (group_id, user_id, role, ended_at, end_reason)
     values (current_setting('test.g2')::uuid, tests.get_supabase_uid('bob'), 'member', pg_catalog.now(), 'kicked') $$,
  '23514', null,
  'an unknown end_reason violates the check constraint'
);
select throws_ok(
  $$ insert into public.groups (name, time_zone) values (' padded', 'UTC') $$,
  '23514', null,
  'an untrimmed group name violates the check constraint'
);
-- Undo the extra ended row so later counts see only the seeded cast.
delete from public.memberships
where group_id = current_setting('test.g1')::uuid
  and user_id = tests.get_supabase_uid('bob')
  and ended_at is not null;

-- ===== is_member / is_admin: true only for current memberships =====
select tests.authenticate_as('alice');
select ok(private.is_member(current_setting('test.g1')::uuid), 'alice (admin): is_member true');
select ok(private.is_admin(current_setting('test.g1')::uuid), 'alice (admin): is_admin true');

select tests.authenticate_as('bob');
select ok(private.is_member(current_setting('test.g1')::uuid), 'bob (member): is_member true');
select ok(not private.is_admin(current_setting('test.g1')::uuid), 'bob (member): is_admin false');

select tests.authenticate_as('carol');
select ok(not private.is_member(current_setting('test.g1')::uuid), 'carol (ended): is_member false');
select ok(not private.is_admin(current_setting('test.g1')::uuid), 'carol (ended): is_admin false');

select tests.authenticate_as('erin');
select ok(not private.is_member(current_setting('test.g1')::uuid), 'erin (never joined): is_member false');

-- ===== RLS: groups and memberships =====
-- erin never joined: sees neither the group nor its memberships.
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.g1')::uuid),
  0, 'a non-member cannot read the group'
);
select is(
  (select count(*)::integer from public.memberships where group_id = current_setting('test.g1')::uuid),
  0, 'a non-member cannot read the group''s memberships'
);

-- bob (current member): sees the group and its current memberships, not carol's ended row.
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.g1')::uuid),
  1, 'a current member reads the group'
);
select results_eq(
  $$ select user_id from public.memberships where group_id = current_setting('test.g1')::uuid order by role $$,
  $$ values (tests.get_supabase_uid('alice')), (tests.get_supabase_uid('bob')) $$,
  'a current member reads the current memberships only'
);
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.g2')::uuid),
  0, 'a member of one group cannot read another group of the same admin'
);

-- carol (ended): still reads her own membership and the group name, but no one else's rows.
select tests.authenticate_as('carol');
select results_eq(
  $$ select name from public.groups where id = current_setting('test.g1')::uuid $$,
  $$ values ('Hikers'::text) $$,
  'an ended member still reads the group name'
);
select results_eq(
  $$ select user_id, end_reason from public.memberships where group_id = current_setting('test.g1')::uuid $$,
  $$ values (tests.get_supabase_uid('carol'), 'left'::text) $$,
  'an ended member reads only their own (ended) membership'
);

-- alice sees both of her groups.
select tests.authenticate_as('alice');
select is(
  (select count(*)::integer from public.groups),
  2, 'the creator reads both of her groups'
);

-- ===== RLS: profile visibility =====
select tests.authenticate_as('bob');
select results_eq(
  $$ select display_name from public.profiles order by display_name $$,
  $$ values ('Alice'::text), ('Bob'::text), ('Carol'::text) $$,
  'a member reads profiles of current and once-shared group members, not strangers'
);

select tests.authenticate_as('carol');
select results_eq(
  $$ select display_name from public.profiles order by display_name $$,
  $$ values ('Alice'::text), ('Bob'::text), ('Carol'::text) $$,
  'an ended member still reads profiles of people she once shared a group with'
);
select ok(private.shares_group(tests.get_supabase_uid('alice')), 'shares_group is true for a once-shared user');
select ok(not private.shares_group(tests.get_supabase_uid('erin')), 'shares_group is false for a never-shared user');

select tests.authenticate_as('erin');
select results_eq(
  $$ select display_name from public.profiles $$,
  $$ values ('Erin'::text) $$,
  'a user who never shared a group reads only her own profile'
);

-- ===== Direct writes denied =====
select tests.authenticate_as('alice');
select throws_ok(
  $$ insert into public.groups (name, time_zone) values ('Sneaky', 'UTC') $$,
  '42501', null,
  'a direct INSERT into groups is denied'
);
select throws_ok(
  $$ update public.groups set name = 'Renamed' where id = current_setting('test.g1')::uuid $$,
  '42501', null,
  'a direct UPDATE of groups is denied'
);
select throws_ok(
  $$ delete from public.groups where id = current_setting('test.g1')::uuid $$,
  '42501', null,
  'a direct DELETE from groups is denied'
);
select throws_ok(
  $$ insert into public.memberships (group_id, user_id, role)
     values (current_setting('test.g1')::uuid, tests.get_supabase_uid('erin'), 'member') $$,
  '42501', null,
  'a direct INSERT into memberships is denied'
);
select throws_ok(
  $$ update public.memberships set role = 'member' where group_id = current_setting('test.g1')::uuid $$,
  '42501', null,
  'a direct UPDATE of memberships is denied'
);
select throws_ok(
  $$ delete from public.memberships where group_id = current_setting('test.g1')::uuid $$,
  '42501', null,
  'a direct DELETE from memberships is denied'
);

-- ===== anon gets nothing =====
select tests.clear_authentication();
select throws_ok($$ select * from public.groups $$, '42501', null, 'anon cannot read groups');
select throws_ok($$ select * from public.memberships $$, '42501', null, 'anon cannot read memberships');
select throws_ok($$ select public.create_group('Anon') $$, '42501', null, 'anon cannot execute create_group');
select throws_ok(
  $$ select private.is_member(current_setting('test.g1')::uuid) $$,
  '42501', null,
  'anon cannot call is_member'
);

-- ===== Owner's view: nothing changed, and group delete cascades =====
reset role;
select results_eq(
  $$ select name from public.groups where id = current_setting('test.g1')::uuid $$,
  $$ values ('Hikers'::text) $$,
  'the denied direct UPDATE did not rename the group'
);
select is(
  (select count(*)::integer from public.memberships where group_id = current_setting('test.g1')::uuid),
  3, 'the denied direct DELETE removed no memberships'
);
delete from public.groups where id = current_setting('test.g1')::uuid;
select is(
  (select count(*)::integer from public.memberships where group_id = current_setting('test.g1')::uuid),
  0, 'deleting a group cascades to its memberships'
);

select * from finish();
rollback;
