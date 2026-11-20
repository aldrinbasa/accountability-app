import { describe, expect, it } from 'vitest'
import {
  boardLayout,
  memberSentence,
  missText,
  passedChipText,
  planSummary,
  previousWeekStart,
  rankChipText,
  scoreStickerLabel,
  shortDays,
  unscoredText,
  weekChipText,
  type BoardRow,
  type PlanItem,
} from '@/domain/board'

function row(
  userId: string,
  displayName: string,
  weeklyPoints: number | null,
  rank: number | null,
): BoardRow {
  return {
    userId,
    displayName,
    avatarPath: null,
    weeklyPoints,
    sessionsDone: 0,
    sessionsPlanned: 0,
    sessionsFrozen: 0,
    rank,
    missCount: 0,
    bestStreak: 0,
    plan: [],
    taskCount: 0,
  }
}

// Jo 67 #1, Marco 63 #2, Priya 50 #3, Sam 50 #3, Ana 40 #5 (separated from nobody), Lee unscored.
const BOARD: BoardRow[] = [
  row('jo', 'Jo', 67, 1),
  row('marco', 'Marco', 63, 2),
  row('sam', 'Sam', 50, 3),
  row('priya', 'Priya', 50, 3),
  row('ana', 'Ana', 40, 5),
  row('lee', 'Lee', null, null),
]

describe('rankChipText', () => {
  it('first: the gap to the member ranked second', () => {
    expect(rankChipText(BOARD, 'jo')).toBe('#1 · 4 ahead of Marco')
  })

  it('middle: the member directly above and the gap', () => {
    expect(rankChipText(BOARD, 'marco')).toBe("#2 · Jo's 4 ahead")
    // Below a shared rank: the first of the tied members above, by name.
    expect(rankChipText(BOARD, 'ana')).toBe("#5 · Priya's 10 ahead")
  })

  it('tied: the first other tied member by name', () => {
    expect(rankChipText(BOARD, 'sam')).toBe('#3 · tied with Priya')
    expect(rankChipText(BOARD, 'priya')).toBe('#3 · tied with Sam')
    const tiedFirst = [row('a', 'Zoe', 80, 1), row('b', 'Ben', 80, 1), row('c', 'Cy', 80, 1)]
    expect(rankChipText(tiedFirst, 'a')).toBe('#1 · tied with Ben')
  })

  it('level on points: separated only by sessions', () => {
    const level = [row('a', 'Marco', 67, 1), row('b', 'Jo', 67, 2), row('c', 'Kim', 67, 3)]
    expect(rankChipText(level, 'c')).toBe('#3 · level with Jo on points')
    expect(rankChipText(level, 'a')).toBe('#1 · level with Jo on points')
  })

  it('only ranked member: "#1"', () => {
    expect(rankChipText([row('a', 'Jo', 50, 1), row('b', 'Sam', null, null)], 'a')).toBe('#1')
  })

  it('hidden when unranked or missing', () => {
    expect(rankChipText(BOARD, 'lee')).toBeNull()
    expect(rankChipText(BOARD, 'nobody')).toBeNull()
    expect(rankChipText([row('a', 'Jo', 100, null)], 'a')).toBeNull()
  })

  it('passed: names the passed member ranked best now', () => {
    expect(rankChipText(BOARD, 'jo', ['marco'])).toBe('#1 · passed Marco')
    expect(rankChipText(BOARD, 'marco', ['ana', 'sam', 'priya'])).toBe('#2 · passed Priya')
    // A passed member who has climbed back above no longer counts.
    expect(rankChipText(BOARD, 'marco', ['jo'])).toBe("#2 · Jo's 4 ahead")
    // Unknown ids (a member who left) are ignored.
    expect(rankChipText(BOARD, 'jo', ['gone'])).toBe('#1 · 4 ahead of Marco')
  })
})

describe('passedChipText', () => {
  it('names the best-ranked passed member whatever their rank, or null', () => {
    expect(passedChipText(BOARD, 1, ['sam', 'priya', 'marco'])).toBe('#1 · passed Marco')
    expect(passedChipText(BOARD, 3, ['sam', 'priya'])).toBe('#3 · passed Priya')
    expect(passedChipText(BOARD, 1, ['gone'])).toBeNull()
  })
})

describe('scoreStickerLabel', () => {
  it('names the points and where the tap goes', () => {
    expect(scoreStickerLabel(67)).toBe('67 weekly points. Open the leaderboard')
    expect(scoreStickerLabel(null)).toBe('No score this week. Open the leaderboard')
  })
})

const gym3x: PlanItem = {
  activityName: 'Gym',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
}
const studyMwf: PlanItem = {
  activityName: 'Study',
  scheduleType: 'fixed_days',
  days: [1, 3, 5],
  target: null,
}
const paintTuTh: PlanItem = {
  activityName: 'Paint',
  scheduleType: 'fixed_days',
  days: [4, 2],
  target: null,
}

