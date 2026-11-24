import { useMemo } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { CreateChallengeResult, OverturnResult } from '@/domain/challenge'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { useInvalidateVoteOutcomeViews } from '@/data/vote-outcome'

export interface ChallengeRepository {
  create(checkinId: string): Promise<CreateChallengeResult>
  overturn(challengeId: string): Promise<OverturnResult>
}

/** Challenge writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createChallengeRepository(backend: BackendPort): ChallengeRepository {
  return {
    create: (checkinId) => backend.createChallenge(checkinId),
    overturn: (challengeId) => backend.overturnRuling(challengeId),
  }
}

/**
 * Everything a challenge (or a ruling it caused, or an overturn) can change in a group: the shared
 * vote-outcome list (`@/data/vote-outcome`), the same one a freeze outcome refreshes.
 */
export function useInvalidateChallengeViews(groupId: string): () => void {
  return useInvalidateVoteOutcomeViews(groupId)
}

/**
 * `create_challenge` for a check-in of the group (Story 5.1). Never queued: offline is the caller's
 * Inline retry. On success refetches the group's views (a group of two rules Fake at once, so
 * points, streaks and the board move).
 */
export function useCreateChallenge(groupId: string) {
  const { backend } = useBackendContext('useCreateChallenge')
  const repository = useMemo(() => createChallengeRepository(backend), [backend])
  const invalidate = useInvalidateChallengeViews(groupId)
  return useMutation({
    mutationFn: (checkinId: string) => repository.create(checkinId),
    onSuccess: () => invalidate(),
  })
}

/**
 * `overturn_ruling` for a Fake ruling of the group (Story 5.3), the admin only. Never queued:
 * offline is the caller's toast. On success refetches the group's views (the check-in counts again,
 * and the server cancels any freeze on its session, so the Feed, Today, My plan, the board,
 * streaks, profiles and the goal move).
 */
export function useOverturnRuling(groupId: string) {
  const { backend } = useBackendContext('useOverturnRuling')
  const repository = useMemo(() => createChallengeRepository(backend), [backend])
  const invalidate = useInvalidateChallengeViews(groupId)
  return useMutation({
    mutationFn: (challengeId: string) => repository.overturn(challengeId),
    onSuccess: () => invalidate(),
  })
}
