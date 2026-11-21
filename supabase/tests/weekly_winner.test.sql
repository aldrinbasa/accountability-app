-- Weekly winner (Story 4.5): the badge catalog and badge_awards (columns, unique key, RLS, grants),
-- the weekly_winner feed kind, the awards and feed event written by the lock step (co-winners tied
-- on points but split by sessions each awarded, one event; a single winner; none for a zero-point
-- week, a group of one (not ranked, 2026-11-20 decision) or a week with nobody at its lock;
-- idempotent re-runs), get_winner_week (a week, the latest locked week, podium rows, an unknown or
-- unlocked week, not_member) and get_board's is_winner.
--
-- Cast: alice (UTC) creates "Crew"; bob and carol join. dan creates "Zeroes", eve joins. frank is
-- alone in "Solo". kim is in no group (later alone in "Late", joined after its lock).
-- Weeks: P = Mon 9 Nov 2026 (locks Thu 19 Nov 00:00 UTC), W = Mon 16 Nov (locks Thu 26 Nov).
-- P: alice 2 of 2 (100, 2 done), bob 1 of 1 (100, 1 done), carol 1 of 2 (50): alice and bob win.
-- W: alice 1 of 2 (50), bob 0 of 1 (0), carol 2 of 2 (100): carol wins. Zeroes P: 0 and 0. Solo P:
-- frank 1 of 1 (100). Plans, sessions and check-ins are written directly as the table owner; the
-- routines that read the clock get their search_path pointed at test_overrides.
begin;
set local timezone = 'UTC';
select plan(38);

select tests.create_supabase_user('alice');
select tests.create_supabase_user('bob');
select tests.create_supabase_user('carol');
select tests.create_supabase_user('dan');
select tests.create_supabase_user('eve');
select tests.create_supabase_user('frank');
select tests.create_supabase_user('kim');

-- ===== Shape, RLS and grants (AD-3, AD-5, AD-16) =====
select columns_are('public', 'badges',
  array['key', 'name', 'how_earned', 'line', 'icon', 'sort_order', 'created_at', 'updated_at'],
  'badges has the story''s columns');
select columns_are('public', 'badge_awards',
  array['id', 'group_id', 'membership_id', 'user_id', 'badge_key', 'week_start', 'awarded_at',
        'created_at', 'updated_at'],
  'badge_awards has the story''s columns');
select col_is_pk('public', 'badges', 'key', 'badges is keyed by key');
select ok(
  (select i.indisunique
          and pg_catalog.pg_get_indexdef(i.indexrelid) like '%(membership_id, badge_key, week_start)%'
   from pg_catalog.pg_index i
   where i.indexrelid = 'public.badge_awards_one_per_membership_badge_week'::regclass),
  'badge_awards is unique on (membership_id, badge_key, week_start)'
);
select is(
  (select pg_catalog.string_agg(b.key || '|' || b.name || '|' || b.how_earned || '|' || b.line, ';')
   from public.badges b where b.key = 'weekly_winner'),
  'weekly_winner|Weekly Winner|Most weekly points when the week locks|Top of the board. Enjoy it while it lasts.',
  'the catalog holds weekly_winner with its name, how earned and line (Story 4.6 adds the rest)'
);
select ok(
  (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('public.badges'::regclass, 'public.badge_awards'::regclass))
  and (select pg_catalog.count(*) = 2 from pg_catalog.pg_policies p
       where p.schemaname = 'public' and p.tablename in ('badges', 'badge_awards')
         and p.cmd = 'SELECT' and p.roles = array['authenticated']::name[])
  and (select pg_catalog.count(*) = 2 from pg_catalog.pg_policies p
       where p.schemaname = 'public' and p.tablename in ('badges', 'badge_awards')),
  'badges and badge_awards have RLS with one SELECT policy each for authenticated and nothing else'
);
select ok(
  (select bool_and(has_table_privilege('authenticated', t.tbl, 'SELECT')
                   and not has_table_privilege('authenticated', t.tbl, 'INSERT, UPDATE, DELETE, TRUNCATE')
                   and not has_table_privilege('anon', t.tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE'))
   from (values ('public.badges'), ('public.badge_awards')) t(tbl)),
  'grants: authenticated SELECT only on badges and badge_awards; anon nothing'
);
select ok(
  has_function_privilege('authenticated', 'public.get_winner_week(uuid, date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_winner_week(uuid, date)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_winner_week(uuid, date)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.lock_week(uuid, date)', 'EXECUTE')
  and (select p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig)
       from pg_catalog.pg_proc p where p.oid = 'public.get_winner_week(uuid, date)'::regprocedure),
  'get_winner_week: stable security definer, empty search_path, authenticated only; lock_week closed'
);
select ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_function_result('public.get_board(uuid, date)'::regprocedure),
    'user_id uuid, display_name text, avatar_path text, weekly_points integer, sessions_done integer, '
    || 'sessions_planned integer, sessions_frozen integer, rank integer, waiting boolean, miss_count integer, '
    || 'best_streak integer, plan jsonb, task_count integer, lock_at timestamp with time zone, '
    || 'is_current_week boolean, time_zone text, locked boolean, is_winner boolean'
  ) > 0,
  'get_board keeps every earlier column and adds is_winner'
);
select ok(
  (select pg_catalog.pg_get_constraintdef(c.oid) like '%weekly_winner%'
          and pg_catalog.pg_get_constraintdef(c.oid) like '%miss%'
   from pg_catalog.pg_constraint c
   where c.conname = 'feed_events_kind_check' and c.conrelid = 'public.feed_events'::regclass),
  'feed_events accepts the weekly_winner kind next to the earlier ones'
);

