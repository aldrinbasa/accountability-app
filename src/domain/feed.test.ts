import { describe, expect, it } from 'vitest'
import {
  checkinAlt,
  checkinHeading,
  checkinLateLabel,
  checkinMeta,
  eventLine,
  formatFeedStamp,
  missDay,
  missLine,
  photoRenditions,
  winnerStickyLine,
  type FeedCheckin,
  type FeedEvent,
  type FeedMiss,
  type FeedViewer,
  type FeedWinner,
} from '@/domain/feed'

const NOW = new Date('2026-11-20T09:00:00Z') // Friday 20 Nov, 09:00 London (GMT)
const viewer: FeedViewer = { userId: 'jo', zone: 'Europe/London', now: NOW }

function checkin(overrides: Partial<FeedCheckin> = {}): FeedCheckin {
  return {
    type: 'checkin',
    id: 'c-1',
    groupId: 'g-1',
    sortAt: '2026-11-20T07:12:30.000000+00:00',
    authorId: 'marco',
    authorName: 'Marco',
    authorAvatarPath: null,
    commitmentId: 'cm-1',
    commitmentKind: 'commitment',
    activityName: 'Gym',
    presetKey: 'gym',
    taskName: null,
    capturedAt: '2026-11-20T07:12:00Z',
    receivedAt: '2026-11-20T07:12:30Z',
    isLate: false,
    isExtra: false,
    caption: 'leg day. send help.',
    fullPrunedAt: null,
    countedPosition: 3,
    target: 3,
    ...overrides,
  }
}

function event(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    type: 'event',
    kind: 'member_joined',
    id: 'e-1',
    groupId: 'g-1',
    sortAt: '2026-11-20T07:00:00Z',
    actorId: 'priya',
    actorName: 'Priya',
    subjectId: null,
    subjectName: null,
    ...overrides,
  }
}

describe('formatFeedStamp', () => {
  it('shows the clock for today, the weekday within 6 days, the date when older', () => {
    expect(formatFeedStamp('2026-11-20T07:12:00Z', 'Europe/London', NOW)).toBe('07:12')
    expect(formatFeedStamp('2026-11-19T07:12:00Z', 'Europe/London', NOW)).toBe('Thu 07:12')
    expect(formatFeedStamp('2026-11-14T07:12:00Z', 'Europe/London', NOW)).toBe('Sat 07:12')
    expect(formatFeedStamp('2026-11-13T07:12:00Z', 'Europe/London', NOW)).toBe('13 Nov')
  })

  it('uses the viewer zone for the day and the clock', () => {
    // 23:30 UTC on Thursday is already Friday 07:30 in Manila.
    expect(formatFeedStamp('2026-11-19T23:30:00Z', 'Asia/Manila', NOW)).toBe('07:30')
  })
})

describe('check-in text', () => {
  it('builds the meta, heading and alt from the server fields', () => {
    const item = checkin()
    expect(checkinMeta(item, viewer)).toBe('Marco · Gym · 3/3 · 07:12')
    expect(checkinHeading(item, viewer)).toBe('Marco · Gym · 07:12')
    expect(checkinAlt(item, viewer)).toBe(
      "Marco's Gym check-in, 07:12, caption: leg day. send help.",
    )
  })

  it('says extra instead of a fraction, and no fraction for a task', () => {
    expect(
      checkinMeta(checkin({ isExtra: true, countedPosition: null, target: null }), viewer),
    ).toBe('Marco · Gym · extra · 07:12')
    expect(
      checkinMeta(
        checkin({ commitmentKind: 'task', taskName: 'Grocery run', countedPosition: 1, target: 1 }),
        viewer,
      ),
    ).toBe('Marco · Grocery run · 07:12')
  })

  it('reads "You" for the viewer\'s own check-in', () => {
    const own = checkin({ authorId: 'jo', authorName: 'Jo', caption: null })
    expect(checkinMeta(own, viewer)).toBe('You · Gym · 3/3 · 07:12')
    expect(checkinAlt(own, viewer)).toBe('Your Gym check-in, 07:12')
  })

  it('labels late check-ins only', () => {
    expect(checkinLateLabel(checkin())).toBeNull()
    expect(
      checkinLateLabel(
        checkin({
          isLate: true,
          capturedAt: '2026-11-19T07:00:00Z',
          receivedAt: '2026-11-19T12:30:00Z',
        }),
      ),
    ).toEqual({ text: 'sent 5 h later', spoken: 'sent 5 hours later' })
  })
})

describe('eventLine', () => {
  it('words each sticky', () => {
    expect(eventLine(event(), 'jo')).toBe('Priya joined.')
    expect(eventLine(event({ kind: 'member_left', actorName: 'Sam' }), 'jo')).toBe('Sam left.')
    expect(
      eventLine(
        event({ kind: 'member_removed', actorName: 'Jo', subjectId: 'sam', subjectName: 'Sam' }),
        'marco',
      ),
    ).toBe('Sam was removed.')
    expect(
      eventLine(
        event({
          kind: 'admin_handover',
          actorId: 'jo',
          actorName: 'Jo',
          subjectId: 'marco',
          subjectName: 'Marco',
        }),
        'priya',
      ),
    ).toBe('Jo left. Marco is admin now.')
  })

  it('reads "You" for the viewer', () => {
    expect(eventLine(event({ actorId: 'jo', actorName: 'Jo' }), 'jo')).toBe('You joined.')
    expect(
      eventLine(
        event({
          kind: 'admin_handover',
          actorId: 'jo',
          actorName: 'Jo',
          subjectId: 'marco',
          subjectName: 'Marco',
        }),
        'marco',
      ),
    ).toBe("Jo left. You're admin now.")
  })
})

