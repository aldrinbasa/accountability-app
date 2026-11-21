-- Freeze requests (Story 5.4, FR-18, FR-20, FR-22, AD-2, AD-4, AD-6, AD-8, AD-11, AD-14, AD-15,
-- AD-16, AD-17).
--
-- A member asks to freeze one of their own sessions with a reason (request_freeze). Fixed days and
-- tasks name the session: before it ends, or after a recorded miss until the next member-local
-- midnight after miss_recorded_at (the IANA zone of that week). Times per week name the week: this
-- member week, or last week until the next member-local midnight after the latest miss stamp on its
-- rows; only while counted check-ins are below the effective target (rows minus approved and
-- pending freezes), and the server picks the highest-slot row that is not done, not frozen and has
-- no pending freeze. Never in a locked week, never for a Fake-ruling miss; no allowance.
-- my_freeze_options lists what the caller may freeze now (with every window computed here, AD-11);
-- my_freeze_requests lists the caller's pending and approved requests in unlocked weeks.
--
-- private.close_vote now also decides a freeze (Approve >= Deny over final ballots by
-- freeze_request_id, so no ballot approves) and writes one `freeze_result` feed event; tick step 3
-- closes due freeze requests too (coalesce(early_close_at, closes_at) <= now()), so a group request
-- with no votes is approved after 24 h and never left pending past the lock. A request made with 1
-- current member is closed at once inside request_freeze (approved). Story 5.5 adds the voting.
--
-- An approved freeze takes the session off the plan: session_status returns `frozen` (after
-- `done`, before `missed`), so the AD-4 functions drop it from the score (planned - frozen), the
-- streak walk treats it as neutral and the Feed hides a miss sticky whose sessions are no longer
-- missed. post_checkin refuses a frozen day session (session_frozen), skips frozen rows for times
-- per week (preferring a row with no pending freeze) and withdraws a pending freeze on the session
-- it matches.
--
-- Additive only: one new table, new functions; session_status, close_vote, tick step 3 and
-- post_checkin replaced in place (same signatures and return shapes); the feed log gains the kind
-- `freeze_result`. counted_checkins is not touched (it keeps one check-in per session). The
-- routines call now() unqualified on purpose (pgTAP re-points their search_path at test_overrides
-- so tests.freeze_time moves the clock).

-- 1. Table
create table public.freeze_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  requester_id uuid not null references public.profiles (id),
  commitment_id uuid not null references public.commitments (id) on delete cascade,
  -- The day session, or the times-per-week row the server picked.
  session_id uuid not null references public.sessions (id) on delete cascade,
  week_start date not null,
  -- Trimmed, 1 to 80 characters (request_freeze checks it first: reason_required).
  reason text not null
    constraint freeze_requests_reason_check
    check (pg_catalog.char_length(reason) between 1 and 80),
  opened_at timestamptz not null,
  -- least(opened_at + 24 h, lock_at of the session's week): every request closes before its lock.
  closes_at timestamptz not null,
  -- Set by Story 5.5 when every eligible voter has a final ballot.
  early_close_at timestamptz null,
  closed_at timestamptz null,
  status text not null default 'pending'
    constraint freeze_requests_status_check
    check (status in ('pending', 'approved', 'denied', 'cancelled', 'withdrawn')),
  cancel_reason text null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint freeze_requests_closed_consistent_check
    check ((status = 'pending') = (closed_at is null))
);

-- At most one pending request per session.
create unique index freeze_requests_one_pending_per_session
  on public.freeze_requests (session_id)
  where status = 'pending';
-- The pending requests tick step 3 scans.
create index freeze_requests_pending_idx
  on public.freeze_requests (closes_at)
  where closed_at is null;
create index freeze_requests_group_id_idx on public.freeze_requests (group_id);
create index freeze_requests_commitment_week_idx
  on public.freeze_requests (commitment_id, week_start);
create index freeze_requests_approved_session_idx
  on public.freeze_requests (session_id)
  where status = 'approved';

create trigger freeze_requests_set_updated_at
  before update on public.freeze_requests
  for each row execute function private.set_updated_at();

-- 2. Row level security: current members of the group read its freeze requests; no client writes
--    (request_freeze, post_checkin and close_vote are the only writers).
alter table public.freeze_requests enable row level security;

create policy freeze_requests_select_member
  on public.freeze_requests
  for select
  to authenticated
  using (private.is_member(group_id));