-- ===== Profiles and groups =====
select tests.authenticate_as('alice');
select public.save_profile('Alice', 'UTC');
select tests.authenticate_as('bob');
select public.save_profile('Bob', 'UTC');
select tests.authenticate_as('carol');
select public.save_profile('Carol', 'UTC');
select tests.authenticate_as('dan');
select public.save_profile('Dan', 'UTC');
select tests.authenticate_as('eve');
select public.save_profile('Eve', 'UTC');
select tests.authenticate_as('frank');
select public.save_profile('Frank', 'UTC');
select tests.authenticate_as('kim');
select public.save_profile('Kim', 'UTC');

select tests.authenticate_as('alice');
select pg_catalog.set_config('test.g1', public.create_group('Crew')::text, true);
select pg_catalog.set_config('test.code1', (select code from public.create_invite(current_setting('test.g1')::uuid, false)), true);
select tests.authenticate_as('bob');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('carol');
select public.join_group(current_setting('test.code1'));
select tests.authenticate_as('dan');
select pg_catalog.set_config('test.g2', public.create_group('Zeroes')::text, true);
select pg_catalog.set_config('test.code2', (select code from public.create_invite(current_setting('test.g2')::uuid, false)), true);
select tests.authenticate_as('eve');
select public.join_group(current_setting('test.code2'));
select tests.authenticate_as('frank');
select pg_catalog.set_config('test.g3', public.create_group('Solo')::text, true);

-- ===== Fixture (temporary, as the table owner) =====
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00' where ended_at is null;

alter function private.lock_week(uuid, date) set search_path = test_overrides, pg_catalog;
alter function private.lock_due_weeks() set search_path = test_overrides, pg_catalog;
alter function private.session_status(public.sessions) set search_path = test_overrides, pg_catalog;
alter function private.current_streak(uuid) set search_path = test_overrides, pg_catalog;
alter function private.commitment_is_active(public.commitments) set search_path = test_overrides, pg_catalog;
alter function public.get_board(uuid, date) set search_path = test_overrides, pg_catalog;
select tests.freeze_time('2026-11-18 12:00:00+00');

-- A times-per-week commitment (one version from 26 Oct) of p_user in group setting p_group.
create function pg_temp.add_plan(p_user text, p_group text, p_preset text, p_target smallint)
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
  insert into public.commitments (group_id, membership_id, user_id, kind, group_activity_id, schedule_type)
  values (v_group, v_membership, v_uid, 'commitment', v_activity, 'times_per_week')
  returning id into v_id;
  insert into public.commitment_versions (commitment_id, group_id, effective_week_start, days, target)
  values (v_id, v_group, '2026-10-26', null, p_target);
  return v_id;
