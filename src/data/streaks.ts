import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Streak } from '@/domain/streaks'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { retryOnline } from '@/data/query-client'

/** `['streaks', groupId]`: `get_streaks` for a group (invalidated after each confirmed post). */
export function streaksKey(groupId: string) {
  return ['streaks', groupId] as const
}

export interface StreaksRepository {
  streaks(groupId: string): Promise<Streak[]>
}

/** Streak reads over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createStreaksRepository(backend: BackendPort): StreaksRepository {
  return { streaks: (groupId) => backend.getStreaks(groupId) }
}

/**
 * Every commitment's current streak in the group (Story 4.2), for Today now and the Board and
 * profiles later. Cached data shows at once; refetches when a screen using it opens (`'always'`)
 * and on app focus, and the outbox invalidates it after every confirmed post. Retries once.
 */
export function useStreaks(groupId: string) {
  const { backend } = useBackendContext('useStreaks')
  const repository = useMemo(() => createStreaksRepository(backend), [backend])
  return useQuery({
    queryKey: streaksKey(groupId),
    queryFn: () => repository.streaks(groupId),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}
