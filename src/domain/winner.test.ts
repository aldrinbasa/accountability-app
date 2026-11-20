import { describe, expect, it } from 'vitest'
import {
  hasWinners,
  joinNames,
  parseWinnerWeekStart,
  shouldAutoShowWinner,
  weekOfLabel,
  winnerButtonLabel,
  winnerHeading,
  winnerLine,
  winnerMemberSentence,
  winnerPodiumBlocks,
  winnerPoints,
  type WinnerPodiumMember,
  type WinnerWeek,
} from '@/domain/winner'

function member(
  userId: string,
  displayName: string,
  weeklyPoints: number,
  rank: number,
  isWinner: boolean,
): WinnerPodiumMember {
  return { userId, displayName, avatarPath: null, weeklyPoints, rank, isWinner }
}

const LOCK = '2026-11-18T16:00:00.000Z'

function week(podium: WinnerPodiumMember[], overrides: Partial<WinnerWeek> = {}): WinnerWeek {
  return {
    weekStart: '2026-11-09',
    lockAt: LOCK,
    scored: true,
    ranked: true,
    winnerUserIds: podium.filter((m) => m.isWinner).map((m) => m.userId),
    podium,
    ...overrides,
  }
}

const SINGLE = week([
  member('marco', 'Marco', 94, 1, true),
  member('jo', 'Jo', 80, 2, false),
  member('dev', 'Dev', 70, 3, false),
])
// Tied on points, split by sessions: Marco stored at rank 2.
const CO = week([
  member('jo', 'Jo', 94, 1, true),
  member('marco', 'Marco', 94, 2, true),
  member('dev', 'Dev', 70, 3, false),
])

describe('show-once rule (Story 4.5)', () => {
  const joinedBefore = '2026-11-01T00:00:00.000Z'

  it('shows the latest locked week with winners once, for a member who joined before its lock', () => {
    expect(shouldAutoShowWinner({ week: SINGLE, seen: false, joinedAt: joinedBefore })).toBe(true)
  })

  it('never shows again on this device once the seen key is stored', () => {
    expect(shouldAutoShowWinner({ week: SINGLE, seen: true, joinedAt: joinedBefore })).toBe(false)
  })

  it('never shows to a member who joined at or after the lock', () => {
    expect(shouldAutoShowWinner({ week: SINGLE, seen: false, joinedAt: LOCK })).toBe(false)
    expect(
      shouldAutoShowWinner({ week: SINGLE, seen: false, joinedAt: '2026-11-19T08:00:00.000Z' }),
    ).toBe(false)
  })

  it('shows nothing when the latest locked week has no winner (an older unseen week never queues up)', () => {
    const none = week([member('a', 'Ann', 0, 1, false)], { winnerUserIds: [] })
    expect(shouldAutoShowWinner({ week: none, seen: false, joinedAt: joinedBefore })).toBe(false)
    expect(shouldAutoShowWinner({ week: null, seen: false, joinedAt: joinedBefore })).toBe(false)
    expect(shouldAutoShowWinner({ week: undefined, seen: false, joinedAt: joinedBefore })).toBe(
      false,
    )
  })

  it('shows nothing when every winner left the podium (an anonymized account, Epic 7)', () => {
    const gone = week([member('jo', 'Jo', 80, 2, false)], { winnerUserIds: ['deleted'] })
    expect(hasWinners(gone)).toBe(false)
  })

  it('shows nothing for a group of one (not ranked) or an unscored week', () => {
    expect(hasWinners(week([], { ranked: false, winnerUserIds: [] }))).toBe(false)
    expect(hasWinners(week([], { scored: false, ranked: false, winnerUserIds: [] }))).toBe(false)
  })
})

describe('Winner card copy (Story 4.5)', () => {
  it('heading: winner, or winners for co-winners', () => {
    expect(winnerHeading(1)).toBe("Last week's winner")
    expect(winnerHeading(2)).toBe("Last week's winners")
  })

  it('points: "94", or "94 each" for co-winners', () => {
    expect(winnerPoints(94, 1)).toBe('94')
    expect(winnerPoints(94, 2)).toBe('94 each')
  })

  it('names are joined with "&"', () => {
    expect(joinNames(['Marco'])).toBe('Marco')
    expect(joinNames(['Jo', 'Marco'])).toBe('Jo & Marco')
    expect(joinNames(['Ann', 'Jo', 'Marco'])).toBe('Ann, Jo & Marco')
    expect(joinNames([])).toBe('')
  })

  it('button: "Nice" for a winner (co-winners too), "Fine." for everyone else', () => {
    expect(winnerButtonLabel(SINGLE, 'marco')).toBe('Nice')
    expect(winnerButtonLabel(SINGLE, 'jo')).toBe('Fine.')
    expect(winnerButtonLabel(CO, 'marco')).toBe('Nice')
    expect(winnerButtonLabel(CO, 'dev')).toBe('Fine.')
  })

  it("line: the tease for someone else's single win, else the badge line", () => {
    expect(winnerLine(SINGLE, 'jo')).toBe('Bow down. Or just beat Marco.')
    expect(winnerLine(SINGLE, 'marco')).toBe('Top of the board. Enjoy it while it lasts.')
    expect(winnerLine(CO, 'dev')).toBe('Top of the board. Enjoy it while it lasts.')
  })

  it('podium: every winner on the 1st block, the rest on their own ranks', () => {
    expect(winnerPodiumBlocks(CO).map((b) => [b.place, b.members.map((m) => m.userId)])).toEqual([
      [1, ['jo', 'marco']],
      [3, ['dev']],
    ])
    expect(winnerPodiumBlocks(SINGLE).map((b) => b.place)).toEqual([1, 2, 3])
  })

  it('screen-reader sentence: a co-winner reads as rank 1', () => {
    expect(winnerMemberSentence(member('marco', 'Marco', 94, 2, true))).toBe(
      'Marco, rank 1, weekly winner, 94 weekly points.',
    )
    expect(winnerMemberSentence(member('dev', 'Dev', 70, 3, false))).toBe(
      'Dev, rank 3, 70 weekly points.',
    )
  })
})

describe('deep link and sticky helpers (Story 4.5)', () => {
  it('accepts only a real Monday as the week', () => {
    expect(parseWinnerWeekStart('2026-11-09')).toBe('2026-11-09')
    expect(parseWinnerWeekStart('2026-11-10')).toBeNull()
    expect(parseWinnerWeekStart('2026-02-30')).toBeNull()
    expect(parseWinnerWeekStart('nope')).toBeNull()
    expect(parseWinnerWeekStart(undefined)).toBeNull()
  })

  it('names the week: "week of 9 Nov"', () => {
    expect(weekOfLabel('2026-11-09')).toBe('week of 9 Nov')
    expect(weekOfLabel('bad')).toBe('')
  })
})