revoke all on table public.freeze_requests from public, anon, authenticated;
grant select on table public.freeze_requests to authenticated;

-- 3. Helpers.

-- True when the session has an approved freeze. Security definer, so session_status (security
-- invoker) gives every caller the same answer whatever their RLS; granted to authenticated for that.
create or replace function private.session_frozen(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.freeze_requests f
    where f.session_id = p_session_id
      and f.status = 'approved'
  );
$$;

-- The next local midnight strictly after p_at in zone p_tz (via the IANA zone, never + 24 h).
create or replace function private.next_local_midnight(p_at timestamptz, p_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select private.local_start((p_at at time zone p_tz)::date + 1, p_tz);
$$;

revoke execute on function private.session_frozen(uuid) from public, anon, authenticated;
revoke execute on function private.next_local_midnight(timestamptz, text) from public, anon, authenticated;
grant execute on function private.session_frozen(uuid) to authenticated;

-- 4. AD-4: the one definition of a session's status (from 20261215000000_challenges.sql): an
--    approved freeze makes it `frozen` (a counted check-in still reads `done` first).
create or replace function private.session_status(s public.sessions)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.checkins c
      where c.session_id = s.id
        and not private.checkin_removed(c.id)
    ) then 'done'
    when private.session_frozen(s.id) then 'frozen'
    when s.ends_at <= now() then 'missed'
    else 'open'
  end;
$$;

revoke execute on function private.session_status(public.sessions) from public, anon, authenticated;
grant execute on function private.session_status(public.sessions) to authenticated;

-- 5. The feed log gains `freeze_result` (keeps every kind).
alter table public.feed_events drop constraint feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check
  check (kind in ('member_joined', 'member_left', 'member_removed', 'admin_handover', 'miss',
                  'weekly_winner', 'goal_result', 'ruling', 'overturn', 'freeze_result'));

-- 6. Close one vote (AD-17), from 20261217000000_votes.sql: the challenge branch is unchanged; an
--    id that is no challenge is looked up in freeze_requests. A freeze request is locked and left
--    alone unless pending; Approve = final approve ballots, Deny = final deny ballots (cast_at + 6 s
--    <= now(), or every ballot once now() >= closes_at); Approve >= Deny approves (a tie or no
--    ballot approves, so a solo request is approved). Stores status and closed_at and appends one
--    `freeze_result` event (actor = the requester) with outcome, reason and miss_removed (an
--    approved freeze on a session whose miss was recorded). Same signature.
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
  v_status text;
  v_variant text;
  v_checkin public.checkins;
  v_commitment public.commitments;
  v_activity text;
  v_fr public.freeze_requests;
  v_session public.sessions;
  v_approve integer;
  v_deny integer;
  v_miss_removed boolean;
begin
  select ch.* into v_ch
  from public.challenges ch
  where ch.id = p_id
  for update;

  if v_ch.id is null then
    select f.* into v_fr
    from public.freeze_requests f
    where f.id = p_id
    for update;

    if v_fr.id is null or v_fr.closed_at is not null or v_fr.status <> 'pending' then
      return;
    end if;

    select
      pg_catalog.count(*) filter (where v.choice = 'approve')::integer,
      pg_catalog.count(*) filter (where v.choice = 'deny')::integer
    into v_approve, v_deny
    from public.votes v
    where v.freeze_request_id = v_fr.id
      and (v.cast_at + interval '6 seconds' <= now() or now() >= v_fr.closes_at);

    v_status := case when v_approve >= v_deny then 'approved' else 'denied' end;

    select s.* into v_session from public.sessions s where s.id = v_fr.session_id;
    v_miss_removed := v_status = 'approved' and v_session.miss_recorded_at is not null;

    update public.freeze_requests
    set status = v_status,
        closed_at = now()
    where id = v_fr.id;

    select cm.* into v_commitment from public.commitments cm where cm.id = v_fr.commitment_id;
    select coalesce(pa.name, ga.custom_name) into v_activity
    from public.group_activities ga
    left join public.preset_activities pa on pa.key = ga.preset_key
    where ga.id = v_commitment.group_activity_id;

    insert into public.feed_events (group_id, kind, actor_id, subject_id, payload)
    values (
      v_fr.group_id, 'freeze_result', v_fr.requester_id, null,
      pg_catalog.jsonb_build_object(
        'freeze_request_id', v_fr.id,
        'outcome', v_status,
        'reason', v_fr.reason,
        'miss_removed', v_miss_removed,
        'approve_count', v_approve,
        'deny_count', v_deny,
        'commitment_id', v_commitment.id,
        'commitment_kind', v_commitment.kind,
        'schedule_type', v_commitment.schedule_type,
        'activity_name', v_activity,
        'task_name', v_commitment.name,
        'session_id', v_fr.session_id,
        'week_start', v_fr.week_start,
        'session_day', case
          when v_commitment.kind = 'task' then v_commitment.deadline
          when v_commitment.schedule_type = 'fixed_days'
            then v_session.week_start + (v_session.slot::integer - 1)
        end,
        'actor_name', (select p.display_name from public.profiles p where p.id = v_fr.requester_id)
      )
    );
    return;
  end if;

  if v_ch.closed_at is not null or v_ch.status = 'cancelled' then
    return;
  end if;

  select
    pg_catalog.count(*) filter (where v.choice = 'fake')::integer,
    pg_catalog.count(*) filter (where v.choice = 'real')::integer
  into v_fake, v_real
  from public.votes v
  where v.challenge_id = v_ch.id
    and (v.cast_at + interval '6 seconds' <= now() or now() >= v_ch.closes_at);

  v_ballots := v_fake + v_real;
  v_fake := 1 + v_fake;
  v_status := case when v_fake > v_real then 'fake' else 'real' end;

  v_variant := case
    when private.challenge_others_at_open(v_ch.id) = 0 then 'two_person'
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

