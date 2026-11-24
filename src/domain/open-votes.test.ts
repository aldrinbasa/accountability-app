import { describe, expect, it } from 'vitest'
import { openVotesFor } from '@/domain/open-votes'
import { feedCheckin, feedFreezeVote, feedVote } from '@/test/feed-items'

// The fixtures close at 21:59 UTC on 20 Nov; the reader is user-1.
const NOW = new Date('2026-11-20T03:00:00Z')
const viewer = { userId: 'user-1', now: NOW }

describe('openVotesFor (Story 5.6)', () => {
  it('keeps eligible, unvoted votes of both kinds, nearest closes_at first, then id', () => {
    const late = feedVote({ id: 'ch-late', closesAt: '2026-11-21T01:00:00Z' })
    const soon = feedFreezeVote({ id: 'fr-soon', closesAt: '2026-11-20T05:00:00Z' })
    const tieB = feedVote({ id: 'ch-b', closesAt: '2026-11-20T10:00:00Z' })
    const tieA = feedFreezeVote({ id: 'fr-a', closesAt: '2026-11-20T10:00:00Z' })
    expect(
      openVotesFor([late, feedCheckin(), soon, tieB, tieA], viewer).map((vote) => vote.id),
    ).toEqual(['fr-soon', 'ch-b', 'fr-a', 'ch-late'])
  })

  it('drops closed, cancelled, past-deadline, not-eligible and own votes', () => {
    const items = [
      feedVote({ id: 'closed', status: 'real', fakeCount: 1, realCount: 2 }),
      feedVote({ id: 'cancelled', status: 'cancelled' }),
      feedVote({ id: 'past', closesAt: '2026-11-20T02:59:59Z' }),
      feedVote({ id: 'later', canVote: false }),
      feedVote({ id: 'mine', challengerId: 'user-1' }),
      feedVote({ id: 'owner', ownerId: 'user-1' }),
      feedFreezeVote({ id: 'request', requesterId: 'user-1' }),
      feedFreezeVote({ id: 'approved', status: 'approved' }),
      feedFreezeVote({ id: 'withdrawn', status: 'withdrawn' }),
    ]
    expect(openVotesFor(items, viewer)).toEqual([])
  })

  it('keeps a ballot inside its 6 s window and drops a final one', () => {
    const fresh = feedVote({
      id: 'fresh',
      myChoice: 'real',
      myCastAt: new Date(NOW.getTime() - 5_999).toISOString(),
    })
    const final = feedFreezeVote({
      id: 'final',
      myChoice: 'approve',
      myCastAt: new Date(NOW.getTime() - 6_000).toISOString(),
    })
    expect(openVotesFor([fresh, final], viewer).map((vote) => vote.id)).toEqual(['fresh'])
  })
})
