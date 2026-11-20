-- Weekly score and points (Story 4.1): private.commitment_week_score, private.weekly_points and
-- private.group_ranking (fixed days, times per week rows and a task in one overall score, a
-- commitment with 0 non-frozen sessions excluded, a member with no sessions unranked, extras
-- ignored, over-plan check-ins never above 100, rounding 1 of 3 = 33 and 2 of 3 = 67, ties on
-- points broken by sessions, full ties sharing a rank with the next rank skipped, an ended
-- membership excluded, a waiting group unranked), public.get_group_week, public.get_board
-- (not_member, names, order, waiting), post_checkin's new return columns (weekly_points, rank,
-- passed_user_ids; empty for a late check-in, a waiting group and an idempotent replay), and
-- grants per role (AD-16).
--
-- Cast (every zone UTC): alice creates "Crew"; bob, carol, dave, gus, hank and erin join; erin
-- leaves. frank is alone in "Solo" (a waiting group). Week W = Mon 16 Nov 2026 (locks Thu 26 Nov).
-- Plans, sessions and check-ins are written directly as the table owner; post_checkin's photos are
-- put in Storage as service_role. Frozen sessions do not exist before Epic 5, so the fixture
-- replaces private.session_status inside this rolled-back transaction to read frozen ids from a
-- test table. post_checkin and get_group_week call now() unqualified; their search_path is
-- pointed at test_overrides so tests.freeze_time moves their clock.
begin;
set local timezone = 'UTC';
select plan(38);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dave');
select tests.create_supabase_user('erin');
select tests.create_supabase_user('frank');
select tests.create_supabase_user('gus');
select tests.create_supabase_user('hank');

-- ===== Shape and grants (AD-16) =====
select ok(
  pg_catalog.to_regprocedure('private.commitment_week_score(uuid, date)') is not null
  and pg_catalog.to_regprocedure('private.weekly_points(uuid, date)') is not null
  and pg_catalog.to_regprocedure('private.group_ranking(uuid, date)') is not null
  and pg_catalog.to_regprocedure('public.get_board(uuid, date)') is not null
  and pg_catalog.to_regprocedure('public.get_group_week(uuid)') is not null,
  'the scoring functions, get_board and get_group_week exist'
);
select ok(
  (select bool_and(p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig))
   from pg_catalog.pg_proc p
   where p.oid in ('private.commitment_week_score(uuid, date)'::regprocedure,
                   'private.weekly_points(uuid, date)'::regprocedure,
                   'private.group_ranking(uuid, date)'::regprocedure,
                   'public.get_board(uuid, date)'::regprocedure,
                   'public.get_group_week(uuid)'::regprocedure)),
  'scoring functions and the two reads are stable security definer with an empty search_path'
);
select ok(
  (select bool_and(not has_function_privilege(r.role, f.fn, 'EXECUTE'))
   from (values ('public'), ('anon'), ('authenticated')) r(role)
   cross join (values ('private.commitment_week_score(uuid, date)'),
                      ('private.weekly_points(uuid, date)'),
                      ('private.group_ranking(uuid, date)')) f(fn)),
  'the private scoring functions are not executable by PUBLIC, anon or authenticated'
);
select ok(
  has_function_privilege('authenticated', 'public.get_board(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_board(uuid, date)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_board(uuid, date)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_group_week(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_group_week(uuid)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_group_week(uuid)', 'EXECUTE'),
  'get_board and get_group_week: authenticated only'
);
select ok(
  has_function_privilege('authenticated', 'public.post_checkin(uuid, uuid, timestamptz, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.post_checkin(uuid, uuid, timestamptz, text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.post_checkin(uuid, uuid, timestamptz, text)', 'EXECUTE')
  and (select p.prosecdef from pg_catalog.pg_proc p
       where p.oid = 'public.post_checkin(uuid, uuid, timestamptz, text)'::regprocedure),
  'post_checkin keeps its grants (authenticated only) and stays security definer'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result('public.post_checkin(uuid, uuid, timestamptz, text)'::regprocedure),
    'done_count integer, target integer, weekly_points integer, rank integer, passed_user_ids uuid[]'
  ) > 0,
  'post_checkin returns every earlier column plus weekly_points, rank and passed_user_ids'
);