-- 7. Tick step 3: close due votes (AD-7, AD-17), from 20261215000000_challenges.sql. Every
--    challenge and every pending freeze request with closed_at null whose
--    coalesce(early_close_at, closes_at) has passed, oldest first, each in its own exception
--    block. Selected by time, so it catches up after a pause; closes_at <= lock_at and step 3 runs
--    before step 5, so nothing on a week is still open when that week locks. Returns the first
--    error as text (naming the challenge or freeze), or null.
create or replace function private.tick_step_3_close_votes()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
  v_error text;
begin
  for v_row in
    select x.id, x.kind
    from (
      select ch.id, 'challenge'::text as kind, coalesce(ch.early_close_at, ch.closes_at) as due_at
      from public.challenges ch
      where ch.closed_at is null
        and coalesce(ch.early_close_at, ch.closes_at) <= now()
      union all
      select f.id, 'freeze'::text, coalesce(f.early_close_at, f.closes_at)
      from public.freeze_requests f
      where f.closed_at is null
        and f.status = 'pending'
        and coalesce(f.early_close_at, f.closes_at) <= now()
    ) x
    order by x.due_at, x.id
  loop
    begin
      perform private.close_vote(v_row.id);
    exception when others then
      if v_error is null then
        v_error := v_row.kind || ' ' || v_row.id::text || ': ' || sqlerrm;
      end if;
    end;
  end loop;

  return v_error;
end;
$$;

revoke execute on function private.tick_step_3_close_votes() from public, anon, authenticated;

