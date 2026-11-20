/**
 * Streaks (Story 4.2, FR-25): what `get_streaks` returns and the copy built from it. Every streak
 * is the server's (AD-4: `private.current_streak`); this file only formats them.
 */

/** One `get_streaks` row: a commitment or task of a current member of the group. */
export interface Streak {
  commitmentId: string
  userId: string
  /** Kept sessions (fixed days) or target-met weeks (times per week) in a row; null for a task. */
  currentStreak: number | null
  /** The streak is 0 now but was above 0 before: the meta reads "back to 0". */
  backToZero: boolean
}

export const STREAK_COPY = {
  streak: 'streak',
  backToZero: 'back to 0',
} as const

/** The streak values whose numeral plays the milestone pop (UX-DR114). */
export const STREAK_MILESTONES: readonly number[] = [3, 10, 25]

export function isStreakMilestone(value: number | null | undefined): boolean {
  return typeof value === 'number' && STREAK_MILESTONES.includes(value)
}

/**
 * The streak part of a row's meta line: "streak 6", or "back to 0" from a reset until the streak is
 * above 0 again (the next kept session, or the next target-met week). Null when there is nothing to say: a task, a streak not loaded yet, or a commitment that
 * never had a streak (never "streak 0", and no streak-guilt copy).
 */
export function streakMeta(
  streak: Pick<Streak, 'currentStreak' | 'backToZero'> | undefined,
): string | null {
  if (!streak || streak.currentStreak === null) return null
  if (streak.currentStreak > 0) return `${STREAK_COPY.streak} ${streak.currentStreak}`
  return streak.backToZero ? STREAK_COPY.backToZero : null
}

/** `get_streaks` rows by commitment id. */
export function streaksByCommitment(streaks: readonly Streak[] | undefined): Map<string, Streak> {
  return new Map((streaks ?? []).map((streak) => [streak.commitmentId, streak]))
}
