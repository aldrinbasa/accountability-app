import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateChallengeResult, OverturnResult } from '@/domain/challenge'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { boardGroupKey, groupWeekKey } from '@/data/board'
import { feedKey } from '@/data/feed'
import { groupGoalKey } from '@/data/goal'
import { MY_GROUPS_KEY } from '@/data/groups'
import { memberProfileGroupKey } from '@/data/member-profile'
import { todayKey } from '@/data/plan'
import { streaksKey } from '@/data/streaks'

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
 * Everything a challenge (or a ruling it caused) can change in a group: Today, the Feed (wall,
 * anchored pages and Friends today), the board and its week, streaks, profiles, the group goal, and
 * the groups list (its member count picks the 2-person or 3+ copy and hides Challenge when alone).
 * Server actions never queue (AD-12): this runs after the server answered.
 */
export function useInvalidateChallengeViews(groupId: string): () => void {
  const queryClient = useQueryClient()
  return () => {
    for (const queryKey of [
      todayKey(groupId),
      feedKey(groupId),
      boardGroupKey(groupId),
      groupWeekKey(groupId),
      streaksKey(groupId),
      memberProfileGroupKey(groupId),
      groupGoalKey(groupId),
      MY_GROUPS_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }
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
 * so the Feed, Today, the board, streaks, profiles and the goal move).
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