describe('planSummary (Story 4.3)', () => {
  it('reads like "Gym 3x · Study MWF · Paint Tu/Th · 1 task"', () => {
    expect(planSummary([gym3x, studyMwf, paintTuTh], 1)).toBe(
      'Gym 3x · Study MWF · Paint Tu/Th · 1 task',
    )
  })

  it('times per week as "Nx"', () => {
    expect(planSummary([{ ...gym3x, target: 5 }], 0)).toBe('Gym 5x')
  })

  it('fixed days as short weekdays', () => {
    expect(shortDays([4])).toBe('Thu')
    expect(shortDays([6])).toBe('Sat')
    expect(shortDays([5, 1])).toBe('MF')
    expect(shortDays([1, 3, 6])).toBe('Mo/We/Sa')
    expect(shortDays([1, 2, 3, 4, 5, 6, 7])).toBe('daily')
    expect(planSummary([{ ...studyMwf, days: [7] }], 0)).toBe('Study Sun')
  })

  it('counts tasks, alone or after the commitments', () => {
    expect(planSummary([], 1)).toBe('1 task')
    expect(planSummary([], 2)).toBe('2 tasks')
    expect(planSummary([gym3x], 3)).toBe('Gym 3x · 3 tasks')
  })

  it('an empty plan is empty', () => {
    expect(planSummary([], 0)).toBe('')
  })
})

describe('Board layout (Story 4.3)', () => {
  it('podium blocks for ranks 1-3 (ties share one), rows from 4th, unscored last', () => {
    const layout = boardLayout(BOARD)
    expect(layout.podium.map((block) => [block.rank, block.rows.map((r) => r.userId)])).toEqual([
      [1, ['jo']],
      [2, ['marco']],
      [3, ['sam', 'priya']],
    ])
    expect(layout.rows.map((r) => r.userId)).toEqual(['ana'])
    expect(layout.unscored.map((r) => r.userId)).toEqual(['lee'])
  })

  it('a missing rank has no block: 1, 1, 3', () => {
    const layout = boardLayout([
      row('a', 'Ann', 80, 1),
      row('b', 'Bo', 80, 1),
      row('c', 'Cy', 50, 3),
    ])
    expect(layout.podium.map((block) => [block.rank, block.rows.length])).toEqual([
      [1, 2],
      [3, 1],
    ])
    expect(layout.rows).toEqual([])
  })

  it('two ranked members: 1st and 2nd blocks, no rows', () => {
    const layout = boardLayout([row('a', 'Ann', 80, 1), row('b', 'Bo', 50, 2)])
    expect(layout.podium.map((block) => block.rank)).toEqual([1, 2])
    expect(layout.rows).toEqual([])
  })
})

describe('Board copy (Story 4.3)', () => {
  it('miss marks text', () => {
    expect(missText(1, 'this')).toBe('1 miss this week')
    expect(missText(3, 'this')).toBe('3 misses this week')
    expect(missText(2, 'last')).toBe('2 misses last week')
  })

  it('week chip: this week, zone named when it differs, last week, locked', () => {
    const lockAt = '2026-11-26T00:00:00Z'
    const base = { lockAt, groupZone: 'Europe/London', memberZone: 'Europe/London', locked: false }
    expect(weekChipText({ ...base, week: 'this' })).toBe('This week · locks Wed 23:59 after Sun')
    expect(weekChipText({ ...base, week: 'this', memberZone: 'Europe/Berlin' })).toBe(
      'This week · locks Wed 23:59 London time after Sun',
    )
    expect(weekChipText({ ...base, week: 'last' })).toBe('Locks Wed 23:59 · can still change')
    expect(weekChipText({ ...base, week: 'last', memberZone: 'Europe/Berlin' })).toBe(
      'Locks Wed 23:59 London time · can still change',
    )
    expect(weekChipText({ ...base, week: 'last', locked: true })).toBe('Locked')
  })

  it('previous week start is the Monday before', () => {
    expect(previousWeekStart('2026-11-16')).toBe('2026-11-09')
    expect(previousWeekStart('2026-03-02')).toBe('2026-02-23')
  })

  it('unscored text, with the whole-week-frozen prefix', () => {
    expect(unscoredText(row('a', 'Priya', null, null), 'this')).toBe('no score this week')
    const frozen = { ...row('a', 'Priya', null, null), sessionsPlanned: 3, sessionsFrozen: 3 }
    expect(unscoredText(frozen, 'this')).toBe('Whole week frozen · back Mon · no score this week')
    // Last week: "back Mon" is already past.
    expect(unscoredText(frozen, 'last')).toBe('no score last week')
  })

  it('member sentence: name, rank, points, plan, misses and streak', () => {
    const marco = {
      ...row('m', 'Marco', 88, 1),
      plan: [{ ...gym3x, target: 5 }],
      taskCount: 1,
      missCount: 2,
      bestStreak: 8,
    }
    expect(memberSentence(marco, 'this')).toBe(
      'Marco, rank 1, 88 weekly points, Gym 5x · 1 task, 2 misses this week, best current streak 8.',
    )
    expect(memberSentence(row('l', 'Lee', null, null), 'last')).toBe('Lee, no score last week.')
  })
})
