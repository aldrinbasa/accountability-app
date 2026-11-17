-- Leaving, removing and admin handover (Story 1.8): private.end_membership, leave_group and
-- remove_member, the admin handover order, the last-member group delete, reads after the end,
-- rejoin by invite, and grants per role (AD-16).
--
-- Cast: alice creates "Hikers" (admin). bob, carol, dave and frank join with alice's invite.
-- bob leaves. alice removes frank, who then rejoins. alice leaves (handover by joined_at), the new
-- admin leaves (handover tie broken by membership id), then the group runs down to its last
-- member and is deleted. erin has a profile and is a stranger to Hikers; she also creates "Solo"
-- and leaves it as its only member.
-- Ids are kept in transaction-local settings (test.g1, test.c1, ...) so every role can read them.
begin;
select plan(72);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('frank');

-- ===== Shape and grants per role =====
select has_function('private', 'end_membership', array['uuid', 'text'], 'private.end_membership(uuid, text) exists');
select has_function('public', 'leave_group', array['uuid'], 'public.leave_group(uuid) exists');
select has_function('public', 'remove_member', array['uuid', 'uuid'], 'public.remove_member(uuid, uuid) exists');
select function_returns('private', 'end_membership', array['uuid', 'text'], 'void', 'end_membership returns void');
select function_returns('public', 'leave_group', array['uuid'], 'void', 'leave_group returns void');
select function_returns('public', 'remove_member', array['uuid', 'uuid'], 'void', 'remove_member returns void');
select ok(
  (select bool_and(p.prosecdef) from pg_catalog.pg_proc p
   where p.oid in ('private.end_membership(uuid, text)'::regprocedure, 'public.leave_group(uuid)'::regprocedure,
                   'public.remove_member(uuid, uuid)'::regprocedure)),
  'end_membership, leave_group and remove_member are security definer'
);
select ok(
  (select bool_and('search_path=""' = any (p.proconfig)) from pg_catalog.pg_proc p
   where p.oid in ('private.end_membership(uuid, text)'::regprocedure, 'public.leave_group(uuid)'::regprocedure,
                   'public.remove_member(uuid, uuid)'::regprocedure)),
  'end_membership, leave_group and remove_member pin search_path to empty'
);
select ok(
  has_function_privilege('authenticated', 'public.leave_group(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_member(uuid, uuid)', 'EXECUTE'),
  'authenticated can execute leave_group and remove_member'
);
select ok(
  not has_function_privilege('anon', 'public.leave_group(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.remove_member(uuid, uuid)', 'EXECUTE'),
  'anon cannot execute leave_group or remove_member'
);
select ok(
  not has_function_privilege('public', 'public.leave_group(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.remove_member(uuid, uuid)', 'EXECUTE'),
  'PUBLIC cannot execute leave_group or remove_member'
);
select ok(
  not has_function_privilege('authenticated', 'private.end_membership(uuid, text)', 'EXECUTE'),
  'authenticated cannot execute end_membership'
);
select ok(
  not has_function_privilege('anon', 'private.end_membership(uuid, text)', 'EXECUTE')
  and not has_function_privilege('public', 'private.end_membership(uuid, text)', 'EXECUTE'),
  'anon and PUBLIC cannot execute end_membership'
);

