-- Security baseline (Story 1.1, AD-16): the private schema is closed to anon, and objects created
-- after the baseline migration get no default privileges for client roles.
-- Story 1.6 gives authenticated USAGE on private and EXECUTE on exactly three RLS helpers
-- (is_member, is_admin, shares_group); nothing else in private is executable by a client role.
begin;
select plan(20);

-- private schema: exists, closed to anon; authenticated may only reach the RLS helpers
select has_schema('private', 'schema private exists');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no USAGE on private');
select ok(has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated has USAGE on private (Story 1.6 RLS helpers)');
select results_eq(
  $$ select p.proname::text from pg_catalog.pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by 1 $$,
  $$ values ('is_admin'::text), ('is_member'::text), ('shares_group'::text) $$,
  'authenticated can execute only is_admin, is_member and shares_group in private'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE'))),
  0, 'anon and PUBLIC can execute nothing in private'
);

-- a function created now in public: nobody but its owner may execute it
create function public.baseline_probe_fn() returns integer language sql as 'select 1';
select ok(not has_function_privilege('public', 'public.baseline_probe_fn()', 'EXECUTE'), 'new public function: no EXECUTE for PUBLIC');
select ok(not has_function_privilege('anon', 'public.baseline_probe_fn()', 'EXECUTE'), 'new public function: no EXECUTE for anon');
select ok(not has_function_privilege('authenticated', 'public.baseline_probe_fn()', 'EXECUTE'), 'new public function: no EXECUTE for authenticated');

-- a function created now in private: not executable by PUBLIC either
create function private.baseline_probe_fn() returns integer language sql as 'select 1';
select ok(not has_function_privilege('public', 'private.baseline_probe_fn()', 'EXECUTE'), 'new private function: no EXECUTE for PUBLIC');
select ok(not has_function_privilege('anon', 'private.baseline_probe_fn()', 'EXECUTE'), 'new private function: no EXECUTE for anon');
select ok(not has_function_privilege('authenticated', 'private.baseline_probe_fn()', 'EXECUTE'), 'new private function: no EXECUTE for authenticated');

-- a table created now in public: no privileges at all for client roles
create table public.baseline_probe_table (id integer);
select ok(
  not has_table_privilege('anon', 'public.baseline_probe_table', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'new public table: no privileges for anon'
);
select ok(
  not has_table_privilege('authenticated', 'public.baseline_probe_table', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'new public table: no privileges for authenticated'
);

-- a sequence created now in public: no privileges for client roles
create sequence public.baseline_probe_seq;
select ok(not has_sequence_privilege('anon', 'public.baseline_probe_seq', 'USAGE, SELECT, UPDATE'), 'new public sequence: no privileges for anon');
select ok(not has_sequence_privilege('authenticated', 'public.baseline_probe_seq', 'USAGE, SELECT, UPDATE'), 'new public sequence: no privileges for authenticated');

-- private.set_updated_at(): the shared trigger function, security invoker, empty search_path
select has_function('private', 'set_updated_at', array[]::text[], 'private.set_updated_at() exists');
select function_returns('private', 'set_updated_at', array[]::text[], 'trigger', 'private.set_updated_at() returns trigger');
select ok(
  not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'private.set_updated_at()'::regprocedure),
  'private.set_updated_at() is security invoker'
);
select ok(
  (select 'search_path=""' = any (p.proconfig) from pg_catalog.pg_proc p where p.oid = 'private.set_updated_at()'::regprocedure),
  'private.set_updated_at() pins search_path to empty'
);

-- the trigger function actually stamps updated_at
create table public.baseline_probe_stamp (id integer primary key, updated_at timestamptz not null default 'epoch');
create trigger baseline_probe_stamp_updated_at
  before update on public.baseline_probe_stamp
  for each row execute function private.set_updated_at();
insert into public.baseline_probe_stamp (id) values (1);
update public.baseline_probe_stamp set id = 1 where id = 1;
select ok(
  (select updated_at > 'epoch'::timestamptz from public.baseline_probe_stamp where id = 1),
  'private.set_updated_at() stamps updated_at on update'
);

select * from finish();
rollback;
