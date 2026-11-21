-- Demo data for proofy-dev (branch seed-dev only; never run against prod).
--
-- One group "Epic 4 Test Crew" with two existing users, active since Sat 17 Oct 2026: four locked
-- weeks (19 Oct, 26 Oct, 2 Nov, 9 Nov) and the current week (16 Nov). The real code does the work:
-- tick step 1 writes the sessions, tick step 4 stamps the misses, tick step 5 (lock_due_weeks)
-- locks the weeks (results, winners, badges, goal results, feed events). Only the commitments,
-- tasks, check-ins and the goal version are written here, as the RPCs would have written them.
-- Afterwards the feed events and awards made "now" get the times they would have had.
--
-- One DO block = one transaction, under the tick's advisory lock (the cron tick skips meanwhile).
-- Re-run safe: does nothing when the group already exists.
do $seed$
declare
  c_a constant uuid := '5fbe3b3e-92e1-40a2-9d43-9f2c087ce0e7';
  c_b constant uuid := '90be1de9-74cd-4802-9507-0409e2549b39';
  c_name constant text := 'Epic 4 Test Crew';
  c_first constant date := date '2026-10-19';
  v_gtz text;
  v_g uuid;
  v_ma uuid;
  v_mb uuid;
  v_act_gym uuid;
  v_act_read uuid;
  v_act_run uuid;
  v_act_med uuid;
  v_act_clean uuid;
  v_act_errands uuid;
  v_gym uuid;
  v_read uuid;
  v_run uuid;
  v_med uuid;
  v_task_a uuid;
  v_task_b uuid;
  v_err text;
  v_n integer;
  v_expected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('proofy.tick'));

  if exists (select 1 from public.groups g where g.name = c_name and g.created_by = c_a) then
    raise notice 'seed: group "%" already exists, nothing to do', c_name;
    return;
  end if;

  if (select count(*) from public.profiles p where p.id in (c_a, c_b)) <> 2 then
    raise exception 'seed: both profiles must exist';
  end if;

  select coalesce(p.time_zone, 'Asia/Manila') into v_gtz from public.profiles p where p.id = c_a;

  -- 1. Group and members (as create_group and join_group would, with past times).
  insert into public.groups (name, time_zone, created_by, created_at, updated_at)
  values (c_name, v_gtz, c_a,
          timestamp '2026-10-17 10:00' at time zone v_gtz,
          timestamp '2026-10-17 10:00' at time zone v_gtz)
  returning id into v_g;

  insert into public.memberships (group_id, user_id, role, joined_at, created_at, updated_at)
  values (v_g, c_a, 'admin',
          timestamp '2026-10-17 10:00' at time zone v_gtz,
          timestamp '2026-10-17 10:00' at time zone v_gtz,
          timestamp '2026-10-17 10:00' at time zone v_gtz)
  returning id into v_ma;

  insert into public.memberships (group_id, user_id, role, joined_at, created_at, updated_at)
  values (v_g, c_b, 'member',
          timestamp '2026-10-17 19:30' at time zone v_gtz,
          timestamp '2026-10-17 19:30' at time zone v_gtz,
          timestamp '2026-10-17 19:30' at time zone v_gtz)
  returning id into v_mb;

  insert into public.feed_events (group_id, kind, actor_id, payload, created_at, updated_at)
  select v_g, 'member_joined', c_b,
         pg_catalog.jsonb_build_object('actor_name', p.display_name, 'membership_id', v_mb),
         timestamp '2026-10-17 19:30' at time zone v_gtz,
         timestamp '2026-10-17 19:30' at time zone v_gtz
  from public.profiles p where p.id = c_b;

  -- 2. Activities, commitments (from Mon 19 Oct) and the weekly 80% goal.
  insert into public.group_activities (group_id, preset_key, created_by, schedule_type)
  values (v_g, 'gym', c_a, 'fixed_days') returning id into v_act_gym;
  insert into public.group_activities (group_id, preset_key, created_by, schedule_type)
  values (v_g, 'read', c_a, 'times_per_week') returning id into v_act_read;
  insert into public.group_activities (group_id, preset_key, created_by, schedule_type)
  values (v_g, 'run', c_b, 'fixed_days') returning id into v_act_run;
  insert into public.group_activities (group_id, preset_key, created_by, schedule_type)
  values (v_g, 'meditate', c_b, 'times_per_week') returning id into v_act_med;
  insert into public.group_activities (group_id, preset_key, created_by)
  values (v_g, 'clean', c_a) returning id into v_act_clean;
  insert into public.group_activities (group_id, custom_name, created_by)
  values (v_g, 'Errands', c_b) returning id into v_act_errands;

  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, schedule_type, created_at)
  values (v_g, v_ma, c_a, 'commitment', v_act_gym, 'fixed_days',
          timestamp '2026-10-17 10:05' at time zone v_gtz)
  returning id into v_gym;
  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, schedule_type, created_at)
  values (v_g, v_ma, c_a, 'commitment', v_act_read, 'times_per_week',
          timestamp '2026-10-17 10:07' at time zone v_gtz)
  returning id into v_read;
  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, schedule_type, created_at)
  values (v_g, v_mb, c_b, 'commitment', v_act_run, 'fixed_days',
          timestamp '2026-10-17 19:40' at time zone v_gtz)
  returning id into v_run;
  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, schedule_type, created_at)
  values (v_g, v_mb, c_b, 'commitment', v_act_med, 'times_per_week',
          timestamp '2026-10-17 19:42' at time zone v_gtz)
  returning id into v_med;

  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values
    (v_gym, v_g, c_first, array[1, 3, 5]::smallint[], null),
    (v_read, v_g, c_first, null, 4),
    (v_run, v_g, c_first, array[2, 4, 6]::smallint[], null),
    (v_med, v_g, c_first, null, 5);

  insert into public.group_goals (group_id, target_pct, period, effective_week_start, created_by, created_at)
  values (v_g, 80, 'weekly', c_first, c_a, timestamp '2026-10-17 20:00' at time zone v_gtz);

  -- 3. Sessions: the past weeks get a lock ahead for now (step 1 skips locked weeks), then step 1.
  insert into public.group_weeks (group_id, week_start, lock_at)
  select v_g, c_first + 7 * i, now() + interval '1 day'
  from pg_catalog.generate_series(0, 3) as g(i);

  v_err := private.tick_step_1_sessions();
  if v_err is not null then
    raise notice 'seed: tick step 1 reported: %', v_err;
  end if;

  select count(*) into v_n from public.sessions s where s.group_id = v_g;
  if v_n <> 75 then
    raise exception 'seed: expected 75 sessions after step 1, got % (step 1: %)', v_n, v_err;
  end if;

  -- Tasks (as add_task would): A's in the week of 2 Nov, B's in the current week.
  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, name, deadline,
     deadline_day_starts_at, created_at)
  values (v_g, v_ma, c_a, 'task', v_act_clean, 'Deep clean the kitchen', date '2026-11-05',
          private.local_start(date '2026-11-05', private.member_time_zone(c_a, date '2026-11-02')),
          private.local_start(date '2026-11-02', private.member_time_zone(c_a, date '2026-11-02'))
            + interval '8 hours')
  returning id into v_task_a;
  insert into public.sessions
    (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
  select v_g, v_ma, c_a, v_task_a, date '2026-11-02', 0, c.created_at,
         private.local_start(date '2026-11-06', private.member_time_zone(c_a, date '2026-11-02'))
  from public.commitments c where c.id = v_task_a;

  insert into public.commitments
    (group_id, membership_id, user_id, kind, group_activity_id, name, deadline,
     deadline_day_starts_at, created_at)
  values (v_g, v_mb, c_b, 'task', v_act_errands, 'Book the dentist', date '2026-11-18',
          private.local_start(date '2026-11-18', private.member_time_zone(c_b, date '2026-11-16')),
          private.local_start(date '2026-11-16', private.member_time_zone(c_b, date '2026-11-16'))
            + interval '9 hours')
  returning id into v_task_b;
  insert into public.sessions
    (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
  select v_g, v_mb, c_b, v_task_b, date '2026-11-16', 0, c.created_at,
         private.local_start(date '2026-11-19', private.member_time_zone(c_b, date '2026-11-16'))
  from public.commitments c where c.id = v_task_b;

  -- 4. Check-ins (as post_checkin would store an on-time post: received 7 s after the shutter,
  --    counted = received, not late). Times are local to the member; photos are uploaded after.
  --    (commitment, week, slot, local day, local time, caption)
  with spec (cid, wk, slot, d, tm, caption) as (
    values
      -- A, Gym, Mon/Wed/Fri at dawn (Early Bird). Week of 26 Oct misses Friday.
      (v_gym, date '2026-10-19', 1, date '2026-10-19', '06:12', 'Day one. Legs.'),
      (v_gym, date '2026-10-19', 3, date '2026-10-21', '06:25', null),
      (v_gym, date '2026-10-19', 5, date '2026-10-23', '06:18', 'Back and biceps'),
      (v_gym, date '2026-10-26', 1, date '2026-10-26', '06:31', null),
      (v_gym, date '2026-10-26', 3, date '2026-10-28', '06:09', 'Cold morning, still went'),
      (v_gym, date '2026-11-02', 1, date '2026-11-02', '06:22', null),
      (v_gym, date '2026-11-02', 3, date '2026-11-04', '06:40', 'New deadlift PR'),
      (v_gym, date '2026-11-02', 5, date '2026-11-06', '06:15', null),
      (v_gym, date '2026-11-09', 1, date '2026-11-09', '06:05', null),
      (v_gym, date '2026-11-09', 3, date '2026-11-11', '06:28', 'Push day'),
      (v_gym, date '2026-11-09', 5, date '2026-11-13', '06:33', null),
      (v_gym, date '2026-11-16', 1, date '2026-11-16', '06:20', 'Monday, no excuses'),
      (v_gym, date '2026-11-16', 3, date '2026-11-18', '06:11', null),
      (v_gym, date '2026-11-16', 5, date '2026-11-20', '06:35', 'Squats'),
      -- A, Read 4x/week in the evening.
      (v_read, date '2026-10-19', 1, date '2026-10-19', '21:10', 'Started Project Hail Mary'),
      (v_read, date '2026-10-19', 2, date '2026-10-21', '20:40', null),
      (v_read, date '2026-10-19', 3, date '2026-10-24', '15:30', null),
      (v_read, date '2026-10-26', 1, date '2026-10-26', '21:05', null),
      (v_read, date '2026-10-26', 2, date '2026-10-27', '20:50', 'Chapter 12 done'),
      (v_read, date '2026-10-26', 3, date '2026-10-29', '21:20', null),
      (v_read, date '2026-10-26', 4, date '2026-11-01', '11:00', 'Sunday coffee and pages'),
      (v_read, date '2026-11-02', 1, date '2026-11-03', '21:15', null),
      (v_read, date '2026-11-02', 2, date '2026-11-07', '16:45', null),
      (v_read, date '2026-11-09', 1, date '2026-11-09', '20:30', null),
      (v_read, date '2026-11-09', 2, date '2026-11-10', '21:00', 'Finished it'),
      (v_read, date '2026-11-09', 3, date '2026-11-12', '20:55', null),
      (v_read, date '2026-11-09', 4, date '2026-11-14', '14:10', 'New book'),
      (v_read, date '2026-11-16', 1, date '2026-11-16', '21:00', null),
      (v_read, date '2026-11-16', 2, date '2026-11-17', '20:35', null),
      (v_read, date '2026-11-16', 3, date '2026-11-19', '20:40', 'Two chapters'),
      -- A, task.
      (v_task_a, date '2026-11-02', 0, date '2026-11-04', '18:15', 'Oven finally clean'),
      -- B, Run Tue/Thu/Sat. Week of 26 Oct misses Tuesday.
      (v_run, date '2026-10-19', 2, date '2026-10-20', '17:30', 'Easy 5k'),
      (v_run, date '2026-10-19', 4, date '2026-10-22', '17:45', null),
      (v_run, date '2026-10-19', 6, date '2026-10-24', '07:30', 'Long run, 10k'),
      (v_run, date '2026-10-26', 4, date '2026-10-29', '17:40', 'Rainy 5k'),
      (v_run, date '2026-10-26', 6, date '2026-10-31', '08:00', null),
      (v_run, date '2026-11-02', 2, date '2026-11-03', '17:35', null),
      (v_run, date '2026-11-02', 4, date '2026-11-05', '18:05', 'Intervals'),
      (v_run, date '2026-11-02', 6, date '2026-11-07', '07:20', null),
      (v_run, date '2026-11-09', 2, date '2026-11-10', '17:50', null),
      (v_run, date '2026-11-09', 4, date '2026-11-12', '17:25', 'Felt fast today'),
      (v_run, date '2026-11-09', 6, date '2026-11-14', '07:45', '12k'),
      (v_run, date '2026-11-16', 2, date '2026-11-17', '17:40', null),
      (v_run, date '2026-11-16', 4, date '2026-11-19', '17:55', 'Tempo run'),
      -- B, Meditate 5x/week late at night (Night Owl); this week at lunch.
      (v_med, date '2026-10-19', 1, date '2026-10-19', '22:15', null),
      (v_med, date '2026-10-19', 2, date '2026-10-20', '22:30', '10 minutes of breathing'),
      (v_med, date '2026-10-19', 3, date '2026-10-21', '22:20', null),
      (v_med, date '2026-10-19', 4, date '2026-10-23', '22:45', null),
      (v_med, date '2026-10-26', 1, date '2026-10-28', '22:10', 'Rough week'),
      (v_med, date '2026-11-02', 1, date '2026-11-02', '22:05', 'Back on it'),
      (v_med, date '2026-11-02', 2, date '2026-11-03', '22:25', null),
      (v_med, date '2026-11-02', 3, date '2026-11-04', '22:40', null),
      (v_med, date '2026-11-02', 4, date '2026-11-05', '22:15', null),
      (v_med, date '2026-11-02', 5, date '2026-11-06', '22:35', 'Five for five'),
      (v_med, date '2026-11-09', 1, date '2026-11-09', '22:20', null),
      (v_med, date '2026-11-09', 2, date '2026-11-11', '22:10', null),
      (v_med, date '2026-11-09', 3, date '2026-11-13', '22:50', null),
      (v_med, date '2026-11-16', 1, date '2026-11-16', '12:30', 'Lunch break reset'),
      (v_med, date '2026-11-16', 2, date '2026-11-17', '12:40', null),
      (v_med, date '2026-11-16', 3, date '2026-11-18', '12:25', null),
      (v_med, date '2026-11-16', 4, date '2026-11-19', '12:35', null),
      (v_med, date '2026-11-16', 5, date '2026-11-20', '12:30', 'Calm before the weekend')
  )
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at,
     is_late, caption, created_at, updated_at)
  select pg_catalog.gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
         t.at, t.at + interval '7 seconds', t.at + interval '7 seconds', false, x.caption,
         t.at + interval '7 seconds', t.at + interval '7 seconds'
  from spec x
  join public.sessions s
    on s.commitment_id = x.cid and s.week_start = x.wk and s.slot = x.slot
  cross join lateral (
    select private.local_start(x.d, private.member_time_zone(s.user_id, s.week_start))
           + x.tm::interval as at
  ) t
  where t.at between s.starts_at and s.ends_at
    and t.at < now();
  get diagnostics v_n = row_count;
  if v_n <> 62 then
    raise exception 'seed: expected 62 check-ins, wrote %', v_n;
  end if;

  -- 5. Tick step 4: stamp the misses (and their feed events).
  v_err := private.tick_step_4_misses();
  if v_err is not null then
    raise notice 'seed: tick step 4 reported: %', v_err;
  end if;
  select count(*) into v_n from public.feed_events e where e.group_id = v_g and e.kind = 'miss';
  if v_n = 0 then
    raise exception 'seed: step 4 stamped no misses (step 4: %)', v_err;
  end if;

  -- 6. The real locks back in place, then tick step 5 locks every due week, oldest first.
  update public.group_weeks gw
  set lock_at = private.local_start(gw.week_start + 10, private.group_time_zone(v_g, gw.week_start))
  where gw.group_id = v_g and gw.week_start < date '2026-11-16';

  v_err := private.lock_due_weeks();
  select count(*) into v_n
  from public.group_weeks gw
  where gw.group_id = v_g and gw.week_start < date '2026-11-16' and gw.locked_at is not null;
  if v_n <> 4 then
    raise exception 'seed: expected 4 locked weeks, got % (step 5: %)', v_n, v_err;
  end if;

  -- 7. Times: what the lock and step 4 wrote "now" gets the time it would have had.
  update public.group_weeks gw
  set locked_at = gw.lock_at + interval '1 minute'
  where gw.group_id = v_g and gw.locked_at is not null;

  update public.badge_awards a
  set awarded_at = gw.lock_at + interval '1 minute'
  from public.group_weeks gw
  where a.group_id = v_g and gw.group_id = v_g and gw.week_start = a.week_start;

  update public.sessions s
  set miss_recorded_at = s.ends_at + interval '1 minute'
  where s.group_id = v_g and s.miss_recorded_at is not null;

  alter table public.feed_events disable trigger feed_events_append_only;

  update public.feed_events e
  set created_at = (e.payload ->> 'ends_at')::timestamptz + interval '1 minute'
  where e.group_id = v_g and e.kind = 'miss';

  update public.feed_events e
  set created_at = gw.lock_at
    + case when e.kind = 'weekly_winner' then interval '1 minute' else interval '61 seconds' end
  from public.group_weeks gw
  where e.group_id = v_g
    and e.kind in ('weekly_winner', 'goal_result')
    and gw.group_id = v_g
    and gw.week_start = (e.payload ->> 'week_start')::date;

  alter table public.feed_events enable trigger feed_events_append_only;

  raise notice 'seed: group % created (zone %)', v_g, v_gtz;
end;
$seed$;
