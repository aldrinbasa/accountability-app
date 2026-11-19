-- Activities (Story 2.1): the 20 seeded presets, group_activities and its constraints,
-- private.resolve_group_activity (exactly one input, presets, group ids, custom names), RLS for
-- members, non-members and ended memberships, the group_activity_options view, and grants per role.
--
-- Cast: alice creates "Crew" (admin); bob and carol join with alice's invite; carol then leaves.
-- erin creates "Solo" and is a stranger to Crew.
-- private.resolve_group_activity is not client-executable, so it is called as the owner after
-- `reset role` (the jwt claims stay set, so auth.uid() is still the authenticated user).
-- Ids are kept in transaction-local settings (test.g1, test.gym, ...) so every role can read them.
begin;
select plan(77);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('erin');

-- ===== Shape =====
select has_table('public', 'preset_activities', 'public.preset_activities exists');
select has_table('public', 'group_activities', 'public.group_activities exists');
select has_view('public', 'group_activity_options', 'public.group_activity_options exists');
select columns_are('public', 'preset_activities', array['key', 'name', 'category', 'sort'],
  'preset_activities has key, name, category, sort');
select columns_are('public', 'group_activities',
  array['id', 'group_id', 'preset_key', 'custom_name', 'created_by', 'schedule_type', 'created_at', 'updated_at'],
  'group_activities has the story''s columns');
select columns_are('public', 'group_activity_options',
  array['id', 'group_id', 'preset_key', 'custom_name', 'created_by', 'locked_schedule_type'],
  'group_activity_options has the story''s columns');
select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_catalog.pg_class c
   where c.oid = 'public.group_activity_options'::regclass),
  'group_activity_options is security_invoker'
);
select tests.rls_enabled('public', 'preset_activities');
select tests.rls_enabled('public', 'group_activities');
select index_is_unique('public', 'group_activities', 'group_activities_one_per_preset',
  'one row per preset per group is a unique index');
select index_is_unique('public', 'group_activities', 'group_activities_custom_per_creator',
  'custom names per creator are a unique index');
select has_function('private', 'resolve_group_activity', array['uuid', 'text', 'uuid', 'text'],
  'private.resolve_group_activity(uuid, text, uuid, text) exists');
select ok(
  (select p.prorettype = 'public.group_activities'::regtype from pg_catalog.pg_proc p
   where p.oid = 'private.resolve_group_activity(uuid, text, uuid, text)'::regprocedure),
  'resolve_group_activity returns a group_activities row'
);
select ok(
  (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_catalog.pg_proc p
   where p.oid = 'private.resolve_group_activity(uuid, text, uuid, text)'::regprocedure),
  'resolve_group_activity is security definer with an empty search_path'
);

-- ===== The 20 presets =====
select is((select count(*)::integer from public.preset_activities), 20, 'exactly 20 presets are seeded');
select is(
  (select pg_catalog.array_agg(distinct category::text collate "C" order by category::text collate "C")
   from public.preset_activities),
  array['creative', 'fitness', 'life_work', 'mind']::text[],
  'the presets fall in exactly four categories'
);
select is(
  (select pg_catalog.array_agg(category || ':' || key || ':' || name order by sort)
   from public.preset_activities),
  array[
    'fitness:gym:Gym', 'fitness:run:Run', 'fitness:walk:Walk', 'fitness:yoga:Yoga', 'fitness:sports:Sports',
    'mind:study:Study', 'mind:read:Read', 'mind:meditate:Meditate', 'mind:journal:Journal',
    'mind:language_practice:Language practice',
    'creative:paint:Paint', 'creative:draw:Draw', 'creative:music_practice:Music practice',
    'creative:write:Write', 'creative:photography:Photography',
    'life_work:side_business:Side business', 'life_work:cook_at_home:Cook at home',
    'life_work:clean:Clean', 'life_work:groceries:Groceries', 'life_work:sleep_early:Sleep early'
  ]::text[],
  'the presets have the exact keys, display names, categories and order'
);

