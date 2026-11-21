import {
  castFailure,
  isVoteChoice,
  tallyLine,
  undoFailure,
  voteCardState,
  voteCheckin,
  votedLine,
  votedToast,
  voteHeading,
  voteKicker,
  voteRulingLine,
  voteShowsThumbnail,
  voteThumbnailLabel,
  voteWhoLine,
} from '@/domain/vote'
import { feedVote } from '@/test/feed-items'

const NOW = new Date('2026-11-20T03:00:00Z')
const viewer = (userId: string) => ({ userId, now: NOW })

describe('voteCardState (Story 5.2)', () => {
  it('maps every state', () => {
    const open = feedVote()
    expect(voteCardState(open, viewer('user-9'))).toEqual({ kind: 'open' })
    expect(voteCardState({ ...open, myChoice: 'real' }, viewer('user-9'))).toEqual({
      kind: 'voted',
      choice: 'real',
    })
    expect(voteCardState(open, viewer(open.challengerId!))).toEqual({ kind: 'challenger' })
    expect(voteCardState(open, viewer(open.ownerId!))).toEqual({ kind: 'owner' })
    expect(voteCardState({ ...open, canVote: false }, viewer('user-9'))).toEqual({
      kind: 'joinedLater',
    })
    expect(voteCardState({ ...open, closesAt: NOW.toISOString() }, viewer('user-9'))).toEqual({
      kind: 'closing',
    })
    expect(voteCardState({ ...open, status: 'fake' }, viewer('user-9'))).toEqual({
      kind: 'closed',
      outcome: 'fake',
    })
    expect(voteCardState({ ...open, status: 'real' }, viewer(open.ownerId!))).toEqual({
      kind: 'closed',
      outcome: 'real',
    })
    expect(voteCardState({ ...open, status: 'cancelled' }, viewer('user-9'))).toEqual({
      kind: 'cancelled',
    })
  })

  it('a signed-out reader (empty id) is never the challenger or owner', () => {
    expect(voteCardState({ ...feedVote(), challengerId: null }, viewer(''))).toEqual({
      kind: 'open',
    })
  })
})

describe('voteKicker', () => {
  it('uses the 5.1 time rule: hours floor, then minutes at least 1', () => {
    const at = (ms: number) => feedVote({ closesAt: new Date(NOW.getTime() + ms).toISOString() })
    expect(voteKicker(at(18 * 3_600_000 + 59 * 60_000), NOW)).toEqual({
      text: 'CHALLENGE · 18 H LEFT',
      spoken: 'Challenge, 18 hours left',
    })
    expect(voteKicker(at(3_600_000), NOW)).toEqual({
      text: 'CHALLENGE · 1 H LEFT',
      spoken: 'Challenge, 1 hour left',
    })
    expect(voteKicker(at(3_599_999), NOW).text).toBe('CHALLENGE · 59 MIN LEFT')
    expect(voteKicker(at(10_000), NOW)).toEqual({
      text: 'CHALLENGE · 1 MIN LEFT',
      spoken: 'Challenge, 1 minute left',
    })
    expect(voteKicker(at(0), NOW).text).toBe('CHALLENGE')
    expect(voteKicker({ ...at(5_000_000), status: 'real' }, NOW).text).toBe('CHALLENGE')
  })
})

describe('Vote card copy', () => {
  it('who line, heading and thumbnail with the "You" rule', () => {
    const vote = feedVote()
    expect(voteWhoLine(vote, 'user-9')).toBe("Lena challenged Dev's Study check-in.")
    expect(voteWhoLine(vote, vote.challengerId!)).toBe("You challenged Dev's Study check-in.")
    expect(voteWhoLine(vote, vote.ownerId!)).toBe('Lena challenged your Study check-in.')
    expect(voteHeading(vote, 'user-9')).toBe("Challenge vote on Dev's Study check-in")
    expect(voteThumbnailLabel(vote, 'user-9')).toBe("View Dev's Study check-in photo")
    expect(voteWhoLine({ ...vote, taskName: 'Groceries' }, 'user-9')).toBe(
      "Lena challenged Dev's Groceries check-in.",
    )
  })

  it('tally, voted line and toast', () => {
    expect(tallyLine({ votedCount: 3, eligibleCount: 4 })).toBe('3 of 4 voted')
    expect(votedLine('real', { votedCount: 3, eligibleCount: 4 })).toBe(
      'You voted Real · 3 of 4 voted',
    )
    expect(votedLine('fake', null)).toBe('You voted Fake')
    expect(votedToast('fake')).toBe('Voted Fake')
    expect(isVoteChoice('real')).toBe(true)
    expect(isVoteChoice('approve')).toBe(false)
  })

  it('the closed ruling line comes from 5.1', () => {
    const closed = feedVote({ status: 'fake', fakeCount: 3, realCount: 1, variant: 'normal' })
    expect(voteRulingLine(closed, 'user-9')).toBe(
      "Ruled Fake · Dev's Study removed. 3 Fake, 1 Real.",
    )
    expect(
      voteRulingLine({ ...closed, status: 'real', fakeCount: 2, realCount: 2 }, 'user-9'),
    ).toBe("Ruled Real · Dev's Study stands. 2 Fake, 2 Real.")
    expect(
      voteRulingLine({ ...closed, fakeCount: 1, realCount: 0, variant: 'lone' }, 'user-9'),
    ).toBe("Ruled Fake · nobody else voted · Dev's Study removed.")
    expect(voteRulingLine(feedVote(), 'user-9')).toBeNull()
    expect(voteShowsThumbnail(closed)).toBe(false)
    expect(voteShowsThumbnail(feedVote())).toBe(true)
  })

  it('the check-in for the Photo viewer', () => {
    const vote = feedVote()
    expect(voteCheckin(vote)).toMatchObject({
      type: 'checkin',
      id: vote.checkinId,
      authorId: vote.ownerId,
      authorName: 'Dev',
      activityName: 'Study',
      caption: null,
    })
  })
})

describe('failure mapping', () => {
  it('cast: offline, refusals and plain failures', () => {
    expect(castFailure('unknown', true)).toEqual({ kind: 'offline' })
    expect(castFailure('network', false)).toEqual({ kind: 'failed' })
    expect(castFailure('unknown', false)).toEqual({ kind: 'failed' })
    expect(castFailure('vote_closed', false)).toEqual({
      kind: 'refused',
      text: "That vote's already wrapped up.",
    })
    expect(castFailure('already_voted', false)).toMatchObject({ kind: 'refused' })
    expect(castFailure('not_eligible', false)).toEqual({
      kind: 'refused',
      text: "You can't vote on this one.",
    })
    expect(castFailure('not_member', false)).toMatchObject({ kind: 'refused' })
  })

  it('undo: offline, refusals and plain failures', () => {
    expect(undoFailure('network', true)).toEqual({
      kind: 'offline',
      text: "Couldn't undo. You're offline.",
    })
    expect(undoFailure('undo_expired', false)).toEqual({
      kind: 'refused',
      text: "That vote's already final.",
    })
    expect(undoFailure('vote_closed', false)).toMatchObject({ kind: 'refused' })
    expect(undoFailure('unknown', false)).toEqual({
      kind: 'failed',
      text: "Couldn't undo your vote. Tap Retry.",
    })
  })
})
