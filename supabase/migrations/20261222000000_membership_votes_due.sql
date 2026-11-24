-- Membership vote side effects, review fixes (Story 5.6, AD-17, AD-18).
--
-- private.end_membership (from 20261221000000_membership_votes.sql) now first closes, through
-- private.close_vote, every vote of the group that is already due (coalesce(early_close_at,
-- closes_at) <= now()) but not yet closed by tick step 3, so a member leaving in that gap never
-- cancels a settled ruling or deletes ballots that already decided it. The all-voted re-check takes
-- the last cast_at over the current eligible voters' ballots only (the same set it counts).
--
-- Additive only: end_membership replaced in place with the same signature. It calls now()
-- unqualified on purpose (pgTAP re-points its search_path at test_overrides).

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

  -- Story 5.6 (0): a vote of the group that is already due (its early close or deadline passed,
  -- tick step 3 has not run yet) is decided first, as step 3 would have, with every ballot still
  -- in place: a leave never cancels an outcome that was already settled.
  for v_vote in
    select x.id
    from (
      select ch.id, ch.closes_at
      from public.challenges ch
      where ch.group_id = v_group_id and ch.status = 'open' and ch.closed_at is null
        and coalesce(ch.early_close_at, ch.closes_at) <= now()
      union all
      select f.id, f.closes_at
      from public.freeze_requests f
      where f.group_id = v_group_id and f.status = 'pending' and f.closed_at is null
        and coalesce(f.early_close_at, f.closes_at) <= now()
    ) x
    order by x.closes_at, x.id
  loop
    perform private.close_vote(v_vote.id);
  end loop;

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
        where v.challenge_id = v_vote.id
          and private.challenge_voter_eligible(v_vote.id, v.voter_id);

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
        where v.freeze_request_id = v_vote.id
          and private.freeze_voter_eligible(v_vote.id, v.voter_id);

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
