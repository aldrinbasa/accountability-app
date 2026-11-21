import { cn } from '@/ui/lib/utils'

export interface RankChipProps {
  /** "#2". */
  rank: string
  /** "Marco's 4 ahead", or null for the bare rank. */
  detail: string | null
  /** Plays the 300 ms wobble once (keyed by the caller). */
  wobble?: boolean
  onWobbleEnd?: () => void
}

/**
 * The rank chip (DESIGN.md `rank-chip`): a card chip (2.5px line outline, wob-sm) with the rank in
 * title type and the detail in button weight, "#2 · Marco's 4 ahead". The wobble swaps it in when
 * the rank changes (transform only).
 */
export function RankChip({ rank, detail, wobble, onWobbleEnd }: RankChipProps) {
  return (
    <p
      data-component="rank-chip"
      className={cn(
        'inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 self-start rounded-wob-sm border-[2.5px] border-line bg-card px-2.5 py-1.5 type-button text-ink',
        wobble && 'animate-chip-wobble',
      )}
      onAnimationEnd={wobble ? onWobbleEnd : undefined}
    >
      <b className="type-title">{rank}</b>
      {detail ? <span>{` · ${detail}`}</span> : null}
    </p>
  )
}
