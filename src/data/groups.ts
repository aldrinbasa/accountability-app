import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { trimGroupName, type Invite, type InvitePreview, type MyGroup } from '@/domain/groups'
import type { Profile } from '@/domain/profile'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { deviceTimeZone, MY_PROFILE_KEY } from '@/data/profile'

/** The signed-in member's current groups. Sign-out clears the whole query cache, this key included. */
export const MY_GROUPS_KEY = ['groups', 'me'] as const

/** `['invite', groupId]`: the admin's current invite for a group. */
export function inviteKey(groupId: string) {
  return ['invite', groupId] as const
}

/** `['invite', 'code', code]`: what an invite code leads to (the join screen). */
export function invitePreviewKey(code: string) {
  return ['invite', 'code', code] as const
}

export interface GroupRepository {
  listMine(): Promise<MyGroup[]>
  create(name: string): Promise<string>
  invite(groupId: string, fresh: boolean): Promise<Invite>
  previewInvite(code: string): Promise<InvitePreview>
  join(code: string): Promise<string>
}

/** Group reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createGroupRepository(backend: BackendPort): GroupRepository {
  return {
    listMine: () => backend.listMyGroups(),
    create: (name) => backend.createGroup(name),
    invite: (groupId, fresh) => backend.createInvite(groupId, fresh),
    previewInvite: (code) => backend.getInvite(code),
    join: (code) => backend.joinGroup(code),
  }
}

function useGroupRepository(hook: string): GroupRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createGroupRepository(backend), [backend])
}

/** `['groups', 'me']`: current groups with role and member count. Retries once, refetches on focus. */
export function useMyGroups() {
  const repository = useGroupRepository('useMyGroups')
  return useQuery({
    queryKey: MY_GROUPS_KEY,
    queryFn: () => repository.listMine(),
    retry: 1,
    retryDelay: 500,
  })
}

/**
 * `create_group`. Resolves with the new group's id once `['groups', 'me']` holds it, so the caller can
 * focus the new group straight away. A provisional row (what the server just created) goes into the
 * cache first, so a failed refetch cannot drop the new group; the refetch then replaces it.
 */
export function useCreateGroup() {
  const repository = useGroupRepository('useCreateGroup')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => repository.create(name),
    onSuccess: async (groupId, name) => {
      const profile = queryClient.getQueryData<Profile | null>(MY_PROFILE_KEY)
      const provisional: MyGroup = {
        id: groupId,
        name: trimGroupName(name),
        timeZone: profile?.timeZone ?? deviceTimeZone(),
        role: 'admin',
        joinedAt: new Date().toISOString(),
        memberCount: 1,
      }
      await queryClient.cancelQueries({ queryKey: MY_GROUPS_KEY })
      queryClient.setQueryData<MyGroup[]>(MY_GROUPS_KEY, (groups = []) => [
        ...groups.filter((group) => group.id !== groupId),
        provisional,
      ])
      await queryClient.invalidateQueries({ queryKey: MY_GROUPS_KEY })
    },
  })
}

/**
 * `['invite', groupId]` via `create_invite(groupId, false)`: the group's unexpired invite, made on
 * first ask. Only for an admin of a group under the member cap (`enabled`). Retries once.
 */
export function useInvite(groupId: string, enabled: boolean) {
  const repository = useGroupRepository('useInvite')
  return useQuery({
    queryKey: inviteKey(groupId),
    queryFn: () => repository.invite(groupId, false),
    enabled,
    retry: 1,
    retryDelay: 500,
  })
}

/** `create_invite(groupId, true)`: a fresh invite, which replaces `['invite', groupId]`. */
export function useNewInvite(groupId: string) {
  const repository = useGroupRepository('useNewInvite')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => repository.invite(groupId, true),
    onSuccess: (invite) => {
      queryClient.setQueryData<Invite>(inviteKey(groupId), invite)
    },
  })
}

/**
 * `['invite', 'code', code]` via `get_invite`. No retry: an unknown code (`invite_not_found`) is an
 * answer, not a failure, and the screen offers its own Try again.
 */
export function useInvitePreview(code: string) {
  const repository = useGroupRepository('useInvitePreview')
  return useQuery({
    queryKey: invitePreviewKey(code),
    queryFn: () => repository.previewInvite(code),
    retry: false,
  })
}

/**
 * `join_group`. Resolves with the group id once `['groups', 'me']` has been refetched with it, so the
 * caller can focus the group straight away. The refetch runs even with no mounted observer: /join
 * sits outside the shell, and Today must not open on a stale list. The code's cached preview then
 * reads `member`.
 */
export function useJoinGroup() {
  const repository = useGroupRepository('useJoinGroup')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => repository.join(code),
    onSuccess: async (_groupId, code) => {
      await fetchMyGroups(queryClient, repository)
      queryClient.setQueryData<InvitePreview>(invitePreviewKey(code), (preview) =>
        preview ? { ...preview, status: 'member' } : preview,
      )
    },
  })
}

/**
 * Fetches `['groups', 'me']` now, observer or not. `refetchQueries` / `invalidateQueries` cannot do
 * this for a query that has no observer in this session (one restored from the persisted cache or set
 * with `setQueryData` has no `queryFn`), so the query function is passed here. A failure leaves the
 * cache as it was; the next refetch on focus catches up.
 */
async function fetchMyGroups(queryClient: QueryClient, repository: GroupRepository): Promise<void> {
  try {
    await queryClient.fetchQuery({
      queryKey: MY_GROUPS_KEY,
      queryFn: () => repository.listMine(),
      staleTime: 0,
    })
  } catch {
    // Keep the cached list.
  }
}

/** Refetches `['groups', 'me']` with no observer needed, e.g. before /join opens Today on a group. */
export function useRefetchMyGroups(): () => Promise<void> {
  const repository = useGroupRepository('useRefetchMyGroups')
  const queryClient = useQueryClient()
  return useCallback(() => fetchMyGroups(queryClient, repository), [queryClient, repository])
}
