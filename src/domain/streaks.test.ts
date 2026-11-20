import { describe, expect, it } from 'vitest'
import { isStreakMilestone, streakMeta, streaksByCommitment, type Streak } from '@/domain/streaks'

function streak(currentStreak: number | null, backToZero = false): Streak {
  return { commitmentId: 'c1', userId: 'u1', currentStreak, backToZero }
}

describe('streakMeta', () => {
  it('reads "streak N" for a running streak', () => {
    expect(streakMeta(streak(6))).toBe('streak 6')
    expect(streakMeta(streak(1))).toBe('streak 1')
  })

  it('reads "back to 0" right after a reset, never "streak 0"', () => {
    expect(streakMeta(streak(0, true))).toBe('back to 0')
  })

  it('says nothing for a commitment that never had a streak', () => {
    expect(streakMeta(streak(0, false))).toBeNull()
  })

  it('says nothing for a task or a streak not loaded yet', () => {
    expect(streakMeta(streak(null))).toBeNull()
    expect(streakMeta(undefined)).toBeNull()
  })
})

describe('isStreakMilestone', () => {
  it('is true exactly at 3, 10 and 25', () => {
    expect([2, 3, 4, 9, 10, 11, 24, 25, 26].filter(isStreakMilestone)).toEqual([3, 10, 25])
    expect(isStreakMilestone(null)).toBe(false)
    expect(isStreakMilestone(undefined)).toBe(false)
  })
})

describe('streaksByCommitment', () => {
  it('maps rows by commitment id and accepts no data', () => {
    const rows = [streak(2), { ...streak(5), commitmentId: 'c2' }]
    expect(streaksByCommitment(rows).get('c2')?.currentStreak).toBe(5)
    expect(streaksByCommitment(undefined).size).toBe(0)
  })
})
