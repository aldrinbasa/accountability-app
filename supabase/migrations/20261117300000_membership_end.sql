-- Leaving, removing and admin handover (Story 1.8, FR-6, FR-7, AD-2, AD-3, AD-14, AD-16, AD-18).
--
-- private.end_membership is the one routine that ends a membership, hands admin on and deletes an
-- empty group. leave_group and remove_member are its only callers for now (delete_account joins
-- in Epic 7). Vote and freeze side effects arrive in Story 5.6, feed events in Story 3.4.
--
-- Additive only: no table changes. The routines call now() unqualified on purpose. With
-- search_path = '' that is pg_catalog.now(); pgTAP can re-point a function's search_path at
-- test_overrides inside its rolled-back transaction so tests.freeze_time moves the clock.

-- 1. The membership-ending routine (private, no client grant).
--    Runs in the caller's transaction. Locks the group row first, so leaves, removals and joins
--    on one group run one at a time and the handover always sees the final member list.
--    - sets ended_at = now() and end_reason (left, removed or account_deleted);
--    - an ended admin row is set back to role 'member' before anyone is promoted, so the
--      one-admin partial index never sees two admins and an ended row never reads as admin;
--    - if the ended member was admin and members remain, the current member with the earliest
--      joined_at (ties by membership id) becomes admin;
--    - if no current members remain, deletes the group (cascading its invites and memberships,
--      the only case where membership rows are removed).
--    Raises not_member when the membership does not exist or has already ended.
create or replace function private.end_membership(p_membership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_role text;
  v_next_admin uuid;
begin
  if p_reason is null or p_reason not in ('left', 'removed', 'account_deleted') then
    raise exception 'invalid_end_reason';
  end if;

  select m.group_id into v_group_id
  from public.memberships m
  where m.id = p_membership_id;

  if v_group_id is null then
    raise exception 'not_member';
  end if;

  perform 1 from public.groups g where g.id = v_group_id for update;

  -- Re-read under the group lock: another transaction may have ended this row meanwhile.
  select m.role into v_role
  from public.memberships m
  where m.id = p_membership_id
    and m.ended_at is null
  for update;

  if v_role is null then
    raise exception 'not_member';
  end if;

  update public.memberships
  set ended_at = now(),
      end_reason = p_reason,
      role = 'member'
  where id = p_membership_id;

  if not exists (
    select 1 from public.memberships m
    where m.group_id = v_group_id and m.ended_at is null
  ) then
    delete from public.groups where id = v_group_id;
    return;
  end if;

  if v_role = 'admin' then
    select m.id into v_next_admin
    from public.memberships m
    where m.group_id = v_group_id
      and m.ended_at is null
    order by m.joined_at, m.id
    limit 1
    for update;

    update public.memberships
    set role = 'admin'
    where id = v_next_admin;
  end if;
end;
$$;

revoke execute on function private.end_membership(uuid, text) from public, anon, authenticated;

-- 2. RPC: leave a group. Ends the caller's current membership with reason 'left'.
--    Raises not_member when the caller has no current membership in the group.
create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;

  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;

  if v_membership_id is null then
    raise exception 'not_member';
  end if;

  perform private.end_membership(v_membership_id, 'left');
end;
$$;

revoke execute on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;

-- 3. RPC: the admin removes another member. Ends the target's current membership with 'removed'.
--    Checks in order: caller is the current admin (not_admin), target is not the caller
--    (cannot_remove_self), target has a current membership (not_member).
create or replace function public.remove_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  perform 1 from public.groups g where g.id = p_group_id for update;

  if not private.is_admin(p_group_id) then
    raise exception 'not_admin';
  end if;

  if p_user_id = v_uid then
    raise exception 'cannot_remove_self';
  end if;

  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = p_user_id
    and m.ended_at is null;

  if v_membership_id is null then
    raise exception 'not_member';
  end if;

  perform private.end_membership(v_membership_id, 'removed');
end;
$$;

revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
