import { cn } from '@/ui/lib/utils'

/**
 * Miss chip (DESIGN.md `miss-chip`): "MISS" in `label` (uppercase through the type style) on an
 * `obj-miss` fill with `obj-on-miss` text, `wob-xs` corners, tilted -3deg. Sits on miss stickies.
 */
export function MissChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block -rotate-3 rounded-wob-xs border-2 border-obj-miss bg-obj-miss px-[7px] type-label text-obj-on-miss',
        className,
      )}
      data-component="miss-chip"
    >
      {label}
    </span>
  )
}
