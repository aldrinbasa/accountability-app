import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { InfiniteData } from '@tanstack/react-query'
import type { FeedPage } from '@/domain/feed'
import type { FeedVote, VoteTally } from '@/domain/vote'
import { feedAroundKey, feedKey, feedWallKey } from '@/data/feed'
import { useCastVote, useUndoVote, useVoteTallies, voteTalliesKey } from '@/data/vote'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  withBackend,
} from '@/test/fake-backend'
import { feedVote } from '@/test/feed-items'

const VOTE = feedVote({ groupId: TEST_GROUP.id })
const TALLY: VoteTally = {
  targetKind: 'challenge',
  targetId: VOTE.id,
  votedCount: 2,
  eligibleCount: 4,
}

function setup() {
  const backend = createFakeBackend(undefined, {
    feed: { [TEST_GROUP.id]: [VOTE] },
    voteTallies: { [TEST_GROUP.id]: [TALLY] },
  })
  const queryClient = createTestQueryClient()
  const page: InfiniteData<FeedPage> = {
    pages: [{ items: [VOTE], nextCursor: null }],
    pageParams: [null],
  }
  queryClient.setQueryData(feedWallKey(TEST_GROUP.id), page)
  queryClient.setQueryData(feedAroundKey(TEST_GROUP.id, VOTE.id, 'vote'), page)
  queryClient.setQueryData(voteTalliesKey(TEST_GROUP.id), [TALLY])
  const wrapper = ({ children }: { children: ReactNode }) =>
    withBackend(backend, children, undefined, queryClient)
  return { backend, queryClient, wrapper }
}

function cachedVote(
  queryClient: ReturnType<typeof createTestQueryClient>,
  key: readonly unknown[],
): FeedVote | undefined {
  const data = queryClient.getQueryData<InfiniteData<FeedPage>>(key)
  const item = data?.pages[0]?.items[0]
  return item?.type === 'vote' ? item : undefined
}

describe('vote data (Story 5.2)', () => {
  // Before the fixture's `closesAt`.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T03:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('keeps the tallies under the Feed prefix', () => {
    expect(voteTalliesKey('g').slice(0, 2)).toEqual([...feedKey('g')])
  })

  it('useVoteTallies reads vote_tallies for the group', async () => {
    const { backend, wrapper } = setup()
    const { result } = renderHook(() => useVoteTallies(TEST_GROUP.id), { wrapper })
    await waitFor(() => expect(result.current.isFetching).toBe(false))
    expect(result.current.data).toEqual([TALLY])
    expect(backend.listVoteTallies).toHaveBeenCalledWith(TEST_GROUP.id)
  })

  it('cast writes the ballot into every Feed cache and the tally; undo clears it', async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(
      () => ({ cast: useCastVote(TEST_GROUP.id), undo: useUndoVote(TEST_GROUP.id, 'challenge') }),
      { wrapper },
    )

    await act(async () => {
      await result.current.cast.mutateAsync({ voteId: VOTE.id, choice: 'real' })
    })
    expect(backend.castVote).toHaveBeenCalledWith('challenge', VOTE.id, 'real')
    for (const key of [feedWallKey(TEST_GROUP.id), feedAroundKey(TEST_GROUP.id, VOTE.id, 'vote')]) {
      expect(cachedVote(queryClient, key)?.myChoice).toBe('real')
    }
    expect(queryClient.getQueryData<VoteTally[]>(voteTalliesKey(TEST_GROUP.id))?.[0]).toMatchObject(
      { votedCount: 3 },
    )
    expect(queryClient.getQueryState(voteTalliesKey(TEST_GROUP.id))?.isInvalidated).toBe(true)

    await act(async () => {
      await result.current.undo.mutateAsync(VOTE.id)
    })
    expect(backend.undoVote).toHaveBeenCalledWith('challenge', VOTE.id)
    expect(cachedVote(queryClient, feedWallKey(TEST_GROUP.id))?.myChoice).toBeNull()
    expect(queryClient.getQueryData<VoteTally[]>(voteTalliesKey(TEST_GROUP.id))?.[0]).toMatchObject(
      { votedCount: 2 },
    )
  })

  it('refetches the tallies again once the ballot is final (6 s)', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-20T03:00:00Z') })
    try {
      const { queryClient, wrapper } = setup()
      const { result } = renderHook(() => useCastVote(TEST_GROUP.id), { wrapper })
      await act(async () => {
        await result.current.mutateAsync({ voteId: VOTE.id, choice: 'fake' })
      })
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000)
      })
      expect(invalidate).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: voteTalliesKey(TEST_GROUP.id) })
    } finally {
      vi.useRealTimers()
    }
  })
})
