import type { ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface FieldErrorProps {
  /** Referenced by the field's `aria-describedby`. */
  id: string
  children: ReactNode
  /** Optional follow-up control after the message, e.g. a "Send a new one" link. */
  action?: ReactNode
  className?: string
}

/**
 * Field error per DESIGN.md `field-error`: cobalt (never red) body-sm text after a Duotone
 * warning-circle. `role="alert"` so it is announced when it appears on submit.
 */
export function FieldError({ id, children, action, className }: FieldErrorProps) {
  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <p id={id} role="alert" className="flex items-start gap-2 type-body-sm text-error">
        <Icon icon={WarningCircle} size={20} tone="error" />
        <span>{children}</span>
      </p>
      {action}
    </div>
  )
}