-- ===== Grants per role =====
select ok(
  not has_table_privilege('anon', 'public.preset_activities', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('anon', 'public.group_activities', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('anon', 'public.group_activity_options', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'anon has no privileges on preset_activities, group_activities or group_activity_options'
);
select ok(
  has_table_privilege('authenticated', 'public.preset_activities', 'SELECT')
  and has_table_privilege('authenticated', 'public.group_activities', 'SELECT')
  and has_table_privilege('authenticated', 'public.group_activity_options', 'SELECT'),
  'authenticated can SELECT preset_activities, group_activities and group_activity_options'
);
select ok(
  not has_table_privilege('authenticated', 'public.preset_activities', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('authenticated', 'public.group_activities', 'INSERT, UPDATE, DELETE, TRUNCATE')
  and not has_table_privilege('authenticated', 'public.group_activity_options', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'authenticated cannot write preset_activities, group_activities or group_activity_options'
);
select ok(
  not has_table_privilege('service_role', 'public.preset_activities', 'INSERT')
  and not has_table_privilege('service_role', 'public.preset_activities', 'UPDATE')
  and not has_table_privilege('service_role', 'public.preset_activities', 'DELETE')
  and not has_table_privilege('public', 'public.preset_activities', 'INSERT, UPDATE, DELETE'),
  'no client or service role can insert, update or delete presets'
);
select ok(
  not has_function_privilege('authenticated', 'private.resolve_group_activity(uuid, text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.resolve_group_activity(uuid, text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('public', 'private.resolve_group_activity(uuid, text, uuid, text)', 'EXECUTE'),
  'resolve_group_activity is not executable by authenticated, anon or PUBLIC'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.c1'));

-- ===== A client cannot call the resolver =====
select tests.authenticate_as('alice');
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, null) $$,
  '42501', null,
  'an authenticated client calling resolve_group_activity is refused'
);

-- ===== Presets =====
-- alice (owner role, her jwt) is the first to use Gym in Crew.
reset role;
select pg_catalog.set_config('test.gym',
  (private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, null)).id::text, true);
select is(
  (select ga.group_id::text || ':' || ga.preset_key || ':' || coalesce(ga.custom_name, '-') || ':'
          || coalesce(ga.schedule_type, '-')
   from public.group_activities ga where ga.id = current_setting('test.gym')::uuid),
  current_setting('test.g1') || ':gym:-:-',
  'a preset key on first use inserts the group''s row for it (no custom name, no schedule type)'
);
select is(
  (select ga.created_by from public.group_activities ga where ga.id = current_setting('test.gym')::uuid),
  tests.get_supabase_uid('alice'),
  'the first member to use a preset is its created_by'
);
select ok(
  (select ga.xmax::text <> '0' from public.group_activities ga where ga.id = current_setting('test.gym')::uuid),
  'the inserted preset row comes back locked (select ... for update)'
);

select tests.authenticate_as('bob');
reset role;
select is(
  (private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, null)).id,
  current_setting('test.gym')::uuid,
  'a second member using the same preset gets the same row'
);
select tests.authenticate_as('alice');
reset role;
select is(
  (private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, null)).id,
  current_setting('test.gym')::uuid,
  'the first member using the preset again gets the same row'
);
select is(
  (select count(*)::integer from public.group_activities
   where group_id = current_setting('test.g1')::uuid and preset_key = 'gym'),
  1, 'the group still has a single Gym row'
);
select ok(
  (select ga.xmax::text <> '0' from public.group_activities ga where ga.id = current_setting('test.gym')::uuid),
  'the reused preset row comes back locked'
);

select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, 'surfing', null, null) $$,
  'P0001', 'invalid_activity',
  'an unknown preset key raises invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, '', null, null) $$,
  'P0001', 'invalid_activity',
  'an empty preset key raises invalid_activity'
);

-- erin uses Run in her own group.
select tests.authenticate_as('erin');
reset role;
select pg_catalog.set_config('test.erun',
  (private.resolve_group_activity(current_setting('test.g2')::uuid, 'run', null, null)).id::text, true);
select is(
  (select ga.group_id from public.group_activities ga where ga.id = current_setting('test.erun')::uuid),
  current_setting('test.g2')::uuid,
  'a preset row belongs to the group it was resolved in'
);

-- ===== A group_activity_id =====
select tests.authenticate_as('bob');
reset role;
select is(
  (private.resolve_group_activity(current_setting('test.g1')::uuid, null, current_setting('test.gym')::uuid, null)).id,
  current_setting('test.gym')::uuid,
  'a group_activity_id of this group returns that row'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, null, current_setting('test.erun')::uuid, null) $$,
  'P0001', 'invalid_activity',
  'another group''s group_activity_id raises invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, null, pg_catalog.gen_random_uuid(), null) $$,
  'P0001', 'invalid_activity',
  'an unknown group_activity_id raises invalid_activity'
);