-- ===== Profiles, the group and its members =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('dave');
select public.save_profile('Dave', 'UTC');
select tests.authenticate_as('erin');
select public.save_profile('Erin', 'UTC');
select tests.authenticate_as('frank');
select public.save_profile('Frank', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Hikers')::text, true);
select pg_catalog.set_config('test.c1', (select code from public.create_invite(current_setting('test.g1')::uuid)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('dave');
select public.join_group(current_setting('test.c1'));
select tests.authenticate_as('frank');
select public.join_group(current_setting('test.c1'));

-- Everyone joined in this one transaction, so joined_at ties. Spread it out as the owner:
-- alice 1 Jan, bob 2 Jan, frank 3 Jan. Of carol and dave, the one with the greater membership id
-- joined on 2 Jan and the other on 4 Jan, so the first handover is decided by joined_at against
-- the id order. test.early names the 2 Jan one, test.late the 4 Jan one.
reset role;
select pg_catalog.set_config('test.early', (
  select n from public.memberships m
  cross join pg_catalog.unnest(array['carol', 'dave']) as n
  where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid(n)
  order by m.id desc limit 1), true);
select pg_catalog.set_config('test.late', (
  select n from public.memberships m
  cross join pg_catalog.unnest(array['carol', 'dave']) as n
  where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid(n)
  order by m.id asc limit 1), true);
update public.memberships m
set joined_at = case m.user_id
  when tests.get_supabase_uid('alice') then '2026-01-01 00:00:00+00'::timestamptz
  when tests.get_supabase_uid('bob') then '2026-01-02 00:00:00+00'::timestamptz
  when tests.get_supabase_uid('frank') then '2026-01-03 00:00:00+00'::timestamptz
  when tests.get_supabase_uid(current_setting('test.early')) then '2026-01-02 00:00:00+00'::timestamptz
  else '2026-01-04 00:00:00+00'::timestamptz
end
where m.group_id = current_setting('test.g1')::uuid;

select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and ended_at is null),
  5, 'Hikers starts with 5 current members'
);

-- ===== Errors =====
select tests.authenticate_as('erin');
select throws_ok(
  $$ select public.leave_group(current_setting('test.g1')::uuid) $$,
  'P0001', 'not_member',
  'a non-member leaving raises not_member'
);
select throws_ok(
  $$ select public.leave_group(pg_catalog.gen_random_uuid()) $$,
  'P0001', 'not_member',
  'leaving an unknown group raises not_member'
);
select throws_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('bob')) $$,
  'P0001', 'not_admin',
  'a non-member removing someone raises not_admin'
);
select tests.authenticate_as('bob');
select throws_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('carol')) $$,
  'P0001', 'not_admin',
  'a member who is not admin removing someone raises not_admin'
);
select tests.authenticate_as('alice');
select throws_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('alice')) $$,
  'P0001', 'cannot_remove_self',
  'the admin removing herself raises cannot_remove_self'
);
select throws_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('erin')) $$,
  'P0001', 'not_member',
  'removing someone who was never a member raises not_member'
);
select throws_ok(
  $$ select private.end_membership(
       (select id from public.memberships where user_id = tests.get_supabase_uid('alice')), 'left') $$,
  '42501', null,
  'authenticated cannot call end_membership directly'
);
reset role;
select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and ended_at is null),
  5, 'the failed calls ended nobody'
);

-- ===== A member leaves =====
select tests.authenticate_as('bob');
select lives_ok(
  $$ select public.leave_group(current_setting('test.g1')::uuid) $$,
  'bob leaves Hikers'
);
reset role;
select results_eq(
  $$ select ended_at, end_reason, role from public.memberships
     where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('bob') $$,
  $$ values (pg_catalog.now(), 'left'::text, 'member'::text) $$,
  'bob''s membership is ended now with end_reason left'
);
select results_eq(
  $$ select user_id from public.memberships
     where group_id = current_setting('test.g1')::uuid and role = 'admin' and ended_at is null $$,
  $$ values (tests.get_supabase_uid('alice')) $$,
  'after a member leaves, alice is still the one admin'
);
select tests.authenticate_as('bob');
select throws_ok(
  $$ select public.leave_group(current_setting('test.g1')::uuid) $$,
  'P0001', 'not_member',
  'leaving again raises not_member'
);

-- ===== The admin removes a member =====
select tests.authenticate_as('alice');
select lives_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('frank')) $$,
  'alice removes frank'
);
select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('frank')),
  0, 'the admin no longer reads frank''s membership'
);
reset role;
select results_eq(
  $$ select ended_at, end_reason, role from public.memberships
     where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('frank') $$,
  $$ values (pg_catalog.now(), 'removed'::text, 'member'::text) $$,
  'frank''s membership is ended now with end_reason removed'
);
select results_eq(
  $$ select user_id from public.memberships
     where group_id = current_setting('test.g1')::uuid and role = 'admin' and ended_at is null $$,
  $$ values (tests.get_supabase_uid('alice')) $$,
  'after a removal, alice is still the one admin'
);
select tests.authenticate_as('alice');
select throws_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('frank')) $$,
  'P0001', 'not_member',
  'removing frank again raises not_member'
);
select throws_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid('bob')) $$,
  'P0001', 'not_member',
  'removing bob, who already left, raises not_member'
);

-- ===== Reads after the end =====
select tests.authenticate_as('frank');
select results_eq(
  $$ select user_id, end_reason from public.memberships where group_id = current_setting('test.g1')::uuid $$,
  $$ values (tests.get_supabase_uid('frank'), 'removed'::text) $$,
  'the removed member reads only his own ended membership of the group'
);
select is(
  (select name from public.groups where id = current_setting('test.g1')::uuid),
  'Hikers', 'the removed member still reads the group name'
);
select ok(not private.is_member(current_setting('test.g1')::uuid), 'the removed member is no longer a member');
select tests.authenticate_as('bob');
select results_eq(
  $$ select user_id, end_reason from public.memberships where group_id = current_setting('test.g1')::uuid $$,
  $$ values (tests.get_supabase_uid('bob'), 'left'::text) $$,
  'the member who left reads only his own ended membership of the group'
);
select is(
  (select name from public.groups where id = current_setting('test.g1')::uuid),
  'Hikers', 'the member who left still reads the group name'
);

