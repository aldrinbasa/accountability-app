-- Group goal review fix (Story 4.7): private.lock_month reads the month from the lock's own date.
--
-- A week's lock is Thursday 00:00 after the week in the group's zone for that week (AD-11), so its
-- local date is always week_start + 10. The first version read the stored lock_at in
-- private.group_time_zone(group, week), which knows only the current and pending zone: after a
-- group moved west, a past lock on Thursday the 1st read as Wednesday the 31st and fell into the
-- previous month. Same signature, grants kept (create or replace).
create or replace function private.lock_month(p_group_id uuid, p_week_start date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.date_trunc('month', (p_week_start + 10)::timestamp)::date
  where p_group_id is not null;
$$;

revoke execute on function private.lock_month(uuid, date) from public, anon, authenticated;
