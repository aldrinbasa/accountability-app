import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { boardGroupKey, groupWeekKey } from '@/data/board'
import { useCreateChallenge, useOverturnRuling } from '@/data/challenge'
import { feedKey } from '@/data/feed'
import { groupGoalKey } from '@/data/goal'
import { MY_GROUPS_KEY } from '@/data/groups'
import { memberProfileGroupKey } from '@/data/member-profile'
import { planKey, todayKey } from '@/data/plan'
import { streaksKey } from '@/data/streaks'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  withBackend,
} from '@/test/fake-backend'
import type { FeedRuling } from '@/domain/feed'
import { feedCheckin } from '@/test/feed-items'

describe('challenge data (Story 5.1)', () => {
  it('useCreateChallenge sends the check-in and refreshes every view a challenge can change', async () => {
    const backend = createFakeBackend(undefined, { feed: { [TEST_GROUP.id]: [feedCheckin()] } })
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      withBackend(backend, children, undefined, queryClient)
    const keys = [
      todayKey(TEST_GROUP.id),
      feedKey(TEST_GROUP.id),
      boardGroupKey(TEST_GROUP.id),
      groupWeekKey(TEST_GROUP.id),
      streaksKey(TEST_GROUP.id),
      memberProfileGroupKey(TEST_GROUP.id),
      groupGoalKey(TEST_GROUP.id),
      MY_GROUPS_KEY,
      planKey(TEST_GROUP.id),
    ]
    for (const key of keys) queryClient.setQueryData(key, [])

    const { result } = renderHook(() => useCreateChallenge(TEST_GROUP.id), { wrapper })
    let answer: unknown
    await act(async () => {
      answer = await result.current.mutateAsync('checkin-1')
    })
    expect(backend.createChallenge).toHaveBeenCalledWith('checkin-1')
    expect(answer).toMatchObject({ challengeId: 'challenge-checkin-1', status: 'open' })
    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
  })

  it('useOverturnRuling sends the challenge and refreshes the same views', async () => {
    const ruling: FeedRuling = {
      type: 'ruling',
      id: 'ruling-1',
      groupId: TEST_GROUP.id,
      sortAt: '2026-11-20T02:00:00.000000+00:00',
      challengeId: 'ch-1',
      checkinId: 'checkin-1',
      challengerId: 'user-3',
      challengerName: 'Sam',
      ownerId: 'user-2',
      ownerName: 'Priya',
      title: 'Gym',
      outcome: 'fake',
      fakeCount: 2,
      realCount: 1,
      variant: 'normal',
      overturnUntil: '2099-01-05T16:00:00.000Z',
      canOverturn: true,
      overturnedById: null,
      overturnedByName: null,
      overturnedAt: null,
    }
    const backend = createFakeBackend(undefined, { feed: { [TEST_GROUP.id]: [ruling] } })
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      withBackend(backend, children, undefined, queryClient)
    // Epic 5 retro: the shared vote-outcome list, so My plan refetches too (an overturn cancels
    // any freeze on the check-in's session).
    const keys = [
      todayKey(TEST_GROUP.id),
      planKey(TEST_GROUP.id),
      feedKey(TEST_GROUP.id),
      boardGroupKey(TEST_GROUP.id),
      groupWeekKey(TEST_GROUP.id),
      streaksKey(TEST_GROUP.id),
      memberProfileGroupKey(TEST_GROUP.id),
      groupGoalKey(TEST_GROUP.id),
      MY_GROUPS_KEY,
    ]
    for (const key of keys) queryClient.setQueryData(key, [])

    const { result } = renderHook(() => useOverturnRuling(TEST_GROUP.id), { wrapper })
    let answer: unknown
    await act(async () => {
      answer = await result.current.mutateAsync('ch-1')
    })
    expect(backend.overturnRuling).toHaveBeenCalledWith('ch-1')
    expect(answer).toMatchObject({ overturnId: 'overturn-ch-1' })
    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
  })
})
