import { useMemo } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { backendErrorCode } from '@/domain/error-codes'
import type { AddCommitmentInput, AddCommitmentResult, PlanPreview } from '@/domain/plan'
import type { BackendPort } from '@/ports/backend-port'
import { groupActivitiesKey } from '@/data/activities'
import { useBackendContext } from '@/data/backend-context-value'

/** `['today', groupId]`: Today's items for a group (Story 2.5 reads it; plan writes invalidate it). */
export function todayKey(groupId: string) {
  return ['today', groupId] as const
}

/** `['plan', groupId]`: the member's plan in a group; the preview lives under it too. */
export function planKey(groupId: string) {
  return ['plan', groupId] as const
}

/** `['plan', groupId, 'preview', target, endDate]`: `plan_preview` for the sheet's inputs. */
export function planPreviewKey(groupId: string, target: number | null, endDate: string | null) {
  return [...planKey(groupId), 'preview', target, endDate] as const
}

export interface PlanRepository {
  preview(groupId: string, target: number | null, endDate: string | null): Promise<PlanPreview>
  addCommitment(input: AddCommitmentInput): Promise<AddCommitmentResult>
}

/** Plan reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createPlanRepository(backend: BackendPort): PlanRepository {
  return {
    preview: (groupId, target, endDate) => backend.planPreview(groupId, target, endDate),
    addCommitment: (input) => backend.addCommitment(input),
  }
}

function usePlanRepository(hook: string): PlanRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createPlanRepository(backend), [backend])
}

/**
 * `plan_preview` for the Plan sheet: the server's dates and the pro-rated last week for `target`
 * (times per week only, else null) and `endDate`. Keeps the previous answer on screen while a new
 * one loads (`isPlaceholderData`). Retries once.
 */
export function usePlanPreview(groupId: string, target: number | null, endDate: string | null) {
  const repository = usePlanRepository('usePlanPreview')
  return useQuery({
    queryKey: planPreviewKey(groupId, target, endDate),
    queryFn: () => repository.preview(groupId, target, endDate),
    placeholderData: keepPreviousData,
    retry: 1,
    retryDelay: 500,
  })
}

/**
 * `add_commitment`. On success invalidates `['today', groupId]`, `['plan', groupId]` and
 * `['groupActivities', groupId]` (the activity may now be locked to a type). A
 * `schedule_type_locked` answer refetches `['groupActivities', groupId]` so the sheet shows the lock.
 * Plan writes need the network: nothing is queued offline.
 */
export function useAddCommitment(groupId: string) {
  const repository = usePlanRepository('useAddCommitment')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddCommitmentInput) => repository.addCommitment(input),
    // Not awaited: the sheet closes at once and the refetches catch up behind it.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: todayKey(groupId) })
      void queryClient.invalidateQueries({ queryKey: planKey(groupId) })
      void queryClient.invalidateQueries({ queryKey: groupActivitiesKey(groupId) })
    },
    onError: (error) => {
      if (backendErrorCode(error) === 'schedule_type_locked') {
        void queryClient.invalidateQueries({ queryKey: groupActivitiesKey(groupId) })
      }
    },
  })
}
