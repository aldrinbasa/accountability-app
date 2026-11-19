import type { ReactNode } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface BannerAction {
  label: string
  onClick: () => void
}

export interface BannerProps {
  /** Phosphor icon, drawn with a sticky soft tone on the ink strip. */
  icon: PhosphorIcon
  children: ReactNode
  /** One button on object, on sticky fill without offset (e.g. "Show me how", Retry, Got it). */
  action?: BannerAction
  className?: string
}

/**
 * Banner (DESIGN.md `banner`): an inverted ink strip with card text, for persistent notices such as
 * offline, photo waiting, or the Safari-tab install notice. Not dismissible by itself; it goes away
 * when its cause is resolved (or through its own action, e.g. Got it).
 */
export function Banner({ icon, children, action, className }: BannerProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-[10px] rounded-wob-sm bg-ink py-2 pr-2 pl-3 type-body-sm text-card',
        className,
      )}
      data-component="banner"
    >
      <Icon icon={icon} size={24} tone="sticky" />
      <p className="min-w-0 flex-1 font-bold">{children}</p>
      {action ? (
        <Button
          variant="on-object"
          className="shrink-0 bg-sticky px-3 whitespace-nowrap shadow-none!"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
