import type { CSSProperties, ReactNode } from 'react'
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'
import { WarningCircle } from '@phosphor-icons/react'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import type { ToastAction } from '@/ui/toast'

/** One toast slip: the yellow sticky, or the pola error slip with a cobalt edge and icon. */
export function ToastSlip({
  id,
  message,
  variant,
  action,
}: {
  id: string | number
  message: ReactNode
  variant: 'sticky' | 'error'
  action?: ToastAction
}) {
  return (
    // Tap anywhere on the slip dismisses it early; the action button stops that tap.
    <div
      onClick={() => sonnerToast.dismiss(id)}
      className={cn(
        'on-object flex w-full items-center gap-3 rounded-sticky py-2 pr-2 pl-[14px] type-body-sm text-obj-ink',
        variant === 'error'
          ? 'border-[2.5px] border-obj-error bg-pola'
          : 'border-2 border-obj-ink bg-sticky',
      )}
      data-variant={variant}
    >
      {variant === 'error' ? (
        <Icon icon={WarningCircle} size={24} tone="obj-error" className="text-obj-error" />
      ) : null}
      <p className="min-w-0 flex-1 py-1">{message}</p>
      {action ? (
        <Button
          variant="on-object"
          onClick={(event) => {
            event.stopPropagation()
            action.onClick()
            sonnerToast.dismiss(id)
          }}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

const toasterStyle = {
  '--width':
    'min(calc(var(--spacing-content-max) - 2 * var(--spacing-gutter)), calc(100vw - 2 * var(--spacing-gutter)))',
} as CSSProperties

// Side offsets keep the slip inside the 480px column (and clear of landscape side insets).
const columnInset = 'calc((100vw - var(--spacing-content-max)) / 2 + var(--spacing-gutter))'
const bottomOffset = {
  bottom: 'var(--nav-clearance)',
  left: `max(var(--spacing-gutter), env(safe-area-inset-left), ${columnInset})`,
  right: `max(var(--spacing-gutter), env(safe-area-inset-right), ${columnInset})`,
}

/**
 * The single toast region, mounted once at the app root. Bottom-center inside the 480px column,
 * above the nav and clear of the lifted Camera button and the bottom safe area. `aria-live="polite"`
 * comes from sonner's region; the focus hotkey is turned off so a toast never takes focus.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      visibleToasts={1}
      hotkey={[]}
      gap={0}
      offset={bottomOffset}
      mobileOffset={bottomOffset}
      swipeDirections={['bottom', 'left', 'right']}
      containerAriaLabel="Notifications"
      style={toasterStyle}
      toastOptions={{ unstyled: true }}
    />
  )
}
