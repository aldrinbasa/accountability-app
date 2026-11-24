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
  canShowOverturn,
  CHALLENGE_COPY,
  overturnButtonLabel,
  overturnFailure,
  overturnLine,
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
    overturnUntil: '2026-11-22T15:59:00.000Z',
    canOverturn: false,
    overturnedById: null,
    overturnedByName: null,
    overturnedAt: null,
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
      text: 'QUESTIONED · 18 H LEFT',
      spoken: 'questioned, 18 hours left',
    })
  })

  it('says 1 hour in the singular', () => {
    const closes = new Date(NOW.getTime() + 3_600_000).toISOString()
    expect(challengeChip(open(closes), NOW)?.spoken).toBe('questioned, 1 hour left')
  })

  it('shows minutes under 1 hour, at least 1', () => {
    const closes = new Date(NOW.getTime() + 59 * 60_000 + 59_000).toISOString()
    expect(challengeChip(open(closes), NOW)?.text).toBe('QUESTIONED · 59 MIN LEFT')
    const soon = new Date(NOW.getTime() + 10_000).toISOString()
    expect(challengeChip(open(soon), NOW)).toEqual({
      text: 'QUESTIONED · 1 MIN LEFT',
      spoken: 'questioned, 1 minute left',
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
    expect(challengeSheetTitle(item)).toBe("Question Dev's Study?")
    expect(challengeOverflowLabel(item)).toBe("More actions for Dev's Study check-in")
    expect(challengeSheetTitle(feedCheckin({ authorName: 'Dev', taskName: 'Groceries' }))).toBe(
      "Question Dev's Groceries?",
    )
  })

  it('3+ members: the vote rules, the ritual line and Question it', () => {
    expect(challengeSheetBody(3)).toBe(
      "This casts your vote: doesn't count. The group has 24 h. If nobody else votes, it doesn't count; a tie keeps it.",
    )
    expect(challengeSheetMeta(3)).toBe("The photo's a ritual, not a court case.")
    expect(challengeActionLabel(3)).toBe('Question it')
  })

  it("2 members: the at-once result and Don't count it", () => {
    expect(challengeSheetBody(2)).toBe(
      "It's just the two of you, so it stops counting right away. No vote.",
    )
    expect(challengeSheetMeta(2)).toBeNull()
    expect(challengeActionLabel(2)).toBe("Don't count it")
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
    expect(challengeFailureText('gone')).toBe("That check-in can't be questioned anymore.")
  })

  it('maps the other codes to their table copy', () => {
    expect(challengeFailure('own_checkin')).toBe('own')
    expect(challengeFailureText('own')).toBe("You can't question your own check-in.")
    expect(challengeFailure('group_waiting')).toBe('waiting')
    expect(challengeFailureText('waiting')).toBe(
      'Questioning a check-in needs a second member in the group.',
    )
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
    expect(errorCopy('already_challenged')).toBe("That check-in can't be questioned anymore.")
    expect(errorCopy('challenge_expired')).toBe("That check-in can't be questioned anymore.")
    // The check-in flow keeps its own copy for week_locked.
    expect(errorCopy('week_locked')).toBe("That week has locked, so this photo can't count.")
  })
})

describe('rulingLine', () => {
  it('counts: a tie keeps it, a majority backed it, with both counts', () => {
    expect(rulingLine(ruling({ outcome: 'real', fakeCount: 2, realCount: 2 }), 'user-1')).toBe(
      "Counts · a tie keeps it · Dev's Study · 2 said it counts, 2 said it doesn't.",
    )
    expect(rulingLine(ruling({ outcome: 'real', fakeCount: 1, realCount: 2 }), 'user-1')).toBe(
      "Counts · the group backed it · Dev's Study · 2 said it counts, 1 said it doesn't.",
    )
  })

  it('didn’t count by votes', () => {
    expect(rulingLine(ruling(), 'user-1')).toBe(
      "Didn't count · Dev's Study · 3 said it doesn't count, 1 said it counts.",
    )
  })

  it('didn’t count: nobody else voted', () => {
    expect(rulingLine(ruling({ variant: 'lone', fakeCount: 1, realCount: 0 }), 'user-1')).toBe(
      "Didn't count · Dev's Study · nobody else voted.",
    )
  })

  it('didn’t count in a group of two names who questioned it', () => {
    expect(rulingLine(ruling({ variant: 'two_person' }), 'user-1')).toBe(
      "Didn't count · Dev's Study · Lena questioned it.",
    )
  })

  it('follows the Feed’s "You" rule', () => {
    expect(rulingLine(ruling({ variant: 'two_person' }), 'user-3')).toBe(
      "Didn't count · Dev's Study · You questioned it.",
    )
    expect(rulingLine(ruling({ outcome: 'real', fakeCount: 0, realCount: 1 }), 'user-4')).toBe(
      "Counts · the group backed it · Your Study · 1 said it counts, 0 said it doesn't.",
    )
  })
})

