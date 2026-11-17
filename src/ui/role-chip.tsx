import { cn } from '@/ui/lib/utils'

export interface RoleChipProps {
  /** `admin`: vote fill with obj-ink. `member`: card fill with ink and line. */
  variant: 'admin' | 'member'
  /** Visible text, e.g. "Admin" (shown in caps by the `label` type). */
  children: string
  className?: string
}

/** Role chip (DESIGN.md `role-chip`): informational, never a control. */
export function RoleChip({ variant, children, className }: RoleChipProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-wob-xs border-2 px-2 py-[2px] type-label',
        variant === 'admin'
          ? 'border-obj-ink bg-vote text-obj-ink'
          : 'border-line bg-card text-ink',
        className,
      )}
      data-variant={variant}
    >
      {children}
    </span>
  )
}