-- ===== Profiles and groups =====
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
select tests.authenticate_as('gus');
select public.save_profile('Gus', 'UTC');
select tests.authenticate_as('hank');
select public.save_profile('Hank', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('dave');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('gus');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('hank');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('erin');
select public.join_group(current_setting('test.code'));
select tests.authenticate_as('frank');
select pg_catalog.set_config('test.g2', public.create_group('Solo')::text, true);

-- ===== Fixture helpers (temporary, as the table owner) =====
reset role;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function public.post_checkin(uuid, uuid, timestamptz, text) set search_path = test_overrides, pg_catalog;
alter function public.get_group_week(uuid) set search_path = test_overrides, pg_catalog;
-- The frozen clock (Fri 20 Nov 12:00 UTC) for every routine pointed at test_overrides.
select tests.freeze_time('2026-11-20 12:00:00+00');

-- Frozen sessions by fixture (Epic 5 adds the real status): session_status reads this table first.
create table tests.frozen_sessions (id uuid primary key);
create or replace function private.session_status(s public.sessions)
returns text
language sql
stable
security invoker
set search_path = test_overrides, pg_catalog
as $$
  select case
    when exists (select 1 from tests.frozen_sessions f where f.id = s.id) then 'frozen'
    when exists (select 1 from public.checkins c where c.session_id = s.id) then 'done'
    when s.ends_at <= now() then 'missed'
    else 'open'
  end;
$$;

-- A commitment (one version) or, with p_kind 'task', a task; p_group is a setting name (g1, g2).
create function pg_temp.add_plan(
  p_user text, p_group text, p_preset text, p_days smallint[], p_target smallint,
  p_kind text default 'commitment'
)
returns uuid
language plpgsql
as $$
declare
  v_uid uuid := tests.get_supabase_uid(p_user);
  v_group uuid := current_setting('test.' || p_group)::uuid;
  v_activity uuid;
  v_membership uuid;
  v_id uuid;
begin
  insert into public.group_activities (group_id, preset_key, created_by)
  values (v_group, p_preset, v_uid)
  on conflict do nothing;
  select ga.id into v_activity from public.group_activities ga
  where ga.group_id = v_group and ga.preset_key = p_preset;
  select m.id into v_membership from public.memberships m
  where m.group_id = v_group and m.user_id = v_uid and m.ended_at is null;
  if p_kind = 'task' then
    insert into public.commitments
      (group_id, membership_id, user_id, kind, group_activity_id, name, deadline, deadline_day_starts_at)
    values (v_group, v_membership, v_uid, 'task', v_activity, 'Tax forms', '2026-11-22',
            '2026-11-22 00:00:00+00')
    returning id into v_id;
  else
    insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
    values (v_group, v_membership, v_uid, 'commitment', v_activity,
            case when p_days is null then 'times_per_week' else 'fixed_days' end)
    returning id into v_id;
    insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
    values (v_id, v_group, '2026-10-26', p_days, p_target);
  end if;
  return v_id;
end;
$$;

-- A session of a commitment (setting name): a fixed day (slot = ISO weekday, one UTC day) or a
-- whole-week row (times per week slot 1..N, a task slot 0).
create function pg_temp.add_session(p_commitment text, p_week date, p_slot integer, p_day boolean)
returns uuid
language sql
as $$
  insert into public.sessions (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
  select c.group_id, c.membership_id, c.user_id, c.id, p_week, p_slot::smallint,
         case when p_day then (p_week + p_slot - 1)::timestamp at time zone 'UTC'
              else p_week::timestamp at time zone 'UTC' end,
         case when p_day then (p_week + p_slot)::timestamp at time zone 'UTC'
              else (p_week + 7)::timestamp at time zone 'UTC' end
  from public.commitments c
  where c.id = current_setting('test.' || p_commitment)::uuid
  returning id;
$$;

-- A counted check-in on a session, or (p_session null) an extra on a commitment (setting name).
create function pg_temp.check_in(p_session uuid, p_commitment text default null)
returns void
language sql
as $$
  insert into public.checkins
    (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
  select pg_catalog.gen_random_uuid(), c.group_id, c.user_id, c.id, p_session,
         '2026-11-16 09:00:00+00', '2026-11-16 09:00:00+00', '2026-11-16 09:00:00+00', false
  from public.commitments c
  where c.id = coalesce(
    (select s.commitment_id from public.sessions s where s.id = p_session),
    current_setting('test.' || p_commitment)::uuid
  );
$$;

create function pg_temp.membership(p_user text, p_group text)
returns uuid
language sql
as $$
  select m.id from public.memberships m
  where m.user_id = tests.get_supabase_uid(p_user)
    and m.group_id = current_setting('test.' || p_group)::uuid
  order by m.joined_at desc
  limit 1;
$$;

-- The ranking row of a member as "points|done|planned|frozen|rank" (null as "null").
create function pg_temp.rank_row(p_user text, p_group text, p_week date)
returns text
language sql
as $$
  select coalesce(r.weekly_points::text, 'null') || '|' || r.sessions_done || '|'
         || r.sessions_planned || '|' || r.sessions_frozen || '|' || coalesce(r.rank::text, 'null')
  from private.group_ranking(current_setting('test.' || p_group)::uuid, p_week) r
  where r.user_id = tests.get_supabase_uid(p_user);
$$;

-- ===== Plans for week W (16 Nov) =====
-- alice: Gym Mon Wed Fri (2 done), Walk 2 times (1 done), task Tax forms (done), plus an extra:
-- 4 of 6 = 67, 4 done.
select pg_catalog.set_config('test.gym', pg_temp.add_plan('alice', 'g1', 'gym', array[1, 3, 5]::smallint[], null)::text, true);
select pg_catalog.set_config('test.walk', pg_temp.add_plan('alice', 'g1', 'walk', null, 2::smallint)::text, true);
select pg_catalog.set_config('test.tax', pg_temp.add_plan('alice', 'g1', 'groceries', null, null, 'task')::text, true);
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 1, true));
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-16', 3, true));
select pg_temp.add_session('gym', '2026-11-16', 5, true);
select pg_temp.check_in(pg_temp.add_session('walk', '2026-11-16', 1, false));
select pg_temp.add_session('walk', '2026-11-16', 2, false);
select pg_temp.check_in(pg_temp.add_session('tax', '2026-11-16', 0, false));
select pg_temp.check_in(null, 'gym');

-- bob: Run Mon Tue Wed, 2 done plus two extras: 67, 2 done (level with alice on points).
select pg_catalog.set_config('test.run', pg_temp.add_plan('bob', 'g1', 'run', array[1, 2, 3]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-16', 1, true));
select pg_temp.check_in(pg_temp.add_session('run', '2026-11-16', 2, true));
select pg_temp.add_session('run', '2026-11-16', 3, true);
select pg_temp.check_in(null, 'run');
select pg_temp.check_in(null, 'run');

-- carol: Read Mon Wed Thu, 1 done: 33. dave: Yoga Mon Tue Sat, 1 done: 33 (full tie with carol).
select pg_catalog.set_config('test.read', pg_temp.add_plan('carol', 'g1', 'read', array[1, 3, 4]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('read', '2026-11-16', 1, true));
select pg_temp.add_session('read', '2026-11-16', 3, true);
select pg_temp.add_session('read', '2026-11-16', 4, true);
select pg_catalog.set_config('test.yoga', pg_temp.add_plan('dave', 'g1', 'yoga', array[1, 2, 6]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('yoga', '2026-11-16', 1, true));
select pg_temp.add_session('yoga', '2026-11-16', 2, true);
select pg_temp.add_session('yoga', '2026-11-16', 6, true);

-- gus: Draw Fri Sat, nothing done yet: 0. hank: no plan (no score).
select pg_catalog.set_config('test.draw', pg_temp.add_plan('gus', 'g1', 'draw', array[5, 6]::smallint[], null)::text, true);
select pg_temp.add_session('draw', '2026-11-16', 5, true);
select pg_temp.add_session('draw', '2026-11-16', 6, true);

-- erin: Paint Mon, done (100), then leaves the group.
select pg_catalog.set_config('test.paint', pg_temp.add_plan('erin', 'g1', 'paint', array[1]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('paint', '2026-11-16', 1, true));
update public.memberships set ended_at = '2026-11-17 10:00:00+00', end_reason = 'left'
where id = pg_temp.membership('erin', 'g1');

-- frank (waiting group Solo): Clean Mon, done.
select pg_catalog.set_config('test.clean', pg_temp.add_plan('frank', 'g2', 'clean', array[1]::smallint[], null)::text, true);
select pg_temp.check_in(pg_temp.add_session('clean', '2026-11-16', 1, true));

-- ===== commitment_week_score and weekly_points =====
select is(private.commitment_week_score(current_setting('test.gym')::uuid, '2026-11-16'),
  2::numeric / 3, 'Gym: 2 of 3 fixed-day sessions');
select is(private.commitment_week_score(current_setting('test.walk')::uuid, '2026-11-16'),
  0.5::numeric, 'Walk: 1 of 2 times-per-week rows');
select is(private.commitment_week_score(current_setting('test.tax')::uuid, '2026-11-16'),
  1::numeric, 'a task''s single session counts like any other');
select is(private.commitment_week_score(current_setting('test.gym')::uuid, '2026-11-09'),
  null::numeric, 'a commitment with no sessions that week has no score');
select is(private.weekly_points(pg_temp.membership('alice', 'g1'), '2026-11-16'), 67,
  'fixed days, times per week rows and a task in one overall score: 4 of 6 = 67 (extra ignored)');
select is(private.weekly_points(pg_temp.membership('carol', 'g1'), '2026-11-16'), 33,
  'rounding: 1 of 3 = 33');
select is(private.weekly_points(pg_temp.membership('bob', 'g1'), '2026-11-16'), 67,
  'rounding: 2 of 3 = 67, and two extras change nothing');
select is(private.weekly_points(pg_temp.membership('gus', 'g1'), '2026-11-16'), 0,
  'planned sessions with none done: 0 (open sessions count in planned)');
select is(private.weekly_points(pg_temp.membership('hank', 'g1'), '2026-11-16'), null::integer,
  'no sessions: no score');

-- Over plan: week of 9 Nov, alice has one Gym session done plus three extras: 100, never more.
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-09', 1, true));
select pg_temp.check_in(null, 'gym');
select pg_temp.check_in(null, 'gym');
select pg_temp.check_in(null, 'gym');
select is(private.weekly_points(pg_temp.membership('alice', 'g1'), '2026-11-09'), 100,
  'over-plan check-ins never take points above 100');

-- Frozen (fixture), week of 2 Nov: Gym Mon done + Wed frozen, Walk both rows frozen.
select pg_temp.check_in(pg_temp.add_session('gym', '2026-11-02', 1, true));
insert into tests.frozen_sessions (id)
values (pg_temp.add_session('gym', '2026-11-02', 3, true)),
       (pg_temp.add_session('walk', '2026-11-02', 1, false)),
       (pg_temp.add_session('walk', '2026-11-02', 2, false));
select is(private.commitment_week_score(current_setting('test.walk')::uuid, '2026-11-02'),
  null::numeric, 'a commitment with 0 non-frozen sessions has no score');
select is(private.commitment_week_score(current_setting('test.gym')::uuid, '2026-11-02'),
  1::numeric, 'frozen sessions leave the denominator: 1 done of 2 planned minus 1 frozen');
select is(private.weekly_points(pg_temp.membership('alice', 'g1'), '2026-11-02'), 100,
  'the all-frozen commitment is excluded from the overall score: 1 of 1');
select is(pg_temp.rank_row('alice', 'g1', '2026-11-02'), '100|1|4|3|1',
  'group_ranking reports done, planned and frozen counts');
-- Every session frozen: no score, not ranked.
insert into tests.frozen_sessions (id)
select s.id from public.sessions s
where s.membership_id = pg_temp.membership('alice', 'g1') and s.week_start = '2026-11-02'
on conflict do nothing;
select is(private.weekly_points(pg_temp.membership('alice', 'g1'), '2026-11-02'), null::integer,
  'a member whose sessions are all frozen has no score');

-- ===== group_ranking, week W =====
select is(
  (select pg_catalog.array_agg(p.display_name || ':' || coalesce(r.rank::text, '-') order by r.rank nulls last, p.display_name)
   from private.group_ranking(current_setting('test.g1')::uuid, '2026-11-16') r
   join public.profiles p on p.id = r.user_id),
  array['Alice:1', 'Bob:2', 'Carol:3', 'Dave:3', 'Gus:5', 'Hank:-'],
  'ranking: points desc then sessions done; full ties share a rank and the next is skipped; unscored last; erin (left) excluded'
);
select is(pg_temp.rank_row('alice', 'g1', '2026-11-16'), '67|4|6|0|1', 'alice: 67, 4 of 6, rank 1');
select is(pg_temp.rank_row('bob', 'g1', '2026-11-16'), '67|2|3|0|2',
  'bob: level with alice on points, behind on sessions done');
select is(pg_temp.rank_row('hank', 'g1', '2026-11-16'), 'null|0|0|0|null', 'hank: no sessions, no rank');
select is(
  (select r.rank from private.group_ranking(current_setting('test.g1')::uuid, '2026-11-16') r order by r.rank nulls last limit 1 offset 5),
  null::integer,
  'unscored members come after every ranked member'
);
select is(pg_temp.rank_row('frank', 'g2', '2026-11-16'), '100|1|1|0|null',
  'a waiting group returns its member''s row with rank null');

-- ===== get_group_week =====
select tests.authenticate_as('alice');
select is(
  (select w.week_start::text || '|' || w.lock_at::text from public.get_group_week(current_setting('test.g1')::uuid) w),
  '2026-11-16|2026-11-26 00:00:00+00',
  'get_group_week: the group''s current Monday and its Thursday 00:00 lock'
);
select tests.authenticate_as('frank');
select throws_ok(
  format('select * from public.get_group_week(%L)', current_setting('test.g1')),
  'P0001', 'not_member', 'get_group_week: not_member for a non-member'
);

-- ===== get_board =====
select throws_ok(
  format('select * from public.get_board(%L, %L)', current_setting('test.g1'), '2026-11-16'),
  'P0001', 'not_member', 'get_board: not_member for a non-member'
);
select is(
  (select b.waiting::text || '|' || coalesce(b.rank::text, 'null') || '|' || b.weekly_points
   from public.get_board(current_setting('test.g2')::uuid, '2026-11-16') b),
  'true|null|100',
  'get_board in a waiting group: waiting, unranked'
);
select tests.authenticate_as('carol');
select is(
  (select pg_catalog.array_agg(b.display_name || ':' || coalesce(b.weekly_points::text, '-') || ':' || coalesce(b.rank::text, '-') || ':' || b.waiting::text order by b.rank nulls last, b.display_name)
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b),
  array['Alice:67:1:false', 'Bob:67:2:false', 'Carol:33:3:false', 'Dave:33:3:false', 'Gus:0:5:false', 'Hank:-:-:false'],
  'get_board: ranked rows first (ties by name), then unscored, with names, points and waiting = false'
);

-- ===== post_checkin's post-moment values =====
select pg_catalog.set_config('test.p1', '00000000-0000-4000-a000-0000000041a1', true);
select pg_catalog.set_config('test.p2', '00000000-0000-4000-a000-0000000041a2', true);
select pg_catalog.set_config('test.p3', '00000000-0000-4000-a000-0000000041a3', true);
reset role;
set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.' || p.grp) || '/' || current_setting('test.' || p.id) || '/' || s.size || '.webp',
       tests.get_supabase_uid(p.owner)::text
from (values ('p1', 'gus', 'g1'), ('p2', 'carol', 'g1'), ('p3', 'frank', 'g2')) p(id, owner, grp)
cross join (values ('1080'), ('360')) s(size);
reset role;
-- frank's Solo plan gets a Friday session for his post.
select pg_temp.add_session('clean', '2026-11-16', 5, true);

-- Fri 20 Nov 12:00: gus checks in on time for Friday's Draw: 1 of 2 = 50 passes carol and dave.
select tests.authenticate_as('gus');
select is(
  (select r.counted::text || '|' || r.done_count || '/' || r.target || '|' || r.weekly_points || '|' || r.rank
          || '|' || (select pg_catalog.array_agg(u order by u) from pg_catalog.unnest(r.passed_user_ids) u)::text
   from public.post_checkin(current_setting('test.p1')::uuid, current_setting('test.draw')::uuid,
     '2026-11-20 11:59:00+00', null) r),
  'true|1/2|50|3|' || (select pg_catalog.array_agg(u order by u)
                        from pg_catalog.unnest(array[tests.get_supabase_uid('carol'), tests.get_supabase_uid('dave')]) u)::text,
  'post_checkin: points and rank after the post, and the members it passed'
);

-- carol posts a late check-in (taken Thursday evening): counted at captured_at, passes nobody.
select tests.authenticate_as('carol');
select is(
  (select r.counted::text || '|' || r.is_late::text || '|' || r.weekly_points || '|' || r.rank || '|'
          || pg_catalog.cardinality(r.passed_user_ids)
   from public.post_checkin(current_setting('test.p2')::uuid, current_setting('test.read')::uuid,
     '2026-11-19 18:00:00+00', null) r),
  'true|true|67|2|0',
  'post_checkin: a late check-in returns its points and rank but passed_user_ids is empty'
);

-- gus repeats his post: same shape, current values, no passed members.
select tests.authenticate_as('gus');
select is(
  (select r.checkin_id::text || '|' || r.counted::text || '|' || r.weekly_points || '|' || r.rank || '|'
          || pg_catalog.cardinality(r.passed_user_ids)
   from public.post_checkin(current_setting('test.p1')::uuid, current_setting('test.draw')::uuid,
     '2026-11-20 11:59:00+00', null) r),
  current_setting('test.p1') || '|true|50|4|0',
  'post_checkin: the idempotent replay returns the same shape with the current points and rank'
);

-- frank posts in his waiting group: points, no rank, nobody passed.
select tests.authenticate_as('frank');
select is(
  (select r.weekly_points || '|' || coalesce(r.rank::text, 'null') || '|' || pg_catalog.cardinality(r.passed_user_ids)
   from public.post_checkin(current_setting('test.p3')::uuid, current_setting('test.clean')::uuid,
     '2026-11-20 11:59:00+00', null) r),
  '100|null|0',
  'post_checkin in a waiting group: no rank and passed_user_ids empty'
);

-- hank plans Journal Fri Sat (0 of 2: 0, rank 6), then checks in on time for Friday: 1 of 2 = 50
-- with 1 done ties gus at #4 (a tie is not a pass) and passes dave (33, now #6).
reset role;
select pg_catalog.set_config('test.journal', pg_temp.add_plan('hank', 'g1', 'journal', array[5, 6]::smallint[], null)::text, true);
select pg_temp.add_session('journal', '2026-11-16', 5, true);
select pg_temp.add_session('journal', '2026-11-16', 6, true);
select pg_catalog.set_config('test.p4', '00000000-0000-4000-a000-0000000041a4', true);
set local role service_role;
insert into storage.objects (bucket_id, name, owner_id)
select 'checkins', current_setting('test.g1') || '/' || current_setting('test.p4') || '/' || s.size || '.webp',
       tests.get_supabase_uid('hank')::text
from (values ('1080'), ('360')) s(size);
reset role;
select tests.authenticate_as('hank');
select is(
  (select r.weekly_points || '|' || r.rank || '|' || r.passed_user_ids::text
   from public.post_checkin(current_setting('test.p4')::uuid, current_setting('test.journal')::uuid,
     '2026-11-20 11:59:00+00', null) r),
  '50|4|{' || tests.get_supabase_uid('dave') || '}',
  'post_checkin: a member tied by the post is not passed; the one now ranked below is'
);

-- The ranking after the posts: carol (late) ties bob, gus and hank share 4th, dave 6th.
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.array_agg(b.display_name || ':' || coalesce(b.rank::text, '-') order by b.rank nulls last, b.display_name)
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-16') b),
  array['Alice:1', 'Bob:2', 'Carol:2', 'Gus:4', 'Hank:4', 'Dave:6'],
  'get_board after the posts reflects them'
);

select * from finish();
rollback;
