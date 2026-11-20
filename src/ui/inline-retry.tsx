import type { ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface InlineRetryProps {
  /** Cause and fix, e.g. "You're offline. Groups need a signal to start." */
  children: ReactNode
  /** Leave out when retrying cannot help (e.g. too late to delete): then no Retry link shows. */
  onRetry?: () => void
  retryLabel?: string
  /**
   * On an object (a polaroid frame): `obj-error` outline, `obj-ink` text, the cause stacked over a
   * `button-on-object` Retry, centered in the box it fills.
   */
  onObject?: boolean
  className?: string
}

/**
 * Inline retry (DESIGN.md `inline-retry`): a dashed cobalt box (never red) placed where the failed
 * thing is, with a warning icon, the cause and fix in `body-sm` ink, and a Retry text link (none
 * without `onRetry`).
 * Announced when it appears.
 */
export function InlineRetry({
  children,
  onRetry,
  retryLabel = 'Retry',
  onObject = false,
  className,
}: InlineRetryProps) {
  if (onObject) {
    return (
      <div
        role="alert"
        className={cn(
          'on-object flex flex-col items-center justify-center gap-2 rounded-wob-sm border-2 border-dashed border-obj-error p-3 text-center type-body-sm text-obj-ink',
          className,
        )}
        data-component="inline-retry"
        data-on-object=""
      >
        <Icon icon={WarningCircle} size={32} tone="obj-error" className="text-obj-error" />
        <p className="font-extrabold">{children}</p>
        {onRetry ? (
          <Button variant="on-object" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-2 rounded-wob-sm border-2 border-dashed border-error py-1 pr-1 pl-3 type-body-sm text-ink',
        !onRetry && 'min-h-target-min pr-3',
        className,
      )}
      data-component="inline-retry"
    >
      <Icon icon={WarningCircle} size={20} tone="error" className="text-error" />
      <p className="min-w-0 flex-1">{children}</p>
      {onRetry ? (
        <Button variant="link" className="shrink-0" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
