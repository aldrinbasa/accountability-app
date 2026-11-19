import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { BackendError, backendErrorCode } from '@/domain/error-codes'
import type { AddCommitmentInput, AddTaskInput, TaskDetails } from '@/domain/plan'
import { groupActivitiesKey } from '@/data/activities'
import {
  planKey,
  planPreviewKey,
  taskKey,
  todayKey,
  useAddCommitment,
  useAddTask,
  useDeleteTask,
  usePlanPreview,
  useRenameTask,
  useTask,
  useToday,
} from '@/data/plan'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  TEST_PLAN_PREVIEW,
  TEST_TODAY_SUMMARY,
  withBackend,
} from '@/test/fake-backend'

function setup(backend = createFakeBackend()) {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    withBackend(backend, children, undefined, queryClient)
  return { backend, queryClient, wrapper }
}

const INPUT: AddCommitmentInput = {
  groupId: TEST_GROUP.id,
  activity: { kind: 'preset', presetKey: 'gym' },
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
  endDate: null,
}

describe('plan data', () => {
  it('keys live under the story keys', () => {
    expect(todayKey('g1')).toEqual(['today', 'g1'])
    expect(planKey('g1')).toEqual(['plan', 'g1'])
    expect(planPreviewKey('g1', 3, null).slice(0, 2)).toEqual(['plan', 'g1'])
  })

  it('usePlanPreview reads plan_preview for the target and end date', async () => {
    const { backend, wrapper } = setup()
    const { result } = renderHook(() => usePlanPreview(TEST_GROUP.id, 3, '2026-12-04'), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(backend.planPreview).toHaveBeenCalledWith(TEST_GROUP.id, 3, '2026-12-04')
    expect(result.current.data).toEqual({ ...TEST_PLAN_PREVIEW, lastWeekTarget: 2 })
  })

  it('useAddCommitment sends the input and invalidates today, plan and group activities', async () => {
    const { backend, queryClient, wrapper } = setup()
    for (const key of [
      todayKey(TEST_GROUP.id),
      planKey(TEST_GROUP.id),
      groupActivitiesKey(TEST_GROUP.id),
    ]) {
      queryClient.setQueryData(key, [])
    }
    const { result } = renderHook(() => useAddCommitment(TEST_GROUP.id), { wrapper })
    let answer: unknown
    await act(async () => {
      answer = await result.current.mutateAsync(INPUT)
    })
    expect(backend.addCommitment).toHaveBeenCalledWith(INPUT)
    expect(answer).toEqual({ commitmentId: 'commitment-1', startsOn: TEST_PLAN_PREVIEW.startsOn })
    for (const key of [
      todayKey(TEST_GROUP.id),
      planKey(TEST_GROUP.id),
      groupActivitiesKey(TEST_GROUP.id),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }
  })

  it('schedule_type_locked refetches the group activities; other failures do not', async () => {
    const backend = createFakeBackend()
    const { queryClient, wrapper } = setup(backend)
    queryClient.setQueryData(groupActivitiesKey(TEST_GROUP.id), [])
    const { result } = renderHook(() => useAddCommitment(TEST_GROUP.id), { wrapper })

    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('network'))
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch(() => undefined)
    })
    expect(queryClient.getQueryState(groupActivitiesKey(TEST_GROUP.id))?.isInvalidated).toBe(false)

    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('schedule_type_locked'))
    await act(async () => {
      await result.current.mutateAsync(INPUT).catch(() => undefined)
    })
    expect(queryClient.getQueryState(groupActivitiesKey(TEST_GROUP.id))?.isInvalidated).toBe(true)
  })
})

const TASK_INPUT: AddTaskInput = {
  groupId: TEST_GROUP.id,
  activity: { kind: 'preset', presetKey: 'groceries' },
  name: 'Grocery run',
  deadline: '2026-11-22',
}

const TASK: TaskDetails = {
  commitmentId: 'task-1',
  groupId: TEST_GROUP.id,
  presetKey: 'groceries',
  customName: null,
  name: 'Grocery run',
  deadline: '2026-11-22',
  canDelete: true,
  canRename: true,
}

