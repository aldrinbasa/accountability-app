import { useRef } from 'react'
import { Minus, Plus } from '@phosphor-icons/react'
import { IconButton } from '@/ui/icon-button'

export interface StepperProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  /** Unit after the value in `meta` muted, e.g. "times per week". */
  unit: string
  /** The announced value, e.g. "4 times per week". */
  valueLabel: (value: number) => string
  /** The value as shown (default the number itself), e.g. steps of 5 shown as "85%". */
  display?: (value: number) => string
  decrementLabel: string
  incrementLabel: string
  /** Id of the visible label for the group. */
  labelledBy: string
}

/**
 * Stepper (DESIGN.md `stepper`): minus and plus Icon buttons around the value in `numeral-md`, the
 * unit in `meta` muted. At `min` the minus is hidden, at `max` the plus. Each change is announced
 * politely ("4 times per week"). When the pressed button disappears at a bound, focus moves to the
 * other one so it is never lost.
 */
export function Stepper({
  value,
  onChange,
  min,
  max,
  unit,
  valueLabel,
  display = String,
  decrementLabel,
  incrementLabel,
  labelledBy,
}: StepperProps) {
  const minusRef = useRef<HTMLButtonElement>(null)
  const plusRef = useRef<HTMLButtonElement>(null)

  function step(delta: number) {
    const next = Math.min(max, Math.max(min, value + delta))
    if (next === value) return
    onChange(next)
    if (next === min) requestAnimationFrame(() => plusRef.current?.focus())
    if (next === max) requestAnimationFrame(() => minusRef.current?.focus())
  }

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="flex flex-wrap items-center gap-[14px]"
    >
      {/* Hidden at a bound but kept in the layout, so the value and plus never jump sideways. */}
      <IconButton
        ref={minusRef}
        icon={Minus}
        label={decrementLabel}
        aria-hidden={value <= min || undefined}
        tabIndex={value <= min ? -1 : undefined}
        className={value <= min ? 'invisible' : undefined}
        onClick={() => step(-1)}
      />
      <span
        aria-live="polite"
        className="min-w-[48px] text-center type-numeral-md tabular-nums"
        data-stepper-value=""
      >
        <span aria-hidden="true">{display(value)}</span>
        <span className="sr-only">{valueLabel(value)}</span>
      </span>
      <IconButton
        ref={plusRef}
        icon={Plus}
        label={incrementLabel}
        aria-hidden={value >= max || undefined}
        tabIndex={value >= max ? -1 : undefined}
        className={value >= max ? 'invisible' : undefined}
        onClick={() => step(1)}
      />
      {unit ? (
        <span aria-hidden="true" className="type-meta text-muted">
          {unit}
        </span>
      ) : null}
    </div>
  )
}
