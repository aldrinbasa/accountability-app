import { describe, expect, it } from 'vitest'
import {
  dayOf,
  freezeCancelledLine,
  freezeChoiceButtonLabel,
  freezeChoiceLabel,
  freezeOutcomeLine,
  freezeRequestLine,
  freezeResultWho,
  freezeRuleLine,
  freezeVoteCardState,
  freezeVotedLine,
  freezeVotedToast,
  freezeVoteHeading,
  freezeVoteKicker,
  isFreezeVoteStatus,
  reasonLabel,
} from '@/domain/freeze-vote'
import { feedFreezeResult, feedFreezeVote } from '@/test/feed-items'

const NOW = new Date('2026-11-20T03:00:00Z')
const VIEWER = { userId: 'user-1', now: NOW }

describe('freeze Vote card state (Story 5.5)', () => {
  it('is open for an eligible voter, voted once they cast', () => {
    expect(freezeVoteCardState(feedFreezeVote(), VIEWER)).toEqual({ kind: 'open' })
    expect(freezeVoteCardState(feedFreezeVote({ myChoice: 'deny' }), VIEWER)).toEqual({
      kind: 'voted',
      choice: 'deny',
    })
  })

  it('locks the requester, and reads joined later without a vote', () => {
    expect(freezeVoteCardState(feedFreezeVote(), { ...VIEWER, userId: 'user-4' })).toEqual({
      kind: 'requester',
    })
    expect(freezeVoteCardState(feedFreezeVote({ canVote: false }), VIEWER)).toEqual({
      kind: 'joinedLater',
    })
  })

  it('is closing at closes_at, closed with the outcome, cancelled when cancelled or withdrawn', () => {
    const due = feedFreezeVote({ closesAt: NOW.toISOString() })
    expect(freezeVoteCardState(due, VIEWER)).toEqual({ kind: 'closing' })
    expect(freezeVoteCardState(feedFreezeVote({ status: 'denied' }), VIEWER)).toEqual({
      kind: 'closed',
      outcome: 'denied',
    })
    expect(freezeVoteCardState(feedFreezeVote({ status: 'cancelled' }), VIEWER).kind).toBe(
      'cancelled',
    )
    expect(freezeVoteCardState(feedFreezeVote({ status: 'withdrawn' }), VIEWER).kind).toBe(
      'cancelled',
    )
  })

  it('guards the status values', () => {
    expect(isFreezeVoteStatus('approved')).toBe(true)
    expect(isFreezeVoteStatus('open')).toBe(false)
  })
})

describe('freeze Vote card copy (Story 5.5)', () => {
  it('kicker: hours left, minutes under an hour, plain once not pending', () => {
    expect(freezeVoteKicker(feedFreezeVote({ closesAt: '2026-11-21T00:59:59Z' }), NOW)).toEqual({
      text: 'FREEZE REQUEST · 21 H LEFT',
      spoken: 'Freeze request, 21 hours left',
    })
    expect(freezeVoteKicker(feedFreezeVote({ closesAt: '2026-11-20T03:05:00Z' }), NOW).text).toBe(
      'FREEZE REQUEST · 5 MIN LEFT',
    )
    expect(freezeVoteKicker(feedFreezeVote({ status: 'approved' }), NOW).text).toBe(
      'FREEZE REQUEST',
    )
  })

  it('request line: a day, a times-per-week week (this and last), the You rule', () => {
    expect(freezeRequestLine(feedFreezeVote(), 'user-1')).toBe('Dev wants Study on Sat frozen.')
    expect(freezeRequestLine(feedFreezeVote(), 'user-4')).toBe('You want Study on Sat frozen.')
    const gym = feedFreezeVote({ title: 'Gym', scheduleType: 'times_per_week', sessionDay: null })
    expect(freezeRequestLine(gym, 'user-1')).toBe('Dev wants one Gym session off this week.')
    expect(freezeRequestLine({ ...gym, which: 'last' }, 'user-1')).toBe(
      'Dev wants one Gym session off last week.',
    )
  })

  it('heading, reason label and rule line (2 members: just you deciding)', () => {
    expect(freezeVoteHeading(feedFreezeVote(), 'user-1')).toBe(
      "Vote on Dev's freeze request for Study",
    )
    expect(reasonLabel('flu, in bed')).toBe('Reason: flu, in bed')
    expect(freezeRuleLine(feedFreezeVote())).toBe('No votes means approved.')
    expect(freezeRuleLine(feedFreezeVote({ twoPerson: true }))).toBe(
      'Just you deciding. No vote means approved.',
    )
  })

  it('buttons, toast and voted line', () => {
    expect(freezeChoiceLabel('approve')).toBe('Approve')
    expect(freezeChoiceButtonLabel('deny')).toBe('Vote: deny')
    expect(freezeVotedToast('approve')).toBe('Voted Approve')
    expect(freezeVotedToast('deny')).toBe('Voted Deny')
    expect(freezeVotedLine('approve', { votedCount: 1, eligibleCount: 3 })).toBe(
      'Voted Approve · 1 of 3 voted',
    )
    expect(freezeVotedLine('deny', null)).toBe('Voted Deny')
  })
})

