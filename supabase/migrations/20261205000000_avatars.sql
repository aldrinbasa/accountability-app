-- Avatars (Story 3.6, FR-1, AD-2, AD-3, AD-9, AD-16).
--
-- The profile photo is taken with the live camera, encoded once as a 256 px square WebP and
-- uploaded to bucket `avatars` at {user_id}/{version}.webp (both lowercase UUIDs; the version is a
-- new random id per photo). The client then points its own profiles.avatar_path at it through the
-- existing owner-only column UPDATE grant from Story 1.4. No change to public.profiles.
--
-- Storage policies:
--   INSERT: the caller, as owner, only under their own folder, only a well-formed .webp name.
--   SELECT: the owner, or anyone who shares or once shared a group with the owner (the AD-3
--           profile rule, private.shares_group: overlapping memberships, ended ones included).
--   No UPDATE or DELETE policy: no upsert, no overwrite, no client delete. Replaced versions stay
--   until the storage clean-up in Story 7.1.
--
-- Additive only: one bucket, one helper, two policies.

-- 1. Bucket: private, WebP only, 200 KB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 204800, array['image/webp'])
on conflict (id) do nothing;

-- 2. The owner id of an object path when it is exactly {user_id}/{version}.webp (lowercase UUIDs),
--    else null.
create or replace function private.avatar_path_owner(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is not null and p_name ~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  ) then
    return pg_catalog.split_part(p_name, '/', 1)::uuid;
  end if;
  return null;
end;
$$;

revoke execute on function private.avatar_path_owner(text) from public, anon, authenticated;
grant execute on function private.avatar_path_owner(text) to authenticated;

-- 3. Policies. The owner is the caller; nothing for anon.
create policy avatars_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and owner_id = (select auth.uid())::text
    and private.avatar_path_owner(name) = (select auth.uid())
  );

create policy avatars_select_shared
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (
      private.avatar_path_owner(name) = (select auth.uid())
      or private.shares_group(private.avatar_path_owner(name))
    )
  );
