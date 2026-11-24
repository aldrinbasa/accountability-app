import { cn } from '@/ui/lib/utils'

export interface VoteChipProps {
  /** What it shows, e.g. "QUESTIONED · 18 H LEFT". */
  text: string
  /** What a screen reader says, e.g. "questioned, 18 hours left". */
  spoken: string
  className?: string
}

/**
 * Vote chip (DESIGN.md `vote-chip`): `vote` fill, `obj-ink` text and 2px border, `wob-xs` corners,
 * `label` type ("QUESTIONED · 18 H LEFT"). Sits on a polaroid under an open challenge; the words
 * carry the meaning, not the color.
 */
export function VoteChip({ text, spoken, className }: VoteChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-wob-xs border-2 border-obj-ink bg-vote px-[7px] py-px type-label text-obj-ink',
        className,
      )}
      data-component="vote-chip"
    >
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  )
}
