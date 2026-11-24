import {
  castFailure,
  choiceButtonLabel,
  choiceLabel,
  choiceSaid,
  isVoteChoice,
  tallyLine,
  undoFailure,
  voteCardState,
  voteCheckin,
  votedLine,
  votedToast,
  voteHeading,
  voteKicker,
  voteOverturnLine,
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
      text: 'QUESTION · 18 H LEFT',
      spoken: 'Question, 18 hours left',
    })
    expect(voteKicker(at(3_600_000), NOW)).toEqual({
      text: 'QUESTION · 1 H LEFT',
      spoken: 'Question, 1 hour left',
    })
    expect(voteKicker(at(3_599_999), NOW).text).toBe('QUESTION · 59 MIN LEFT')
    expect(voteKicker(at(10_000), NOW)).toEqual({
      text: 'QUESTION · 1 MIN LEFT',
      spoken: 'Question, 1 minute left',
    })
    expect(voteKicker(at(0), NOW).text).toBe('QUESTION')
    expect(voteKicker({ ...at(5_000_000), status: 'real' }, NOW).text).toBe('QUESTION')
  })
})

describe('Vote card copy', () => {
  it('who line, heading and thumbnail with the "You" rule', () => {
    const vote = feedVote()
    expect(voteWhoLine(vote, 'user-9')).toBe("Lena questioned Dev's Study check-in.")
    expect(voteWhoLine(vote, vote.challengerId!)).toBe("You questioned Dev's Study check-in.")
    expect(voteWhoLine(vote, vote.ownerId!)).toBe('Lena questioned your Study check-in.')
    expect(voteHeading(vote, 'user-9')).toBe("Vote on whether Dev's Study check-in counts")
    expect(voteThumbnailLabel(vote, 'user-9')).toBe("View Dev's Study check-in photo")
    expect(voteWhoLine({ ...vote, taskName: 'Groceries' }, 'user-9')).toBe(
      "Lena questioned Dev's Groceries check-in.",
    )
  })

  it('tally, voted line and toast', () => {
    expect(tallyLine({ votedCount: 3, eligibleCount: 4 })).toBe('3 of 4 voted')
    expect(votedLine('real', { votedCount: 3, eligibleCount: 4 })).toBe(
      'You said it counts · 3 of 4 voted',
    )
    expect(votedLine('fake', null)).toBe("You said it doesn't count")
    expect(votedToast('fake')).toBe("You said it doesn't count")
    expect(votedToast('real')).toBe('You said it counts')
    expect(choiceSaid('real')).toBe('You said it counts')
    expect(choiceSaid('fake')).toBe("You said it doesn't count")
  })

  it('words the buttons Doesn’t count | Counts, never Fake or Real', () => {
    expect(choiceLabel('fake')).toBe("Doesn't count")
    expect(choiceLabel('real')).toBe('Counts')
    expect(choiceButtonLabel('fake')).toBe("Vote: doesn't count")
    expect(choiceButtonLabel('real')).toBe('Vote: counts')
    expect(isVoteChoice('real')).toBe(true)
    expect(isVoteChoice('approve')).toBe(false)
  })

  it('the closed ruling line comes from 5.1', () => {
    const closed = feedVote({ status: 'fake', fakeCount: 3, realCount: 1, variant: 'normal' })
    expect(voteRulingLine(closed, 'user-9')).toBe(
      "Didn't count · Dev's Study · 3 said it doesn't count, 1 said it counts.",
    )
    expect(
      voteRulingLine({ ...closed, status: 'real', fakeCount: 2, realCount: 2 }, 'user-9'),
    ).toBe("Counts · a tie keeps it · Dev's Study · 2 said it counts, 2 said it doesn't.")
    expect(
      voteRulingLine({ ...closed, fakeCount: 1, realCount: 0, variant: 'lone' }, 'user-9'),
    ).toBe("Didn't count · Dev's Study · nobody else voted.")
    expect(voteRulingLine(feedVote(), 'user-9')).toBeNull()
    expect(voteShowsThumbnail(closed)).toBe(false)
    expect(voteShowsThumbnail(feedVote())).toBe(true)
  })

  it('an overturned Fake card names the admin and shows its thumbnail again (Story 5.3)', () => {
    const closed = feedVote({ status: 'fake', fakeCount: 3, realCount: 1, variant: 'normal' })
    const overturned = { ...closed, overturnedById: 'user-1', overturnedByName: 'Jo' }
    expect(voteOverturnLine(closed, 'user-9')).toBeNull()
    expect(voteOverturnLine(overturned, 'user-9')).toBe("Overturned by Jo · Dev's Study is back.")
    expect(voteOverturnLine(overturned, 'user-1')).toBe("Overturned by you · Dev's Study is back.")
    expect(voteOverturnLine(overturned, 'user-4')).toBe('Overturned by Jo · Your Study is back.')
    expect(voteShowsThumbnail(overturned)).toBe(true)
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
