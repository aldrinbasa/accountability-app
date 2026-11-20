import { Clock } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

/**
 * Week chip (DESIGN.md `week-chip`): a sticky-yellow object with `obj-ink` text and outline, `meta`
 * type and a clock doodle. Says which week the Board shows and when it locks.
 */
export function WeekChip({ text, className }: { text: string; className?: string }) {
  return (
    <p
      data-component="week-chip"
      className={cn(
        'inline-flex items-center gap-[6px] self-start rounded-wob-sm border-2 border-obj-ink bg-sticky px-[10px] py-[5px] type-meta text-obj-ink',
        className,
      )}
    >
      <Icon icon={Clock} size={20} />
      <span>{text}</span>
    </p>
  )
}