-- 8. post_checkin (from 20261206000000_weekly_score.sql), same signature and return shape: the
--    session matching skips frozen rows for times per week (a row with no pending freeze first),
--    refuses a frozen fixed-days or task session (session_frozen), and the matched session's
--    pending freeze is withdrawn (status `withdrawn`, closed_at) in the same transaction.
create or replace function public.post_checkin(
  p_id uuid,
  p_commitment_id uuid,
  p_captured_at timestamptz,
  p_caption text default null
)
returns table (
  checkin_id uuid,
  session_id uuid,
  counted boolean,
  is_late boolean,
  done_count integer,
  target integer,
  weekly_points integer,
  rank integer,
  passed_user_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_caption text;
  v_existing public.checkins;
  v_c public.commitments;
  v_membership_id uuid;
  v_received timestamptz;
  v_counted timestamptz;
  v_tz text;
  v_week date;
  v_version public.commitment_versions;
  v_lock_at timestamptz;
  v_session_id uuid;
  v_is_late boolean;
  v_before jsonb := '{}'::jsonb;
  v_before_rank integer;
  v_points integer;
  v_rank integer;
  v_passed uuid[] := '{}'::uuid[];
  v_session_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if p_id is null or p_commitment_id is null or p_captured_at is null then
    raise exception 'invalid_checkin';
  end if;

  v_caption := nullif(pg_catalog.regexp_replace(p_caption, '^\s+|\s+$', '', 'g'), '');

  -- The commitment's lock first, so a concurrent post to it (same id or not) waits here.
  select c.* into v_c
  from public.commitments c
  where c.id = p_commitment_id
  for update;

  select ck.* into v_existing from public.checkins ck where ck.id = p_id;
  if found then
    if v_existing.user_id = v_uid
       and v_existing.commitment_id = p_commitment_id
       and v_existing.captured_at = p_captured_at
       and v_existing.caption is not distinct from v_caption then
      select w.week_start into v_week
      from private.member_current_week(v_existing.user_id, v_existing.counted_at) w;
      select r.weekly_points, r.rank into v_points, v_rank
      from private.group_ranking(v_existing.group_id, v_week) r
      where r.user_id = v_uid;
      return query
      select v_existing.id, v_existing.session_id, v_existing.session_id is not null,
             v_existing.is_late, x.done_count, x.target, v_points, v_rank, '{}'::uuid[]
      from private.checkin_counts(v_existing.commitment_id, v_week) x;
      return;
    end if;
    raise exception 'checkin_conflict';
  end if;

  if v_caption is not null and pg_catalog.char_length(v_caption) > 80 then
    raise exception 'invalid_caption';
  end if;

  v_received := now();
  if p_captured_at > v_received + interval '1 minute' then
    raise exception 'bad_capture_time';
  end if;
  v_counted := case
    when v_received - p_captured_at <= interval '10 minutes' then v_received
    else p_captured_at
  end;

  if v_c.id is null then
    raise exception 'commitment_ended';
  end if;

  -- FOR SHARE: a leave or removal of this membership waits until the post is done.
  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = v_c.group_id
    and m.user_id = v_uid
    and m.ended_at is null
  for share;

  if v_membership_id is null then
    raise exception 'not_member';
  end if;

  if v_c.user_id <> v_uid or v_c.membership_id <> v_membership_id then
    raise exception 'commitment_ended';
  end if;

  select w.week_start, w.time_zone into v_week, v_tz
  from private.member_current_week(v_uid, v_counted) w;

  if v_c.kind = 'task' then
    if not exists (
      select 1 from public.sessions s
      where s.commitment_id = v_c.id and s.week_start = v_week
    ) then
      raise exception 'commitment_ended';
    end if;
  else
    if v_c.ends_after_week_start is not null and v_c.ends_after_week_start < v_week then
      raise exception 'commitment_ended';
    end if;
    select cv.* into v_version
    from public.commitment_versions cv
    where cv.commitment_id = v_c.id
      and cv.effective_week_start <= v_week
    order by cv.effective_week_start desc
    limit 1;
    if v_version.id is null or (v_version.end_date is not null and v_version.end_date < v_week) then
      raise exception 'commitment_ended';
    end if;
  end if;

  select gw.lock_at into v_lock_at
  from public.group_weeks gw
  where gw.group_id = v_c.group_id and gw.week_start = v_week;
  if v_lock_at is null then
    v_lock_at := private.local_start(v_week + 10, private.group_time_zone(v_c.group_id, v_week));
  end if;
  if v_received >= v_lock_at then
    raise exception 'week_locked'
      using detail = pg_catalog.json_build_object(
        'lock_at', v_lock_at,
        'time_zone', private.group_time_zone(v_c.group_id, v_week)
      )::text;
  end if;

  if (
    select count(distinct o.name)
    from storage.objects o
    where o.bucket_id = 'checkins'
      and o.owner_id = v_uid::text
      and o.name in (
        v_c.group_id::text || '/' || p_id::text || '/1080.webp',
        v_c.group_id::text || '/' || p_id::text || '/360.webp'
      )
  ) < 2 then
    raise exception 'photo_missing';
  end if;

  -- Session matching (FR-14): the commitment's session whose [starts_at, ends_at) contains
  -- counted_at and that is not done yet, ended or miss-stamped ones included. Times per week: at
  -- most one counted check-in per member-local day; frozen rows are skipped and a row without a
  -- pending freeze is preferred (then the lowest slot). Fixed days and tasks: a frozen matched
  -- session refuses the post (session_frozen); a non-frozen one is preferred if several match.
  if v_c.kind = 'commitment' and v_c.schedule_type = 'times_per_week'
     and exists (
       select 1
       from private.counted_checkins(v_c.membership_id, v_week) k
       where k.commitment_id = v_c.id
         and (k.counted_at at time zone v_tz)::date = (v_counted at time zone v_tz)::date
     ) then
    v_session_id := null;
  elsif v_c.kind = 'commitment' and v_c.schedule_type = 'times_per_week' then
    select s.id into v_session_id
    from public.sessions s
    where s.commitment_id = v_c.id
      and s.starts_at <= v_counted
      and v_counted < s.ends_at
      and private.session_status(s) not in ('done', 'frozen')
    order by
      exists (
        select 1 from public.freeze_requests f
        where f.session_id = s.id and f.status = 'pending'
      ),
      s.slot
    limit 1;
  else
    select s.id, private.session_status(s) into v_session_id, v_session_status
    from public.sessions s
    where s.commitment_id = v_c.id
      and s.starts_at <= v_counted
      and v_counted < s.ends_at
      and private.session_status(s) <> 'done'
    order by private.session_status(s) = 'frozen', s.slot
    limit 1;
    if v_session_status = 'frozen' then
      raise exception 'session_frozen';
    end if;
  end if;

  v_is_late := v_received - p_captured_at > interval '10 minutes'
    or (p_captured_at at time zone v_tz)::date <> (v_received at time zone v_tz)::date;

  -- The ranking before the post: only an on-time post that completes a session can pass anyone.
  if v_session_id is not null and v_counted = v_received then
    select coalesce(pg_catalog.jsonb_object_agg(r.user_id::text, r.rank), '{}'::jsonb)
      into v_before
    from private.group_ranking(v_c.group_id, v_week) r
    where r.rank is not null;
    v_before_rank := (v_before ->> v_uid::text)::integer;
  end if;

  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at,
     is_late, caption)
  values
    (p_id, v_c.group_id, v_uid, v_c.id, v_session_id, p_captured_at, v_received, v_counted,
     v_is_late, v_caption);

  -- A check-in on a session with a pending freeze withdraws that request (Story 5.4, AD-6).
  if v_session_id is not null then
    update public.freeze_requests f
    set status = 'withdrawn',
        closed_at = now()
    where f.session_id = v_session_id
      and f.status = 'pending';
  end if;

  select r.weekly_points, r.rank into v_points, v_rank
  from private.group_ranking(v_c.group_id, v_week) r
  where r.user_id = v_uid;

  if v_rank is not null and v_before <> '{}'::jsonb then
    select coalesce(pg_catalog.array_agg(r.user_id order by r.rank, r.user_id), '{}'::uuid[])
      into v_passed
    from private.group_ranking(v_c.group_id, v_week) r
    where r.user_id <> v_uid
      and v_before ? r.user_id::text
      and (v_before_rank is null or (v_before ->> r.user_id::text)::integer < v_before_rank)
      and (r.rank is null or r.rank > v_rank);
  end if;

  return query
  select p_id, v_session_id, v_session_id is not null, v_is_late, x.done_count, x.target,
         v_points, v_rank, v_passed
  from private.checkin_counts(v_c.id, v_week) x;
