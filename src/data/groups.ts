import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trimGroupName, type MyGroup } from '@/domain/groups'
import type { Profile } from '@/domain/profile'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { deviceTimeZone, MY_PROFILE_KEY } from '@/data/profile'

/** The signed-in member's current groups. Sign-out clears the whole query cache, this key included. */
export const MY_GROUPS_KEY = ['groups', 'me'] as const

export interface GroupRepository {
  listMine(): Promise<MyGroup[]>
  create(name: string): Promise<string>
}

/** Group reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createGroupRepository(backend: BackendPort): GroupRepository {
  return {
    listMine: () => backend.listMyGroups(),
    create: (name) => backend.createGroup(name),
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
