import { forwardRef, type ButtonHTMLAttributes } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  icon: PhosphorIcon
  /** Accessible name, required: an icon alone has none (e.g. "Close", "Notifications, 3 unread"). */
  label: string
}

/** Icon button: 44px blob, card fill, 2.5px line outline, 24px Duotone icon. Bell, back, sheet close. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex size-target-min shrink-0 items-center justify-center rounded-blob border-[2.5px] border-line bg-card text-ink press-overlay',
        className,
      )}
      {...props}
    >
      <Icon icon={icon} size={24} />
    </button>
  )
})