end;
$$;

-- p_count whole-week sessions (slots 1..N) of a commitment (setting name) in a week; the first
-- p_done get a counted check-in.
create function pg_temp.week(p_commitment text, p_week date, p_count integer, p_done integer)
returns void
language plpgsql
as $$
declare
  v_session uuid;
begin
  for i in 1 .. p_count loop
    insert into public.sessions
      (group_id, membership_id, user_id, commitment_id, week_start, slot, starts_at, ends_at)
    select c.group_id, c.membership_id, c.user_id, c.id, p_week, i::smallint,
           p_week::timestamp at time zone 'UTC', (p_week + 7)::timestamp at time zone 'UTC'
    from public.commitments c
    where c.id = current_setting('test.' || p_commitment)::uuid
    returning id into v_session;
    if i <= p_done then
      insert into public.checkins
        (id, group_id, user_id, commitment_id, session_id, captured_at, received_at, counted_at, is_late)
      select pg_catalog.gen_random_uuid(), s.group_id, s.user_id, s.commitment_id, s.id,
             s.starts_at + interval '1 hour' * i, s.starts_at + interval '1 hour' * i,
             s.starts_at + interval '1 hour' * i, false
      from public.sessions s
      where s.id = v_session;
    end if;
  end loop;
end;
$$;

-- A group's Weekly Winner awards for a week: the winners' names, by name.
create function pg_temp.awards(p_group text, p_week date)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(p.display_name, ',' order by p.display_name), '')
  from public.badge_awards a
  join public.profiles p on p.id = a.user_id
  where a.group_id = current_setting('test.' || p_group)::uuid
    and a.week_start = p_week
    and a.badge_key = 'weekly_winner';
$$;

-- A group's weekly_winner feed events for a week, as text: points|names|ids count; '' for none,
-- several joined by ';'.
create function pg_temp.events(p_group text, p_week date)
returns text
language sql
as $$
  select coalesce(pg_catalog.string_agg(
    (e.payload ->> 'weekly_points') || '|'
    || (select pg_catalog.string_agg(w ->> 'name', ',' order by o)
        from pg_catalog.jsonb_array_elements(e.payload -> 'winners') with ordinality as x(w, o))
    || '|' || pg_catalog.jsonb_array_length(e.payload -> 'winner_user_ids'),
    ';'), '')
  from public.feed_events e
  where e.group_id = current_setting('test.' || p_group)::uuid
    and e.kind = 'weekly_winner'
    and e.payload ->> 'week_start' = p_week::text;
$$;

select pg_catalog.set_config('test.a', pg_temp.add_plan('alice', 'g1', 'gym', 2::smallint)::text, true);
select pg_catalog.set_config('test.b', pg_temp.add_plan('bob', 'g1', 'run', 1::smallint)::text, true);
select pg_catalog.set_config('test.c', pg_temp.add_plan('carol', 'g1', 'yoga', 2::smallint)::text, true);
select pg_catalog.set_config('test.d', pg_temp.add_plan('dan', 'g2', 'gym', 1::smallint)::text, true);
select pg_catalog.set_config('test.e', pg_temp.add_plan('eve', 'g2', 'gym', 1::smallint)::text, true);
select pg_catalog.set_config('test.f', pg_temp.add_plan('frank', 'g3', 'gym', 1::smallint)::text, true);

select pg_temp.week('a', '2026-11-09', 2, 2);
select pg_temp.week('b', '2026-11-09', 1, 1);
select pg_temp.week('c', '2026-11-09', 2, 1);
select pg_temp.week('a', '2026-11-16', 2, 1);
select pg_temp.week('b', '2026-11-16', 1, 0);
select pg_temp.week('c', '2026-11-16', 2, 2);
select pg_temp.week('d', '2026-11-09', 1, 0);
select pg_temp.week('e', '2026-11-09', 1, 0);
select pg_temp.week('f', '2026-11-09', 1, 1);

