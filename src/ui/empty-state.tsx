import type { ReactNode } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface EmptyStateAction {
  label: string
  onClick: () => void
}

export interface EmptyStateProps {
  /** Phosphor doodle, drawn at 64px Duotone. */
  icon: PhosphorIcon
  /** The handwritten line (`hand-lg`). */
  line: string
  /**
   * The `body-sm` muted sentence that carries the meaning. Leave it out only when the line already
   * says everything (e.g. "You're not in Sunday Reset anymore.").
   */
  body?: string
  /** At most one primary action. */
  action?: EmptyStateAction
  /** A ready-made action element in place of `action` (e.g. a button that opens a sheet). */
  actionSlot?: ReactNode
  className?: string
}

/** Empty state (DESIGN.md `empty-state`): centered doodle, a hand line, a meaning sentence, one action. */
export function EmptyState({ icon, line, body, action, actionSlot, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center gap-2 px-2 py-[28px] text-center', className)}
      data-component="empty-state"
    >
      <Icon icon={icon} size={64} />
      <p className="type-hand-lg">{line}</p>
      {body ? <p className="max-w-[30ch] type-body-sm text-muted">{body}</p> : null}
      {action ? (
        <Button variant="primary" className="mt-2" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : (
        actionSlot
      )}
    </div>
  )
}
