import type { FeedItem } from '@/domain/feed'
import { freezeVoteCardState, type FeedFreezeVote } from '@/domain/freeze-vote'
import { BALLOT_FINAL_MS, voteCardState, type FeedVote } from '@/domain/vote'

/**
 * Today's "Open votes" (Story 5.6, FR-35): the votes waiting for the reader, so nobody needs push to
 * take part. The server decides who may vote and every time (`feed_items` `can_vote`, `closes_at`);
 * this file only picks and orders what it sent.
 */

export const OPEN_VOTES_COPY = {
  title: 'Open votes',
  ritual:
    "The photo's a ritual, not a court case. Question a check-in only when something's clearly off.",
  notNow: 'Not now',
} as const

/** A challenge's or a freeze request's Vote card. */
export type OpenVote = FeedVote | FeedFreezeVote

/** The cached Open votes list (a shape of its own, so Feed-page patches can tell it apart). */
export interface OpenVotesData {
  openVotes: OpenVote[]
}

function cardState(vote: OpenVote, viewer: { userId: string; now: Date }) {
  return vote.type === 'vote' ? voteCardState(vote, viewer) : freezeVoteCardState(vote, viewer)
}

/**
 * The votes the reader can still cast, nearest `closesAt` first (then id): an eligible voter with no
 * ballot, plus a ballot still inside its 6 s undo window (the card stays in its voted state until
 * the next fetch after that). Never a closed, cancelled or past-deadline vote, nor the challenger's,
 * owner's or requester's own.
 */
export function openVotesFor(
  items: readonly FeedItem[],
  viewer: { userId: string; now: Date },
): OpenVote[] {
  const now = viewer.now.getTime()
  const open = items.filter((item): item is OpenVote => {
    if (item.type !== 'vote' && item.type !== 'freezeVote') return false
    const state = cardState(item, viewer)
    if (state.kind === 'open') return true
    if (state.kind !== 'voted' || item.myCastAt === null) return false
    const castAt = Date.parse(item.myCastAt)
    return !Number.isNaN(castAt) && now < castAt + BALLOT_FINAL_MS
  })
  // An unreadable deadline sorts last, so the order stays consistent.
  const closes = (vote: OpenVote) => {
    const at = Date.parse(vote.closesAt)
    return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at
  }
  return open.sort((a, b) => {
    const ca = closes(a)
    const cb = closes(b)
    if (ca !== cb) return ca < cb ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
