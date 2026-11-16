-- Security baseline (Story 1.1, AD-16): the private schema is closed, and objects created after
-- the baseline migration get no default privileges for client roles.
begin;
select plan(18);

-- private schema: exists, closed to client roles
select has_schema('private', 'schema private exists');
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon has no USAGE on private');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated has no USAGE on private');

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
