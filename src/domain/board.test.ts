import { describe, expect, it } from 'vitest'
import { passedChipText, rankChipText, scoreStickerLabel, type BoardRow } from '@/domain/board'

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
