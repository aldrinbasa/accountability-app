-- Weekly winner (Story 4.5, FR-27, FR-31, AD-3, AD-5, AD-10, AD-12, AD-15, AD-16).
--
-- When a ranked week locks with winners (Story 4.4 stores them in group_week_results.winner_user_ids:
-- every ranked member on the top points, on points alone, none when the top is 0), the same
-- transaction now awards each winner the Weekly Winner badge and writes one `weekly_winner` feed
-- event. A week that is unscored, not ranked (a group of one, 2026-11-20 decision) or has no winner
-- writes neither.
--   badges        the badge catalog (one row here: weekly_winner; Story 4.6 adds the rest)
--   badge_awards  the only badge store (AD-5): unique (membership_id, badge_key, week_start)
--
-- public.get_winner_week(group, week) is the winner card's read: the locked week's flags, winners and
-- podium members (null week: the group's most recent locked week). public.get_board is dropped and
-- recreated with every earlier column plus `is_winner`, so a locked week's co-winners stand together
-- on the Board's 1st block (EXPERIENCE.md "Weekly winner tie (locked week)").
--
-- Backward compatible: two new tables, one widened check constraint, one new RPC; private.lock_week
-- is replaced with the same signature and the 4.4 body plus the award and event writes. get_board is
-- dropped and recreated (a new output column needs that) with its arguments, every column and its
-- grants; nothing in the database calls it, and the running app ignores the extra column. The routines call now() unqualified on purpose (see
-- 20261204000000_misses.sql).

-- 1. The badge catalog. Readable by every signed-in member; never client-writable.
create table public.badges (
  key text primary key,
  name text not null,
  how_earned text not null,
  line text not null,
  -- A Phosphor icon name the client maps to a glyph.
  icon text not null,
  sort_order integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create trigger badges_set_updated_at
  before update on public.badges
  for each row execute function private.set_updated_at();

insert into public.badges (key, name, how_earned, line, icon, sort_order)
values ('weekly_winner', 'Weekly Winner', 'Most weekly points when the week locks',
        'Top of the board. Enjoy it while it lasts.', 'crown', 1);

-- 2. Badge awards (AD-5): the only badge store. week_start is the locked week that earned it.
--    Weekly Winner is per week; one-time badges (Story 4.6) are inserted with
--    `where not exists (membership_id, badge_key)` inside the lock step, which runs under the tick's
--    advisory lock, so they cannot be awarded twice.
create table public.badge_awards (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  -- Nullable so account deletion (Epic 7) can anonymize an award.
  user_id uuid null references public.profiles (id) on delete set null,
  badge_key text not null references public.badges (key),
  week_start date not null
    constraint badge_awards_week_start_monday_check
    check (extract(isodow from week_start) = 1),
  awarded_at timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create unique index badge_awards_one_per_membership_badge_week
  on public.badge_awards (membership_id, badge_key, week_start);
create index badge_awards_group_id_idx on public.badge_awards (group_id);
create index badge_awards_user_id_idx on public.badge_awards (user_id);
create index badge_awards_badge_key_idx on public.badge_awards (badge_key);

create trigger badge_awards_set_updated_at
  before update on public.badge_awards
  for each row execute function private.set_updated_at();

-- 3. The feed gains the weekly_winner kind. Its payload: week_start, weekly_points (the winners'
--    points), winner_user_ids and winners [{user_id, name}] (names at write time, by name).
alter table public.feed_events drop constraint feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check
  check (kind in ('member_joined', 'member_left', 'member_removed', 'admin_handover', 'miss',
                  'weekly_winner'));

-- 4. Lock one week (from 20261209000000_week_lock.sql): the same body, plus, after
--    group_week_results and before locked_at, one weekly_winner badge award per winner and one
--    weekly_winner feed event, only when the week has winners. Re-runs stay no-ops (locked_at, the
--    unique keys).
create or replace function private.lock_week(p_group_id uuid, p_week_start date)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_lock_at timestamptz;
  v_locked_at timestamptz;
  v_members integer;
  v_ranked boolean;
  v_winners uuid[] := '{}'::uuid[];
  v_top integer;
begin
  select gw.lock_at, gw.locked_at into v_lock_at, v_locked_at
  from public.group_weeks gw
  where gw.group_id = p_group_id
    and gw.week_start = p_week_start
  for update;

  if not found or v_locked_at is not null or v_lock_at > now() then
    return false;
  end if;

  perform c.id
  from public.commitments c
  where c.group_id = p_group_id
  for share;

  insert into public.week_results
    (group_id, membership_id, user_id, week_start, weekly_points, sessions_done,
     sessions_planned, sessions_frozen, rank)
  select p_group_id, r.membership_id, r.user_id, p_week_start, r.weekly_points, r.sessions_done,
         r.sessions_planned, r.sessions_frozen, r.rank
  from private.week_ranking(p_group_id, p_week_start, v_lock_at) r;
  get diagnostics v_members = row_count;
  v_ranked := v_members >= 2;

  -- streak_through_week reads stored rows of earlier weeks only: this statement's own rows are not
  -- visible to it.
  insert into public.week_commitment_results
    (group_id, commitment_id, membership_id, week_start, planned, done, frozen, target_met,
     streak_after)
  select c.group_id, c.id, c.membership_id, p_week_start, x.planned, x.done, x.frozen,
         x.planned - x.frozen > 0 and x.done >= x.planned - x.frozen,
         private.streak_through_week(c.id, p_week_start)
  from public.commitments c
  join public.week_results wr
    on wr.membership_id = c.membership_id
   and wr.week_start = p_week_start
  cross join lateral (
    select
      count(*)::integer as planned,
      (count(*) filter (where z.status = 'done'))::integer as done,
      (count(*) filter (where z.status = 'frozen'))::integer as frozen
    from public.sessions s
    cross join lateral (select private.session_status(s) as status) z
    where s.commitment_id = c.id
      and s.week_start = p_week_start
  ) x
  where c.group_id = p_group_id
    and x.planned > 0;

  if v_ranked then
    select coalesce(pg_catalog.array_agg(wr.user_id order by wr.user_id), '{}'::uuid[])
      into v_winners
    from public.week_results wr
    where wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.rank is not null
      and wr.weekly_points > 0
      and wr.weekly_points = (
        select max(w2.weekly_points)
        from public.week_results w2
        where w2.group_id = p_group_id
          and w2.week_start = p_week_start
          and w2.rank is not null
      );
  end if;

  insert into public.group_week_results (group_id, week_start, scored, ranked, winner_user_ids)
  values (p_group_id, p_week_start, v_members > 0, v_ranked, v_winners);

  -- Story 4.5: the Weekly Winner badge for each winner (co-winners each earn it) and one feed event.
  if pg_catalog.cardinality(v_winners) > 0 then
    insert into public.badge_awards
      (group_id, membership_id, user_id, badge_key, week_start, awarded_at)
    select p_group_id, wr.membership_id, wr.user_id, 'weekly_winner', p_week_start, now()
    from public.week_results wr
    where wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.user_id = any (v_winners)
    on conflict (membership_id, badge_key, week_start) do nothing;

    select max(wr.weekly_points) into v_top
    from public.week_results wr
    where wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.user_id = any (v_winners);

    insert into public.feed_events (group_id, kind, created_at, payload)
    select p_group_id, 'weekly_winner', now(),
           pg_catalog.jsonb_build_object(
             'week_start', p_week_start,
             'weekly_points', v_top,
             'winner_user_ids', pg_catalog.to_jsonb(v_winners),
             'winners', coalesce(pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('user_id', p.id, 'name', p.display_name)
               order by p.display_name, p.id
             ), '[]'::jsonb)
           )
    from public.profiles p
    where p.id = any (v_winners);
  end if;

  update public.group_weeks
  set locked_at = now()
  where group_id = p_group_id
    and week_start = p_week_start;

  return true;
end;
$$;

-- 5. The winner card's read (AD-12): a locked week of the group (null: its most recent locked week).
--    One row per podium member (ranks 1-3 plus every winner, whatever its rank; live names and
--    avatars; an anonymized row is skipped), winners first by name, then by rank and name; the week
--    columns repeat on every row. A locked week with no such member returns one row with null
--    member columns; an unknown or unlocked week returns no rows. Raises not_member unless the
--    caller is a current member of the group.
create or replace function public.get_winner_week(p_group_id uuid, p_week_start date)
returns table (
  week_start date,
  lock_at timestamptz,
  scored boolean,
  ranked boolean,
  winner_user_ids uuid[],
  user_id uuid,
  display_name text,
  avatar_path text,
  weekly_points integer,
  rank integer,
  is_winner boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_week date;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  if p_week_start is null then
    select max(gw.week_start) into v_week
    from public.group_weeks gw
    where gw.group_id = p_group_id
      and gw.locked_at is not null;
  else
    v_week := p_week_start;
  end if;

  return query
  select
    gr.week_start,
    gw.lock_at,
    gr.scored,
    gr.ranked,
    gr.winner_user_ids,
    m.user_id,
    m.display_name,
    m.avatar_path,
    m.weekly_points,
    m.rank,
    m.is_winner
  from public.group_week_results gr
  join public.group_weeks gw
    on gw.group_id = gr.group_id
   and gw.week_start = gr.week_start
   and gw.locked_at is not null
  left join lateral (
    select
      wr.user_id,
      p.display_name,
      p.avatar_path,
      wr.weekly_points,
      wr.rank,
      wr.user_id = any (gr.winner_user_ids) as is_winner
    from public.week_results wr
    join public.profiles p on p.id = wr.user_id
    where wr.group_id = gr.group_id
      and wr.week_start = gr.week_start
      and wr.rank is not null
      and (wr.rank <= 3 or wr.user_id = any (gr.winner_user_ids))
  ) m on true
  where gr.group_id = p_group_id
    and gr.week_start = v_week
  order by m.is_winner desc nulls last,
           case when m.is_winner then null else m.rank end nulls first,
           m.display_name, m.user_id;
end;
$$;

-- 6. get_board (from 20261209000000_week_lock.sql) with every column plus is_winner: a locked
--    week's rows say whether the member is one of its winners (group_week_results.winner_user_ids);
--    an unlocked week's rows are never winners.
drop function public.get_board(uuid, date);

create function public.get_board(p_group_id uuid, p_week_start date)
returns table (
  user_id uuid,
  display_name text,
  avatar_path text,
  weekly_points integer,
  sessions_done integer,
  sessions_planned integer,
  sessions_frozen integer,
  rank integer,
  waiting boolean,
  miss_count integer,
  best_streak integer,
  plan jsonb,
  task_count integer,
  lock_at timestamptz,
  is_current_week boolean,
  time_zone text,
  locked boolean,
  is_winner boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_locked boolean;
  v_waiting boolean;
  v_current date;
  v_lock_at timestamptz;
  v_tz text;
  v_winners uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not private.is_member(p_group_id) then
    raise exception 'not_member';
  end if;

  v_locked := coalesce((
    select gw.locked_at is not null
    from public.group_weeks gw
    where gw.group_id = p_group_id and gw.week_start = p_week_start
  ), false);

  if v_locked then
    select not gr.ranked, gr.winner_user_ids into v_waiting, v_winners
    from public.group_week_results gr
    where gr.group_id = p_group_id and gr.week_start = p_week_start;
    v_waiting := coalesce(v_waiting, true);
    v_winners := coalesce(v_winners, '{}'::uuid[]);
  else
    select count(*) < 2 into v_waiting
    from public.memberships m
    where m.group_id = p_group_id
      and m.ended_at is null;
  end if;

  v_current := private.group_current_week(p_group_id, now());
  v_tz := private.group_time_zone(p_group_id, p_week_start);
  v_lock_at := private.week_lock_at(p_group_id, p_week_start);

  return query
  with r as (
    select
      wr.membership_id,
      wr.user_id,
      wr.weekly_points,
      wr.sessions_done,
      wr.sessions_planned,
      wr.sessions_frozen,
      wr.rank,
      greatest(wr.sessions_planned - wr.sessions_done - wr.sessions_frozen, 0) as stored_misses
    from public.week_results wr
    where v_locked
      and wr.group_id = p_group_id
      and wr.week_start = p_week_start
      and wr.user_id is not null
    union all
    select
      w.membership_id,
      w.user_id,
      w.weekly_points,
      w.sessions_done,
      w.sessions_planned,
      w.sessions_frozen,
      w.rank,
      null::integer
    from private.week_ranking(p_group_id, p_week_start, null) w
    where not v_locked
  )
  select
    r.user_id,
    p.display_name,
    p.avatar_path,
    r.weekly_points,
    r.sessions_done,
    r.sessions_planned,
    r.sessions_frozen,
    r.rank,
    v_waiting,
    coalesce(r.stored_misses, (
      select count(*)::integer
      from public.sessions s
      where s.membership_id = r.membership_id
        and s.week_start = p_week_start
        and private.session_status(s) = 'missed'
    ), 0),
    coalesce((
      select max(private.current_streak(c.id))
      from public.commitments c
      where c.membership_id = r.membership_id
        and c.kind = 'commitment'
        and private.commitment_is_active(c)
    ), 0),
    coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'activity_name', coalesce(pa.name, ga.custom_name),
          'schedule_type', c.schedule_type,
          'days', v.days,
          'target', v.target
        )
        order by c.created_at, c.id
      )
      from public.commitments c
      join public.group_activities ga on ga.id = c.group_activity_id
      left join public.preset_activities pa on pa.key = ga.preset_key
      left join lateral (
        select cv.days, cv.target
        from public.commitment_versions cv
        where cv.commitment_id = c.id
          and cv.effective_week_start <= p_week_start
        order by cv.effective_week_start desc
        limit 1
      ) v on true
      where c.membership_id = r.membership_id
        and c.kind = 'commitment'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = p_week_start
        )
    ), '[]'::jsonb),
    (
      select count(*)::integer
      from public.commitments c
      where c.membership_id = r.membership_id
        and c.kind = 'task'
        and exists (
          select 1 from public.sessions s
          where s.commitment_id = c.id and s.week_start = p_week_start
        )
    ),
    v_lock_at,
    p_week_start = v_current,
    v_tz,
    v_locked,
    r.user_id = any (v_winners)
  from r
  join public.profiles p on p.id = r.user_id
  order by r.rank nulls last, p.display_name, r.user_id;
end;
$$;

-- 7. Grants (AD-16). The RPCs are for authenticated only; lock_week stays closed.
revoke execute on function private.lock_week(uuid, date) from public, anon, authenticated;
revoke execute on function public.get_winner_week(uuid, date) from public, anon;
grant execute on function public.get_winner_week(uuid, date) to authenticated;
revoke execute on function public.get_board(uuid, date) from public, anon;
grant execute on function public.get_board(uuid, date) to authenticated;

-- 8. Row level security: every signed-in member reads the catalog; current members of the group
--    read its awards (AD-3); no client writes.
alter table public.badges enable row level security;
alter table public.badge_awards enable row level security;

create policy badges_select_authenticated
  on public.badges
  for select
  to authenticated
  using (true);

create policy badge_awards_select_member
  on public.badge_awards
  for select
  to authenticated
  using (private.is_member(group_id));

revoke all on table public.badges from public, anon, authenticated;
revoke all on table public.badge_awards from public, anon, authenticated;
grant select on table public.badges to authenticated;
grant select on table public.badge_awards to authenticated;
