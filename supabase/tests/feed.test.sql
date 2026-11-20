-- Feed wall (Story 3.4): the feed_events table (shape, kinds, append-only guard, RLS, grants),
-- the events written by join_group and private.end_membership (join, idempotent rejoin, removal,
-- leave, admin handover, last member), the feed_items view (security_invoker, columns, RLS for
-- members, non-members and left members, removed and rejoined members, the handover hiding, extra,
-- late and counted position) and the Storage read rule for hidden check-ins (AD-16).
--
-- Cast: alice creates "Crew" (admin, Europe/London); bob, carol and erin join with her invite.
-- dave is alone in "Other". Week Mon 16 to Sun 22 Nov 2026 (London = UTC in November): alice has
-- Gym fixed days Mon Wed Fri and Run 2 times per week; bob has Walk 2 times per week.
-- Memberships and events use the real clock (one transaction, so one timestamp); check-ins use
-- the frozen clock through post_checkin's search_path override (rolled back with everything else).
begin;
set local timezone = 'UTC';
select plan(49);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');

-- ===== Shape =====
select columns_are('public', 'feed_events',
  array['id', 'group_id', 'kind', 'actor_id', 'subject_id', 'payload', 'created_at', 'updated_at'],
  'feed_events has the story''s columns');
select ok(
  (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.feed_events'::regclass),
  'RLS is enabled on feed_events'
);
select ok(
  (select c.relkind = 'v' and 'security_invoker=true' = any (c.reloptions)
   from pg_catalog.pg_class c where c.oid = 'public.feed_items'::regclass),
  'feed_items is a security_invoker view'
);
select is(
  (select pg_catalog.array_agg(a.attname::text order by a.attnum)
   from pg_catalog.pg_attribute a
   where a.attrelid = 'public.feed_items'::regclass and a.attnum > 0 and not a.attisdropped),
  array['group_id', 'item_kind', 'item_id', 'sort_at', 'actor_id', 'actor_name', 'actor_avatar_path',
        'subject_id', 'subject_name', 'commitment_id', 'commitment_kind', 'activity_name',
        'preset_key', 'task_name', 'captured_at', 'received_at', 'is_late', 'is_extra', 'caption',
        'full_pruned_at', 'counted_position', 'target', 'payload', 'miss_count']::text[],
  'feed_items has the story''s columns in order'
);
select ok(
  (select bool_and(p.prosecdef and 'search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('public.join_group(text)'::regprocedure,
                   'private.end_membership(uuid, text)'::regprocedure)),
  'join_group and end_membership stay security definer with an empty search_path'
);

-- ===== Grants per role (AD-16) =====
select ok(
  has_table_privilege('authenticated', 'public.feed_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.feed_events', 'INSERT')
  and not has_table_privilege('authenticated', 'public.feed_events', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.feed_events', 'DELETE')
  and not has_table_privilege('anon', 'public.feed_events', 'SELECT, INSERT, UPDATE, DELETE'),
  'feed_events: SELECT for authenticated only, no writes, nothing for anon'
);
select ok(
  has_table_privilege('authenticated', 'public.feed_items', 'SELECT')
  and not has_table_privilege('authenticated', 'public.feed_items', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('anon', 'public.feed_items', 'SELECT, INSERT, UPDATE, DELETE'),
  'feed_items: SELECT for authenticated only, nothing for anon'
);
select ok(
  not has_function_privilege('authenticated', 'private.feed_events_append_only()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.feed_events_append_only()', 'EXECUTE')
  and not has_function_privilege('public', 'private.feed_events_append_only()', 'EXECUTE'),
  'the append-only trigger function is not executable by client roles'
);

-- ===== Profiles and groups: join events =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'Europe/London');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'Europe/London');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'Europe/London');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'Europe/London');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'Europe/London');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select pg_catalog.set_config('test.g2', public.create_group('Other')::text, true);

