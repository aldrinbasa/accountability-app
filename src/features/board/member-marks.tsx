import { missText, streakLabel, type BoardRow, type BoardWeek } from '@/domain/board'
import { MissMarks } from '@/ui/miss-marks'
import { StreakCounter } from '@/ui/streak-counter'
import { cn } from '@/ui/lib/utils'

/**
 * A member's miss marks and flame: one X per missed session of the week, then the small Streak
 * counter with the best current streak (hidden at 0). Nothing when there is neither.
 */
export function MemberMarks({
  row,
  week,
  className,
}: {
  row: BoardRow
  week: BoardWeek
  className?: string
}) {
  if (row.missCount <= 0 && row.bestStreak <= 0) return null
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      <MissMarks count={row.missCount} label={missText(row.missCount, week)} />
      {row.bestStreak > 0 ? (
        <StreakCounter value={row.bestStreak} size="sm" label={streakLabel(row.bestStreak)} />
      ) : null}
    </span>
  )
}
