-- Profile visibility needs overlapping memberships (Epic 1 retro F2, product decision 2026-11-19).
--
-- private.shares_group used to match any two membership rows in the same group, ended ones
-- included, so a removed member could read the profiles of people who joined after the removal,
-- and a newcomer could read the profiles of people who left before they joined. The rule now: the
-- caller sees another person's profile only when one of the caller's memberships and one of theirs,
-- in the same group, overlapped in time. A current membership (ended_at null) runs to infinity, so
-- current co-members always overlap. Bounds are inclusive: a join at the very moment of the other
-- person's end still counts.
--
-- Additive and backward compatible: same name, signature, return type, volatility, security
-- definer and empty search_path, so the generated database types and the profiles_select_shared
-- policy (its only caller) stay as they are. CREATE OR REPLACE keeps the existing privileges; they
-- are restated below so this file says what it relies on.

create or replace function private.shares_group(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = p_user_id
      and mine.joined_at <= coalesce(theirs.ended_at, 'infinity'::timestamptz)
      and theirs.joined_at <= coalesce(mine.ended_at, 'infinity'::timestamptz)
  );
$$;

comment on function private.shares_group(uuid) is
  'True when one of the caller''s memberships and one of p_user_id''s, in the same group, overlapped in time (ended rows included). Used by profiles_select_shared.';

revoke execute on function private.shares_group(uuid) from public, anon;
grant execute on function private.shares_group(uuid) to authenticated;