select private.ensure_group_week(g.id, w.week)
from (values (current_setting('test.g1')::uuid), (current_setting('test.g2')::uuid),
             (current_setting('test.g3')::uuid)) g(id)
cross join (values ('2026-11-09'::date), ('2026-11-16'::date), ('2026-11-23'::date)) w(week);

-- ===== P locks (Thu 19 Nov 00:00:01) =====
select tests.freeze_time('2026-11-19 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'P locks in every group without an error');
select is(
  (select pg_catalog.string_agg(p.display_name || ':' || wr.rank || ':' || wr.weekly_points, ',' order by wr.rank)
   from public.week_results wr join public.profiles p on p.id = wr.user_id
   where wr.group_id = current_setting('test.g1')::uuid and wr.week_start = '2026-11-09'),
  'Alice:1:100,Bob:2:100,Carol:3:50',
  'Crew P: Alice and Bob tie on points, split by sessions (ranks 1 and 2)'
);
select is(pg_temp.awards('g1', '2026-11-09'), 'Alice,Bob',
  'co-winners each earn the Weekly Winner badge for P');
select is(pg_temp.events('g1', '2026-11-09'), '100|Alice,Bob|2',
  'co-winners: one weekly_winner feed event with both winners, their points and ids');
select is(
  (select coalesce(e.actor_id::text, 'none') || '|' || (e.payload ->> 'week_start') || '|' || e.created_at
   from public.feed_events e
   where e.group_id = current_setting('test.g1')::uuid and e.kind = 'weekly_winner'),
  'none|2026-11-09|2026-11-19 00:00:00.001+00',
  'the event: no actor (the winners are in the payload), the week, at the week''s lock time + 1 ms (Epic 4 retro)'
);
select is(
  (select pg_catalog.string_agg(a.membership_id::text || a.week_start::text, ',' order by a.membership_id)
   from public.badge_awards a
   where a.group_id = current_setting('test.g1')::uuid and a.badge_key = 'weekly_winner'),
  (select pg_catalog.string_agg(m.id::text || '2026-11-09', ',' order by m.id)
   from public.memberships m
   where m.group_id = current_setting('test.g1')::uuid
     and m.user_id in (tests.get_supabase_uid('alice'), tests.get_supabase_uid('bob'))),
  'the awards carry the winners'' memberships and the locked week'
);
select is(pg_temp.awards('g2', '2026-11-09') || '#' || pg_temp.events('g2', '2026-11-09'), '#',
  'a zero-point week (everyone on 0): no award, no feed event');
select is(pg_temp.awards('g3', '2026-11-09') || '#' || pg_temp.events('g3', '2026-11-09'), '#',
  'a group of one (scored, not ranked): no award, no feed event');

-- ===== Re-runs are no-ops =====
select tests.freeze_time('2026-11-19 00:05:00+00');
select is(private.lock_due_weeks(), null::text, 're-run: clean');
select is(private.lock_week(current_setting('test.g1')::uuid, '2026-11-09'), false,
  'lock_week on the locked week returns false');
select is(
  (select pg_catalog.count(*)::text from public.badge_awards where badge_key = 'weekly_winner')
  || '|' || (select pg_catalog.count(*) from public.feed_events where kind = 'weekly_winner'),
  '2|1',
  're-runs write no duplicate award or event'
);

-- ===== W locks (Thu 26 Nov 00:00:01): a single winner =====
select tests.freeze_time('2026-11-26 00:00:01+00');
select is(private.lock_due_weeks(), null::text, 'W locks without an error');
select is(pg_temp.awards('g1', '2026-11-16') || '#' || pg_temp.events('g1', '2026-11-16'),
  'Carol#100|Carol|1', 'a single winner: one award and one feed event');

-- ===== get_winner_week =====
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.string_agg(
     w.week_start || '|' || w.lock_at || '|' || w.scored || '|' || w.ranked || '|'
     || pg_catalog.cardinality(w.winner_user_ids) || '|' || w.display_name || '|' || w.weekly_points
     || '|' || w.rank || '|' || w.is_winner, ';')
   from public.get_winner_week(current_setting('test.g1')::uuid, '2026-11-09') w),
  '2026-11-09|2026-11-19 00:00:00+00|true|true|2|Alice|100|1|true;'
  || '2026-11-09|2026-11-19 00:00:00+00|true|true|2|Bob|100|2|true;'
  || '2026-11-09|2026-11-19 00:00:00+00|true|true|2|Carol|50|3|false',
  'get_winner_week: the week''s flags, winners and lock time, winners first by name, then the podium'
);
select is(
  (select pg_catalog.string_agg(w.week_start || '|' || w.display_name || '|' || w.is_winner, ';')
   from public.get_winner_week(current_setting('test.g1')::uuid, null) w),
  '2026-11-16|Carol|true;2026-11-16|Alice|false;2026-11-16|Bob|false',
  'a null week reads the group''s most recent locked week (W, not the unlocked 23 Nov)'
);
select is(
  (select pg_catalog.count(*)::integer
   from public.get_winner_week(current_setting('test.g1')::uuid, '2026-11-23')),
  0, 'an unlocked week returns no rows');
