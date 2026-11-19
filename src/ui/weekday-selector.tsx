import { forwardRef } from 'react'
import { Check } from '@phosphor-icons/react'
import { cn } from '@/ui/lib/utils'

export interface WeekdayOption {
  /** ISO weekday (Monday = 1). */
  value: number
  /** The circle's letter: M T W T F S S. */
  letter: string
  /** The full day name, the circle's accessible name ("Friday"). */
  name: string
}

export interface WeekdaySelectorProps {
  days: readonly WeekdayOption[]
  /** The selected days (multi mode). */
  value: readonly number[]
  onChange: (value: number[]) => void
  /** Id of the visible label for the group. */
  labelledBy: string
  /** Id of a Field error or note under the selector. */
  describedBy?: string
  invalid?: boolean
}

/**
 * Weekday selector in multi mode (DESIGN.md `weekday-selector`): seven 44px circles 4px apart, each
 * a toggle button named by its full day ("Friday, selected"). Selected: ink fill, card letter and a
 * check under the letter, so the state never rests on color alone. The ref goes to the first circle
 * (focus target for a Field error).
 */
export const WeekdaySelector = forwardRef<HTMLButtonElement, WeekdaySelectorProps>(
  function WeekdaySelector({ days, value, onChange, labelledBy, describedBy, invalid }, ref) {
    function toggle(day: number) {
      onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day])
    }

    return (
      <div
        role="group"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className="flex flex-wrap gap-1"
      >
        {days.map((day, index) => {
          const selected = value.includes(day.value)
          return (
            <button
              key={day.value}
              ref={index === 0 ? ref : undefined}
              type="button"
              aria-pressed={selected}
              aria-label={selected ? `${day.name}, selected` : day.name}
              onClick={() => toggle(day.value)}
              className={cn(
                'flex size-target-min shrink-0 flex-col items-center justify-center rounded-full border-2 type-button leading-none',
                selected
                  ? 'border-ink bg-ink text-card'
                  : 'border-line bg-card text-ink press-overlay',
                invalid && !selected && 'border-error',
              )}
            >
              <span aria-hidden="true">{day.letter}</span>
              {selected ? <Check aria-hidden="true" weight="bold" size={12} /> : null}
            </button>
          )
        })}
      </div>
    )
  },
)
