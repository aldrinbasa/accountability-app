import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { FeedItem, FeedPage } from '@/domain/feed'
import type { FeedFreezeVote } from '@/domain/freeze-vote'
import type { OpenVote, OpenVotesData } from '@/domain/open-votes'
import {
  BALLOT_FINAL_MS,
  choiceKind,
  type AnyVoteChoice,
  type CastVoteResult,
  type VoteKind,
  type VoteTally,
} from '@/domain/vote'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { feedKey } from '@/data/feed'
import { openVotesKey } from '@/data/open-votes'
import { retryOnline } from '@/data/query-client'

/**
 * `['feed', groupId, 'tallies']`: the group's "N of M voted" per open vote. Under the Feed prefix, so
 * every Feed invalidation (a post, a challenge, a refusal) refreshes it too.
 */
export function voteTalliesKey(groupId: string) {
  return [...feedKey(groupId), 'tallies'] as const
}

export interface VoteRepository {
  /** A ballot on a challenge (`fake` | `real`) or a freeze request (`approve` | `deny`). */
  cast(voteId: string, choice: AnyVoteChoice): Promise<CastVoteResult>
  undo(kind: VoteKind, voteId: string): Promise<void>
  tallies(groupId: string): Promise<VoteTally[]>
}

/** Vote reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createVoteRepository(backend: BackendPort): VoteRepository {
  return {
    cast: (voteId, choice) => backend.castVote(choiceKind(choice), voteId, choice),
    undo: (kind, voteId) => backend.undoVote(kind, voteId),
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

function isOpenVotes(data: unknown): data is OpenVotesData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { openVotes?: unknown }).openVotes)
  )
}

/**
 * Writes the reader's own ballot into every cached Feed page of the group (wall and anchored
 * pages) and into Today's Open votes (Story 5.6), so the card shows it before the next refetch: a
 * challenge's or a freeze request's card.
 */
export function patchFeedVote(
  queryClient: QueryClient,
  groupId: string,
  voteId: string,
  patch: { myChoice: AnyVoteChoice | null; myCastAt: string | null },
): void {
  queryClient.setQueriesData({ queryKey: feedKey(groupId) }, (data: unknown) => {
    if (isOpenVotes(data)) {
      return {
        openVotes: data.openVotes.map((item) => patchItem(item, voteId, patch) as OpenVote),
      }
    }
    if (!isFeedPages(data)) return data
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((item): FeedItem => patchItem(item, voteId, patch)),
      })),
    }
  })
}

type FeedVoteChoice = Extract<FeedItem, { type: 'vote' }>['myChoice']
type FreezeVoteChoice = FeedFreezeVote['myChoice']

function patchItem(
  item: FeedItem,
  voteId: string,
  patch: { myChoice: AnyVoteChoice | null; myCastAt: string | null },
): FeedItem {
  if (item.id !== voteId) return item
  if (
    item.type === 'vote' &&
    (patch.myChoice === null || choiceKind(patch.myChoice) === 'challenge')
  ) {
    return { ...item, myChoice: patch.myChoice as FeedVoteChoice, myCastAt: patch.myCastAt }
  }
  if (
    item.type === 'freezeVote' &&
    (patch.myChoice === null || choiceKind(patch.myChoice) === 'freeze')
  ) {
    return { ...item, myChoice: patch.myChoice as FreezeVoteChoice, myCastAt: patch.myCastAt }
  }
  return item
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
 * `cast_vote` on a challenge (Story 5.2) or a freeze request (Story 5.5) of the group. Never queued (AD-12): offline is the
 * caller's error toast. On success it writes the ballot into the cached Feed pages and tally, then
 * refetches the tallies now and once the ballot is final at the server (6 s).
 */
export function useCastVote(groupId: string) {
  const repository = useVoteRepository('useCastVote')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ voteId, choice }: { voteId: string; choice: AnyVoteChoice }) =>
      repository.cast(voteId, choice),
    onSuccess: (result, { voteId, choice }) => {
      patchFeedVote(queryClient, groupId, voteId, { myChoice: choice, myCastAt: result.castAt })
      shiftTally(queryClient, groupId, voteId, 1)
      const refetch = () =>
        void queryClient.invalidateQueries({ queryKey: voteTalliesKey(groupId) })
      refetch()
      setTimeout(() => {
        refetch()
        // Today's Open votes lets the voted card go once its ballot is final (Story 5.6).
        void queryClient.invalidateQueries({ queryKey: openVotesKey(groupId) })
      }, BALLOT_FINAL_MS + 500)
    },
  })
}

/**
 * `undo_vote` on a challenge or freeze request of the group: clears the cached ballot and tally,
 * then refetches the tallies.
 */
export function useUndoVote(groupId: string, kind: VoteKind) {
  const repository = useVoteRepository('useUndoVote')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (voteId: string) => repository.undo(kind, voteId),
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
