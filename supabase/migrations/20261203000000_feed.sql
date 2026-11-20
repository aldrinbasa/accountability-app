-- Feed wall (Story 3.4, FR-6, FR-31, AD-2, AD-4, AD-10, AD-16, AD-18).
--
-- feed_events is the group's append-only log of membership moments: joins, leaves, removals and
-- admin handovers (Story 3.5 adds misses). join_group and private.end_membership write them in the
-- same transaction as the membership change; nothing deletes or edits a row (only the group's own
-- delete cascades them away). Each row keeps the names at write time in payload, so "Sam left."
-- still reads right once Sam's profile is out of the caller's sight.
--
-- feed_items is the Feed's read model (AD-10): a security_invoker view merging the check-ins the
-- caller may see (checkins RLS: current members, authors still current; commitments RLS: the
-- author's current membership) with the group's events, both keyed by (sort_at, item_id) for
-- keyset paging. A member_left row whose admin_handover shares its membership_id is hidden, so the
-- Feed shows one "Jo left. Marco is admin now." sticky. Counted position and target come from
-- private.counted_checkins and the sessions table only (AD-4).
--
-- Additive only: one new table, one view, policies, and join_group / private.end_membership
-- redefined in place with the same signatures and bodies plus the event inserts.

-- 1. Table
create table public.feed_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  kind text not null
    constraint feed_events_kind_check
    check (kind in ('member_joined', 'member_left', 'member_removed', 'admin_handover', 'miss')),
  -- Who the moment is about first: the member who joined or left, the admin who removed someone,
  -- the admin who handed over.
  actor_id uuid null references public.profiles (id) on delete set null,
  -- The other person, when there is one: the removed member, the new admin.
  subject_id uuid null references public.profiles (id) on delete set null,
  -- Names at write time (actor_name, subject_name), membership_id, end_reason; misses add theirs.
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now()
);

-- 2. Indexes
create index feed_events_group_id_created_at_idx
  on public.feed_events (group_id, created_at desc, id desc);
create index feed_events_handover_idx
  on public.feed_events (group_id, (payload ->> 'membership_id'))
  where kind = 'admin_handover';
create index feed_events_actor_id_idx on public.feed_events (actor_id);
create index feed_events_subject_id_idx on public.feed_events (subject_id);

-- 3. Append-only guard. A direct UPDATE or DELETE raises feed_events_append_only; only the
--    foreign keys' own cascades (group deleted, profile deleted) get through, because those run
--    one trigger level down (pg_trigger_depth() > 1).
create or replace function private.feed_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.pg_trigger_depth() <= 1 then
    raise exception 'feed_events_append_only';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function private.feed_events_append_only() from public, anon, authenticated;

create trigger feed_events_append_only
  before update or delete on public.feed_events
  for each row execute function private.feed_events_append_only();

-- 4. Row level security: current members of the group read its events. No client writes.
alter table public.feed_events enable row level security;

create policy feed_events_select_member
  on public.feed_events
  for select
  to authenticated
  using (private.is_member(group_id));

revoke all on table public.feed_events from public, anon, authenticated;
grant select on table public.feed_events to authenticated;

-- 5. The Feed's read model. Both branches expose the same columns.
--    item_kind: 'checkin' or the event kind. sort_at: received_at for a check-in, created_at for
--    an event. counted_position: how many counted check-ins of the commitment's session week sit
--    at or before this one by (counted_at, id); target: the commitment's sessions that week.
--    Extras (session_id null) have neither.
create view public.feed_items
with (security_invoker = true)
as
select
  c.group_id,
  'checkin'::text as item_kind,
  c.id as item_id,
  c.received_at as sort_at,
  c.user_id as actor_id,
  p.display_name as actor_name,
  p.avatar_path as actor_avatar_path,
  null::uuid as subject_id,
  null::text as subject_name,
  c.commitment_id,
  cm.kind as commitment_kind,
  coalesce(pa.name, ga.custom_name) as activity_name,
  ga.preset_key,
  cm.name as task_name,
  c.captured_at,
  c.received_at,
  c.is_late,
  c.session_id is null as is_extra,
  c.caption,
  c.full_pruned_at,
  w.counted_position,
  w.target,
  null::jsonb as payload