end;
$$;

revoke execute on function public.post_checkin(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.post_checkin(uuid, uuid, timestamptz, text) to authenticated;

-- 9. Times per week: one commitment week's counts (AD-6). rows = the week's sessions, counted =
--    its counted check-ins (private.counted_checkins), approved = rows reading `frozen`, pending =
--    rows with a pending freeze. The effective target is rows - approved - pending. Only the
--    security definer routines below call it.
create or replace function private.freeze_week_counts(p_commitment_id uuid, p_week_start date)
returns table (rows_count integer, counted integer, approved integer, pending integer)
language sql
stable
set search_path = ''
as $$
  select
    (select pg_catalog.count(*)::integer from public.sessions s
     where s.commitment_id = c.id and s.week_start = p_week_start),
    (select pg_catalog.count(*)::integer
     from private.counted_checkins(c.membership_id, p_week_start) k
     where k.commitment_id = c.id),
    (select pg_catalog.count(*)::integer from public.sessions s
     where s.commitment_id = c.id and s.week_start = p_week_start
       and private.session_status(s) = 'frozen'),
    (select pg_catalog.count(*)::integer from public.freeze_requests f
     where f.commitment_id = c.id and f.week_start = p_week_start and f.status = 'pending')
  from public.commitments c
  where c.id = p_commitment_id;
$$;

-- Whether the session is missed because its check-in was ruled Fake (and not overturned).
create or replace function private.session_fake_ruling_miss(s public.sessions)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.session_status(s) = 'missed'
    and exists (
      select 1 from public.checkins c
      where c.session_id = s.id
        and private.checkin_removed(c.id)
    );
$$;

revoke execute on function private.freeze_week_counts(uuid, date) from public, anon, authenticated;
revoke execute on function private.session_fake_ruling_miss(public.sessions) from public, anon, authenticated;

-- 10. RPC: request a freeze (FR-20, AD-2, AD-6, AD-11, AD-14, AD-16, AD-17). The requester is
--     auth.uid(). Checks in order: signed in; the commitment row is locked FOR UPDATE (serializes
--     with post_checkin and other requests on it); it is the caller's own commitment in a group
--     they are a current member of (not_member); the reason, trimmed, is 1 to 80 characters
--     (reason_required); fixed days and tasks pass a session of the commitment and no week, times
--     per week a week and no session (invalid_freeze); the week's lock has not passed
--     (week_locked). Day: done (session_done), frozen (session_frozen), pending
--     (freeze_pending), missed with a removed check-in (fake_ruling_miss), then the window: now()
--     < ends_at, or a recorded miss and now() before the next member-local midnight after it
--     (freeze_window_closed). Week: this member week, or last week while a row is miss-stamped and
--     now() is before the next member-local midnight after the latest stamp
--     (freeze_window_closed); counted >= rows - approved - pending (target_met); the server picks
--     the highest-slot row not done, not frozen, not pending (and not a Fake-ruling miss).
--     closes_at = least(opened_at + 24 h, lock_at). With 1 current member the request is closed at
--     once through close_vote (approved, zero eligible voters).
create or replace function public.request_freeze(
  p_commitment_id uuid,
  p_reason text,
  p_session_id uuid default null,
  p_week_start date default null
)
returns table (freeze_request_id uuid, status text, closes_at timestamptz, session_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_c public.commitments;
  v_reason text;
  v_is_week boolean;
  v_session public.sessions;
  v_status text;
  v_week date;
  v_this date;
  v_tz text;
  v_lock_at timestamptz;
  v_last_stamp timestamptz;
  v_counts record;
  v_members integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_c
  from public.commitments c
  where c.id = p_commitment_id
  for update;

  if v_c.id is null
     or v_c.user_id <> v_uid
     or not exists (
       select 1 from public.memberships m
       where m.id = v_c.membership_id
         and m.user_id = v_uid
         and m.group_id = v_c.group_id
         and m.ended_at is null
     ) then
    raise exception 'not_member';
  end if;

  v_reason := nullif(pg_catalog.regexp_replace(coalesce(p_reason, ''), '^\s+|\s+$', '', 'g'), '');
  if v_reason is null or pg_catalog.char_length(v_reason) > 80 then
    raise exception 'reason_required';
  end if;

  v_is_week := v_c.kind = 'commitment' and v_c.schedule_type = 'times_per_week';

  if v_is_week then
    if p_week_start is null or p_session_id is not null then
      raise exception 'invalid_freeze';
    end if;
    v_week := p_week_start;
  else
    if p_session_id is null or p_week_start is not null then
      raise exception 'invalid_freeze';
    end if;
    select s.* into v_session
    from public.sessions s
    where s.id = p_session_id
      and s.commitment_id = v_c.id;
    if v_session.id is null then
      raise exception 'invalid_freeze';
    end if;
    v_week := v_session.week_start;
  end if;

  v_lock_at := private.week_lock_at(v_c.group_id, v_week);
  if v_now >= v_lock_at then
    raise exception 'week_locked';
  end if;

  v_tz := private.member_time_zone(v_uid, v_week);

  if not v_is_week then
    v_status := private.session_status(v_session);
    if v_status = 'done' then
      raise exception 'session_done';
    end if;
    if v_status = 'frozen' then
      raise exception 'session_frozen';
    end if;
    if exists (
      select 1 from public.freeze_requests f
      where f.session_id = v_session.id and f.status = 'pending'
    ) then
      raise exception 'freeze_pending';
    end if;
    if private.session_fake_ruling_miss(v_session) then
      raise exception 'fake_ruling_miss';
    end if;
    if not (
      v_now < v_session.ends_at
      or (v_session.miss_recorded_at is not null
          and v_now < private.next_local_midnight(v_session.miss_recorded_at, v_tz))
    ) then
      raise exception 'freeze_window_closed';
    end if;
  else
    select w.week_start into v_this from private.member_current_week(v_uid, v_now) w;
    if v_week = v_this then
      null;
    elsif v_week = v_this - 7 then
      select max(s.miss_recorded_at) into v_last_stamp
      from public.sessions s
      where s.commitment_id = v_c.id and s.week_start = v_week;
      if v_last_stamp is null or v_now >= private.next_local_midnight(v_last_stamp, v_tz) then
        raise exception 'freeze_window_closed';
      end if;
    else
      raise exception 'freeze_window_closed';
    end if;

    select x.* into v_counts from private.freeze_week_counts(v_c.id, v_week) x;
    if v_counts.rows_count = 0 then
      raise exception 'freeze_window_closed';
    end if;
    if v_counts.counted >= v_counts.rows_count - v_counts.approved - v_counts.pending then
      raise exception 'target_met';
    end if;

    select s.* into v_session
    from public.sessions s
    where s.commitment_id = v_c.id
      and s.week_start = v_week
      and private.session_status(s) not in ('done', 'frozen')
      and not exists (
        select 1 from public.freeze_requests f
        where f.session_id = s.id and f.status = 'pending'
      )
      and not private.session_fake_ruling_miss(s)
    order by s.slot desc
    limit 1;
    if v_session.id is null then
      raise exception 'target_met';
    end if;
  end if;

  begin
    insert into public.freeze_requests
      (group_id, requester_id, commitment_id, session_id, week_start, reason, opened_at, closes_at)
    values
      (v_c.group_id, v_uid, v_c.id, v_session.id, v_week, v_reason, v_now,
       least(v_now + interval '24 hours', v_lock_at))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'freeze_pending';
  end;

  select pg_catalog.count(*)::integer into v_members
  from public.memberships m
  where m.group_id = v_c.group_id
    and m.ended_at is null;

  if v_members = 1 then
    perform private.close_vote(v_id);
  end if;

  return query
  select f.id, f.status, f.closes_at, f.session_id
  from public.freeze_requests f
  where f.id = v_id;
end;
$$;

-- 11. RPC: what the caller may freeze now in the group (AD-11): the same rules as request_freeze,
--     every window computed here so the client never does time math.
--     option_kind `day` (fixed days, task): session_id, starts_at, ends_at, window_ends_at (the
--       session's end, or the next member-local midnight after its recorded miss, never past the
--       lock), missed, week_start, which (`this` | `last`), time_zone.
--     option_kind `week` (times per week): week_start, which, starts_at / ends_at (the week's
--       span), window_ends_at, missed (a row is miss-stamped), target (rows - approved - pending),
--       frozen (approved + pending), target_after (target - 1), time_zone.
create or replace function public.my_freeze_options(p_group_id uuid)
returns table (
  option_kind text,
  commitment_id uuid,
  session_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  window_ends_at timestamptz,
  missed boolean,
  week_start date,
  which text,
  target integer,
  frozen integer,
  target_after integer,
  time_zone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_membership_id uuid;
  v_this date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null;

  if v_membership_id is null then
    raise exception 'not_member';
  end if;

  select w.week_start into v_this from private.member_current_week(v_uid, v_now) w;

  return query
  -- Day sessions (fixed days and tasks).
  select
    'day'::text,
    c.id,
    s.id,
    s.starts_at,
    s.ends_at,
    least(
      case when v_now < s.ends_at then s.ends_at
           else private.next_local_midnight(s.miss_recorded_at, z.tz) end,
      l.lock_at
    ),
    private.session_status(s) = 'missed',
    s.week_start,
    case when s.week_start < v_this then 'last' else 'this' end,
    null::integer,
    null::integer,
    null::integer,
    z.tz
  from public.commitments c
  join public.sessions s on s.commitment_id = c.id
  cross join lateral (select private.member_time_zone(v_uid, s.week_start) as tz) z
  cross join lateral (select private.week_lock_at(c.group_id, s.week_start) as lock_at) l
  where c.membership_id = v_membership_id
    and c.user_id = v_uid
    and (c.kind = 'task' or c.schedule_type = 'fixed_days')
    and v_now < l.lock_at
    and private.session_status(s) not in ('done', 'frozen')
    and not exists (
      select 1 from public.freeze_requests f
      where f.session_id = s.id and f.status = 'pending'
    )
    and not private.session_fake_ruling_miss(s)
    and (
      v_now < s.ends_at
      or (s.miss_recorded_at is not null
          and v_now < private.next_local_midnight(s.miss_recorded_at, z.tz))
    )
  union all
  -- Times-per-week weeks (this week, and last week inside its window).
  select
    'week'::text,
    c.id,
    null::uuid,
    k.first_start,
    k.last_end,
    least(
      case when wk.week_start = v_this then private.local_start(wk.week_start + 7, z.tz)
           else private.next_local_midnight(k.last_stamp, z.tz) end,
      l.lock_at
    ),
    k.last_stamp is not null,
    wk.week_start,
    case when wk.week_start = v_this then 'this' else 'last' end,
    n.rows_count - n.approved - n.pending,
    n.approved + n.pending,
    n.rows_count - n.approved - n.pending - 1,
    z.tz
  from public.commitments c
  cross join (values (v_this), (v_this - 7)) as wk(week_start)
  cross join lateral (select private.member_time_zone(v_uid, wk.week_start) as tz) z
  cross join lateral (select private.week_lock_at(c.group_id, wk.week_start) as lock_at) l
  cross join lateral (
    select
      pg_catalog.count(*)::integer as n_rows,
      min(s.starts_at) as first_start,
      max(s.ends_at) as last_end,
      max(s.miss_recorded_at) as last_stamp
    from public.sessions s
    where s.commitment_id = c.id and s.week_start = wk.week_start
  ) k
  cross join lateral private.freeze_week_counts(c.id, wk.week_start) n
  where c.membership_id = v_membership_id
    and c.user_id = v_uid
    and c.kind = 'commitment'
    and c.schedule_type = 'times_per_week'
    and k.n_rows > 0
    and v_now < l.lock_at
    and (
      wk.week_start = v_this
      or (k.last_stamp is not null
          and v_now < private.next_local_midnight(k.last_stamp, z.tz))
    )
    and n.counted < n.rows_count - n.approved - n.pending
    and exists (
      select 1 from public.sessions s
      where s.commitment_id = c.id
        and s.week_start = wk.week_start
        and private.session_status(s) not in ('done', 'frozen')
        and not exists (
          select 1 from public.freeze_requests f
          where f.session_id = s.id and f.status = 'pending'
        )
        and not private.session_fake_ruling_miss(s)
    )
  order by 1, 4, 2;
end;
$$;

-- 12. RPC: the caller's pending and approved freeze requests in the group's unlocked weeks, for
--     the Today and My plan states. target_after (times per week) = the week's effective target
--     now (rows - approved - pending), null for a day request.
create or replace function public.my_freeze_requests(p_group_id uuid)
returns table (
  id uuid,
  commitment_id uuid,
  session_id uuid,
  option_kind text,
  week_start date,
  status text,
  reason text,
  closes_at timestamptz,
  starts_at timestamptz,
  target_after integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_current_member(p_group_id, v_uid) then
    raise exception 'not_member';
  end if;

  return query
  select
    f.id,
    f.commitment_id,
    f.session_id,
    case when c.kind = 'commitment' and c.schedule_type = 'times_per_week' then 'week' else 'day' end,
    f.week_start,
    f.status,
    f.reason,
    f.closes_at,
    s.starts_at,
    case when c.kind = 'commitment' and c.schedule_type = 'times_per_week'
      then (select n.rows_count - n.approved - n.pending
            from private.freeze_week_counts(c.id, f.week_start) n)
    end
  from public.freeze_requests f
  join public.commitments c on c.id = f.commitment_id
  join public.sessions s on s.id = f.session_id
  where f.group_id = p_group_id
    and f.requester_id = v_uid
    and f.status in ('pending', 'approved')
    and now() < private.week_lock_at(f.group_id, f.week_start)
  order by s.starts_at, f.id;
end;
$$;

-- 13. Grants (AD-16). request_freeze, my_freeze_options and my_freeze_requests are client RPCs;
--     close_vote, step 3 and the helpers above stay closed.
revoke execute on function public.request_freeze(uuid, text, uuid, date) from public, anon;
revoke execute on function public.my_freeze_options(uuid) from public, anon;
revoke execute on function public.my_freeze_requests(uuid) from public, anon;
grant execute on function public.request_freeze(uuid, text, uuid, date) to authenticated;
grant execute on function public.my_freeze_options(uuid) to authenticated;
grant execute on function public.my_freeze_requests(uuid) to authenticated;
