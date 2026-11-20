import type { MouseEvent } from 'react'
import { cn } from '@/ui/lib/utils'

export interface ScoreStickerProps {
  /** Weekly points, or null for no score this week. */
  points: number | null
  /** The unit under the numeral ("Weekly points", set in uppercase). */
  unit: string
  /** Replaces the numeral when there is no score ("no score this week"). */
  emptyText: string
  /** The accessible name ("67 weekly points. Open the leaderboard"). */
  label: string
  /** Where a tap goes. */
  href: string
  /** A plain click (modified clicks open the link as usual). */
  onOpen: () => void
  /** Plays the 400 ms count bump on the numeral (the post moment). */
  bump?: boolean
}

/**
 * The Score sticker (DESIGN.md `score-sticker`): a lavender paper object (3px obj-ink outline,
 * wob-lg, -3deg, hard sticker shadow) with the weekly points in numeral-xl and the unit in label
 * type, or "no score this week" in title-sm. A link: a press shifts it by its offset.
 */
export function ScoreSticker({
  points,
  unit,
  emptyText,
  label,
  href,
  onOpen,
  bump,
}: ScoreStickerProps) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    event.preventDefault()
    onOpen()
  }

  return (
    <a
      href={href}
      onClick={onClick}
      aria-label={label}
      data-component="score-sticker"
      className="on-object flex min-h-target-min min-w-[118px] flex-none -rotate-3 flex-col items-center justify-center rounded-wob-lg border-3 border-obj-ink bg-vote px-3.5 pt-2.5 pb-2 text-center text-obj-ink no-underline shadow-score press-offset-lg"
    >
      {points === null ? (
        <span className="max-w-[8ch] py-2 type-title-sm">{emptyText}</span>
      ) : (
        <span
          className={cn('inline-block type-numeral-xl tabular-nums', bump && 'animate-count-bump')}
        >
          {points}
        </span>
      )}
      <span className="mt-0.5 type-label">{unit}</span>
    </a>
  )
}
