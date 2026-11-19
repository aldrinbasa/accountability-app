import { forwardRef, useRef, type KeyboardEvent, type Ref } from 'react'
import { Check } from '@phosphor-icons/react'
import { cn } from '@/ui/lib/utils'

export interface WeekdayOption {
  /** ISO weekday (Monday = 1). */
  value: number
  /** The circle's letter: M T W T F S S. */
  letter: string
  /** The full day name, the circle's accessible name ("Friday", or "Today" in single mode). */
  name: string
  /** A visible line under the circle (single mode: "Today" under today's circle). */
  caption?: string
}

interface WeekdaySelectorCommonProps {
  /** The circles to show, in order (single mode passes only today to Sunday). */
  days: readonly WeekdayOption[]
  /** Id of the visible label for the group. */
  labelledBy: string
  /** Id of a Field error or note under the selector. */
  describedBy?: string
  invalid?: boolean
}

export interface WeekdaySelectorMultiProps extends WeekdaySelectorCommonProps {
  mode?: 'multi'
  /** The selected days. */
  value: readonly number[]
  onChange: (value: number[]) => void
}

export interface WeekdaySelectorSingleProps extends WeekdaySelectorCommonProps {
  mode: 'single'
  /** The one selected day, or null. */
  value: number | null
  onChange: (value: number) => void
}

export type WeekdaySelectorProps = WeekdaySelectorMultiProps | WeekdaySelectorSingleProps

const CIRCLE =
  'flex size-target-min shrink-0 flex-col items-center justify-center rounded-full border-2 type-button leading-none'

function circleClass(selected: boolean, invalid: boolean | undefined) {
  return cn(
    CIRCLE,
    selected ? 'border-ink bg-ink text-card' : 'border-line bg-card text-ink press-overlay',
    invalid && !selected && 'border-error',
  )
}

/**
 * Weekday selector (DESIGN.md `weekday-selector`): 44px circles 4px apart. Selected: ink fill, card
 * letter and a check under the letter, so the state never rests on color alone.
 * - Multi mode (fixed days): seven toggle buttons named by their full day ("Friday, selected").
 * - Single mode (task deadline): a radio group of only the days given (today to Sunday), one tab
 *   stop, arrow keys (and Home/End) move and select; a caption such as "Today" sits under a circle.
 * The ref goes to the first circle in multi mode and to the tab stop in single mode (focus target
 * for a Field error).
 */
export const WeekdaySelector = forwardRef<HTMLButtonElement, WeekdaySelectorProps>(
  function WeekdaySelector(props, ref) {
    if (props.mode === 'single') return <SingleWeekdaySelector {...props} forwardedRef={ref} />

    const { days, value, onChange, labelledBy, describedBy, invalid } = props
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
              className={circleClass(selected, invalid)}
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

function SingleWeekdaySelector({
  days,
  value,
  onChange,
  labelledBy,
  describedBy,
  invalid,
  forwardedRef,
}: WeekdaySelectorSingleProps & { forwardedRef: Ref<HTMLButtonElement> }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = days.findIndex((day) => day.value === value)
  const tabStop = selectedIndex === -1 ? 0 : selectedIndex

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % days.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + days.length) % days.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = days.length - 1
    if (next === null) return
    event.preventDefault()
    const day = days[next]
    if (!day) return
    onChange(day.value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className="flex flex-wrap gap-1"
    >
      {days.map((day, index) => {
        const selected = day.value === value
        return (
          <div key={day.value} className="flex flex-col items-center gap-1">
            <button
              ref={(node) => {
                refs.current[index] = node
                if (index !== tabStop) return
                if (typeof forwardedRef === 'function') forwardedRef(node)
                else if (forwardedRef) forwardedRef.current = node
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={day.name}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => {
                if (!selected) onChange(day.value)
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={circleClass(selected, invalid)}
            >
              <span aria-hidden="true">{day.letter}</span>
              {selected ? <Check aria-hidden="true" weight="bold" size={12} /> : null}
            </button>
            {day.caption ? (
              <span aria-hidden="true" className="type-meta text-muted">
                {day.caption}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
