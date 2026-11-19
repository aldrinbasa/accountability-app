-- Profiles (Story 1.4): table shape, RLS, grants per role and the save_profile RPC.
begin;
select plan(47);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');

-- ===== Shape =====
select has_table('public', 'profiles', 'table public.profiles exists');
select col_is_pk('public', 'profiles', 'id', 'profiles.id is the primary key');
select col_type_is('public', 'profiles', 'id', 'uuid', 'profiles.id is uuid');
select fk_ok('public', 'profiles', 'id', 'auth', 'users', 'id', 'profiles.id references auth.users');
select ok(
  (select c.confdeltype = 'c' from pg_catalog.pg_constraint c
   where c.conrelid = 'public.profiles'::regclass and c.contype = 'f'),
  'profiles.id cascades on auth.users delete'
);
select col_not_null('public', 'profiles', 'display_name', 'display_name is not null');
select col_is_null('public', 'profiles', 'avatar_path', 'avatar_path is nullable');
select col_not_null('public', 'profiles', 'time_zone', 'time_zone is not null');
select col_not_null('public', 'profiles', 'created_at', 'created_at is not null');
select col_not_null('public', 'profiles', 'updated_at', 'updated_at is not null');
select has_trigger('public', 'profiles', 'profiles_set_updated_at', 'profiles has the updated_at trigger');
select tests.rls_enabled('public', 'profiles');

-- ===== Grants per role =====
select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'authenticated: SELECT on profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'authenticated: no INSERT on profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'authenticated: no DELETE on profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'authenticated: no table-wide UPDATE on profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE, REFERENCES, TRIGGER'), 'authenticated: no TRUNCATE/REFERENCES/TRIGGER');
select ok(has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'), 'authenticated: UPDATE on display_name');
select ok(has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'UPDATE'), 'authenticated: UPDATE on avatar_path');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'time_zone', 'UPDATE'), 'authenticated: no UPDATE on time_zone');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'), 'authenticated: no UPDATE on id');
select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon: no privileges on profiles'
);
select ok(
  not has_any_column_privilege('anon', 'public.profiles', 'SELECT, INSERT, UPDATE, REFERENCES'),
  'anon: no column privileges on profiles'
);

-- save_profile: security definer, empty search_path, executable by authenticated only
select has_function('public', 'save_profile', array['text', 'text'], 'public.save_profile(text, text) exists');
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.save_profile(text, text)'::regprocedure),
  'save_profile is security definer'
);
select ok(
  (select 'search_path=""' = any (p.proconfig) from pg_catalog.pg_proc p where p.oid = 'public.save_profile(text, text)'::regprocedure),
  'save_profile pins search_path to empty'
);
select ok(not has_function_privilege('public', 'public.save_profile(text, text)', 'EXECUTE'), 'PUBLIC cannot execute save_profile');
select ok(not has_function_privilege('anon', 'public.save_profile(text, text)', 'EXECUTE'), 'anon cannot execute save_profile');
select ok(has_function_privilege('authenticated', 'public.save_profile(text, text)', 'EXECUTE'), 'authenticated can execute save_profile');

-- ===== save_profile behaviour =====
select tests.authenticate_as('alice');

select lives_ok(
  $$ select public.save_profile('  Alice  ', 'Asia/Manila') $$,
  'save_profile inserts the caller''s profile'
);
select results_eq(
  $$ select display_name, time_zone from public.profiles where id = tests.get_supabase_uid('alice') $$,
  $$ values ('Alice'::text, 'Asia/Manila'::text) $$,
  'the inserted profile has the trimmed name and the zone'
);

select lives_ok(
  $$ select public.save_profile('Ally', 'Europe/Paris') $$,
  'a second save_profile call succeeds'
);
select results_eq(
  $$ select display_name, time_zone from public.profiles where id = tests.get_supabase_uid('alice') $$,
  $$ values ('Ally'::text, 'Asia/Manila'::text) $$,
  'the second call changes only the name, not the zone'
);

select throws_ok(
  $$ select public.save_profile('   ', 'UTC') $$,
  'P0001', 'invalid_display_name',
  'a blank name raises invalid_display_name'
);
select throws_ok(
  $$ select public.save_profile(pg_catalog.repeat('a', 25), 'UTC') $$,
  'P0001', 'invalid_display_name',
  'a 25-character name raises invalid_display_name'
);
select throws_ok(
  $$ select public.save_profile('Alice', 'Mars/Olympus_Mons') $$,
  'P0001', 'invalid_time_zone',
  'a zone not in pg_timezone_names raises invalid_time_zone'
);

-- ===== Cross-user isolation =====
select tests.authenticate_as('bob');
select lives_ok(
  $$ select public.save_profile(pg_catalog.repeat('b', 24), 'UTC') $$,
  'a 24-character name is accepted'
);
select results_eq(
  $$ select id from public.profiles $$,
  $$ select tests.get_supabase_uid('bob') $$,
  'a user reads only their own profile'
);

-- Bob tries to rename Alice: RLS hides her row, so nothing changes.
update public.profiles set display_name = 'Hacked' where id = tests.get_supabase_uid('alice');

-- Bob may rename himself directly (column-level UPDATE), within the same name rule.
select lives_ok(
  $$ update public.profiles set display_name = 'Bobby' where id = tests.get_supabase_uid('bob') $$,
  'a user can update their own display_name directly'
);
select throws_ok(
  $$ update public.profiles set display_name = '  ' where id = tests.get_supabase_uid('bob') $$,
  '23514', null,
  'a direct update to a blank name violates the check constraint'
);
select throws_ok(
  $$ update public.profiles set time_zone = 'UTC' where id = tests.get_supabase_uid('bob') $$,
  '42501', null,
  'a direct UPDATE of time_zone is denied'
);
select throws_ok(
  $$ delete from public.profiles where id = tests.get_supabase_uid('bob') $$,
  '42501', null,
  'a direct DELETE is denied'
);

select tests.authenticate_as('carol');
select throws_ok(
  $$ insert into public.profiles (id, display_name, time_zone) values (tests.get_supabase_uid('carol'), 'Carol', 'UTC') $$,
  '42501', null,
  'a direct INSERT is denied'
);

-- ===== anon =====
select tests.clear_authentication();
select throws_ok(
  $$ select public.save_profile('Anon', 'UTC') $$,
  '42501', null,
  'anon cannot execute save_profile'
);
select throws_ok(
  $$ select * from public.profiles $$,
  '42501', null,
  'anon cannot read profiles'
);

-- ===== Results seen by the owner of the data =====
reset role;
select results_eq(
  $$ select display_name from public.profiles where id = tests.get_supabase_uid('alice') $$,
  $$ values ('Ally'::text) $$,
  'another user could not update Alice''s profile'
);
select results_eq(
  $$ select display_name from public.profiles where id = tests.get_supabase_uid('bob') $$,
  $$ values ('Bobby'::text) $$,
  'Bob''s own direct rename was stored'
);

select * from finish();
rollback;
