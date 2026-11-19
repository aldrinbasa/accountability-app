import { useId, type ReactNode } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface HintAction {
  label: string
  onClick: () => void
}

export interface HintProps {
  icon: PhosphorIcon
  children: ReactNode
  /** Text links under the message, e.g. Install and Not now. Each is a 44px target. */
  actions?: HintAction[]
  className?: string
}

/**
 * Hint (DESIGN.md `hint`): a dashed muted box with an icon on the left and `body-sm` text, for soft
 * suggestions (install, push off, ritual note). Its actions, including the dismiss, are text links.
 */
export function Hint({ icon, children, actions = [], className }: HintProps) {
  // Each action reads with the message ("Not now" alone says little).
  const messageId = useId()
  return (
    <div
      className={cn(
        'flex items-start gap-[10px] rounded-wob border-[2.5px] border-dashed border-muted px-3 pt-[10px] pb-1 type-body-sm text-muted',
        className,
      )}
      data-component="hint"
    >
      <Icon icon={icon} size={24} className="mt-px text-ink" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p id={messageId} className={actions.length === 0 ? 'pb-[6px]' : undefined}>
          {children}
        </p>
        {actions.length > 0 ? (
          <div className="-ml-1 flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.label}
                variant="link"
                aria-describedby={messageId}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
