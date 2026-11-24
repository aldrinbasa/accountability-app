-- Membership vote side effects (Story 5.6, FR-6, FR-7, FR-17, FR-21, AD-4, AD-10, AD-16, AD-17,
-- AD-18).
--
-- Leaving or being removed never skews a vote. private.end_membership now, in the same transaction
-- and after its earlier side effects (the membership end, member_left / member_removed and
-- admin_handover events, the group deletion when the last member leaves):
--   1. cancels the leaver's open challenges (as challenger or as check-in owner) and pending freeze
--      requests: status `cancelled`, closed_at now(), cancel_reason = the end reason (`left`,
--      `removed`, `account_deleted`), cancelled_by = the leaver;
--   2. deletes the leaver's ballots on the group's challenges still open and freeze requests still
--      pending, final or not (ballots on closed votes stay: Fair Judge);
--   3. re-checks every remaining open vote of the group: when each current eligible voter has a
--      ballot (none left counts), early_close_at = least(greatest(now(), last remaining cast_at +
--      6 s), closes_at), and private.close_vote runs at once when that is not in the future. So no
--      vote ever reads "0 of 0 voted", a 3-person challenge whose only voter leaves rules lone, and
--      a drop to 1 member approves the remaining member's pending freezes (freeze_result written).
--
-- The Feed keeps a cancelled challenge card when the check-in owner left (their check-in is no
-- longer readable under RLS): its commitment, activity and check-in times come from definer helpers
-- gated on the caller's current membership, and the payload says whether the reader may still see
-- the photo (`photo_visible`) and who cancelled it (`cancelled_by_id`). Freeze cards read their
-- commitment and day through helpers too, so a left requester's habit keeps its title.
--
-- Additive only: two nullable columns, three helpers; end_membership and feed_items (same 28
-- columns) replaced in place with the same signatures. The routines call now() unqualified on
-- purpose (pgTAP re-points their search_path at test_overrides so tests.freeze_time moves the clock).

-- 1. Who cancelled a vote (the leaver). Null for every earlier row and when the profile is gone.
alter table public.challenges
  add column cancelled_by uuid null references public.profiles (id) on delete set null;

alter table public.freeze_requests
  add column cancelled_by uuid null references public.profiles (id) on delete set null;

-- 2. Helpers (security definer, so a left member's rows stay describable; each answers only a
--    current member of the row's group; granted to authenticated because feed_items, a
--    security-invoker view, calls them).