reset role;
select is(
  (select pg_catalog.string_agg(e.payload ->> 'actor_name', ',' order by e.payload ->> 'actor_name')
   from public.feed_events e
   where e.group_id = current_setting('test.g1')::uuid and e.kind = 'member_joined'),
  'Bob,Carol,Erin',
  'join_group writes one member_joined per joiner (creating a group writes none)'
);
select is(
  (select (e.actor_id = tests.get_supabase_uid('bob'))::text || '|' || coalesce(e.subject_id::text, 'null')
          || '|' || (e.payload ->> 'membership_id' = m.id::text)::text
   from public.feed_events e
   join public.memberships m on m.group_id = e.group_id and m.user_id = e.actor_id
   where e.group_id = current_setting('test.g1')::uuid and e.kind = 'member_joined'
     and e.actor_id = tests.get_supabase_uid('bob')),
  'true|null|true',
  'member_joined: actor = the joiner, no subject, payload carries the membership id'
);

-- Joining again as a current member is idempotent and writes nothing.
select tests.authenticate_as('bob');
select is(public.join_group(current_setting('test.code')), current_setting('test.g1')::uuid,
  'join again: the group id comes back');
reset role;
select is(
  (select count(*)::integer from public.feed_events e
   where e.group_id = current_setting('test.g1')::uuid and e.kind = 'member_joined'
     and e.actor_id = tests.get_supabase_uid('bob')),
  1,
  'join again: still one member_joined for bob'
);

-- ===== Table rules =====
select throws_ok(
  format($q$insert into public.feed_events (group_id, kind) values (%L, 'member_waved')$q$,
    current_setting('test.g1')),
  '23514', null,
  'an unknown kind violates the check constraint'
);
select throws_ok(
  format($q$update public.feed_events set payload = '{}'::jsonb where group_id = %L$q$,
    current_setting('test.g1')),
  'P0001', 'feed_events_append_only',
  'a direct UPDATE of feed_events raises feed_events_append_only'
);
select throws_ok(
  format($q$delete from public.feed_events where group_id = %L$q$, current_setting('test.g1')),
  'P0001', 'feed_events_append_only',
  'a direct DELETE of feed_events raises feed_events_append_only'
);
select tests.authenticate_as('alice');
select throws_ok(
  format($q$insert into public.feed_events (group_id, kind) values (%L, 'member_joined')$q$,
    current_setting('test.g1')),
  '42501', null,
  'authenticated cannot insert into feed_events'
);

-- ===== Frozen clock: plans, sessions and check-ins =====
reset role;
alter function public.post_checkin(uuid, uuid, timestamptz, text) set search_path = test_overrides, pg_catalog;
alter function public.add_commitment(uuid, text, uuid, text, text, integer[], integer, date)
  set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function private.tick_step_1_sessions() set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;

select pg_catalog.set_config('test.a1', '00000000-0000-4000-a000-0000000034a1', true);
select pg_catalog.set_config('test.a3', '00000000-0000-4000-a000-0000000034a3', true);
select pg_catalog.set_config('test.a4', '00000000-0000-4000-a000-0000000034a4', true);
select pg_catalog.set_config('test.a5', '00000000-0000-4000-a000-0000000034a5', true);
select pg_catalog.set_config('test.b1', '00000000-0000-4000-a000-0000000034b1', true);

set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.g1') || '/' || current_setting('test.' || p.id) || '/' || s.size || '.webp',
       tests.get_supabase_uid(p.owner)::text
from (values ('a1', 'alice'), ('a3', 'alice'), ('a4', 'alice'), ('a5', 'alice'), ('b1', 'bob')) p(id, owner)
cross join (values ('1080'), ('360')) s(size);
reset role;

select tests.freeze_time('2026-11-10 12:00:00+00');
select tests.authenticate_as('alice');
select pg_catalog.set_config('test.gym', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'gym',
    p_schedule_type => 'fixed_days', p_days => array[1, 3, 5]) a), true);
select pg_catalog.set_config('test.run', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'run',
    p_schedule_type => 'times_per_week', p_target => 2) a), true);
