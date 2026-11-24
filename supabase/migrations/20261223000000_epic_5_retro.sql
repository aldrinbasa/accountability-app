-- Epic 5 retro fixes (F1, F7; Aldrin 2026-11-24; spec-epic-5-retro-fixes.md).
--
-- A member may still freeze a session whose check-in the group said doesn't count while the session
-- is open (request_freeze and my_freeze_options unchanged). When the admin then overturns that
-- ruling the check-in counts again and the session reads `done`, so overturn_ruling now cancels
-- every pending or approved freeze on the overturned check-in's session: status `cancelled`,
-- closed_at kept (approved) or set to the overturn (pending), cancel_reason `overturned`,
-- cancelled_by = the admin. A session is never both done and frozen. Ballots stay (Fair Judge
-- counts ballots on votes later cancelled). Freezes on other rows of a times-per-week week stay.
-- overturn_ruling also takes the commitment lock request_freeze and post_checkin share, after the
-- challenge lock, so a request racing the overturn either lands first (and is cancelled) or sees
-- the session done.
--
-- The Feed: a freeze's own card reads its live status (now `cancelled`, reason `overturned`); its
-- `freeze_result` sticky leaves the wall once the request is cancelled (the event is kept).
--
-- Additive only: overturn_ruling and feed_items replaced in place (same signature, same 28
-- columns); grants restated. The routines call now() unqualified on purpose (pgTAP re-points their
-- search_path at test_overrides so tests.freeze_time moves the clock).

-- 1. RPC: overturn a Fake ruling (from 20261218000000_overturns.sql), plus the freeze cancel.
create or replace function public.overturn_ruling(p_challenge_id uuid)
returns table (overturn_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_ch public.challenges;
  v_checkin public.checkins;
  v_now timestamptz := now();
  v_id uuid;
  v_session_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select ch.* into v_ch
  from public.challenges ch
  where ch.id = p_challenge_id
  for update;

  if v_ch.id is null or not private.is_current_member(v_ch.group_id, v_uid) then
    raise exception 'not_member';
  end if;

  if not private.is_admin(v_ch.group_id) then
    raise exception 'not_admin';
  end if;

  if v_ch.status <> 'fake' then
    raise exception 'not_fake_ruling';
  end if;

  if exists (select 1 from public.overturns o where o.challenge_id = v_ch.id) then
    raise exception 'already_overturned';
  end if;

  if v_ch.subject_user_id = v_uid then
    raise exception 'own_checkin';
  end if;

  if not private.is_current_member(v_ch.group_id, v_ch.subject_user_id) then
    raise exception 'not_member';
  end if;

  if v_now >= private.checkin_lock_at(v_ch.checkin_id) then
    raise exception 'week_locked';
  end if;

  select c.* into v_checkin from public.checkins c where c.id = v_ch.checkin_id;

  -- The lock request_freeze and post_checkin share: no freeze request on this commitment can be
  -- made or matched while the overturn decides its session.
  perform 1 from public.commitments cm where cm.id = v_checkin.commitment_id for update;

  begin
    insert into public.overturns (group_id, challenge_id, admin_id, created_at, updated_at)
    values (v_ch.group_id, v_ch.id, v_uid, v_now, v_now)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_overturned';
  end;

  -- Epic 5 retro (F1): the session reads done again, so any pending or approved freeze on it is
  -- cancelled (never done and frozen). Row locks order this with close_vote: a freeze it approves
  -- first is cancelled here; one cancelled here is left alone by it.
  v_session_id := v_checkin.session_id;
  if v_session_id is not null then
    update public.freeze_requests f
    set status = 'cancelled',
        closed_at = coalesce(f.closed_at, v_now),
        cancel_reason = 'overturned',
        cancelled_by = v_uid
    where f.session_id = v_session_id
      and f.status in ('pending', 'approved');
  end if;

  insert into public.feed_events (group_id, kind, actor_id, subject_id, payload, created_at, updated_at)
  values (
    v_ch.group_id, 'overturn', v_uid, v_ch.subject_user_id,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_ch.id,
      'checkin_id', v_ch.checkin_id,
      'actor_name', (select p.display_name from public.profiles p where p.id = v_uid),
      'subject_name', (select p.display_name from public.profiles p where p.id = v_ch.subject_user_id),
      'commitment_id', v_checkin.commitment_id
    ),
    v_now, v_now
  );

  return query select v_id, v_now;
end;
$$;

-- 2. The Feed's read model (from 20261221000000_membership_votes.sql), same 28 columns: a
--    `freeze_result` event whose request is now cancelled (an overturn) is not shown.
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
and not (e.kind = 'freeze_result' and efr.status is not distinct from 'cancelled')
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

-- 3. Grants (AD-16), restated.
revoke execute on function public.overturn_ruling(uuid) from public, anon;
grant execute on function public.overturn_ruling(uuid) to authenticated;