-- ===== The removed member rejoins by invite with a new row =====
select tests.authenticate_as('frank');
select is(
  public.join_group(current_setting('test.c1')),
  current_setting('test.g1')::uuid,
  'the removed member rejoins with the invite'
);
reset role;
select results_eq(
  $$ select ended_at is null, end_reason, role from public.memberships
     where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('frank')
     order by ended_at nulls last $$,
  $$ values (false, 'removed'::text, 'member'::text), (true, null::text, 'member'::text) $$,
  'the rejoin is a new current row and the removed row stays'
);
-- frank's new row joined 4 Jan, so the second handover is a joined_at tie between test.late and frank.
update public.memberships
set joined_at = '2026-01-04 00:00:00+00'
where group_id = current_setting('test.g1')::uuid
  and user_id = tests.get_supabase_uid('frank') and ended_at is null;
select tests.authenticate_as('frank');
select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and ended_at is null),
  4, 'after rejoining, frank reads the 4 current memberships of the group'
);

-- ===== The admin leaves: the longest-standing member becomes admin =====
-- Current: alice (1 Jan, admin), test.early (2 Jan), test.late (4 Jan), frank (4 Jan).
select tests.authenticate_as('alice');
select lives_ok(
  $$ select public.leave_group(current_setting('test.g1')::uuid) $$,
  'alice, the admin, leaves'
);
reset role;
select results_eq(
  $$ select ended_at, end_reason, role from public.memberships
     where group_id = current_setting('test.g1')::uuid and user_id = tests.get_supabase_uid('alice') $$,
  $$ values (pg_catalog.now(), 'left'::text, 'member'::text) $$,
  'alice''s row is ended with end_reason left and no longer marked admin'
);
select results_eq(
  $$ select user_id from public.memberships
     where group_id = current_setting('test.g1')::uuid and role = 'admin' and ended_at is null $$,
  $$ values (tests.get_supabase_uid(current_setting('test.early'))) $$,
  'the earliest-joined remaining member becomes the one admin, even with the greater membership id'
);
select tests.authenticate_as('alice');
select ok(not private.is_admin(current_setting('test.g1')::uuid), 'alice is no longer admin');
select tests.authenticate_as(current_setting('test.early'));
select ok(private.is_admin(current_setting('test.g1')::uuid), 'the new admin passes is_admin');

-- ===== The new admin leaves: a joined_at tie goes to the smaller membership id =====
-- Current: test.early (admin), test.late (4 Jan), frank (4 Jan).
select lives_ok(
  $$ select public.leave_group(current_setting('test.g1')::uuid) $$,
  'the new admin leaves'
);
reset role;
select results_eq(
  $$ select user_id from public.memberships
     where group_id = current_setting('test.g1')::uuid and role = 'admin' and ended_at is null $$,
  $$ select m.user_id from public.memberships m
     where m.group_id = current_setting('test.g1')::uuid and m.ended_at is null
       and m.user_id in (tests.get_supabase_uid(current_setting('test.late')), tests.get_supabase_uid('frank'))
     order by m.id limit 1 $$,
  'on a joined_at tie, the member with the smaller membership id becomes the one admin'
);
select is(
  (select count(*)::integer from public.memberships
   where group_id = current_setting('test.g1')::uuid and role = 'admin'),
  1, 'exactly one membership row of the group, current or ended, is marked admin'
);

-- ===== The admin removes the second-to-last member =====
-- test.admin and test.other name the two current members (test.late and frank, in some order).
select pg_catalog.set_config('test.admin', (
  select n from public.memberships m
  cross join pg_catalog.unnest(array[current_setting('test.late'), 'frank']) as n
  where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid(n)
    and m.role = 'admin' and m.ended_at is null), true);
select pg_catalog.set_config('test.other', (
  select n from public.memberships m
  cross join pg_catalog.unnest(array[current_setting('test.late'), 'frank']) as n
  where m.group_id = current_setting('test.g1')::uuid and m.user_id = tests.get_supabase_uid(n)
    and m.role = 'member' and m.ended_at is null), true);
select tests.authenticate_as(current_setting('test.admin'));
select lives_ok(
  $$ select public.remove_member(current_setting('test.g1')::uuid, tests.get_supabase_uid(current_setting('test.other'))) $$,
  'the admin removes the other remaining member'
);
reset role;
select results_eq(
  $$ select user_id, role from public.memberships
     where group_id = current_setting('test.g1')::uuid and ended_at is null $$,
  $$ values (tests.get_supabase_uid(current_setting('test.admin')), 'admin'::text) $$,
  'one current member is left, and she is the admin'
);
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.g1')::uuid),
  1, 'a group with one member left is not deleted'
);