from public.checkins c
join public.commitments cm on cm.id = c.commitment_id
join public.group_activities ga on ga.id = cm.group_activity_id
left join public.preset_activities pa on pa.key = ga.preset_key
left join public.profiles p on p.id = c.user_id
left join lateral (
  select
    (select pg_catalog.count(*)::integer
     from private.counted_checkins(s.membership_id, s.week_start) k
     where k.commitment_id = c.commitment_id
       and (k.counted_at, k.checkin_id) <= (c.counted_at, c.id)) as counted_position,
    (select pg_catalog.count(*)::integer
     from public.sessions t
     where t.commitment_id = c.commitment_id
       and t.week_start = s.week_start) as target
  from public.sessions s
  where s.id = c.session_id
) w on true
union all
select
  e.group_id,
  e.kind as item_kind,
  e.id as item_id,
  e.created_at as sort_at,
  e.actor_id,
  coalesce(pa.display_name, e.payload ->> 'actor_name') as actor_name,
  pa.avatar_path as actor_avatar_path,
  e.subject_id,
  coalesce(ps.display_name, e.payload ->> 'subject_name') as subject_name,
  null::uuid as commitment_id,
  null::text as commitment_kind,
  null::text as activity_name,
  null::text as preset_key,
  null::text as task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  e.payload
from public.feed_events e
left join public.profiles pa on pa.id = e.actor_id
left join public.profiles ps on ps.id = e.subject_id
where not (
  e.kind = 'member_left'
  and exists (
    select 1
    from public.feed_events h
    where h.group_id = e.group_id
      and h.kind = 'admin_handover'
      and h.payload ->> 'membership_id' = e.payload ->> 'membership_id'
  )
);

revoke all on table public.feed_items from public, anon, authenticated;
grant select on table public.feed_items to authenticated;

-- 6. join_group (from 20261117200000_invites.sql, unchanged) plus the member_joined event after
--    the membership insert. The idempotent return for a current member writes nothing.
create or replace function public.join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_code, '')));
  v_group_id uuid;
  v_expires_at timestamptz;
  v_count integer;
  v_membership_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'profile_required';
  end if;

  select i.group_id, i.expires_at into v_group_id, v_expires_at
  from public.invites i
  where i.code = v_code;

  if v_group_id is null then
    raise exception 'invite_not_found';
  end if;

  perform 1 from public.groups g where g.id = v_group_id for update;

  if exists (
    select 1 from public.memberships m
    where m.group_id = v_group_id and m.user_id = v_uid and m.ended_at is null
  ) then
    return v_group_id;
  end if;

  if now() >= v_expires_at then
    raise exception 'invite_expired';
  end if;

  select pg_catalog.count(*)::integer into v_count
  from public.memberships m
  where m.group_id = v_group_id and m.ended_at is null;

  if v_count >= 10 then
    raise exception 'group_full';
  end if;

  insert into public.memberships (group_id, user_id, role)
  values (v_group_id, v_uid, 'member')
  returning id into v_membership_id;

  insert into public.feed_events (group_id, kind, actor_id, payload)
  select v_group_id, 'member_joined', v_uid,
         pg_catalog.jsonb_build_object(
           'actor_name', p.display_name,
           'membership_id', v_membership_id)
  from public.profiles p
  where p.id = v_uid;

  return v_group_id;
end;
$$;

revoke execute on function public.join_group(text) from public, anon;
grant execute on function public.join_group(text) to authenticated;

-- 7. private.end_membership (from 20261117300000_membership_end.sql, unchanged) plus the events
--    after the update: member_left (left, account_deleted; actor = the member) or member_removed
--    (actor = the admin, auth.uid(), else the member; subject = the removed member), then
--    admin_handover (actor = the leaving admin, subject = the new admin) when admin moves on.
--    The last member leaving deletes the group (and its events), so no event then.
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
  v_member_id uuid;
  v_member_name text;
  v_actor_id uuid;
  v_actor_name text;
  v_next_admin_user uuid;
  v_next_admin_name text;
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

  select m.user_id, p.display_name into v_member_id, v_member_name
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.id = p_membership_id;

  if p_reason = 'removed' then
    v_actor_id := coalesce(auth.uid(), v_member_id);
    select p.display_name into v_actor_name from public.profiles p where p.id = v_actor_id;
    insert into public.feed_events (group_id, kind, actor_id, subject_id, payload)
    values (v_group_id, 'member_removed', v_actor_id, v_member_id,
            pg_catalog.jsonb_build_object(
              'actor_name', v_actor_name,
              'subject_name', v_member_name,
              'membership_id', p_membership_id,
              'end_reason', p_reason));
  else
    insert into public.feed_events (group_id, kind, actor_id, payload)
    values (v_group_id, 'member_left', v_member_id,
            pg_catalog.jsonb_build_object(
              'actor_name', v_member_name,
              'membership_id', p_membership_id,
              'end_reason', p_reason));
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

    select m.user_id, p.display_name into v_next_admin_user, v_next_admin_name
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    where m.id = v_next_admin;

    insert into public.feed_events (group_id, kind, actor_id, subject_id, payload)
    values (v_group_id, 'admin_handover', v_member_id, v_next_admin_user,
            pg_catalog.jsonb_build_object(
              'actor_name', v_member_name,
              'subject_name', v_next_admin_name,
              'membership_id', p_membership_id,
              'end_reason', p_reason));
  end if;
end;
$$;

revoke execute on function private.end_membership(uuid, text) from public, anon, authenticated;
