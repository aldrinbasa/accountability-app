import { useMemo } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { backendErrorCode } from '@/domain/error-codes'
import type {
  CommitmentDetails,
  MyPlanItem,
  UpdateCommitmentInput,
  UpdateCommitmentResult,
} from '@/domain/my-plan'
import type {
  AddCommitmentInput,
  AddCommitmentResult,
  AddTaskInput,
  AddTaskResult,
  PlanPreview,
  TaskDetails,
} from '@/domain/plan'
import type { TodayData } from '@/domain/today'
import type { BackendPort } from '@/ports/backend-port'
import { groupActivitiesKey } from '@/data/activities'
import { boardGroupKey } from '@/data/board'
import { useBackendContext } from '@/data/backend-context-value'
import { retryOnline } from '@/data/query-client'

/** `['today', groupId]`: Today's rows and summary for a group (plan writes invalidate it). */
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

/** `['plan', groupId, 'task', commitmentId]`: `get_task` for edit mode (plan writes refetch it). */
export function taskKey(groupId: string, commitmentId: string) {
  return [...planKey(groupId), 'task', commitmentId] as const
}

/** `['plan', groupId, 'commitment', commitmentId]`: `get_commitment` for edit mode. */
export function commitmentKey(groupId: string, commitmentId: string) {
  return [...planKey(groupId), 'commitment', commitmentId] as const
}

export interface PlanRepository {
  preview(groupId: string, target: number | null, endDate: string | null): Promise<PlanPreview>
  addCommitment(input: AddCommitmentInput): Promise<AddCommitmentResult>
  addTask(input: AddTaskInput): Promise<AddTaskResult>
  getTask(commitmentId: string): Promise<TaskDetails>
  renameTask(commitmentId: string, name: string): Promise<void>
  deleteTask(commitmentId: string): Promise<void>
  today(groupId: string): Promise<TodayData>
  myPlan(groupId: string): Promise<MyPlanItem[]>
  getCommitment(commitmentId: string): Promise<CommitmentDetails>
  updateCommitment(input: UpdateCommitmentInput): Promise<UpdateCommitmentResult>
  endCommitment(commitmentId: string): Promise<void>
}

/** Plan reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createPlanRepository(backend: BackendPort): PlanRepository {
  return {
    preview: (groupId, target, endDate) => backend.planPreview(groupId, target, endDate),
    addCommitment: (input) => backend.addCommitment(input),
    addTask: (input) => backend.addTask(input),
    getTask: (commitmentId) => backend.getTask(commitmentId),
    renameTask: (commitmentId, name) => backend.renameTask(commitmentId, name),
    deleteTask: (commitmentId) => backend.deleteTask(commitmentId),
    today: async (groupId) => {
      const [items, summary] = await Promise.all([
        backend.getTodayItems(groupId),
        backend.getTodaySummary(groupId),
      ])
      return { items, summary }
    },
    myPlan: (groupId) => backend.getMyPlan(groupId),
    getCommitment: (commitmentId) => backend.getCommitment(commitmentId),
    updateCommitment: (input) => backend.updateCommitment(input),
    endCommitment: async (commitmentId) => {
      await backend.endCommitment(commitmentId)
    },
  }
}

function usePlanRepository(hook: string): PlanRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createPlanRepository(backend), [backend])
}

/**
 * Today for a group: `get_today_items` and `get_today_summary` together under `['today', groupId]`.
 * Cached data shows at once and refreshes silently on app focus and when Today opens (the query
 * client's defaults). Retries once.
 */
export function useToday(groupId: string) {
  const repository = usePlanRepository('useToday')
  return useQuery({
    queryKey: todayKey(groupId),
    queryFn: () => repository.today(groupId),
    retry: retryOnline(1),
    retryDelay: 500,
  })
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
    retry: retryOnline(1),
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

/** The task changed under the member (its day started, or it is gone): Today and the plan are stale. */
function isStaleTaskError(error: unknown): boolean {
  const code = backendErrorCode(error)
  return code === 'task_locked' || code === 'not_found'
}

/**
 * Invalidates what every task write changes: Today's items, the member's plan and the board (a task
 * counts this week, so it moves the weekly points, Story 4.1).
 */
function invalidatePlan(queryClient: QueryClient, groupId: string) {
  void queryClient.invalidateQueries({ queryKey: todayKey(groupId) })
  void queryClient.invalidateQueries({ queryKey: planKey(groupId) })
  void queryClient.invalidateQueries({ queryKey: boardGroupKey(groupId) })
}

/**
 * `get_task` for the Plan sheet's edit mode: the task's name, activity, deadline and the server's
 * `can_delete` / `can_rename`. Retries other failures than `not_found` once.
 */
export function useTask(groupId: string, commitmentId: string) {
  const repository = usePlanRepository('useTask')
  return useQuery({
    queryKey: taskKey(groupId, commitmentId),
    queryFn: () => repository.getTask(commitmentId),
    // A task that is gone stays gone: retry only other failures, once.
    retry: retryOnline(1, (error) => backendErrorCode(error) === 'not_found'),
    retryDelay: 500,
  })
}

/**
 * `add_task`. On success invalidates `['today', groupId]`, `['plan', groupId]` and
 * `['groupActivities', groupId]` (a first pick adds the activity to the group's list). An
 * `invalid_deadline` answer (the member's day moved on) refetches the plan, so the days refresh.
 */
export function useAddTask(groupId: string) {
  const repository = usePlanRepository('useAddTask')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AddTaskInput) => repository.addTask(input),
    onSuccess: () => {
      invalidatePlan(queryClient, groupId)
      void queryClient.invalidateQueries({ queryKey: groupActivitiesKey(groupId) })
    },
    onError: (error) => {
      if (backendErrorCode(error) === 'invalid_deadline') {
        void queryClient.invalidateQueries({ queryKey: planKey(groupId) })
      }
    },
  })
}