-- ===== Exactly one input =====
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, null) $$,
  'P0001', 'invalid_activity',
  'no input raises invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', null, 'Pottery') $$,
  'P0001', 'invalid_activity',
  'a preset key and a custom name raise invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', current_setting('test.gym')::uuid, null) $$,
  'P0001', 'invalid_activity',
  'a preset key and a group_activity_id raise invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, null, current_setting('test.gym')::uuid, 'Pottery') $$,
  'P0001', 'invalid_activity',
  'a group_activity_id and a custom name raise invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, 'gym', current_setting('test.gym')::uuid, 'Pottery') $$,
  'P0001', 'invalid_activity',
  'all three inputs raise invalid_activity'
);

-- ===== Custom names =====
select tests.authenticate_as('alice');
reset role;
select pg_catalog.set_config('test.pottery',
  (private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, '  Pottery ')).id::text, true);
select is(
  (select ga.custom_name from public.group_activities ga where ga.id = current_setting('test.pottery')::uuid),
  'Pottery',
  'a custom name is stored trimmed'
);
select ok(
  (select ga.preset_key is null and ga.created_by = tests.get_supabase_uid('alice')
   from public.group_activities ga where ga.id = current_setting('test.pottery')::uuid),
  'a custom row has no preset key and is created_by the caller'
);
select ok(
  (select ga.xmax::text <> '0' from public.group_activities ga where ga.id = current_setting('test.pottery')::uuid),
  'the inserted custom row comes back locked'
);
select is(
  (private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, 'pottery')).id,
  current_setting('test.pottery')::uuid,
  'the same member typing the same name in another case reuses their own row'
);
select is(
  (private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, 'POTTERY  ')).custom_name,
  'Pottery',
  'a reused custom row keeps its first spelling'
);

select tests.authenticate_as('bob');
reset role;
select pg_catalog.set_config('test.bpottery',
  (private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, 'Pottery')).id::text, true);
select isnt(
  current_setting('test.bpottery')::uuid,
  current_setting('test.pottery')::uuid,
  'another member typing the same custom name gets a new row (FR-10)'
);
select is(
  (select count(*)::integer from public.group_activities
   where group_id = current_setting('test.g1')::uuid and pg_catalog.lower(custom_name) = 'pottery'),
  2, 'the group has two separate Pottery rows, one per member'
);
select is(
  (private.resolve_group_activity(current_setting('test.g1')::uuid, null, current_setting('test.pottery')::uuid, null)).id,
  current_setting('test.pottery')::uuid,
  'another member can pick a custom activity by its group_activity_id to share it'
);

select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, '') $$,
  'P0001', 'invalid_activity',
  'an empty custom name raises invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, '    ') $$,
  'P0001', 'invalid_activity',
  'a blank custom name (0 characters after trimming) raises invalid_activity'
);
select throws_ok(
  $$ select private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, 'abcdefghijklmnopqrstuvwxy') $$,
  'P0001', 'invalid_activity',
  'a 25-character custom name raises invalid_activity'
);
select is(
  (private.resolve_group_activity(current_setting('test.g1')::uuid, null, null, ' abcdefghijklmnopqrstuvwx ')).custom_name,
  'abcdefghijklmnopqrstuvwx',
  'a 24-character custom name (after trimming) is accepted'
);