select is(
  (select pg_catalog.count(*)::integer
   from public.get_winner_week(current_setting('test.g1')::uuid, '2026-10-05')),
  0, 'an unknown week returns no rows');
select tests.authenticate_as('kim');
select throws_ok(
  format('select * from public.get_winner_week(%L::uuid, %L::date)',
         current_setting('test.g1'), '2026-11-09'),
  'P0001', 'not_member',
  'get_winner_week raises not_member for a caller outside the group'
);
select tests.authenticate_as('dan');
select is(
  (select pg_catalog.string_agg(pg_catalog.cardinality(w.winner_user_ids) || '|' || w.display_name
     || '|' || w.rank || '|' || w.is_winner, ';')
   from public.get_winner_week(current_setting('test.g2')::uuid, '2026-11-09') w),
  '0|Dan|1|false;0|Eve|1|false',
  'a zero-point week: no winners, the podium rows are not winners'
);
select tests.authenticate_as('frank');
select is(
  (select pg_catalog.string_agg(w.scored || '|' || w.ranked || '|' || coalesce(w.user_id::text, 'none'), ';')
   from public.get_winner_week(current_setting('test.g3')::uuid, '2026-11-09') w),
  'true|false|none',
  'a group of one: one row, scored, not ranked, no podium member'
);

