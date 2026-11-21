import { describe, expect, it } from 'vitest'
import {
  canChallenge,
  challengeActionLabel,
  challengeChip,
  challengeFailure,
  challengeFailureText,
  challengeOverflowLabel,
  challengeSheetBody,
  challengeSheetMeta,
  challengeSheetTitle,
  rulingLine,
} from '@/domain/challenge'
import { errorCopy, isRpcErrorCode } from '@/domain/error-codes'
import type { FeedRuling } from '@/domain/feed'
import { feedCheckin } from '@/test/feed-items'

const NOW = new Date('2026-11-20T02:12:30.000Z')
const viewer = { userId: 'user-1', now: NOW }

function ruling(overrides: Partial<FeedRuling> = {}): FeedRuling {
  return {
    type: 'ruling',
    id: 'ruling-1',
    groupId: 'group-1',
    sortAt: '2026-11-20T03:00:00.000000+00:00',
    challengeId: 'challenge-1',
    checkinId: 'checkin-1',
    challengerId: 'user-3',
    challengerName: 'Lena',
    ownerId: 'user-4',
    ownerName: 'Dev',
    title: 'Study',
    outcome: 'fake',
    fakeCount: 3,
    realCount: 1,
    variant: 'normal',
    ...overrides,
  }
}

describe('canChallenge (Story 5.1 visibility rule)', () => {
  it('offers Challenge on another member’s unchallenged check-in before challenge_until', () => {
    expect(canChallenge(feedCheckin(), viewer, 3)).toBe(true)
    expect(canChallenge(feedCheckin(), viewer, 2)).toBe(true)
  })

  it('hides it on the viewer’s own check-in', () => {
    expect(canChallenge(feedCheckin({ authorId: 'user-1' }), viewer, 3)).toBe(false)
  })

  it('hides it in a waiting group', () => {
    expect(canChallenge(feedCheckin(), viewer, 1)).toBe(false)
  })

  it('hides it once challenged (open, real or cancelled)', () => {
    for (const status of ['open', 'real', 'cancelled'] as const) {
      expect(
        canChallenge(feedCheckin({ challengeId: 'ch', challengeStatus: status }), viewer, 3),
      ).toBe(false)
    }
  })

  it('compares the clock with the server’s challenge_until: one second before and at', () => {
    const until = '2026-11-20T02:12:31.000Z'
    expect(canChallenge(feedCheckin({ challengeUntil: until }), viewer, 3)).toBe(true)
    const at = { ...viewer, now: new Date(until) }
    expect(canChallenge(feedCheckin({ challengeUntil: until }), at, 3)).toBe(false)
  })

  it('keeps late check-ins challengeable (the window is the server’s)', () => {
    expect(canChallenge(feedCheckin({ isLate: true }), viewer, 3)).toBe(true)
  })

  it('hides it without a window or a signed-in viewer', () => {
    expect(canChallenge(feedCheckin({ challengeUntil: null }), viewer, 3)).toBe(false)
    expect(canChallenge(feedCheckin(), { userId: '', now: NOW }, 3)).toBe(false)
  })
})

describe('challengeChip (time-left formatter)', () => {
  const open = (closesAt: string) =>
    feedCheckin({ challengeId: 'ch', challengeStatus: 'open', challengeClosesAt: closesAt })

  it('rounds hours down', () => {
    const closes = new Date(NOW.getTime() + 18 * 3_600_000 + 59 * 60_000).toISOString()
    expect(challengeChip(open(closes), NOW)).toEqual({
      text: 'CHALLENGED · 18 H LEFT',
      spoken: 'challenged, 18 hours left',
    })
  })

  it('says 1 hour in the singular', () => {
    const closes = new Date(NOW.getTime() + 3_600_000).toISOString()
    expect(challengeChip(open(closes), NOW)?.spoken).toBe('challenged, 1 hour left')
  })

  it('shows minutes under 1 hour, at least 1', () => {
    const closes = new Date(NOW.getTime() + 59 * 60_000 + 59_000).toISOString()
    expect(challengeChip(open(closes), NOW)?.text).toBe('CHALLENGED · 59 MIN LEFT')
    const soon = new Date(NOW.getTime() + 10_000).toISOString()
    expect(challengeChip(open(soon), NOW)).toEqual({
      text: 'CHALLENGED · 1 MIN LEFT',
      spoken: 'challenged, 1 minute left',
    })
  })

  it('is absent once closes_at passed, and on a closed or missing challenge', () => {
    expect(challengeChip(open(NOW.toISOString()), NOW)).toBeNull()
    expect(
      challengeChip(
        feedCheckin({
          challengeId: 'ch',
          challengeStatus: 'real',
          challengeClosesAt: '2026-11-21T00:00:00Z',
        }),
        NOW,
      ),
    ).toBeNull()
    expect(challengeChip(feedCheckin(), NOW)).toBeNull()
  })
})

