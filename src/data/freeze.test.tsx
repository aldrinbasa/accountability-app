import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FreezeOption } from '@/domain/freeze'
import { boardGroupKey, groupWeekKey } from '@/data/board'
import { feedKey } from '@/data/feed'
import {
  freezeOptionsKey,
  freezeRequestsKey,
  useFreezeOptions,
  useMyFreezes,
  useRequestFreeze,
} from '@/data/freeze'
import { groupGoalKey } from '@/data/goal'
import { memberProfileGroupKey } from '@/data/member-profile'
import { planKey, todayKey } from '@/data/plan'
import { streaksKey } from '@/data/streaks'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  withBackend,
} from '@/test/fake-backend'

const OPTION: FreezeOption = {
  kind: 'day',
  commitmentId: 'c-study',
  sessionId: 's-sat',
  startsAt: '2026-11-20T16:00:00Z',
  endsAt: '2026-11-21T16:00:00Z',
  windowEndsAt: '2099-11-21T16:00:00Z',
  missed: false,
  weekStart: '2026-11-16',
  which: 'this',
  target: null,
  frozen: null,
  targetAfter: null,
  timeZone: 'Asia/Manila',
}

describe('freeze data (Story 5.4)', () => {
  it('keeps the freeze reads under Today, so every Today invalidation refreshes them', () => {
    expect(freezeOptionsKey('g')).toEqual(['today', 'g', 'freeze', 'options'])
    expect(freezeRequestsKey('g')).toEqual(['today', 'g', 'freeze', 'requests'])
  })

  it('reads the options and requests, and a request refreshes every view it can change', async () => {
    const backend = createFakeBackend(undefined, {
      freezeOptions: { [TEST_GROUP.id]: [OPTION] },
    })
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      withBackend(backend, children, undefined, queryClient)

    const options = renderHook(() => useFreezeOptions(TEST_GROUP.id), { wrapper })
    const requests = renderHook(() => useMyFreezes(TEST_GROUP.id), { wrapper })
    await waitFor(() => expect(options.result.current.data).toEqual([OPTION]))
    await waitFor(() => expect(requests.result.current.data).toEqual([]))

    const keys = [
      todayKey(TEST_GROUP.id),
      planKey(TEST_GROUP.id),
      feedKey(TEST_GROUP.id),
      boardGroupKey(TEST_GROUP.id),
      groupWeekKey(TEST_GROUP.id),
      streaksKey(TEST_GROUP.id),
      memberProfileGroupKey(TEST_GROUP.id),
      groupGoalKey(TEST_GROUP.id),
    ]
    for (const key of keys) queryClient.setQueryData(key, [])

    const { result } = renderHook(() => useRequestFreeze(TEST_GROUP.id), { wrapper })
    let answer: unknown
    await act(async () => {
      answer = await result.current.mutateAsync({
        commitmentId: 'c-study',
        reason: 'flu',
        sessionId: 's-sat',
        weekStart: null,
      })
    })
    expect(backend.requestFreeze).toHaveBeenCalledWith({
      commitmentId: 'c-study',
      reason: 'flu',
      sessionId: 's-sat',
      weekStart: null,
    })
    expect(answer).toMatchObject({ status: 'pending', sessionId: 's-sat' })
    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
    // The freeze reads refetched under Today's prefix: the option is gone, the request is listed.
    await waitFor(() => expect(options.result.current.data).toEqual([]))
    await waitFor(() =>
      expect(requests.result.current.data).toEqual([
        expect.objectContaining({ commitmentId: 'c-study', status: 'pending', reason: 'flu' }),
      ]),
    )
  })
})
