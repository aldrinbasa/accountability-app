import { cn } from '@/ui/lib/utils'

/** The hand-drawn X (UX mockup `key-board.html` `#xmark`), drawn in the current color. */
function MissMark() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={18}
      height={18}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        d="M4.2 4.6c3.6 3.1 7.1 7.4 11.6 11.2M15.6 3.8c-3.2 4.1-7.2 8.2-11.4 12.3"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  )
}

export interface MissMarksProps {
  /** How many marks (one per missed session); nothing renders at 0. */
  count: number
  /** Screen-reader text for all of them ("2 misses this week"). */
  label: string
  className?: string
}

/**
 * Miss marks (DESIGN.md `miss-mark`): one 18px hand-drawn X in `miss` per missed session, with one
 * visually hidden sentence for screen readers. Informational only.
 */
export function MissMarks({ count, label, className }: MissMarksProps) {
  if (count <= 0) return null
  return (
    <span
      data-component="miss-marks"
      className={cn('inline-flex flex-wrap items-center gap-0.5 text-miss', className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <MissMark key={index} />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  )
}