describe('challenge sheet copy', () => {
  const item = feedCheckin({ authorName: 'Dev', activityName: 'Study' })

  it('names the check-in by activity, or by task name', () => {
    expect(challengeSheetTitle(item)).toBe("Challenge Dev's Study?")
    expect(challengeOverflowLabel(item)).toBe("More actions for Dev's Study check-in")
    expect(challengeSheetTitle(feedCheckin({ authorName: 'Dev', taskName: 'Groceries' }))).toBe(
      "Challenge Dev's Groceries?",
    )
  })

  it('3+ members: the vote rules, the ritual line and Challenge', () => {
    expect(challengeSheetBody(3)).toBe(
      "Your challenge counts as a Fake vote. The group has 24 h. If nobody else votes, it's ruled Fake; a tie keeps it.",
    )
    expect(challengeSheetMeta(3)).toBe("The photo's a ritual, not a court case.")
    expect(challengeActionLabel(3)).toBe('Challenge')
  })

  it('2 members: the at-once ruling and Rule it Fake', () => {
    expect(challengeSheetBody(2)).toBe(
      "It's just the two of you, so this rules it Fake right away. No vote.",
    )
    expect(challengeSheetMeta(2)).toBeNull()
    expect(challengeActionLabel(2)).toBe('Rule it Fake')
  })
})

describe('challenge failures', () => {
  it('maps the gone codes to one line with no Retry', () => {
    // not_member: the check-in's owner left (the challenger is still in the group).
    for (const code of [
      'already_challenged',
      'challenge_expired',
      'week_locked',
      'not_member',
    ] as const) {
      expect(challengeFailure(code)).toBe('gone')
    }
    expect(challengeFailureText('gone')).toBe("That check-in can't be challenged anymore.")
  })

  it('maps the other codes to their table copy', () => {
    expect(challengeFailure('own_checkin')).toBe('own')
    expect(challengeFailureText('own')).toBe("You can't challenge your own check-in.")
    expect(challengeFailure('group_waiting')).toBe('waiting')
    expect(challengeFailureText('waiting')).toBe('Challenges need a second member in the group.')
    expect(challengeFailure('unknown')).toBe('failed')
  })

  it('has every new code in the AD-14 table', () => {
    for (const code of [
      'own_checkin',
      'already_challenged',
      'challenge_expired',
      'group_waiting',
    ]) {
      expect(isRpcErrorCode(code)).toBe(true)
    }
    expect(errorCopy('already_challenged')).toBe("That check-in can't be challenged anymore.")
    expect(errorCopy('challenge_expired')).toBe("That check-in can't be challenged anymore.")
    // The check-in flow keeps its own copy for week_locked.
    expect(errorCopy('week_locked')).toBe("That week has locked, so this photo can't count.")
  })
})

describe('rulingLine', () => {
  it('Real: the check-in stands, with the counts', () => {
    expect(rulingLine(ruling({ outcome: 'real', fakeCount: 2, realCount: 2 }), 'user-1')).toBe(
      "Ruled Real · Dev's Study stands. 2 Fake, 2 Real.",
    )
  })

  it('Fake by votes', () => {
    expect(rulingLine(ruling(), 'user-1')).toBe("Ruled Fake · Dev's Study removed. 3 Fake, 1 Real.")
  })

  it('Fake by the lone challenger', () => {
    expect(rulingLine(ruling({ variant: 'lone', fakeCount: 1, realCount: 0 }), 'user-1')).toBe(
      "Ruled Fake · nobody else voted · Dev's Study removed.",
    )
  })

  it('Fake in a group of two names the challenger', () => {
    expect(rulingLine(ruling({ variant: 'two_person' }), 'user-1')).toBe(
      "Ruled Fake · Lena challenged · Dev's Study removed.",
    )
  })

  it('follows the Feed’s "You" rule', () => {
    expect(rulingLine(ruling({ variant: 'two_person' }), 'user-3')).toBe(
      "Ruled Fake · You challenged · Dev's Study removed.",
    )
    expect(rulingLine(ruling({ outcome: 'real', fakeCount: 0, realCount: 1 }), 'user-4')).toBe(
      'Ruled Real · Your Study stands. 0 Fake, 1 Real.',
    )
  })
})
