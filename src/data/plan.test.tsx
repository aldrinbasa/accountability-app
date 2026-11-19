import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { BackendError } from '@/domain/error-codes'
import type { AddCommitmentInput } from '@/domain/plan'
import { groupActivitiesKey } from '@/data/activities'
import { planKey, planPreviewKey, todayKey, useAddCommitment, usePlanPreview } from '@/data/plan'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  TEST_PLAN_PREVIEW,
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