describe('freeze outcome copy (Story 5.5)', () => {
  it('a day: approved (with Miss removed) and denied', () => {
    const day = feedFreezeResult()
    expect(freezeOutcomeLine(day, 'approved')).toBe(
      'Freeze approved · Study on Sat is off the plan.',
    )
    expect(freezeOutcomeLine(day, 'approved', true)).toBe(
      'Freeze approved · Study on Sat is off the plan. Miss removed.',
    )
    expect(freezeOutcomeLine(day, 'denied')).toBe('Freeze denied · Study on Sat still counts.')
  })

  it('times per week: approved, denied this week and last week', () => {
    const gym = feedFreezeResult({
      title: 'Gym',
      scheduleType: 'times_per_week',
      sessionDay: null,
      weekTarget: 3,
    })
    expect(freezeOutcomeLine(gym, 'approved')).toBe(
      'Freeze approved · one Gym session is off the plan.',
    )
    expect(freezeOutcomeLine(gym, 'denied')).toBe('Freeze denied · Gym still needs 3 this week.')
    expect(freezeOutcomeLine({ ...gym, which: 'last' }, 'denied')).toBe(
      'Freeze denied · Gym still needed 3 last week.',
    )
    expect(freezeOutcomeLine({ ...gym, weekTarget: 0 }, 'denied')).toBe(
      'Freeze denied · Gym still counts.',
    )
    expect(freezeOutcomeLine({ ...gym, weekTarget: null }, 'denied')).toBe(
      'Freeze denied · Gym still counts.',
    )
  })

  it('whose request, and the day of a date', () => {
    expect(freezeResultWho(feedFreezeResult(), 'user-1')).toBe("Dev's request")
    expect(freezeResultWho(feedFreezeResult(), 'user-4')).toBe('Your request')
    expect(dayOf('2026-11-21')).toBe('Sat')
    expect(dayOf('nope')).toBe('')
    expect(dayOf(null)).toBe('')
  })
})

describe('cancelled freeze requests (Story 5.6)', () => {
  it('names the requester who left', () => {
    expect(
      freezeCancelledLine(
        feedFreezeVote({ status: 'cancelled', cancelReason: 'left', cancelledById: 'user-4' }),
      ),
    ).toBe('Cancelled · Dev left the group')
    expect(freezeCancelledLine(feedFreezeVote({ status: 'cancelled' }))).toBe('Cancelled')
  })

  it('after an admin overturn of its session check-in: "the check-in counts again" (Epic 5 retro)', () => {
    expect(
      freezeCancelledLine(
        feedFreezeVote({
          status: 'cancelled',
          cancelReason: 'overturned',
          cancelledById: 'user-1',
        }),
      ),
    ).toBe('Cancelled · the check-in counts again')
  })
})
