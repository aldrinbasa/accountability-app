import { Fire } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface StreakCounterProps {
  /** The streak (the server's `current_streak`). */
  value: number
  /** The accessible name of the whole counter ("Streak 6", "Best current streak 6"). */
  label: string
  /** The unit under the numeral at size `md` ("in a row"); the small variant has none. */
  unit?: string
  /**
   * `md` (24px or larger, Me and profiles): Duotone fire and the numeral in numeral-md in `streak`.
   * `sm` (under 24px, the Board flame): the numeral in title-sm in ink beside a 20px streak fire,
   * never the streak color on a small numeral (UX-DR3).
   */
  size?: 'md' | 'sm'
  /** Plays the milestone pop once on the numeral (3, 10 or 25). */
  pop?: boolean
  className?: string
}

/**
 * The Streak counter (DESIGN.md `streak-counter`): one image named by `label`; the fire and the
 * numeral inside are hidden from assistive tech.
 */
export function StreakCounter({
  value,
  label,
  unit,
  size = 'md',
  pop = false,
  className,
}: StreakCounterProps) {
  const small = size === 'sm'
  return (
    <span
      role="img"
      aria-label={label}
      data-component="streak-counter"
      data-size={size}
      className={cn('inline-flex items-center', small ? 'gap-1' : 'flex-col gap-0.5', className)}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        <Icon icon={Fire} size={small ? 20 : 32} tone="streak" className="text-streak" />
        <span
          className={cn(
            'inline-block tabular-nums',
            small ? 'type-title-sm text-ink' : 'type-numeral-md text-streak',
            pop && 'animate-streak-pop',
          )}
        >
          {value}
        </span>
      </span>
      {!small && unit ? (
        <span aria-hidden="true" className="type-meta text-muted">
          {unit}
        </span>
      ) : null}
    </span>
  )
}