-- ===== get_board's is_winner =====
select tests.authenticate_as('alice');
select is(
  (select pg_catalog.string_agg(b.display_name || ':' || b.rank || ':' || b.is_winner, ',')
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-09') b),
  'Alice:1:true,Bob:2:true,Carol:3:false',
  'get_board for a locked week: both co-winners are winners, whatever their stored rank'
);
select is(
  (select bool_or(b.is_winner)
   from public.get_board(current_setting('test.g1')::uuid, '2026-11-23') b),
  false,
  'get_board for an unlocked week: nobody is a winner'
);

-- ===== RLS =====
select tests.authenticate_as('bob');
select is(
  (select pg_catalog.count(*)::text from public.badge_awards
   where group_id = current_setting('test.g1')::uuid and badge_key = 'weekly_winner')
  || '|' || (select pg_catalog.count(*) from public.badge_awards where group_id <> current_setting('test.g1')::uuid)
  || '|' || (select pg_catalog.count(*) from public.badges)
  || '|' || (select pg_catalog.count(*) from public.feed_items
             where group_id = current_setting('test.g1')::uuid and item_kind = 'weekly_winner'),
  '3|0|15|2',
  'a member reads the group''s awards (no other group''s), the catalog and the winner feed items'
);
select tests.authenticate_as('kim');
select is(
  (select pg_catalog.count(*)::text from public.badge_awards) || '|' || (select pg_catalog.count(*) from public.badges),
  '0|15',
  'an outsider reads no awards but the catalog'
);
select throws_ok(
  $$insert into public.badge_awards (group_id, membership_id, badge_key, week_start)
    select m.group_id, m.id, 'weekly_winner', '2026-11-09' from public.memberships m limit 1$$,
  '42501', null, 'no client writes to badge_awards'
);

-- ===== A week with nobody current at its lock: no award, no event =====
select pg_catalog.set_config('test.g4', public.create_group('Late')::text, true);
reset role;
update public.memberships set joined_at = '2026-11-25 00:00:00+00'
where group_id = current_setting('test.g4')::uuid;
select private.ensure_group_week(current_setting('test.g4')::uuid, '2026-11-09');
select is(
  private.lock_week(current_setting('test.g4')::uuid, '2026-11-09')::text
  || '|' || pg_temp.awards('g4', '2026-11-09') || '|' || pg_temp.events('g4', '2026-11-09'),
  'true||',
  'an unscored week (nobody at its lock): locked, no award, no feed event'
);

-- ===== A winner stored at rank 4 and an anonymized winner (deferred from the 4.5 review) =====
-- "Quad": gus, hal, ivy and jo all on 100 in P, split by sessions 4, 3, 2, 1 (ranks 1 to 4).
select tests.create_supabase_user('gus');
select tests.create_supabase_user('hal');
select tests.create_supabase_user('ivy');
select tests.create_supabase_user('jo');
select tests.authenticate_as('gus');
select public.save_profile('Gus', 'UTC');
select pg_catalog.set_config('test.g5', public.create_group('Quad')::text, true);
select pg_catalog.set_config('test.code5', (select code from public.create_invite(current_setting('test.g5')::uuid, false)), true);
select tests.authenticate_as('hal');
select public.save_profile('Hal', 'UTC');
select public.join_group(current_setting('test.code5'));
select tests.authenticate_as('ivy');
select public.save_profile('Ivy', 'UTC');
select public.join_group(current_setting('test.code5'));
select tests.authenticate_as('jo');
select public.save_profile('Jo', 'UTC');
select public.join_group(current_setting('test.code5'));
reset role;
update public.memberships set joined_at = '2026-10-01 00:00:00+00'
where group_id = current_setting('test.g5')::uuid;
select pg_catalog.set_config('test.q1', pg_temp.add_plan('gus', 'g5', 'gym', 4::smallint)::text, true);
select pg_catalog.set_config('test.q2', pg_temp.add_plan('hal', 'g5', 'gym', 3::smallint)::text, true);
select pg_catalog.set_config('test.q3', pg_temp.add_plan('ivy', 'g5', 'gym', 2::smallint)::text, true);
select pg_catalog.set_config('test.q4', pg_temp.add_plan('jo', 'g5', 'gym', 1::smallint)::text, true);
select pg_temp.week('q1', '2026-11-09', 4, 4);
select pg_temp.week('q2', '2026-11-09', 3, 3);
select pg_temp.week('q3', '2026-11-09', 2, 2);
select pg_temp.week('q4', '2026-11-09', 1, 1);
select private.ensure_group_week(current_setting('test.g5')::uuid, '2026-11-09');
select private.lock_week(current_setting('test.g5')::uuid, '2026-11-09');
select tests.authenticate_as('gus');
select is(
  (select pg_catalog.string_agg(w.display_name || ':' || w.rank || ':' || w.is_winner, ',')
   from public.get_winner_week(current_setting('test.g5')::uuid, '2026-11-09') w),
  'Gus:1:true,Hal:2:true,Ivy:3:true,Jo:4:true',
  'get_winner_week lists a co-winner stored at rank 4 with the other winners'
);
reset role;
update public.week_results set user_id = null
where group_id = current_setting('test.g5')::uuid and user_id = tests.get_supabase_uid('ivy');
select tests.authenticate_as('gus');
select is(
  (select pg_catalog.string_agg(w.display_name || ':' || pg_catalog.cardinality(w.winner_user_ids), ',')
   from public.get_winner_week(current_setting('test.g5')::uuid, '2026-11-09') w),
  'Gus:4,Hal:4,Jo:4',
  'an anonymized winner row is left off the podium; the week still counts every winner'
);

select * from finish();
rollback;