select tests.authenticate_as('bob');
select pg_catalog.set_config('test.walk', (select a.commitment_id::text
  from public.add_commitment(current_setting('test.g1')::uuid, p_preset_key => 'walk',
    p_schedule_type => 'times_per_week', p_target => 2) a), true);

reset role;
select tests.freeze_time('2026-11-16 00:30:00+00');
select is(private.tick_step_1_sessions(), null, 'tick step 1 writes the November week');

-- Wed 08:00 Gym (on time), Wed 09:00 Run (counts), Wed 10:00 Run (extra: second of the day),
-- Wed 11:00 bob's Walk, Fri 12:00 Gym captured 07:00 (late; counted at 07:00, Friday's session).
select tests.freeze_time('2026-11-18 08:00:00+00');
select tests.authenticate_as('alice');
select * from public.post_checkin(current_setting('test.a1')::uuid, current_setting('test.gym')::uuid,
  '2026-11-18 07:58:00+00', 'leg day');
select tests.freeze_time('2026-11-18 09:00:00+00');
select * from public.post_checkin(current_setting('test.a3')::uuid, current_setting('test.run')::uuid,
  '2026-11-18 08:59:00+00', null);
select tests.freeze_time('2026-11-18 10:00:00+00');
select * from public.post_checkin(current_setting('test.a4')::uuid, current_setting('test.run')::uuid,
  '2026-11-18 09:59:00+00', null);
select tests.freeze_time('2026-11-18 11:00:00+00');
select tests.authenticate_as('bob');
select * from public.post_checkin(current_setting('test.b1')::uuid, current_setting('test.walk')::uuid,
  '2026-11-18 10:59:00+00', null);
select tests.freeze_time('2026-11-20 12:00:00+00');
select tests.authenticate_as('alice');
select * from public.post_checkin(current_setting('test.a5')::uuid, current_setting('test.gym')::uuid,
  '2026-11-20 07:00:00+00', null);

-- ===== feed_items: what a current member sees =====
select tests.authenticate_as('carol');
select is(
  (select pg_catalog.string_agg(f.item_id::text, ',' order by f.sort_at desc, f.item_id desc)
   from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'checkin'),
  current_setting('test.a5') || ',' || current_setting('test.b1') || ',' || current_setting('test.a4')
    || ',' || current_setting('test.a3') || ',' || current_setting('test.a1'),
  'a member sees every visible check-in, newest received first'
);
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'member_joined'),
  3,
  'a member sees the three join events'
);
select is(
  (select f.actor_name || '|' || f.activity_name || '|' || f.preset_key || '|' || f.commitment_kind
          || '|' || coalesce(f.task_name, 'null') || '|' || f.caption || '|' || f.is_extra::text
          || '|' || f.is_late::text || '|' || f.counted_position::text || '|' || f.target::text
          || '|' || f.captured_at::text || '|' || f.sort_at::text || '|' || f.received_at::text
          || '|' || (f.actor_id = tests.get_supabase_uid('alice'))::text
          || '|' || (f.commitment_id = current_setting('test.gym')::uuid)::text
          || '|' || coalesce(f.payload::text, 'null') || '|' || coalesce(f.full_pruned_at::text, 'null')
   from public.feed_items f where f.item_id = current_setting('test.a1')::uuid),
  'Alice|Gym|gym|commitment|null|leg day|false|false|1|3|2026-11-18 07:58:00+00|2026-11-18 08:00:00+00'
    || '|2026-11-18 08:00:00+00|true|true|null|null',
  'an on-time check-in: names, activity, caption, 1 of 3, sorted by received_at'
);
select is(
  (select f.counted_position::text || '|' || f.target::text from public.feed_items f
   where f.item_id = current_setting('test.a3')::uuid),
  '1|2',
  'a counted times-per-week check-in: 1 of 2'
);
select is(
  (select f.is_extra::text || '|' || coalesce(f.counted_position::text, 'null') || '|'
          || coalesce(f.target::text, 'null')
   from public.feed_items f where f.item_id = current_setting('test.a4')::uuid),
  'true|null|null',
  'an extra: is_extra, no position and no target'
);
select is(
  (select f.is_late::text || '|' || f.counted_position::text || '|' || f.target::text || '|'
          || f.captured_at::text || '|' || f.sort_at::text
   from public.feed_items f where f.item_id = current_setting('test.a5')::uuid),
  'true|2|3|2026-11-20 07:00:00+00|2026-11-20 12:00:00+00',
  'a late check-in: is_late, 2 of 3, sorted by when it arrived'
);
select is(
  (select pg_catalog.string_agg(f.item_id::text, ',' order by f.sort_at desc, f.item_id desc)
   from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'checkin'
     and (f.sort_at, f.item_id) < ('2026-11-18 11:00:00+00'::timestamptz, current_setting('test.b1')::uuid)),
  current_setting('test.a4') || ',' || current_setting('test.a3') || ',' || current_setting('test.a1'),
  'keyset: the items after a cursor are the older ones'
);

