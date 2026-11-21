import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { boardGroupKey, groupWeekKey } from '@/data/board'
import { useCreateChallenge } from '@/data/challenge'
import { feedKey } from '@/data/feed'
import { groupGoalKey } from '@/data/goal'
import { MY_GROUPS_KEY } from '@/data/groups'
import { memberProfileGroupKey } from '@/data/member-profile'
import { todayKey } from '@/data/plan'
import { streaksKey } from '@/data/streaks'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  withBackend,
} from '@/test/fake-backend'
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
})