-- ===== The last member leaves: the group, its invites and memberships are deleted =====
select tests.authenticate_as(current_setting('test.admin'));
select lives_ok(
  $$ select public.leave_group(current_setting('test.g1')::uuid) $$,
  'the last member leaves'
);
reset role;
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.g1')::uuid),
  0, 'the group is deleted'
);
select is(
  (select count(*)::integer from public.invites where group_id = current_setting('test.g1')::uuid),
  0, 'its invites are deleted'
);
select is(
  (select count(*)::integer from public.memberships where group_id = current_setting('test.g1')::uuid),
  0, 'all its membership rows, current and ended, are deleted'
);
select tests.authenticate_as('bob');
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.g1')::uuid),
  0, 'a former member no longer reads the deleted group'
);
select throws_ok(
  $$ select public.join_group(current_setting('test.c1')) $$,
  'P0001', 'invite_not_found',
  'the deleted group''s invite no longer works'
);

-- ===== A group whose only member is the admin =====
select tests.authenticate_as('erin');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);
select pg_catalog.set_config('test.c2', (select code from public.create_invite(current_setting('test.g2')::uuid)), true);
select throws_ok(
  $$ select public.remove_member(current_setting('test.g2')::uuid, tests.get_supabase_uid('erin')) $$,
  'P0001', 'cannot_remove_self',
  'the only member cannot remove herself either'
);
select lives_ok(
  $$ select public.leave_group(current_setting('test.g2')::uuid) $$,
  'the only member leaves'
);
reset role;
select is(
  (select count(*)::integer from public.groups where id = current_setting('test.g2')::uuid),
  0, 'the one-member group is deleted'
);
select is(
  (select count(*)::integer from public.invites where group_id = current_setting('test.g2')::uuid),
  0, 'the one-member group''s invite is deleted'
);
select is(
  (select count(*)::integer from public.memberships where group_id = current_setting('test.g2')::uuid),
  0, 'the one-member group''s membership row is deleted'
);

-- ===== end_membership called by the owner =====
-- A fresh two-member group: erin (admin) and carol.
select tests.authenticate_as('erin');
select pg_catalog.set_config('test.g3', public.create_group('Painters')::text, true);
select pg_catalog.set_config('test.c3', (select code from public.create_invite(current_setting('test.g3')::uuid)), true);
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.c3'));
reset role;
select pg_catalog.set_config('test.m_carol', (
  select id::text from public.memberships
  where group_id = current_setting('test.g3')::uuid and user_id = tests.get_supabase_uid('carol')), true);
select throws_ok(
  $$ select private.end_membership(current_setting('test.m_carol')::uuid, 'banished') $$,
  'P0001', 'invalid_end_reason',
  'an unknown end reason raises invalid_end_reason'
);
select throws_ok(
  $$ select private.end_membership(pg_catalog.gen_random_uuid(), 'left') $$,
  'P0001', 'not_member',
  'an unknown membership raises not_member'
);
select lives_ok(
  $$ select private.end_membership(current_setting('test.m_carol')::uuid, 'account_deleted') $$,
  'end_membership accepts account_deleted'
);
select results_eq(
  $$ select end_reason from public.memberships where id = current_setting('test.m_carol')::uuid $$,
  $$ values ('account_deleted'::text) $$,
  'the row is ended with end_reason account_deleted'
);
select throws_ok(
  $$ select private.end_membership(current_setting('test.m_carol')::uuid, 'left') $$,
  'P0001', 'not_member',
  'ending an already ended membership raises not_member'
);
select results_eq(
  $$ select user_id from public.memberships
     where group_id = current_setting('test.g3')::uuid and role = 'admin' and ended_at is null $$,
  $$ values (tests.get_supabase_uid('erin')) $$,
  'ending a plain member leaves the admin in place'
);

-- ===== anon gets nothing =====
select tests.clear_authentication();
select throws_ok(
  $$ select public.leave_group(current_setting('test.g3')::uuid) $$,
  '42501', null,
  'anon cannot execute leave_group'
);
select throws_ok(
  $$ select public.remove_member(current_setting('test.g3')::uuid, tests.get_supabase_uid('erin')) $$,
  '42501', null,
  'anon cannot execute remove_member'
);
select throws_ok(
  $$ select private.end_membership(current_setting('test.m_carol')::uuid, 'left') $$,
  '42501', null,
  'anon cannot execute end_membership'
);

-- ===== Exactly one admin in every remaining group =====
reset role;
select is(
  (select count(*)::integer from (
     select g.id from public.groups g
     left join public.memberships m on m.group_id = g.id and m.role = 'admin' and m.ended_at is null
     group by g.id
     having pg_catalog.count(m.id) <> 1) as bad),
  0, 'every remaining group has exactly one current admin'
);

select * from finish();
rollback;
