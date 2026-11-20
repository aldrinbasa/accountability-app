import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GoalPeriod, GroupGoal } from '@/domain/goal'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { memberProfileGroupKey } from '@/data/member-profile'
import { retryOnline } from '@/data/query-client'

/** `['groupGoal', groupId]`: `get_group_goal` (AD-12). */
export function groupGoalKey(groupId: string) {
  return ['groupGoal', groupId] as const
}

export interface GoalInput {
  target: number
  period: GoalPeriod
}

export interface GoalRepository {
  goal(groupId: string): Promise<GroupGoal>
  save(groupId: string, input: GoalInput): Promise<void>
}

/** Goal reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createGoalRepository(backend: BackendPort): GoalRepository {
  return {
    goal: (groupId) => backend.getGroupGoal(groupId),
    save: (groupId, { target, period }) => backend.setGroupGoal(groupId, target, period),
  }
}

function useRepository(hook: string) {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createGoalRepository(backend), [backend])
}

/**
 * The group goal (Story 4.7) under `['groupGoal', groupId]`. Cached data shows at once; refetches
 * when a screen using it opens and on app focus; the outbox invalidates it after every confirmed
 * post, plan writes and a saved goal do too. Retries once.
 */
export function useGroupGoal(groupId: string) {
  const repository = useRepository('useGroupGoal')
  return useQuery({
    queryKey: groupGoalKey(groupId),
    queryFn: () => repository.goal(groupId),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/**
 * `set_group_goal` for a group (admin only). On success invalidates the goal and the group's
 * profiles (Team Player's pending seal follows the goal).
 */
export function useSetGroupGoal(groupId: string) {
  const repository = useRepository('useSetGroupGoal')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GoalInput) => repository.save(groupId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: groupGoalKey(groupId) })
      void queryClient.invalidateQueries({ queryKey: memberProfileGroupKey(groupId) })
    },
  })
}