describe('task data (Story 2.4)', () => {
  it('useAddTask sends the input and invalidates today, plan and group activities', async () => {
    const { backend, queryClient, wrapper } = setup()
    for (const key of [
      todayKey(TEST_GROUP.id),
      planKey(TEST_GROUP.id),
      groupActivitiesKey(TEST_GROUP.id),
    ]) {
      queryClient.setQueryData(key, [])
    }
    const { result } = renderHook(() => useAddTask(TEST_GROUP.id), { wrapper })
    let answer: unknown
    await act(async () => {
      answer = await result.current.mutateAsync(TASK_INPUT)
    })
    expect(backend.addTask).toHaveBeenCalledWith(TASK_INPUT)
    expect(answer).toEqual({ commitmentId: 'commitment-1' })
    for (const key of [
      todayKey(TEST_GROUP.id),
      planKey(TEST_GROUP.id),
      groupActivitiesKey(TEST_GROUP.id),
    ]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }
  })

  it('invalid_deadline refetches the plan (the days moved on)', async () => {
    const backend = createFakeBackend()
    const { queryClient, wrapper } = setup(backend)
    queryClient.setQueryData(planKey(TEST_GROUP.id), [])
    vi.mocked(backend.addTask).mockRejectedValueOnce(new BackendError('invalid_deadline'))
    const { result } = renderHook(() => useAddTask(TEST_GROUP.id), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(TASK_INPUT).catch(() => undefined)
    })
    expect(queryClient.getQueryState(planKey(TEST_GROUP.id))?.isInvalidated).toBe(true)
  })

  it('useTask reads get_task under the plan key', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    const { wrapper } = setup(backend)
    const { result } = renderHook(() => useTask(TEST_GROUP.id, TASK.commitmentId), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(backend.getTask).toHaveBeenCalledWith(TASK.commitmentId)
    expect(result.current.data).toEqual(TASK)
    expect(taskKey(TEST_GROUP.id, 'c1').slice(0, 2)).toEqual(['plan', TEST_GROUP.id])
  })

  it('useRenameTask and useDeleteTask invalidate today and the plan', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    const { queryClient, wrapper } = setup(backend)
    queryClient.setQueryData(todayKey(TEST_GROUP.id), [])
    queryClient.setQueryData(planKey(TEST_GROUP.id), [])
    queryClient.setQueryData(taskKey(TEST_GROUP.id, TASK.commitmentId), TASK)
    const rename = renderHook(() => useRenameTask(TEST_GROUP.id), { wrapper })
    await act(async () => {
      await rename.result.current.mutateAsync({ commitmentId: TASK.commitmentId, name: 'Big shop' })
    })
    expect(backend.renameTask).toHaveBeenCalledWith(TASK.commitmentId, 'Big shop')
    expect(queryClient.getQueryState(todayKey(TEST_GROUP.id))?.isInvalidated).toBe(true)

    queryClient.setQueryData(todayKey(TEST_GROUP.id), [])
    queryClient.setQueryData(planKey(TEST_GROUP.id), [])
    const remove = renderHook(() => useDeleteTask(TEST_GROUP.id), { wrapper })
    await act(async () => {
      await remove.result.current.mutateAsync(TASK.commitmentId)
    })
    expect(backend.deleteTask).toHaveBeenCalledWith(TASK.commitmentId)
    expect(queryClient.getQueryState(todayKey(TEST_GROUP.id))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(planKey(TEST_GROUP.id))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(taskKey(TEST_GROUP.id, TASK.commitmentId))).toBeUndefined()
  })

  it('task_locked on delete refetches the plan', async () => {
    const backend = createFakeBackend(undefined, { tasks: [{ ...TASK, canDelete: false }] })
    const { queryClient, wrapper } = setup(backend)
    queryClient.setQueryData(planKey(TEST_GROUP.id), [])
    const { result } = renderHook(() => useDeleteTask(TEST_GROUP.id), { wrapper })
    let code: unknown
    await act(async () => {
      await result.current.mutateAsync(TASK.commitmentId).catch((error: unknown) => {
        code = backendErrorCode(error)
      })
    })
    expect(code).toBe('task_locked')
    expect(queryClient.getQueryState(planKey(TEST_GROUP.id))?.isInvalidated).toBe(true)
  })

  it('task_locked on rename and not_found on delete refetch today and the plan', async () => {
    const backend = createFakeBackend(undefined, { tasks: [{ ...TASK, canRename: false }] })
    const { queryClient, wrapper } = setup(backend)
    const keys = [todayKey(TEST_GROUP.id), planKey(TEST_GROUP.id)]
    for (const key of keys) queryClient.setQueryData(key, [])
    const rename = renderHook(() => useRenameTask(TEST_GROUP.id), { wrapper })
    await act(async () => {
      await rename.result.current
        .mutateAsync({ commitmentId: TASK.commitmentId, name: 'Big shop' })
        .catch(() => undefined)
    })
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)

    for (const key of keys) queryClient.setQueryData(key, [])
    const remove = renderHook(() => useDeleteTask(TEST_GROUP.id), { wrapper })
    let code: unknown
    await act(async () => {
      await remove.result.current.mutateAsync('missing').catch((error: unknown) => {
        code = backendErrorCode(error)
      })
    })
    expect(code).toBe('not_found')
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('useToday reads both Today functions under one key', async () => {
    const items = [
      {
        commitmentId: 'c1',
        kind: 'commitment' as const,
        section: 'due_today' as const,
        presetKey: 'gym',
        customName: null,
        activityName: 'Gym',
        name: null,
        scheduleType: 'fixed_days' as const,
        days: [1, 3, 5],
        target: 3,
        counted: 0,
        deadline: null,
        startsOn: null,
        canDelete: false,
      },
    ]
    const backend = createFakeBackend(undefined, { today: { [TEST_GROUP.id]: { items } } })
    const { queryClient, wrapper } = setup(backend)
    const { result } = renderHook(() => useToday(TEST_GROUP.id), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ items, summary: TEST_TODAY_SUMMARY })
    expect(backend.getTodayItems).toHaveBeenCalledWith(TEST_GROUP.id)
    expect(backend.getTodaySummary).toHaveBeenCalledWith(TEST_GROUP.id)
    expect(queryClient.getQueryData(todayKey(TEST_GROUP.id))).toEqual(result.current.data)
  })

  it('useToday fails when either read fails', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.getTodaySummary).mockRejectedValue(new BackendError('network'))
    const { wrapper } = setup(backend)
    const { result } = renderHook(() => useToday(TEST_GROUP.id), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 3000 })
    expect(backendErrorCode(result.current.error)).toBe('network')
  })
})