-- Non-members see nothing.
select tests.authenticate_as('dave');
select is(
  (select count(*)::integer from public.feed_items f where f.group_id = current_setting('test.g1')::uuid),
  0, 'RLS: a non-member sees no feed items of the group'
);
select is((select count(*)::integer from public.feed_events), 0,
  'RLS: a non-member reads no feed events');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/%'),
  0,
  'storage: a non-member reads no photos of the group'
);
select tests.authenticate_as('carol');
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/' || current_setting('test.b1') || '/%'),
  2,
  'storage: a member reads the photos of a visible check-in'
);

-- ===== Removal: bob's check-ins and photos go, the sticky stays =====
reset role;
select tests.authenticate_as('alice');
select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('bob'));

select tests.authenticate_as('carol');
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_id = current_setting('test.b1')::uuid),
  0,
  'removed: bob''s check-in leaves the feed at once'
);
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/' || current_setting('test.b1') || '/%'),
  0,
  'removed: bob''s photos are denied to the group'
);
select is(
  (select f.actor_name || '|' || f.subject_name || '|' || (f.actor_id = tests.get_supabase_uid('alice'))::text
          || '|' || (f.subject_id = tests.get_supabase_uid('bob'))::text
          || '|' || (f.payload ->> 'end_reason')
   from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'member_removed'),
  'Alice|Bob|true|true|removed',
  'removed: one member_removed sticky, actor = the admin, subject = the removed member'
);
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'member_left'),
  0,
  'removed: no member_left for a removal'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.feed_items f where f.group_id = current_setting('test.g1')::uuid),
  0, 'removed: bob sees nothing of the group''s feed'
);
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/%'),
  0,
  'removed: bob reads no photos of the group, his own included'
);

-- Bob rejoins: a new member_joined; his old check-in belongs to the ended membership and stays out.
select public.join_group(current_setting('test.code'));
reset role;
select is(
  (select count(*)::integer from public.feed_events e
   where e.group_id = current_setting('test.g1')::uuid and e.kind = 'member_joined'
     and e.actor_id = tests.get_supabase_uid('bob')),
  2,
  'rejoin after removal: a second member_joined for bob'
);
select tests.authenticate_as('carol');
select is(
  (select count(*)::integer from public.feed_items f where f.item_id = current_setting('test.b1')::uuid),
  0,
  'rejoin: a check-in from the ended membership stays out of the feed'
);
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'member_joined'),
  4,
  'rejoin: the member sees both of bob''s joins'
);

-- ===== Leaving: erin =====
select tests.authenticate_as('erin');
select public.leave_group(current_setting('test.g1')::uuid);
select is(
  (select count(*)::integer from public.feed_items f where f.group_id = current_setting('test.g1')::uuid),
  0, 'left: erin sees nothing of the group''s feed'
);
select tests.authenticate_as('carol');
select is(
  (select f.actor_name || '|' || coalesce(f.subject_name, 'null') || '|' || (f.payload ->> 'end_reason')
          || '|' || (f.payload ->> 'actor_name')
   from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'member_left'),
  'Erin|null|left|Erin',
  'left: one member_left sticky with the name kept in the payload'
);

