import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { backendErrorCode } from '@/domain/error-codes'
import {
  trimGroupName,
  type EndedMembership,
  type GroupMember,
  type Invite,
  type InvitePreview,
  type MyGroup,
  type MyGroupsSnapshot,
} from '@/domain/groups'
import type { Profile } from '@/domain/profile'
import { chooseZone, type TimeZoneState } from '@/domain/time-zones'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { setLastSeenCount } from '@/data/group-notices'
import { deviceTimeZone, MY_PROFILE_KEY } from '@/data/profile'
import { retryOnline } from '@/data/query-client'

/**
 * The signed-in member's groups: a `MyGroupsSnapshot` (current groups plus the ones they are no
 * longer in). Sign-out clears the whole query cache, this key included.
 */
export const MY_GROUPS_KEY = ['groups', 'me'] as const

/** `['members', groupId]`: a group's current members (the admin's Members list). */
export function membersKey(groupId: string) {
  return ['members', groupId] as const
}

/** `['invite', groupId]`: the admin's current invite for a group. */
export function inviteKey(groupId: string) {
  return ['invite', groupId] as const
}

/** `['invite', 'code']`: the prefix of every invite preview. */
export const INVITE_PREVIEWS_KEY = ['invite', 'code'] as const

/** `['invite', 'code', code]`: what an invite code leads to (the join screen). */
export function invitePreviewKey(code: string) {
  return [...INVITE_PREVIEWS_KEY, code] as const
}

export interface GroupRepository {
  listMine(): Promise<MyGroupsSnapshot>
  create(name: string): Promise<string>
  invite(groupId: string, fresh: boolean): Promise<Invite>
  previewInvite(code: string): Promise<InvitePreview>
  join(code: string): Promise<string>
  members(groupId: string): Promise<GroupMember[]>
  leave(groupId: string): Promise<void>
  remove(groupId: string, userId: string): Promise<void>
  setTimeZone(groupId: string, timeZone: string): Promise<TimeZoneState>
}