describe('photoRenditions', () => {
  const fast = { saveData: false, effectiveType: '4g' }
  it('uses 360 only for small boxes, pruned photos, Save-Data and 2g', () => {
    expect(photoRenditions({ small: false, fullPruned: false, hints: fast })).toBe('responsive')
    expect(photoRenditions({ small: true, fullPruned: false, hints: fast })).toBe('small')
    expect(photoRenditions({ small: false, fullPruned: true, hints: fast })).toBe('small')
    expect(
      photoRenditions({ small: false, fullPruned: false, hints: { ...fast, saveData: true } }),
    ).toBe('small')
    expect(
      photoRenditions({
        small: false,
        fullPruned: false,
        hints: { saveData: false, effectiveType: 'slow-2g' },
      }),
    ).toBe('small')
    expect(
      photoRenditions({
        small: false,
        fullPruned: false,
        hints: { saveData: false, effectiveType: null },
      }),
    ).toBe('responsive')
  })
})

function miss(overrides: Partial<FeedMiss> = {}): FeedMiss {
  return {
    type: 'miss',
    id: 'm-1',
    groupId: 'g-1',
    sortAt: '2026-11-20T00:00:30Z',
    actorId: 'dev',
    actorName: 'Dev',
    commitmentId: 'cm-2',
    title: 'Paint',
    scheduleType: 'fixed_days',
    missCount: 1,
    tease: 'couch_wins',
    missedOn: '2026-11-19',
    ...overrides,
  }
}

describe('missLine', () => {
  it("words another member's miss with the tease", () => {
    expect(missLine(miss(), 'jo')).toBe('Dev missed Paint. The couch wins this round.')
  })

  it("reads 'You' for the viewer's own miss", () => {
    expect(missLine(miss({ actorId: 'jo', tease: 'couch_regards' }), 'jo')).toBe(
      'You missed Paint. The couch sends its regards.',
    )
  })

  it('counts times-per-week sessions, singular and plural', () => {
    const week = miss({ title: 'Gym', scheduleType: 'times_per_week', tease: 'couch_comfortable' })
    expect(missLine({ ...week, missCount: 2 }, 'jo')).toBe(
      'Dev missed 2 Gym sessions. The couch is getting comfortable.',
    )
    expect(missLine({ ...week, missCount: 1, tease: 'couch_thanks' }, 'jo')).toBe(
      'Dev missed 1 Gym session. The couch says thanks for visiting.',
    )
  })

  it('uses the task name for a task', () => {
    expect(
      missLine(miss({ title: 'Tax forms', scheduleType: null, tease: 'couch_loses' }), 'jo'),
    ).toBe('Dev missed Tax forms. Next time, the couch loses.')
  })

  it('leaves an unknown tease off', () => {
    expect(missLine(miss({ tease: 'couch_sings' }), 'jo')).toBe('Dev missed Paint.')
    expect(missLine(miss({ tease: null }), 'jo')).toBe('Dev missed Paint.')
  })
})

describe('missDay', () => {
  it('shows the weekday within the last 6 days, the date when older', () => {
    expect(missDay('2026-11-19', 'Europe/London', NOW)).toBe('Thu')
    expect(missDay('2026-11-14', 'Europe/London', NOW)).toBe('Sat')
    expect(missDay('2026-11-13', 'Europe/London', NOW)).toBe('13 Nov')
  })

  it('counts days in the viewer zone, and is empty without a day', () => {
    // Friday 23:30 UTC is still Friday in London but already Saturday in Kiritimati (UTC+14).
    const late = new Date('2026-11-20T23:30:00Z')
    expect(missDay('2026-11-14', 'Europe/London', late)).toBe('Sat')
    expect(missDay('2026-11-14', 'Pacific/Kiritimati', late)).toBe('14 Nov')
    // A member ahead of the viewer: their Saturday is the viewer's tomorrow.
    expect(missDay('2026-11-21', 'Europe/London', NOW)).toBe('Sat')
    expect(missDay('2026-11-22', 'Europe/London', NOW)).toBe('22 Nov')
    expect(missDay(null, 'Europe/London', NOW)).toBe('')
    expect(missDay('soon', 'Europe/London', NOW)).toBe('')
  })
})

describe('winnerStickyLine (Story 4.5)', () => {
  function winner(winners: FeedWinner['winners']): FeedWinner {
    return {
      type: 'winner',
      id: 'w-1',
      groupId: 'g-1',
      sortAt: '2026-11-19T00:00:30.000000+00:00',
      weekStart: '2026-11-09',
      weeklyPoints: 94,
      winners,
    }
  }

  it('a single winner, with the tease naming them', () => {
    expect(winnerStickyLine(winner([{ userId: 'marco', name: 'Marco' }]), 'jo')).toBe(
      "Last week's winner · Marco · 94 · Bow down. Or just beat Marco.",
    )
  })

  it('co-winners: names joined with "&", "each", no tease', () => {
    expect(
      winnerStickyLine(
        winner([
          { userId: 'jo', name: 'Jo' },
          { userId: 'marco', name: 'Marco' },
        ]),
        'dev',
      ),
    ).toBe("Last week's winners · Jo & Marco · 94 each.")
  })

  it('the winner reading their own sticky gets no tease', () => {
    expect(winnerStickyLine(winner([{ userId: 'marco', name: 'Marco' }]), 'marco')).toBe(
      "Last week's winner · Marco · 94.",
    )
  })
})
