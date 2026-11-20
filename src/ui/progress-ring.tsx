import { Check } from '@phosphor-icons/react'
import { cn } from '@/ui/lib/utils'
import { ringFraction } from '@/ui/ring-fraction'

const SIZE = 60
const STROKE = 7
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export interface ProgressRingProps {
  /** Check-ins that count so far. */
  value: number
  /** Check-ins owed. */
  target: number
  /** The accessible name, e.g. "Gym, 0 of 3 this week". The ring is one image to assistive tech. */
  label: string
  className?: string
}

/**
 * Progress ring (DESIGN.md `progress-ring`): 60px, a 7px round-capped `success` stroke over a 15%
 * `line` track. The fraction ("2/3") is always centered in `title-sm`, so progress never relies on
 * the stroke alone; at target the ring is full with a check under the fraction. Never overfills.
 */
export function ProgressRing({ value, target, label, className }: ProgressRingProps) {
  const fraction = ringFraction(value, target)
  const met = target > 0 && value >= target
  const drawn = fraction * CIRCUMFERENCE
  return (
    <div
      role="img"
      aria-label={label}
      data-component="progress-ring"
      data-met={met ? '' : undefined}
      className={cn('relative size-[60px] shrink-0', className)}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        className="block -rotate-90"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-line opacity-15"
        />
        {fraction > 0 ? (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${drawn.toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
            className="stroke-success"
            data-ring-progress=""
          />
        ) : null}
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center text-ink tabular-nums type-title-sm"
      >
        {value}/{target}
        {met ? <Check weight="bold" size={20} className="text-success" data-ring-check="" /> : null}
      </span>
    </div>
  )
}
