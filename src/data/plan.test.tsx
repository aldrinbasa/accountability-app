import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { BackendError, backendErrorCode } from '@/domain/error-codes'
import type { AddCommitmentInput, AddTaskInput, TaskDetails } from '@/domain/plan'
import { groupActivitiesKey } from '@/data/activities'
import {
  commitmentKey,
  planKey,
  planPreviewKey,
  taskKey,
  todayKey,
  useAddCommitment,
  useAddTask,
  useCommitment,
  useDeleteTask,
  useEndCommitment,
  useMyPlan,
  usePlanPreview,
  useRenameTask,
  useTask,
  useToday,
  useUpdateCommitment,
} from '@/data/plan'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_COMMITMENT,
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

  it('useMyPlan reads get_my_plan under the plan key itself', async () => {
    const items = [
      {
        commitmentId: 'c-gym',
        kind: 'commitment' as const,
        section: 'current' as const,
        state: 'active' as const,
        presetKey: 'gym',
        customName: null,
        activityName: 'Gym',
        name: null,
        scheduleType: 'times_per_week' as const,
        days: null,
        target: 3,
        endDate: null,
        deadline: null,
        startsOn: null,
        endsOn: null,
        canEdit: true,
        canDelete: false,
      },
    ]
    const backend = createFakeBackend(undefined, { myPlan: { [TEST_GROUP.id]: items } })
    const { queryClient, wrapper } = setup(backend)
    const { result } = renderHook(() => useMyPlan(TEST_GROUP.id), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(items)
    expect(backend.getMyPlan).toHaveBeenCalledWith(TEST_GROUP.id)
    expect(queryClient.getQueryData(['plan', TEST_GROUP.id])).toEqual(items)
  })

  it('useCommitment reads get_commitment under the plan key; not_found is not retried', async () => {
    const backend = createFakeBackend(undefined, { commitments: [TEST_COMMITMENT] })
    const { wrapper } = setup(backend)
    expect(commitmentKey('g1', 'c1')).toEqual(['plan', 'g1', 'commitment', 'c1'])
    const { result } = renderHook(() => useCommitment(TEST_GROUP.id, 'c-gym'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(TEST_COMMITMENT)

    const gone = renderHook(() => useCommitment(TEST_GROUP.id, 'c-none'), { wrapper })
    await waitFor(() => expect(gone.result.current.isError).toBe(true))
    expect(backendErrorCode(gone.result.current.error)).toBe('not_found')
    expect(
      vi.mocked(backend.getCommitment).mock.calls.filter(([id]) => id === 'c-none'),
    ).toHaveLength(1)
  })

  it('useUpdateCommitment and useEndCommitment invalidate today, plan and group activities', async () => {
    const backend = createFakeBackend(undefined, { commitments: [TEST_COMMITMENT] })
    const { queryClient, wrapper } = setup(backend)
    const keys = [
      todayKey(TEST_GROUP.id),
      planKey(TEST_GROUP.id),
      groupActivitiesKey(TEST_GROUP.id),
    ]
    for (const key of keys) queryClient.setQueryData(key, [])
    const update = renderHook(() => useUpdateCommitment(TEST_GROUP.id), { wrapper })
    const input = { commitmentId: 'c-gym', days: null, target: 4, endDate: null }
    let answer: unknown
    await act(async () => {
      answer = await update.result.current.mutateAsync(input)
    })
    expect(backend.updateCommitment).toHaveBeenCalledWith(input)
    expect(answer).toEqual({ changesFrom: '2026-11-23' })
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)

    for (const key of keys) queryClient.setQueryData(key, [])
    const end = renderHook(() => useEndCommitment(TEST_GROUP.id), { wrapper })
    await act(async () => {
      await end.result.current.mutateAsync('c-gym')
    })
    expect(backend.endCommitment).toHaveBeenCalledWith('c-gym')
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it('commitment_ended on an edit or end refetches today and the plan; invalid_plan does not', async () => {
    const backend = createFakeBackend(undefined, {
      commitments: [{ ...TEST_COMMITMENT, canEdit: false, state: 'ending' }],
    })
    const { queryClient, wrapper } = setup(backend)
    const update = renderHook(() => useUpdateCommitment(TEST_GROUP.id), { wrapper })
    queryClient.setQueryData(planKey(TEST_GROUP.id), [])
    await act(async () => {
      await update.result.current
        .mutateAsync({ commitmentId: 'c-gym', days: null, target: 4, endDate: null })
        .catch(() => {})
    })
    expect(queryClient.getQueryState(planKey(TEST_GROUP.id))?.isInvalidated).toBe(true)

    queryClient.setQueryData(planKey(TEST_GROUP.id), [])
    const end = renderHook(() => useEndCommitment(TEST_GROUP.id), { wrapper })
    await act(async () => {
      await end.result.current.mutateAsync('c-gym').catch(() => {})
    })
    expect(queryClient.getQueryState(planKey(TEST_GROUP.id))?.isInvalidated).toBe(true)

    vi.mocked(backend.updateCommitment).mockRejectedValueOnce(new BackendError('invalid_plan'))
    queryClient.setQueryData(planKey(TEST_GROUP.id), [])
    await act(async () => {
      await update.result.current
        .mutateAsync({ commitmentId: 'c-gym', days: null, target: 4, endDate: null })
        .catch(() => {})
    })
    expect(queryClient.getQueryState(planKey(TEST_GROUP.id))?.isInvalidated).toBe(false)
  })

  it('not_found on an edit or end refetches today and the plan', async () => {
    const { queryClient, wrapper } = setup(createFakeBackend())
    const keys = [todayKey(TEST_GROUP.id), planKey(TEST_GROUP.id)]
    const update = renderHook(() => useUpdateCommitment(TEST_GROUP.id), { wrapper })
    for (const key of keys) queryClient.setQueryData(key, [])
    let code: unknown
    await act(async () => {
      code = await update.result.current
        .mutateAsync({ commitmentId: 'c-none', days: null, target: 4, endDate: null })
        .catch(backendErrorCode)
    })
    expect(code).toBe('not_found')
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)

    const end = renderHook(() => useEndCommitment(TEST_GROUP.id), { wrapper })
    for (const key of keys) queryClient.setQueryData(key, [])
    await act(async () => {
      code = await end.result.current.mutateAsync('c-none').catch(backendErrorCode)
    })
    expect(code).toBe('not_found')
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })
})
