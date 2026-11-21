import { describe, expect, it } from 'vitest'
import {
  contributionLabel,
  goalKickerSpan,
  goalMissedText,
  goalNow,
  goalSavedToast,
  goalShortfall,
  goalStickyLine,
  goalSummary,
  goalTargetText,
  goalValueText,
  monthWeekLabel,
  noScoreNote,
  type FeedGoal,
  type GroupGoal,
} from '@/domain/goal'

const GOAL: GroupGoal = {
  weekStart: '2026-11-16',
  memberCount: 3,
  target: 85,
  period: 'weekly',
  liveAverage: 72,
  monthWeeks: [],
  monthAverage: null,
  monthValueNow: null,
  contributions: [],
  lastResult: null,
}

function feedGoal(item: Partial<FeedGoal>): FeedGoal {
  return {
    type: 'goal',
    id: 'e-1',
    groupId: 'g-1',
    sortAt: '2026-11-19T00:00:01Z',
    weekStart: '2026-11-09',
    period: 'weekly',
    target: 85,
    average: 85,
    hit: true,
    ...item,
  }
}

describe('goal copy', () => {
  it('target text: this week / this month', () => {
    expect(goalTargetText(85, 'weekly')).toBe('85% this week')
    expect(goalTargetText(85, 'monthly')).toBe('85% this month')
  })

  it('values show one decimal only when not whole', () => {
    expect(goalValueText(72)).toBe('72%')
    expect(goalValueText(72.5)).toBe('72.5%')
    expect(goalValueText(85.0)).toBe('85%')
  })

  it('shortfall rounds up to a whole percent', () => {
    expect(goalShortfall(85, 84.5)).toBe(1)
    expect(goalShortfall(85, 81)).toBe(4)
    expect(goalShortfall(85, 80.3)).toBe(5)
    expect(goalShortfall(80, 79.9)).toBe(1)
    // Float noise never adds a percent: 85 - 82.1 is 2.9000000000000057.
    expect(goalShortfall(85, 82.1)).toBe(3)
  })

  it('missed line: weekly and monthly, nobody called out', () => {
    const result = { weekStart: '2026-11-09', target: 85, average: 81, hit: false } as const
    expect(goalMissedText({ ...result, period: 'weekly' })).toBe('Missed by 4%. Next week, then.')
    expect(goalMissedText({ ...result, period: 'monthly', average: 84.5 })).toBe(
      'Missed by 1%. Next month, then.',
    )
  })

  it('feed sticky lines: hit, missed (shortfall rounded up), monthly', () => {
    expect(goalStickyLine(feedGoal({}))).toBe(
      'Goal hit · 85% this week. Nobody let the group down. This time.',
    )
    expect(goalStickyLine(feedGoal({ hit: false, average: 80.5 }))).toBe(
      'Goal missed by 5% · 85% this week. Next week, then.',
    )
    expect(goalStickyLine(feedGoal({ period: 'monthly', hit: false, average: 81 }))).toBe(
      'Goal missed by 4% · 85% this month. Next month, then.',
    )
    expect(goalStickyLine(feedGoal({ period: 'monthly' }))).toBe(
      'Goal hit · 85% this month. Nobody let the group down. This time.',
    )
  })

  it('feed kicker: the week, or the month the closing lock fell in', () => {
    expect(goalKickerSpan(feedGoal({}))).toBe('week of 9 Nov')
    expect(goalKickerSpan(feedGoal({ period: 'monthly', weekStart: '2026-11-16' }))).toBe(
      'November',
    )
    // Week of 21 Sep locks Thu 1 Oct: that lock belongs to October (it never closes September).
    expect(goalKickerSpan(feedGoal({ period: 'monthly', weekStart: '2026-09-21' }))).toBe('October')
  })

  it('accessible summary: "Group goal 85% this week. Now 72%."', () => {
    expect(goalSummary(GOAL)).toBe('Group goal 85% this week. Now 72%.')
    expect(goalSummary({ ...GOAL, liveAverage: null })).toBe(
      'Group goal 85% this week. No scores yet.',
    )
    expect(goalSummary({ ...GOAL, target: null, period: null })).toBe('Group goal')
  })

  it("now: a monthly goal shows the server's month value now (what the lock would decide), a weekly goal the live week", () => {
    expect(goalNow(GOAL)).toBe(72)
    expect(goalNow({ ...GOAL, monthValueNow: 90 })).toBe(72)
    // The closing week: the locked weeks average 86, the live week pulls the month to 84.
    expect(goalNow({ ...GOAL, period: 'monthly', monthAverage: 86, monthValueNow: 84 })).toBe(84)
    // Before the month's first lock the month value is the live week alone.
    expect(goalNow({ ...GOAL, period: 'monthly', monthAverage: null, monthValueNow: 72 })).toBe(72)
    // No week with a value yet (nobody scored, or a group that was solo all month).
    expect(goalNow({ ...GOAL, period: 'monthly', monthAverage: null, monthValueNow: null })).toBe(
      null,
    )
    expect(goalSummary({ ...GOAL, period: 'monthly', monthAverage: 86, monthValueNow: 84 })).toBe(
      'Group goal 85% this month. Now 84%.',
    )
  })

  it('contribution labels: "Priya, 64%" or "Priya, no score"', () => {
    expect(contributionLabel({ userId: 'u', name: 'Priya', weeklyPoints: 64 })).toBe('Priya, 64%')
    expect(contributionLabel({ userId: 'u', name: 'Priya', weeklyPoints: null })).toBe(
      'Priya, no score',
    )
  })

  it('the no-score note names who is left out, or nothing', () => {
    expect(noScoreNote([{ userId: 'a', name: 'Jo', weeklyPoints: 80 }])).toBeNull()
    expect(
      noScoreNote([
        { userId: 'a', name: 'Jo', weeklyPoints: 80 },
        { userId: 'b', name: 'Priya', weeklyPoints: null },
      ]),
    ).toBe("Priya has no score, so they're left out of the average.")
    expect(
      noScoreNote([
        { userId: 'b', name: 'Priya', weeklyPoints: null },
        { userId: 'c', name: 'Sam', weeklyPoints: null },
      ]),
    ).toBe("Priya & Sam have no score, so they're left out of the average.")
  })

  it('toast and month week labels', () => {
    expect(goalSavedToast(85, 'weekly')).toBe('Goal set: 85% this week.')
    expect(goalSavedToast(90, 'monthly')).toBe('Goal set: 90% this month.')
    expect(monthWeekLabel({ weekStart: '2026-11-02', average: 70 })).toBe('Week of 2 Nov, 70%')
  })
})