-- ===== Table constraints (as the owner) =====
select throws_ok(
  format($$ insert into public.group_activities (group_id, preset_key, custom_name, created_by)
            values (%L, 'run', 'Running', %L) $$, current_setting('test.g1'), tests.get_supabase_uid('alice')),
  '23514', null,
  'a row with both a preset key and a custom name is rejected'
);
select throws_ok(
  format($$ insert into public.group_activities (group_id, created_by) values (%L, %L) $$,
         current_setting('test.g1'), tests.get_supabase_uid('alice')),
  '23514', null,
  'a row with neither a preset key nor a custom name is rejected'
);
select throws_ok(
  format($$ insert into public.group_activities (group_id, preset_key, created_by) values (%L, 'gym', %L) $$,
         current_setting('test.g1'), tests.get_supabase_uid('bob')),
  '23505', null,
  'a second row for the same preset in a group is rejected'
);
select throws_ok(
  format($$ insert into public.group_activities (group_id, custom_name, created_by) values (%L, 'POTTERY', %L) $$,
         current_setting('test.g1'), tests.get_supabase_uid('alice')),
  '23505', null,
  'a second custom row with the same case-insensitive name for the same creator is rejected'
);
select throws_ok(
  format($$ insert into public.group_activities (group_id, preset_key, created_by, schedule_type) values (%L, 'walk', %L, 'daily') $$,
         current_setting('test.g1'), tests.get_supabase_uid('alice')),
  '23514', null,
  'an unknown schedule type is rejected'
);
select lives_ok(
  format($$ update public.group_activities set schedule_type = 'times_per_week' where id = %L $$,
         current_setting('test.gym')),
  'schedule_type accepts times_per_week'
);
select throws_ok(
  format($$ insert into public.group_activities (group_id, custom_name, created_by) values (%L, ' Pad', %L) $$,
         current_setting('test.g1'), tests.get_supabase_uid('alice')),
  '23514', null,
  'an untrimmed custom name is rejected'
);
select throws_ok(
  format($$ insert into public.group_activities (group_id, preset_key, created_by) values (%L, 'surfing', %L) $$,
         current_setting('test.g1'), tests.get_supabase_uid('alice')),
  '23503', null,
  'a preset key that is not in preset_activities is rejected'
);

-- carol leaves Crew (her membership ends).
select tests.authenticate_as('carol');
select public.leave_group(current_setting('test.g1')::uuid);

-- ===== RLS: reads =====
-- Crew now holds Gym, alice's Pottery, bob's Pottery and the 24-character name.
select tests.authenticate_as('alice');
select is(
  (select count(*)::integer from public.group_activities where group_id = current_setting('test.g1')::uuid),
  4, 'a current member reads all of the group''s activities'
);
select is(
  (select count(*)::integer from public.group_activities where group_id = current_setting('test.g2')::uuid),
  0, 'a member of another group reads none of Solo''s activities'
);
select is(
  (select count(*)::integer from public.group_activity_options where group_id = current_setting('test.g1')::uuid),
  4, 'group_activity_options returns the group''s rows to a current member'
);
select ok(
  (select bool_and(locked_schedule_type is null) from public.group_activity_options),
  'locked_schedule_type is null for every row (Story 2.2 fills it)'
);
select is(
  (select o.preset_key || ':' || o.created_by::text from public.group_activity_options o
   where o.id = current_setting('test.gym')::uuid),
  'gym:' || tests.get_supabase_uid('alice')::text,
  'group_activity_options carries the preset key and created_by'
);
select is((select count(*)::integer from public.preset_activities), 20, 'a member reads all 20 presets');
select throws_ok(
  format($$ insert into public.group_activities (group_id, preset_key, created_by) values (%L, 'walk', %L) $$,
         current_setting('test.g1'), tests.get_supabase_uid('alice')),
  '42501', null,
  'a client cannot insert into group_activities'
);
select throws_ok(
  $$ delete from public.preset_activities $$,
  '42501', null,
  'a client cannot delete presets'
);

select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.group_activities where group_id = current_setting('test.g1')::uuid),
  4, 'another current member reads the same rows'
);

select tests.authenticate_as('carol');
select is((select count(*)::integer from public.group_activities), 0, 'an ended membership reads no group activities');
select is((select count(*)::integer from public.group_activity_options), 0, 'an ended membership reads no group_activity_options rows');

select tests.authenticate_as('erin');
select is(
  (select count(*)::integer from public.group_activities where group_id = current_setting('test.g1')::uuid),
  0, 'a non-member reads none of Crew''s activities'
);
select is(
  (select pg_catalog.array_agg(id) from public.group_activity_options),
  array[current_setting('test.erun')::uuid],
  'a non-member of Crew sees only their own group''s rows in group_activity_options'
);
select is((select count(*)::integer from public.preset_activities), 20, 'any authenticated user reads all 20 presets');

select tests.clear_authentication();
select throws_ok(
  $$ select count(*) from public.preset_activities $$,
  '42501', null,
  'anon cannot read presets'
);
select throws_ok(
  $$ select count(*) from public.group_activity_options $$,
  '42501', null,
  'anon cannot read group_activity_options'
);

select * from finish();
rollback;