-- A challenged check-in's commitment and times, for a current member of its group.
create or replace function private.checkin_subject(p_checkin_id uuid)
returns table (
  commitment_id uuid,
  captured_at timestamptz,
  received_at timestamptz,
  full_pruned_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.commitment_id, c.captured_at, c.received_at, c.full_pruned_at
  from public.checkins c
  where c.id = p_checkin_id
    and private.is_member(c.group_id)
    and exists (select 1 from public.challenges ch where ch.checkin_id = c.id);
$$;

-- A commitment's kind, activity, task name, schedule type and deadline, for a current member of
-- its group.
create or replace function private.commitment_subject(p_commitment_id uuid)
returns table (
  kind text,
  activity_name text,
  preset_key text,
  task_name text,
  schedule_type text,
  deadline date
)
language sql
stable
security definer
set search_path = ''
as $$
  select cm.kind, coalesce(pa.name, ga.custom_name), ga.preset_key, cm.name, cm.schedule_type,
         cm.deadline
  from public.commitments cm
  join public.group_activities ga on ga.id = cm.group_activity_id
  left join public.preset_activities pa on pa.key = ga.preset_key
  where cm.id = p_commitment_id
    and private.is_member(cm.group_id);
$$;

-- A freeze request's day (the task's deadline, or the fixed-days session's date; null for times per
-- week), for a current member of its group.
create or replace function private.freeze_session_day(p_freeze_request_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when cm.kind = 'task' then cm.deadline
    when cm.schedule_type = 'fixed_days' then s.week_start + (s.slot::integer - 1)
  end
  from public.freeze_requests f
  join public.commitments cm on cm.id = f.commitment_id
  left join public.sessions s on s.id = f.session_id
  where f.id = p_freeze_request_id
    and private.is_member(f.group_id);
$$;

revoke execute on function private.checkin_subject(uuid) from public, anon, authenticated;
revoke execute on function private.commitment_subject(uuid) from public, anon, authenticated;
revoke execute on function private.freeze_session_day(uuid) from public, anon, authenticated;
grant execute on function private.checkin_subject(uuid) to authenticated;
grant execute on function private.commitment_subject(uuid) to authenticated;
grant execute on function private.freeze_session_day(uuid) to authenticated;

-- 3. private.end_membership (from 20261203000000_feed.sql, every earlier side effect unchanged)
--    plus the vote side effects after the events and the admin handover: cancel the leaver's open
--    challenges and pending freezes, delete their ballots on open votes, re-check all-voted on
--    every remaining open vote (closing through private.close_vote when due now).
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
  v_vote record;
  v_eligible integer;
  v_voted integer;
  v_last_cast timestamptz;
  v_early timestamptz;
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

  -- Story 5.6 (1): the leaver's open challenges (challenger or check-in owner) and pending freeze
  -- requests are cancelled, naming the end reason and the leaver.
  update public.challenges ch
  set status = 'cancelled',
      closed_at = now(),
      cancel_reason = p_reason,
      cancelled_by = v_member_id
  where ch.group_id = v_group_id
    and ch.status = 'open'
    and ch.closed_at is null
    and (ch.challenger_id = v_member_id or ch.subject_user_id = v_member_id);

  update public.freeze_requests f
  set status = 'cancelled',
      closed_at = now(),
      cancel_reason = p_reason,
      cancelled_by = v_member_id
  where f.group_id = v_group_id
    and f.status = 'pending'
    and f.requester_id = v_member_id;

  -- (2) The leaver's ballots on votes still open are deleted, final or not; ballots on closed
  -- votes stay (Fair Judge counts them).
  delete from public.votes v
  where v.group_id = v_group_id
    and v.voter_id = v_member_id
    and (
      exists (select 1 from public.challenges ch
              where ch.id = v.challenge_id and ch.status = 'open' and ch.closed_at is null)
      or exists (select 1 from public.freeze_requests f
                 where f.id = v.freeze_request_id and f.status = 'pending' and f.closed_at is null)
    );

  -- (3) Every remaining open vote of the group where each current eligible voter has a ballot
  -- (none left counts) closes after the last remaining undo window, at once when that has passed.
  for v_vote in
    select x.id, x.kind
    from (
      select ch.id, 'challenge'::text as kind, ch.closes_at
      from public.challenges ch
      where ch.group_id = v_group_id and ch.status = 'open' and ch.closed_at is null
      union all
      select f.id, 'freeze'::text, f.closes_at
      from public.freeze_requests f
      where f.group_id = v_group_id and f.status = 'pending' and f.closed_at is null
    ) x
    order by x.closes_at, x.id
  loop
    if v_vote.kind = 'challenge' then
      perform 1 from public.challenges ch where ch.id = v_vote.id for update;

      select pg_catalog.count(*)::integer into v_eligible
      from public.memberships m
      where m.group_id = v_group_id
        and m.ended_at is null
        and private.challenge_voter_eligible(v_vote.id, m.user_id);

      select pg_catalog.count(*)::integer into v_voted
      from public.votes v
      where v.challenge_id = v_vote.id
        and private.challenge_voter_eligible(v_vote.id, v.voter_id);

      if v_voted >= v_eligible then
        select pg_catalog.max(v.cast_at) into v_last_cast
        from public.votes v
        where v.challenge_id = v_vote.id;

        update public.challenges ch
        set early_close_at = least(greatest(now(), v_last_cast + interval '6 seconds'), ch.closes_at)
        where ch.id = v_vote.id
        returning ch.early_close_at into v_early;

        if v_early <= now() then
          perform private.close_vote(v_vote.id);
        end if;
      end if;
    else
      perform 1 from public.freeze_requests f where f.id = v_vote.id for update;

      select pg_catalog.count(*)::integer into v_eligible
      from public.memberships m
      where m.group_id = v_group_id
        and m.ended_at is null
        and private.freeze_voter_eligible(v_vote.id, m.user_id);

      select pg_catalog.count(*)::integer into v_voted
      from public.votes v
      where v.freeze_request_id = v_vote.id
        and private.freeze_voter_eligible(v_vote.id, v.voter_id);

      if v_voted >= v_eligible then
        select pg_catalog.max(v.cast_at) into v_last_cast
        from public.votes v
        where v.freeze_request_id = v_vote.id;

        update public.freeze_requests f
        set early_close_at = least(greatest(now(), v_last_cast + interval '6 seconds'), f.closes_at)
        where f.id = v_vote.id
        returning f.early_close_at into v_early;

        if v_early <= now() then
          perform private.close_vote(v_vote.id);
        end if;
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function private.end_membership(uuid, text) from public, anon, authenticated;

-- 4. The Feed's read model (from 20261220000000_freeze_votes.sql), same 28 columns.
--    - `challenge` rows read the check-in's commitment and times through private.checkin_subject
--      and the commitment through private.commitment_subject, so a row survives its owner leaving;
--      the check-in under the reader's RLS only decides `photo_visible`. A row whose check-in the
--      reader can no longer see shows only while the challenge is `cancelled`. Payload +
--      `cancelled_by_id`, `photo_visible`.
--    - `freeze` rows read the commitment through private.commitment_subject and the day through
--      private.freeze_session_day (a left requester's habit keeps its title and day). Payload +
--      `cancelled_by_id`.
create or replace view public.feed_items
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
  null::jsonb as payload,
  null::integer as miss_count,
  ch.id as challenge_id,
  ch.status as challenge_status,
  ch.closes_at as challenge_closes_at,
  private.checkin_challenge_until(c.id, c.received_at) as challenge_until
from public.checkins c
join public.commitments cm on cm.id = c.commitment_id
join public.group_activities ga on ga.id = cm.group_activity_id
left join public.preset_activities pa on pa.key = ga.preset_key
left join public.profiles p on p.id = c.user_id
left join public.challenges ch on ch.checkin_id = c.id
left join lateral (
  select
    case when exists (
      select 1
      from private.counted_checkins(s.membership_id, s.week_start) k0
      where k0.checkin_id = c.id
    ) then (
      select pg_catalog.count(*)::integer
      from private.counted_checkins(s.membership_id, s.week_start) k
      where k.commitment_id = c.commitment_id
        and (k.counted_at, k.checkin_id) <= (c.counted_at, c.id)
    ) end as counted_position,
    (select pg_catalog.count(*)::integer
     from public.sessions t
     where t.commitment_id = c.commitment_id
       and t.week_start = s.week_start
       and private.session_status(t) <> 'frozen') as target
  from public.sessions s
  where s.id = c.session_id
) w on true
where not private.checkin_removed(c.id)
union all
select
  ch.group_id,
  'challenge'::text as item_kind,
  ch.id as item_id,
  ch.opened_at as sort_at,
  ch.challenger_id as actor_id,
  pc.display_name as actor_name,
  pc.avatar_path as actor_avatar_path,
  ch.subject_user_id as subject_id,
  po.display_name as subject_name,
  cs.commitment_id,
  cms.kind as commitment_kind,
  cms.activity_name,
  cms.preset_key,
  cms.task_name,
  cs.captured_at,
  cs.received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  cs.full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  pg_catalog.jsonb_build_object(
    'checkin_id', ch.checkin_id,
    'fake_count', ch.fake_count,
    'real_count', ch.real_count,
    'variant', case
      when ch.status not in ('fake', 'real') then null
      when ch.fake_count = 1 and ch.real_count = 0 then 'lone'
      else 'normal'
    end,
    'cancel_reason', ch.cancel_reason,
    'cancelled_by_id', ch.cancelled_by,
    'photo_visible', c.id is not null,
    'my_choice', mv.choice,
    'my_cast_at', mv.cast_at,
    'can_vote', private.challenge_voter_eligible(ch.id, (select auth.uid())),
    'overturned_by_id', cov.admin_id,
    'overturned_by_name', case when cov.id is not null then coalesce(
      pcov.display_name,
      (select oe.payload ->> 'actor_name'
       from public.feed_events oe
       where oe.group_id = ch.group_id
         and oe.kind = 'overturn'
         and oe.payload ->> 'challenge_id' = ch.id::text
       order by oe.created_at
       limit 1)
    ) end
  ) as payload,
  null::integer as miss_count,
  ch.id as challenge_id,
  ch.status as challenge_status,
  ch.closes_at as challenge_closes_at,
  null::timestamptz as challenge_until
from public.challenges ch
left join public.checkins c on c.id = ch.checkin_id
left join lateral private.checkin_subject(ch.checkin_id) cs on true
left join lateral private.commitment_subject(cs.commitment_id) cms on true
left join public.profiles pc on pc.id = ch.challenger_id
left join public.profiles po on po.id = ch.subject_user_id
left join lateral (
  select v.choice, v.cast_at
  from public.votes v
  where v.challenge_id = ch.id
    and v.voter_id = (select auth.uid())
) mv on true
left join public.overturns cov on cov.challenge_id = ch.id
left join public.profiles pcov on pcov.id = cov.admin_id
where private.challenge_others_at_open(ch.id) > 0
  and (c.id is not null or ch.status = 'cancelled')
union all
select
  f.group_id,
  'freeze'::text as item_kind,
  f.id as item_id,
  f.opened_at as sort_at,
  f.requester_id as actor_id,
  pf.display_name as actor_name,
  pf.avatar_path as actor_avatar_path,
  null::uuid as subject_id,
  null::text as subject_name,
  f.commitment_id,
  cms.kind as commitment_kind,
  cms.activity_name,
  cms.preset_key,
  cms.task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  pg_catalog.jsonb_build_object(
    'status', f.status,
    'reason', f.reason,
    'closes_at', f.closes_at,
    'schedule_type', cms.schedule_type,
    'session_day', private.freeze_session_day(f.id),
    'week_start', f.week_start,
    'which', case
      when f.week_start < (select mw.week_start
                           from private.member_current_week(f.requester_id, f.opened_at) mw)
        then 'last'
      else 'this'
    end,
    'week_target', (
      select pg_catalog.count(*)::integer
      from public.sessions t
      where t.commitment_id = f.commitment_id
        and t.week_start = f.week_start
        and private.session_status(t) <> 'frozen'
    ),
    'two_person', private.freeze_others_at_open(f.id) = 1,
    'cancel_reason', f.cancel_reason,
    'cancelled_by_id', f.cancelled_by,
    'my_choice', fv.choice,
    'my_cast_at', fv.cast_at,
    'can_vote', private.freeze_voter_eligible(f.id, (select auth.uid()))
  ) as payload,
  null::integer as miss_count,
  null::uuid as challenge_id,
  null::text as challenge_status,
  null::timestamptz as challenge_closes_at,
  null::timestamptz as challenge_until
from public.freeze_requests f
left join lateral private.commitment_subject(f.commitment_id) cms on true
left join public.profiles pf on pf.id = f.requester_id
left join lateral (
  select v.choice, v.cast_at
  from public.votes v
  where v.freeze_request_id = f.id
    and v.voter_id = (select auth.uid())
) fv on true
where f.status <> 'withdrawn'
  and private.freeze_others_at_open(f.id) > 0
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
  case when e.kind in ('miss', 'ruling', 'freeze_result') then (e.payload ->> 'commitment_id')::uuid end
    as commitment_id,
  case when e.kind in ('miss', 'ruling', 'freeze_result')
    then coalesce(mc.kind, e.payload ->> 'commitment_kind') end
    as commitment_kind,
  case when e.kind in ('miss', 'ruling', 'freeze_result')
    then coalesce(mpa.name, mga.custom_name, e.payload ->> 'activity_name') end
    as activity_name,
  mga.preset_key,
  case when e.kind in ('miss', 'ruling', 'freeze_result')
    then coalesce(mc.name, e.payload ->> 'task_name') end
    as task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  case
    when e.kind = 'ruling' then e.payload || pg_catalog.jsonb_build_object(
      'overturn_until', case when e.payload ->> 'outcome' = 'fake'
        then private.checkin_lock_at((e.payload ->> 'checkin_id')::uuid) end,
      'can_overturn', private.ruling_can_overturn((e.payload ->> 'challenge_id')::uuid),
      'overturned_by_id', ov.admin_id,
      'overturned_by_name', case when ov.id is not null
        then coalesce(pov.display_name, oe.payload ->> 'actor_name') end,
      'overturned_at', ov.created_at
    )
    when e.kind = 'freeze_result' then e.payload || pg_catalog.jsonb_build_object(
      'which', case
        when (e.payload ->> 'week_start')::date
             < (select mw.week_start
                from private.member_current_week(e.actor_id, coalesce(efr.opened_at, e.created_at)) mw)
          then 'last'
        else 'this'
      end,
      'week_target', (
        select pg_catalog.count(*)::integer
        from public.sessions t
        where t.commitment_id = (e.payload ->> 'commitment_id')::uuid
          and t.week_start = (e.payload ->> 'week_start')::date
          and private.session_status(t) <> 'frozen'
      )
    )
    else e.payload
  end as payload,
  mm.missed as miss_count,
  null::uuid as challenge_id,
  null::text as challenge_status,
  null::timestamptz as challenge_closes_at,
  null::timestamptz as challenge_until
from public.feed_events e
left join public.profiles pa on pa.id = e.actor_id
left join public.profiles ps on ps.id = e.subject_id
left join public.commitments mc
  on e.kind in ('miss', 'ruling', 'freeze_result') and mc.id = (e.payload ->> 'commitment_id')::uuid
left join public.group_activities mga on mga.id = mc.group_activity_id
left join public.preset_activities mpa on mpa.key = mga.preset_key
left join lateral (
  select pg_catalog.count(*)::integer as missed
  from public.sessions s
  where s.id in (
      select x.id::uuid
      from pg_catalog.jsonb_array_elements_text(coalesce(e.payload -> 'session_ids', '[]'::jsonb)) as x(id)
    )
    and private.session_status(s) = 'missed'
) mm on e.kind = 'miss'
left join public.overturns ov
  on e.kind = 'ruling' and ov.challenge_id = (e.payload ->> 'challenge_id')::uuid
left join public.profiles pov on pov.id = ov.admin_id
left join lateral (
  select o.payload
  from public.feed_events o
  where o.group_id = e.group_id
    and o.kind = 'overturn'
    and o.payload ->> 'challenge_id' = e.payload ->> 'challenge_id'
  order by o.created_at
  limit 1
) oe on ov.id is not null
left join public.freeze_requests efr
  on e.kind = 'freeze_result' and efr.id = (e.payload ->> 'freeze_request_id')::uuid
where e.kind <> 'overturn'
and not (
  e.kind = 'member_left'
  and exists (
    select 1
    from public.feed_events h
    where h.group_id = e.group_id
      and h.kind = 'admin_handover'
      and h.payload ->> 'membership_id' = e.payload ->> 'membership_id'
  )
)
and (e.kind <> 'miss' or mm.missed > 0);

revoke all on table public.feed_items from public, anon, authenticated;
grant select on table public.feed_items to authenticated;
