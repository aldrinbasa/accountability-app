import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { openVotesFor, type OpenVotesData } from '@/domain/open-votes'
import type { BackendPort } from '@/ports/backend-port'
import { useAuthSession } from '@/data/auth-session'
import { useBackendContext } from '@/data/backend-context-value'
import { feedKey } from '@/data/feed'
import { retryOnline } from '@/data/query-client'

/**
 * `['feed', groupId, 'open-votes']`: Today's "Open votes" (Story 5.6). Under the Feed prefix, so a
 * post, a challenge, a freeze request or a refused vote refreshes it with the wall.
 */
export function openVotesKey(groupId: string) {
  return [...feedKey(groupId), 'open-votes'] as const
}

export interface OpenVotesRepository {
  /** The votes the reader can still cast, nearest deadline first, decided at `now`. */
  list(groupId: string, userId: string, now: Date): Promise<OpenVotesData>
}

/** Open votes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createOpenVotesRepository(backend: BackendPort): OpenVotesRepository {
  return {
    async list(groupId, userId, now) {
      const items = await backend.listOpenVotes(groupId)
      return { openVotes: openVotesFor(items, { userId, now }) }
    },
  }
}

/**
 * The group's open votes waiting for the reader. Picked when fetched: a card the reader just voted
 * on keeps its voted state until a fetch after its 6 s window (`useCastVote` schedules one).
 * Refetches when Today opens and on app focus; retries once.
 */
export function useOpenVotes(groupId: string) {
  const { backend } = useBackendContext('useOpenVotes')
  const session = useAuthSession()
  const userId = session.user?.id ?? ''
  const repository = useMemo(() => createOpenVotesRepository(backend), [backend])
  return useQuery({
    queryKey: openVotesKey(groupId),
    queryFn: () => repository.list(groupId, userId, new Date()),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}
