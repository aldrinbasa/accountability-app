-- Tasks (Story 2.4, FR-12, FR-10, FR-4, AD-2, AD-6, AD-11, AD-14, AD-15, AD-16).
--
-- A task is a commitments row of kind 'task': an activity, a short name and a deadline day in the
-- member's current week. It counts this week at once: add_task writes its single session (slot 0)
-- itself, starting now and ending at the local midnight after the deadline day. The tick never
-- generates sessions for tasks. A task can be deleted only before its deadline day starts (so a
-- task due today can never be dodged), and renamed until its session ends. Tasks never check, set
-- or lock group_activities.schedule_type (FR-10).
--
-- Additive only: three nullable columns with a kind check, four new functions. No task rows exist
-- before this migration (nothing wrote kind 'task'), so the check holds for every existing row.
-- The routines call now() unqualified on purpose. With search_path = '' that is pg_catalog.now();
-- pgTAP re-points a function's search_path at test_overrides inside its rolled-back transaction so
-- tests.freeze_time moves the clock.

-- 1. Columns. Set exactly when kind = 'task'.
alter table public.commitments
  -- Trimmed, 1 to 40 characters.
  add column name text null
    constraint commitments_name_check
    check (pg_catalog.char_length(name) between 1 and 40 and name !~ '^\s|\s$'),
  -- The last day the task can be done, in the owner's current week when added.
  add column deadline date null,
  -- Local midnight at the start of the deadline day in the owner's zone (delete is refused from here).
  add column deadline_day_starts_at timestamptz null,
  add constraint commitments_task_columns_kind_check
    check (
      case
        when kind = 'task' then
          name is not null and deadline is not null and deadline_day_starts_at is not null
        else
          name is null and deadline is null and deadline_day_starts_at is null
      end
    );

-- 2. RPC: add a task (FR-12).
--    Checks in order: signed in, current member (not_member), the name (invalid_plan), the deadline
--    (invalid_deadline: from the member's local today to the Sunday of their current week), then
--    the activity (invalid_activity, from the resolver). Any exception rolls back everything, a
--    resolver insert included. The activity's schedule type is never read or written (FR-10).
create or replace function public.add_task(
  p_group_id uuid,
  p_preset_key text default null,
  p_group_activity_id uuid default null,
  p_custom_name text default null,
  p_name text default null,
  p_deadline date default null
)
returns table (commitment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership_id uuid;
  v_name text;
  v_tz text;
  v_week_start date;
  v_today date;
  v_activity public.group_activities;
  v_commitment_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- FOR SHARE: a leave or removal of this membership waits until the add is done.
  select m.id into v_membership_id
  from public.memberships m
  where m.group_id = p_group_id
    and m.user_id = v_uid
    and m.ended_at is null
  for share;

  if v_membership_id is null then
    raise exception 'not_member';
  end if;

  v_name := pg_catalog.regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 40 then
    raise exception 'invalid_plan';
  end if;

  v_tz := private.member_time_zone(
    v_uid,
    private.week_start_of(now(), private.member_time_zone(v_uid, null))
  );
  v_week_start := private.week_start_of(now(), v_tz);
  v_today := (now() at time zone v_tz)::date;

  if p_deadline is null or p_deadline < v_today or p_deadline > v_week_start + 6 then
    raise exception 'invalid_deadline';
  end if;

  v_activity := private.resolve_group_activity(p_group_id, p_preset_key, p_group_activity_id, p_custom_name);

  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, schedule_type, name, deadline,
     deadline_day_starts_at)
  values
    (p_group_id, v_membership_id, v_uid, 'task', v_activity.id, null, v_name, p_deadline,
     private.local_start(p_deadline, v_tz))
  returning id into v_commitment_id;

  perform private.ensure_group_week(p_group_id, v_week_start);

  insert into public.sessions
    (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
  values
    (p_group_id, v_membership_id, v_uid, v_commitment_id, v_week_start, 0, now(),
     private.local_start(p_deadline + 1, v_tz));

  commitment_id := v_commitment_id;
  return next;
end;
$$;

-- 3. RPC: delete a task. The owner only, while the membership is current (else not_found, also for
--    a commitment of kind 'commitment'); refused with task_locked from the start of the deadline
--    day. The row lock makes a concurrent rename or delete wait.
create or replace function public.delete_task(p_commitment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.commitments;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_task
  from public.commitments c
  where c.id = p_commitment_id
    and c.user_id = v_uid
    and c.kind = 'task'
    and private.membership_is_current(c.membership_id)
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  if now() >= v_task.deadline_day_starts_at then
    raise exception 'task_locked';
  end if;

  delete from public.sessions s where s.commitment_id = v_task.id;
  delete from public.commitments c where c.id = v_task.id;
end;
$$;

-- 4. RPC: rename a task. The owner only (not_found as delete_task), the name rules of add_task
--    (invalid_plan), and only while the task's session has not ended (task_locked).
create or replace function public.rename_task(p_commitment_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_task public.commitments;
  v_name text;
  v_ends_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select c.* into v_task
  from public.commitments c
  where c.id = p_commitment_id
    and c.user_id = v_uid
    and c.kind = 'task'
    and private.membership_is_current(c.membership_id)
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  v_name := pg_catalog.regexp_replace(p_name, '^\s+|\s+$', '', 'g');
  if v_name is null or pg_catalog.char_length(v_name) not between 1 and 40 then
    raise exception 'invalid_plan';
  end if;

  select s.ends_at into v_ends_at
  from public.sessions s
  where s.commitment_id = v_task.id
    and s.slot = 0;

  if v_ends_at is null or now() >= v_ends_at then
    raise exception 'task_locked';
  end if;

  update public.commitments c
  set name = v_name
  where c.id = v_task.id;
end;
$$;

-- 5. Read: one of the caller's own tasks, for the Plan sheet's edit mode. Stable and security
--    invoker (commitments, group_activities and sessions RLS apply). Anything that is not the
--    caller's task in a current membership raises not_found. can_delete and can_rename are the
--    same rules delete_task and rename_task enforce, at the time of the read.
create or replace function public.get_task(p_commitment_id uuid)
returns table (
  commitment_id uuid,
  group_id uuid,
  preset_key text,
  custom_name text,
  name text,
  deadline date,
  can_delete boolean,
  can_rename boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_found boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  for commitment_id, group_id, preset_key, custom_name, name, deadline, can_delete, can_rename in
    select
      c.id,
      c.group_id,
      ga.preset_key,
      ga.custom_name,
      c.name,
      c.deadline,
      now() < c.deadline_day_starts_at,
      coalesce(now() < s.ends_at, false)
    from public.commitments c
    join public.group_activities ga on ga.id = c.group_activity_id
    left join public.sessions s on s.commitment_id = c.id and s.slot = 0
    where c.id = p_commitment_id
      and c.user_id = v_uid
      and c.kind = 'task'
  loop
    v_found := true;
    return next;
  end loop;

  if not v_found then
    raise exception 'not_found';
  end if;
end;
$$;

-- 6. Grants: the four RPCs are executable by authenticated only. No new private helper.
revoke execute on function public.add_task(uuid, text, uuid, text, text, date) from public, anon;
revoke execute on function public.delete_task(uuid) from public, anon;
revoke execute on function public.rename_task(uuid, text) from public, anon;
revoke execute on function public.get_task(uuid) from public, anon;
grant execute on function public.add_task(uuid, text, uuid, text, text, date) to authenticated;
grant execute on function public.delete_task(uuid) to authenticated;
grant execute on function public.rename_task(uuid, text) to authenticated;
grant execute on function public.get_task(uuid) to authenticated;
