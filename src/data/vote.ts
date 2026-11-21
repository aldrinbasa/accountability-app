import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { FeedItem, FeedPage } from '@/domain/feed'
import {
  BALLOT_FINAL_MS,
  type CastVoteResult,
  type FeedVote,
  type VoteChoice,
  type VoteTally,
} from '@/domain/vote'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { feedKey } from '@/data/feed'
import { retryOnline } from '@/data/query-client'

/**
 * `['feed', groupId, 'tallies']`: the group's "N of M voted" per open vote. Under the Feed prefix, so
 * every Feed invalidation (a post, a challenge, a refusal) refreshes it too.
 */
export function voteTalliesKey(groupId: string) {
  return [...feedKey(groupId), 'tallies'] as const
}

export interface VoteRepository {
  cast(challengeId: string, choice: VoteChoice): Promise<CastVoteResult>
  undo(challengeId: string): Promise<void>
  tallies(groupId: string): Promise<VoteTally[]>
}

/** Vote reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createVoteRepository(backend: BackendPort): VoteRepository {
  return {
    cast: (challengeId, choice) => backend.castVote('challenge', challengeId, choice),
    undo: (challengeId) => backend.undoVote('challenge', challengeId),
    tallies: (groupId) => backend.listVoteTallies(groupId),
  }
}

function useVoteRepository(hook: string): VoteRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createVoteRepository(backend), [backend])
}

/**
 * The group's open-vote tallies (`vote_tallies`). Refetches when a screen with it opens and on app
 * focus; retries once.
 */
export function useVoteTallies(groupId: string) {
  const repository = useVoteRepository('useVoteTallies')
  return useQuery({
    queryKey: voteTalliesKey(groupId),
    queryFn: () => repository.tallies(groupId),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

function isFeedPages(data: unknown): data is { pages: FeedPage[] } {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { pages?: unknown }).pages)
  )
}

/**
 * Writes the reader's own ballot into every cached Feed page of the group (wall and anchored
 * pages), so the card shows it before the next refetch.
 */
export function patchFeedVote(
  queryClient: QueryClient,
  groupId: string,
  voteId: string,
  patch: Pick<FeedVote, 'myChoice' | 'myCastAt'>,
): void {
  queryClient.setQueriesData({ queryKey: feedKey(groupId) }, (data: unknown) => {
    if (!isFeedPages(data)) return data
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((item): FeedItem =>
          item.type === 'vote' && item.id === voteId ? { ...item, ...patch } : item,
        ),
      })),
    }
  })
}

/** Moves the cached tally of one vote by `by` (the reader's own ballot), until the refetch. */
function shiftTally(queryClient: QueryClient, groupId: string, voteId: string, by: number) {
  queryClient.setQueryData<VoteTally[]>(voteTalliesKey(groupId), (old) =>
    old?.map((tally) =>
      tally.targetId === voteId
        ? { ...tally, votedCount: Math.max(0, tally.votedCount + by) }
        : tally,
    ),
  )
}

/**
 * `cast_vote` on a challenge of the group (Story 5.2). Never queued (AD-12): offline is the
 * caller's error toast. On success it writes the ballot into the cached Feed pages and tally, then
 * refetches the tallies now and once the ballot is final at the server (6 s).
 */
export function useCastVote(groupId: string) {
  const repository = useVoteRepository('useCastVote')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ voteId, choice }: { voteId: string; choice: VoteChoice }) =>
      repository.cast(voteId, choice),
    onSuccess: (result, { voteId, choice }) => {
      patchFeedVote(queryClient, groupId, voteId, { myChoice: choice, myCastAt: result.castAt })
      shiftTally(queryClient, groupId, voteId, 1)
      const refetch = () =>
        void queryClient.invalidateQueries({ queryKey: voteTalliesKey(groupId) })
      refetch()
      setTimeout(refetch, BALLOT_FINAL_MS + 500)
    },
  })
}

/**
 * `undo_vote` on a challenge of the group: clears the cached ballot and tally, then refetches the
 * tallies.
 */
export function useUndoVote(groupId: string) {
  const repository = useVoteRepository('useUndoVote')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (voteId: string) => repository.undo(voteId),
    onSuccess: (_result, voteId) => {
      patchFeedVote(queryClient, groupId, voteId, { myChoice: null, myCastAt: null })
      shiftTally(queryClient, groupId, voteId, -1)
      void queryClient.invalidateQueries({ queryKey: voteTalliesKey(groupId) })
    },
  })
}

/** Refetches the group's Feed (and with it the tallies), after a refused vote or undo. */
export function useRefetchFeed(groupId: string): () => void {
  const queryClient = useQueryClient()
  return () => void queryClient.invalidateQueries({ queryKey: feedKey(groupId) })
}