/** `rename_task`. Invalidates today and the plan on success, `task_locked` and `not_found`. */
export function useRenameTask(groupId: string) {
  const repository = usePlanRepository('useRenameTask')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ commitmentId, name }: { commitmentId: string; name: string }) =>
      repository.renameTask(commitmentId, name),
    onSuccess: () => invalidatePlan(queryClient, groupId),
    onError: (error) => {
      if (isStaleTaskError(error)) invalidatePlan(queryClient, groupId)
    },
  })
}

/**
 * `delete_task`. Invalidates today and the plan on success. A `task_locked` (the deadline day has
 * started) or `not_found` answer refetches them too, so nothing keeps offering the delete.
 */
export function useDeleteTask(groupId: string) {
  const repository = usePlanRepository('useDeleteTask')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commitmentId: string) => repository.deleteTask(commitmentId),
    onSuccess: (_data, commitmentId) => {
      // The task is gone: drop its edit-mode read instead of refetching a not_found.
      queryClient.removeQueries({ queryKey: taskKey(groupId, commitmentId) })
      invalidatePlan(queryClient, groupId)
    },
    onError: (error) => {
      if (isStaleTaskError(error)) invalidatePlan(queryClient, groupId)
    },
  })
}

/**
 * My plan for a group: `get_my_plan` under `['plan', groupId]`, so every plan write refreshes it.
 * Rows come with the server's section, state and dates. Retries once.
 */
export function useMyPlan(groupId: string) {
  const repository = usePlanRepository('useMyPlan')
  return useQuery({
    queryKey: planKey(groupId),
    queryFn: () => repository.myPlan(groupId),
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/**
 * `get_commitment` for the Plan sheet's edit mode: the activity, schedule type, latest version,
 * `changes_from`, `min_end_date`, state and `can_edit`. Retries other failures than `not_found` once.
 */
export function useCommitment(groupId: string, commitmentId: string) {
  const repository = usePlanRepository('useCommitment')
  return useQuery({
    queryKey: commitmentKey(groupId, commitmentId),
    queryFn: () => repository.getCommitment(commitmentId),
    retry: retryOnline(1, (error) => backendErrorCode(error) === 'not_found'),
    retryDelay: 500,
  })
}

/** The commitment changed under the member (ended, or gone): Today and the plan are stale. */
function isStaleCommitmentError(error: unknown): boolean {
  const code = backendErrorCode(error)
  return code === 'commitment_ended' || code === 'not_found'
}

/** Invalidates what every commitment write changes: Today, the plan and the activity locks. */
function invalidateCommitment(queryClient: QueryClient, groupId: string) {
  invalidatePlan(queryClient, groupId)
  void queryClient.invalidateQueries({ queryKey: groupActivitiesKey(groupId) })
}

/**
 * `update_commitment`. Invalidates `['today', groupId]`, `['plan', groupId]` and
 * `['groupActivities', groupId]` on success, and on `commitment_ended` / `not_found` (stale rows).
 */
export function useUpdateCommitment(groupId: string) {
  const repository = usePlanRepository('useUpdateCommitment')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateCommitmentInput) => repository.updateCommitment(input),
    onSuccess: (_data, input) => {
      // Drop the edit-mode read, so a reopened sheet waits for the saved values instead of
      // seeding its form from the pre-edit cache.
      queryClient.removeQueries({ queryKey: commitmentKey(groupId, input.commitmentId) })
      invalidateCommitment(queryClient, groupId)
    },
    onError: (error) => {
      if (isStaleCommitmentError(error)) invalidateCommitment(queryClient, groupId)
    },
  })
}

/**
 * `end_commitment`. Invalidates `['today', groupId]`, `['plan', groupId]` and
 * `['groupActivities', groupId]` (the type lock may be released) on success, and on
 * `commitment_ended` / `not_found`.
 */
export function useEndCommitment(groupId: string) {
  const repository = usePlanRepository('useEndCommitment')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commitmentId: string) => repository.endCommitment(commitmentId),
    onSuccess: (_data, commitmentId) => {
      queryClient.removeQueries({ queryKey: commitmentKey(groupId, commitmentId) })
      invalidateCommitment(queryClient, groupId)
    },
    onError: (error) => {
      if (isStaleCommitmentError(error)) invalidateCommitment(queryClient, groupId)
    },
  })
}
