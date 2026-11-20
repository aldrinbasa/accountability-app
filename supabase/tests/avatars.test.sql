-- Avatars (Story 3.6): the `avatars` bucket, private.avatar_path_owner, the Storage INSERT and
-- SELECT policies (no UPDATE or DELETE policy), profiles.avatar_path writable only by its owner,
-- and grants per role (AD-16).
--
-- Cast, in "Crew" (alice creates it; dates set as the owner, 2026):
--   alice  admin, joined 1 Jan, current (the avatar owner)
--   bob    joined 2 Jan, current (a current groupmate)
--   olly   joined 3 Jan, left 10 Jan (a former groupmate)
-- erin has a profile and never joins (a stranger).
-- Avatar objects are inserted as alice through the policy; ids are kept in transaction-local
-- settings so every role can read them.
begin;
select plan(26);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('olly');
select tests.create_supabase_user('erin');

select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('olly');
select public.save_profile('Olly', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);

reset role;
update public.memberships
set joined_at = '2026-01-01 00:00:00+00'
where group_id = current_setting('test.g1')::uuid
  and user_id = tests.get_supabase_uid('alice');
insert into public.memberships (group_id, user_id, role, joined_at, ended_at, end_reason)
values
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('bob'), 'member',
   '2026-01-02 00:00:00+00', null, null),
  (current_setting('test.g1')::uuid, tests.get_supabase_uid('olly'), 'member',
   '2026-01-03 00:00:00+00', '2026-01-10 00:00:00+00', 'left');

select pg_catalog.set_config('test.alice', tests.get_supabase_uid('alice')::text, true);
select pg_catalog.set_config('test.bob', tests.get_supabase_uid('bob')::text, true);
select pg_catalog.set_config('test.alice_path',
  tests.get_supabase_uid('alice')::text || '/00000000-0000-4000-a000-000000000301.webp', true);

-- ===== Shape =====
select is(
  (select row(b.public, b.file_size_limit, b.allowed_mime_types)::text
   from storage.buckets b where b.id = 'avatars'),
  row(false, 204800::bigint, array['image/webp']::text[])::text,
  'bucket avatars: private, 200 KB, image/webp only'
);
select ok(
  (select 'search_path=""' = any (p.proconfig) and not p.prosecdef and p.provolatile = 'i'
   from pg_catalog.pg_proc p where p.oid = 'private.avatar_path_owner(text)'::regprocedure),
  'avatar_path_owner is immutable, security invoker, with an empty search_path'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects'
     and p.policyname like 'avatars%' and p.cmd in ('UPDATE', 'DELETE', 'ALL')),
  0,
  'no UPDATE or DELETE policy on avatar objects'
);
select is(
  (select pg_catalog.array_agg(p.policyname::text || ':' || p.cmd order by p.policyname)
   from pg_catalog.pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname like 'avatars%'),
  array['avatars_insert_own:INSERT', 'avatars_select_shared:SELECT']::text[],
  'avatars has exactly an INSERT and a SELECT policy'
);

-- ===== avatar_path_owner =====
select is(private.avatar_path_owner(current_setting('test.alice_path')),
  current_setting('test.alice')::uuid, 'avatar_path_owner: a well-formed path gives its owner');
select is(private.avatar_path_owner(current_setting('test.alice') || '/x.webp'), null::uuid,
  'avatar_path_owner: a non-uuid version is malformed');
select is(private.avatar_path_owner(current_setting('test.alice') || '/00000000-0000-4000-a000-000000000301.jpg'),
  null::uuid, 'avatar_path_owner: a non-webp name is malformed');
select is(private.avatar_path_owner(upper(current_setting('test.alice_path'))), null::uuid,
  'avatar_path_owner: uppercase UUIDs are malformed');
select is(private.avatar_path_owner(current_setting('test.alice') || '/a/00000000-0000-4000-a000-000000000301.webp'),
  null::uuid, 'avatar_path_owner: a nested path is malformed');
select is(private.avatar_path_owner(null), null::uuid, 'avatar_path_owner: null gives null');

-- ===== Storage INSERT =====
select tests.authenticate_as('alice');
select lives_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', %L, %L)$q$,
    current_setting('test.alice_path'), current_setting('test.alice')),
  'storage: the owner uploads under their own folder'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', %L, %L)$q$,
    current_setting('test.bob') || '/00000000-0000-4000-a000-000000000302.webp',
    current_setting('test.alice')),
  '42501', null, 'storage: an upload under another user''s folder is refused'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', %L, %L)$q$,
    current_setting('test.alice') || '/00000000-0000-4000-a000-000000000303.webp',
    current_setting('test.bob')),
  '42501', null, 'storage: wrong owner is refused'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', %L, %L)$q$,
    current_setting('test.alice') || '/00000000-0000-4000-a000-000000000304.jpg',
    current_setting('test.alice')),
  '42501', null, 'storage: a non-webp name is refused'
);
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', %L, %L)$q$,
    current_setting('test.alice') || '/photo.webp', current_setting('test.alice')),
  '42501', null, 'storage: a name without a version id is refused'
);

-- ===== Storage SELECT =====
select tests.authenticate_as('alice');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'avatars' and o.name = current_setting('test.alice_path')),
  1, 'storage: the owner reads their own avatar'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'avatars' and o.name = current_setting('test.alice_path')),
  1, 'storage: a current groupmate reads the avatar'
);
select tests.authenticate_as('olly');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'avatars' and o.name = current_setting('test.alice_path')),
  1, 'storage: a former groupmate reads the avatar'
);
select tests.authenticate_as('erin');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'avatars' and o.name = current_setting('test.alice_path')),
  0, 'storage: a stranger reads no avatar'
);
select tests.clear_authentication();
select is(
  (select count(*)::integer from storage.objects o where o.bucket_id = 'avatars'),
  0, 'storage: anon reads no avatar'
);

-- ===== profiles.avatar_path: owner only =====
select tests.authenticate_as('alice');
update public.profiles set avatar_path = current_setting('test.alice_path')
where id = current_setting('test.alice')::uuid;
select is(
  (select p.avatar_path from public.profiles p where p.id = current_setting('test.alice')::uuid),
  current_setting('test.alice_path'),
  'profiles: the owner sets their own avatar_path'
);
select tests.authenticate_as('bob');
update public.profiles set avatar_path = 'x' where id = current_setting('test.alice')::uuid;
select is(
  (select p.avatar_path from public.profiles p where p.id = current_setting('test.alice')::uuid),
  current_setting('test.alice_path'),
  'profiles: a groupmate cannot change another member''s avatar_path'
);
select is(
  (select p.avatar_path from public.profiles p where p.id = current_setting('test.alice')::uuid),
  current_setting('test.alice_path'),
  'profiles: a groupmate reads the avatar_path'
);

-- ===== Grants =====
select ok(
  has_function_privilege('authenticated', 'private.avatar_path_owner(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.avatar_path_owner(text)', 'EXECUTE')
  and not has_function_privilege('public', 'private.avatar_path_owner(text)', 'EXECUTE'),
  'only authenticated can execute avatar_path_owner'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'avatar_path', 'UPDATE')
  and not has_column_privilege('anon', 'public.profiles', 'avatar_path', 'UPDATE'),
  'avatar_path: UPDATE for authenticated only (Story 1.4 grant, unchanged)'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon cannot read profiles'
);

select * from finish();
rollback;
