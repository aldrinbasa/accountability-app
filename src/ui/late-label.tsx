import { cn } from '@/ui/lib/utils'

export interface LateLabelProps {
  /** What it shows, e.g. "sent 5 h later" (drawn in capitals). */
  text: string
  /** What a screen reader says, e.g. "sent 5 hours later". */
  spoken: string
  className?: string
}

/**
 * Late label (DESIGN.md `late-label`): a chip on the polaroid meta line, `pola` fill, `obj-late` text
 * and 2px border, `label` type in capitals ("SENT 5 H LATER"), read as "sent 5 hours later".
 */
export function LateLabel({ text, spoken, className }: LateLabelProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-wob-xs border-2 border-obj-late bg-pola px-[7px] py-px type-label text-obj-late',
        className,
      )}
      data-component="late-label"
    >
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  )
}
