-- Challenge fixes (Story 5.1 review): private.close_vote picks the ruling variant from the group as
-- it was at opened_at, so a 3+ group whose other members leave during the 24 h still reads "nobody
-- else voted" (lone), not the 2-person wording. Same signature, body otherwise verbatim from
-- 20261215000000_challenges.sql; grants restated. feed_items' challenge_until moves into one helper,
-- private.checkin_challenge_until (same value; a function, so pgTAP can move its clock), and the view
-- is replaced with the same 28 columns.

create or replace function private.close_vote(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ch public.challenges;
  v_fake integer;
  v_real integer;
  v_ballots integer := 0;
  v_eligible integer;
  v_status text;
  v_variant text;
  v_checkin public.checkins;
  v_commitment public.commitments;
  v_activity text;
begin
  select ch.* into v_ch
  from public.challenges ch
  where ch.id = p_id
  for update;

  if v_ch.id is null or v_ch.closed_at is not null or v_ch.status = 'cancelled' then
    return;
  end if;

  -- Story 5.2 adds the final ballots here (and to v_ballots).
  v_fake := 1;
  v_real := 0;
  v_status := case when v_fake > v_real then 'fake' else 'real' end;

  -- The variant follows the group at opened_at: members then (joined at or before it, not ended
  -- by then) other than the challenger and the owner. None means a 2-person group, ruled at once;
  -- a member leaving later never turns a timed challenge into the 2-person wording.
  select pg_catalog.count(*)::integer into v_eligible
  from public.memberships m
  where m.group_id = v_ch.group_id
    and m.joined_at <= v_ch.opened_at
    and (m.ended_at is null or m.ended_at > v_ch.opened_at)
    and m.user_id <> v_ch.challenger_id
    and m.user_id <> v_ch.subject_user_id;

  v_variant := case
    when v_eligible = 0 then 'two_person'
    when v_ballots = 0 then 'lone'
    else 'normal'
  end;

  update public.challenges
  set status = v_status,
      fake_count = v_fake,
      real_count = v_real,
      closed_at = now()
  where id = v_ch.id;

  select c.* into v_checkin from public.checkins c where c.id = v_ch.checkin_id;
  select cm.* into v_commitment from public.commitments cm where cm.id = v_checkin.commitment_id;
  select coalesce(pa.name, ga.custom_name) into v_activity
  from public.group_activities ga
  left join public.preset_activities pa on pa.key = ga.preset_key
  where ga.id = v_commitment.group_activity_id;

  insert into public.feed_events (group_id, kind, actor_id, subject_id, payload)
  values (
    v_ch.group_id, 'ruling', v_ch.challenger_id, v_ch.subject_user_id,
    pg_catalog.jsonb_build_object(
      'challenge_id', v_ch.id,
      'checkin_id', v_ch.checkin_id,
      'outcome', v_status,
      'fake_count', v_fake,
      'real_count', v_real,
      'variant', v_variant,
      'actor_name', (select p.display_name from public.profiles p where p.id = v_ch.challenger_id),
      'subject_name', (select p.display_name from public.profiles p where p.id = v_ch.subject_user_id),
      'commitment_id', v_commitment.id,
      'commitment_kind', v_commitment.kind,
      'activity_name', v_activity,
      'task_name', v_commitment.name
    )
  );

  if v_status = 'fake' and v_checkin.session_id is not null then
    update public.sessions s
    set miss_recorded_at = now()
    where s.id = v_checkin.session_id
      and s.ends_at <= now()
      and s.miss_recorded_at is null
      and private.session_status(s) = 'missed';
  end if;
end;
$$;

revoke execute on function private.close_vote(uuid) from public, anon, authenticated;

-- Until when a check-in can be challenged: least(received_at + 24 h, lock_at of its week); for a
-- check-in already older than 24 h the lock lookup is skipped (received_at + 24 h, already past).
create or replace function private.checkin_challenge_until(p_checkin_id uuid, p_received_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_received_at + interval '24 hours' > now()
      then least(p_received_at + interval '24 hours', private.checkin_lock_at(p_checkin_id))
    else p_received_at + interval '24 hours'
  end;
$$;

revoke execute on function private.checkin_challenge_until(uuid, timestamptz) from public, anon, authenticated;
grant execute on function private.checkin_challenge_until(uuid, timestamptz) to authenticated;

-- The Feed's read model (from 20261215000000_challenges.sql), unchanged but for challenge_until.
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
where not private.checkin_removed(c.id)
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
  case when e.kind in ('miss', 'ruling') then (e.payload ->> 'commitment_id')::uuid end
    as commitment_id,
  case when e.kind in ('miss', 'ruling') then coalesce(mc.kind, e.payload ->> 'commitment_kind') end
    as commitment_kind,
  case when e.kind in ('miss', 'ruling')
    then coalesce(mpa.name, mga.custom_name, e.payload ->> 'activity_name') end
    as activity_name,
  mga.preset_key,
  case when e.kind in ('miss', 'ruling') then coalesce(mc.name, e.payload ->> 'task_name') end
    as task_name,
  null::timestamptz as captured_at,
  null::timestamptz as received_at,
  null::boolean as is_late,
  null::boolean as is_extra,
  null::text as caption,
  null::timestamptz as full_pruned_at,
  null::integer as counted_position,
  null::integer as target,
  e.payload,
  mm.missed as miss_count,
  null::uuid as challenge_id,
  null::text as challenge_status,
  null::timestamptz as challenge_closes_at,
  null::timestamptz as challenge_until
from public.feed_events e
left join public.profiles pa on pa.id = e.actor_id
left join public.profiles ps on ps.id = e.subject_id
left join public.commitments mc
  on e.kind in ('miss', 'ruling') and mc.id = (e.payload ->> 'commitment_id')::uuid
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
where not (
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
