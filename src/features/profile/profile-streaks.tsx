import { useId } from 'react'
import { PROFILE_COPY, type ProfileStreak } from '@/domain/badges'
import { STREAK_COPY } from '@/domain/streaks'
import { StreakCounter } from '@/ui/streak-counter'

/** "Gym streak 6" / "Gym back to 0" / "Gym streak 0": the counter's accessible name. */
function streakLabel(streak: ProfileStreak): string {
  if (streak.currentStreak === 0 && streak.backToZero) {
    return `${streak.activityName} ${STREAK_COPY.backToZero}`
  }
  return `${streak.activityName} ${STREAK_COPY.streak} ${streak.currentStreak}`
}

/**
 * Streak per active commitment (Story 4.6, the Streak counter from Story 4.2 at `md`): the
 * activity, the counter and "back to 0" after a reset. Hidden with nothing planned.
 */
export function ProfileStreaks({ streaks }: { streaks: readonly ProfileStreak[] }) {
  const headingId = useId()
  if (streaks.length === 0) return null
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
      data-component="profile-streaks"
    >
      <h2 id={headingId} className="type-title">
        {PROFILE_COPY.streaks}
      </h2>
      <ul className="card flex flex-col p-0">
        {streaks.map((streak) => (
          <li key={streak.commitmentId} className="flex min-h-row-min items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 type-title-sm [overflow-wrap:anywhere]">
              {streak.activityName}
              {streak.currentStreak === 0 && streak.backToZero ? (
                <span className="block type-meta text-muted">{STREAK_COPY.backToZero}</span>
              ) : null}
            </span>
            <StreakCounter value={streak.currentStreak} label={streakLabel(streak)} />
          </li>
        ))}
      </ul>
    </section>
  )
}