/** Group reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createGroupRepository(backend: BackendPort): GroupRepository {
  return {
    listMine: () => backend.listMyGroups(),
    create: (name) => backend.createGroup(name),
    invite: (groupId, fresh) => backend.createInvite(groupId, fresh),
    previewInvite: (code) => backend.getInvite(code),
    join: (code) => backend.joinGroup(code),
    members: (groupId) => backend.listMembers(groupId),
    leave: (groupId) => backend.leaveGroup(groupId),
    remove: (groupId, userId) => backend.removeMember(groupId, userId),
    setTimeZone: (groupId, timeZone) => backend.setTimeZone(timeZone, groupId),
  }
}

function useGroupRepository(hook: string): GroupRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createGroupRepository(backend), [backend])
}

const selectGroups = (snapshot: MyGroupsSnapshot): MyGroup[] => snapshot.groups
const selectEnded = (snapshot: MyGroupsSnapshot): EndedMembership[] => snapshot.ended

/** `['groups', 'me']`: current groups with role and member count. Retries once, refetches on focus. */
export function useMyGroups() {
  const repository = useGroupRepository('useMyGroups')
  return useQuery({
    queryKey: MY_GROUPS_KEY,
    queryFn: () => repository.listMine(),
    select: selectGroups,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/** `['groups', 'me']`: the groups the member is no longer in (the same read as `useMyGroups`). */
export function useEndedMemberships() {
  const repository = useGroupRepository('useEndedMemberships')
  return useQuery({
    queryKey: MY_GROUPS_KEY,
    queryFn: () => repository.listMine(),
    select: selectEnded,
    retry: retryOnline(1),
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
        pendingTimeZone: null,
        pendingWeekStart: null,
        role: 'admin',
        joinedAt: new Date().toISOString(),
        memberCount: 1,
      }
      await queryClient.cancelQueries({ queryKey: MY_GROUPS_KEY })
      queryClient.setQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY, (snapshot) => ({
        groups: [...(snapshot?.groups ?? []).filter((group) => group.id !== groupId), provisional],
        ended: snapshot?.ended ?? [],
      }))
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
    retry: retryOnline(1),
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
 * reads `member` (the join screen trusts that only while it stays open; a leave drops it).
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

/**
 * `['members', groupId]`: the group's current members with display names, in handover order. Only
 * for the admin's Members list (`enabled`). Retries once.
 */
export function useMembers(groupId: string, enabled: boolean) {
  const repository = useGroupRepository('useMembers')
  return useQuery({
    queryKey: membersKey(groupId),
    queryFn: () => repository.members(groupId),
    enabled,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/** `not_member` after a leave or remove means the membership has already ended: done, not failed. */
async function unlessEndedAlready(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (backendErrorCode(error) === 'not_member') return
    throw error
  }
}

/**
 * `leave_group`. Resolves once `['groups', 'me']` has been refetched (observer or not), so the caller
 * can move focus on with `remainingGroups`. The group's members and invite leave the cache.
 * `onLeft` runs as soon as the server confirms, before that refetch drops the group, so a screen
 * showing the group can mark itself as leaving first.
 */
export function useLeaveGroup(groupId: string, onLeft?: () => void) {
  const repository = useGroupRepository('useLeaveGroup')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => unlessEndedAlready(() => repository.leave(groupId)),
    onSuccess: async () => {
      onLeft?.()
      await fetchMyGroups(queryClient, repository)
      queryClient.removeQueries({ queryKey: membersKey(groupId) })
      queryClient.removeQueries({ queryKey: inviteKey(groupId) })
      // A preview marked `member` by an earlier join would bounce a rejoin to Today.
      queryClient.removeQueries({ queryKey: INVITE_PREVIEWS_KEY })
    },
  })
}

/** The member's cached current groups without `leftId` (left out even if the refetch failed). */
export function remainingGroups(queryClient: QueryClient, leftId: string): MyGroup[] {
  const snapshot = queryClient.getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)
  return (snapshot?.groups ?? []).filter((group) => group.id !== leftId)
}

/**
 * `remove_member` (admin). Drops the member from `['members', groupId]` at once, then resolves once
 * the members and `['groups', 'me']` are refetched. The group's last-seen member count is set to the
 * new count, so an admin who removes the last other member is not told "Everyone else left".
 */
export function useRemoveMember(groupId: string) {
  const repository = useGroupRepository('useRemoveMember')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => unlessEndedAlready(() => repository.remove(groupId, userId)),
    onSuccess: async (_result, userId) => {
      queryClient.setQueryData<GroupMember[]>(membersKey(groupId), (members) =>
        members?.filter((member) => member.userId !== userId),
      )
      await Promise.all([
        queryClient
          .fetchQuery({
            queryKey: membersKey(groupId),
            queryFn: () => repository.members(groupId),
            staleTime: 0,
          })
          .catch(() => undefined),
        fetchMyGroups(queryClient, repository),
      ])
      const group = queryClient
        .getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)
        ?.groups.find((g) => g.id === groupId)
      if (group) setLastSeenCount(groupId, group.memberCount)
    },
  })
}

function updateGroup(
  snapshot: MyGroupsSnapshot | undefined,
  groupId: string,
  change: (group: MyGroup) => MyGroup,
): MyGroupsSnapshot | undefined {
  if (!snapshot) return snapshot
  return {
    ...snapshot,
    groups: snapshot.groups.map((group) => (group.id === groupId ? change(group) : group)),
  }
}

/**
 * `set_time_zone` for a group's zone (admin). Optimistic: the group in `['groups', 'me']` shows the
 * choice at once and goes back to what it was if the call fails; success writes the server's zones.
 */
export function useSetGroupTimeZone(groupId: string) {
  const repository = useGroupRepository('useSetGroupTimeZone')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (timeZone: string) => repository.setTimeZone(groupId, timeZone),
    onMutate: async (timeZone) => {
      await queryClient.cancelQueries({ queryKey: MY_GROUPS_KEY })
      const previous = queryClient
        .getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)
        ?.groups.find((group) => group.id === groupId)
      if (previous) {
        queryClient.setQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY, (snapshot) =>
          updateGroup(snapshot, groupId, (group) => chooseZone(group, timeZone)),
        )
      }
      return { previous }
    },
    onError: (_error, _timeZone, context) => {
      const previous = context?.previous
      if (!previous) return
      queryClient.setQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY, (snapshot) =>
        updateGroup(snapshot, groupId, (group) => ({
          ...group,
          timeZone: previous.timeZone,
          pendingTimeZone: previous.pendingTimeZone,
          pendingWeekStart: previous.pendingWeekStart,
        })),
      )
    },
    onSuccess: async (state) => {
      await queryClient.cancelQueries({ queryKey: MY_GROUPS_KEY })
      queryClient.setQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY, (snapshot) =>
        updateGroup(snapshot, groupId, (group) => ({ ...group, ...state })),
      )
    },
  })
}