describe('overturn (Story 5.3)', () => {
  const overturned = { overturnedById: 'user-1', overturnedByName: 'Jo' }

  it('words the overturned line with the "You" rule', () => {
    expect(overturnLine(ruling(overturned), 'Study', 'user-9')).toBe(
      "Overturned by Jo · Dev's Study is back.",
    )
    expect(overturnLine(ruling(overturned), 'Study', 'user-1')).toBe(
      "Overturned by you · Dev's Study is back.",
    )
    expect(overturnLine(ruling(overturned), 'Study', 'user-4')).toBe(
      'Overturned by Jo · Your Study is back.',
    )
    expect(overturnLine(ruling(), 'Study', 'user-1')).toBeNull()
    // The admin's profile name gone: the event's name still reads.
    expect(
      overturnLine(ruling({ overturnedById: null, overturnedByName: 'Jo' }), 'Study', 'user-9'),
    ).toBe("Overturned by Jo · Dev's Study is back.")
  })

  it('shows the button only when the server allows it and before overturn_until', () => {
    const before = new Date('2026-11-22T15:58:59.000Z')
    const at = new Date('2026-11-22T15:59:00.000Z')
    expect(canShowOverturn(ruling({ canOverturn: true }), before)).toBe(true)
    expect(canShowOverturn(ruling({ canOverturn: true }), at)).toBe(false)
    expect(canShowOverturn(ruling(), before)).toBe(false)
    expect(canShowOverturn(ruling({ canOverturn: true, outcome: 'real' }), before)).toBe(false)
    expect(canShowOverturn(ruling({ canOverturn: true, ...overturned }), before)).toBe(false)
    expect(canShowOverturn(ruling({ canOverturn: true, overturnUntil: null }), before)).toBe(false)
    expect(canShowOverturn(ruling({ canOverturn: true, overturnUntil: 'nope' }), before)).toBe(
      false,
    )
  })

  it("labels the button with the lock in the group's zone, naming it when the member's differs", () => {
    // Monday 00:00 Manila is the lock: it reads as Sun 23:59.
    expect(overturnButtonLabel('2026-11-22T16:00:00.000Z', 'Asia/Manila', 'Asia/Manila')).toBe(
      'Overturn (admin) until Sun 23:59',
    )
    expect(overturnButtonLabel('2026-11-22T23:59:00.000Z', 'Europe/London', 'Asia/Manila')).toBe(
      'Overturn (admin) until Sun 23:59 London time',
    )
  })

  it('maps failures: offline, refusals with their copy, anything else to Retry', () => {
    expect(overturnFailure('network', true)).toEqual({
      kind: 'offline',
      text: "You're offline. Overturns need a signal.",
    })
    expect(overturnFailure('network', false)).toEqual({ kind: 'failed' })
    expect(overturnFailure('unknown', false)).toEqual({ kind: 'failed' })
    expect(overturnFailure('week_locked', false)).toEqual({
      kind: 'refused',
      text: 'This week has locked. The result is final.',
    })
    expect(overturnFailure('not_admin', false)).toEqual({
      kind: 'refused',
      text: 'Only the group admin can overturn a result.',
    })
    expect(overturnFailure('not_fake_ruling', false)).toEqual({
      kind: 'refused',
      text: "Only a check-in that didn't count can be overturned.",
    })
    expect(overturnFailure('already_overturned', false)).toEqual({
      kind: 'refused',
      text: 'That check-in already counts again.',
    })
    expect(overturnFailure('not_member', false)).toEqual({
      kind: 'refused',
      text: 'That member left the group, so the result stands.',
    })
    expect(overturnFailure('own_checkin', false)).toEqual({
      kind: 'refused',
      text: CHALLENGE_COPY.overturnOwn,
    })
  })
})