-- ===== Admin handover: alice leaves (alice, bob, carol current) =====
select tests.authenticate_as('alice');
select public.leave_group(current_setting('test.g1')::uuid);
reset role;
select pg_catalog.set_config('test.alice_m', (select m.id::text from public.memberships m
  where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('alice')), true);
select pg_catalog.set_config('test.new_admin', (select p.display_name from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.group_id = current_setting('test.g1')::uuid and m.role = 'admin' and m.ended_at is null), true);
select is(
  (select pg_catalog.string_agg(e.kind, ',' order by e.kind) from public.feed_events e
   where e.group_id = current_setting('test.g1')::uuid
     and e.payload ->> 'membership_id' = current_setting('test.alice_m')),
  'admin_handover,member_left',
  'handover: both a member_left and an admin_handover row are written'
);
select is(
  (select (e.actor_id = tests.get_supabase_uid('alice'))::text || '|' || (e.payload ->> 'subject_name')
   from public.feed_events e
   where e.group_id = current_setting('test.g1')::uuid and e.kind = 'admin_handover'),
  'true|' || current_setting('test.new_admin'),
  'handover: actor = the leaving admin, subject = the new admin'
);
select tests.authenticate_as('carol');
select is(
  (select pg_catalog.string_agg(f.item_kind || ':' || f.actor_name || ':' || coalesce(f.subject_name, ''), ','
     order by f.item_kind, f.actor_name)
   from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid
     and f.item_kind in ('member_left', 'admin_handover')),
  'admin_handover:Alice:' || current_setting('test.new_admin') || ',member_left:Erin:',
  'handover: the feed shows the handover and hides the admin''s own member_left'
);
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g1')::uuid and f.item_kind = 'checkin'),
  0,
  'left admin: alice''s check-ins leave the feed at once'
);
select is(
  (select count(*)::integer from storage.objects o
   where o.bucket_id = 'checkins' and o.name like current_setting('test.g1') || '/' || current_setting('test.a1') || '/%'),
  0,
  'left admin: alice''s photos are denied to the group'
);
select tests.authenticate_as('alice');
select is(
  (select count(*)::integer from public.feed_events e where e.group_id = current_setting('test.g1')::uuid),
  0, 'left: alice reads no feed events of the group'
);

-- ===== Account deletion (Story 7.2 calls end_membership with account_deleted) =====
reset role;
select private.end_membership(
  (select m.id from public.memberships m
   where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid('bob')
     and m.ended_at is null),
  'account_deleted');
select is(
  (select e.kind || '|' || (e.actor_id = tests.get_supabase_uid('bob'))::text || '|'
          || (e.payload ->> 'end_reason') || '|' || (e.payload ->> 'actor_name')
   from public.feed_events e
   where e.group_id = current_setting('test.g1')::uuid and e.kind = 'member_left'
     and e.payload ->> 'end_reason' = 'account_deleted'),
  'member_left|true|account_deleted|Bob',
  'account_deleted: a member_left row with end_reason account_deleted in the payload (a handover follows if bob was admin)'
);

-- ===== A miss with no session still missed is hidden (Story 3.5); the last member deletes the group =====
reset role;
insert into public.feed_events (group_id, kind, actor_id, payload)
values (current_setting('test.g2')::uuid, 'miss', tests.get_supabase_uid('dave'), '{"actor_name": "Dave"}');
select tests.authenticate_as('dave');
select is(
  (select count(*)::integer from public.feed_items f
   where f.group_id = current_setting('test.g2')::uuid and f.item_kind = 'miss'),
  0,
  'a miss row with no session still missed stays out of the view (misses.test.sql covers the rest)'
);
select public.leave_group(current_setting('test.g2')::uuid);
reset role;
select is(
  (select count(*)::integer from public.feed_events e where e.group_id = current_setting('test.g2')::uuid),
  0,
  'the last member leaving deletes the group and its events, with no new event'
);
select is(
  (select count(*)::integer from public.groups g where g.id = current_setting('test.g2')::uuid),
  0,
  'the last member leaving deletes the group'
);

select * from finish();
rollback;
