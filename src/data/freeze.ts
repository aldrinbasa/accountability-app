import { useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  FreezeOption,
  FreezeRequest,
  RequestFreezeInput,
  RequestFreezeResult,
} from '@/domain/freeze'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { todayKey } from '@/data/plan'
import { retryOnline } from '@/data/query-client'
import { useInvalidateVoteOutcomeViews } from '@/data/vote-outcome'

/**
 * `['today', groupId, 'freeze']`: the caller's freeze options and requests. Under Today's prefix, so
 * every Today invalidation (a check-in withdrawing a pending freeze, a plan write, a ruling)
 * refreshes them too.
 */
export function freezeKey(groupId: string) {
  return [...todayKey(groupId), 'freeze'] as const
}

/** `['today', groupId, 'freeze', 'options']`: `my_freeze_options`. */
export function freezeOptionsKey(groupId: string) {
  return [...freezeKey(groupId), 'options'] as const
}

/** `['today', groupId, 'freeze', 'requests']`: `my_freeze_requests`. */
export function freezeRequestsKey(groupId: string) {
  return [...freezeKey(groupId), 'requests'] as const
}

export interface FreezeRepository {
  options(groupId: string): Promise<FreezeOption[]>
  requests(groupId: string): Promise<FreezeRequest[]>
  request(input: RequestFreezeInput): Promise<RequestFreezeResult>
}

/** Freeze reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createFreezeRepository(backend: BackendPort): FreezeRepository {
  return {
    options: (groupId) => backend.listFreezeOptions(groupId),
    requests: (groupId) => backend.listMyFreezeRequests(groupId),
    request: (input) => backend.requestFreeze(input),
  }
}

function useFreezeRepository(hook: string): FreezeRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createFreezeRepository(backend), [backend])
}

/**
 * What the member may freeze now in the group (`my_freeze_options`). Refetches when a screen with it
 * opens and on app focus (windows move with the clock); retries once.
 */
export function useFreezeOptions(groupId: string, enabled = true) {
  const repository = useFreezeRepository('useFreezeOptions')
  return useQuery({
    queryKey: freezeOptionsKey(groupId),
    queryFn: () => repository.options(groupId),
    enabled,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/** The member's pending and approved freeze requests in the group (`my_freeze_requests`). */
export function useMyFreezes(groupId: string) {
  const repository = useFreezeRepository('useMyFreezes')
  return useQuery({
    queryKey: freezeRequestsKey(groupId),
    queryFn: () => repository.requests(groupId),
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/**
 * Everything a freeze request (or its solo approval, or its outcome) can change in a group: the
 * shared vote-outcome list (`@/data/vote-outcome`), the same one a challenge ruling refreshes.
 */
export function useInvalidateFreezeViews(groupId: string): () => void {
  return useInvalidateVoteOutcomeViews(groupId)
}

/**
 * `request_freeze` (Story 5.4). Never queued: offline is the Sheet's Inline retry. On success
 * refetches the group's views (a group of one approves at once, so the score and streak move).
 */
export function useRequestFreeze(groupId: string) {
  const repository = useFreezeRepository('useRequestFreeze')
  const invalidate = useInvalidateFreezeViews(groupId)
  return useMutation({
    mutationFn: (input: RequestFreezeInput) => repository.request(input),
    onSuccess: () => invalidate(),
  })
}
