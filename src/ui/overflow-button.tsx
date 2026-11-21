import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { DotsThree } from '@phosphor-icons/react'
import { cn } from '@/ui/lib/utils'

export interface OverflowButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Names its target, e.g. "More actions for Marco's Gym check-in". */
  label: string
  /** On a paper object (polaroid frame): `obj-ink`; else `ink`. */
  onObject?: boolean
}

/**
 * Overflow button (DESIGN.md `overflow-button`): a 44px hit area with Phosphor DotsThree at 24px, no
 * fill or border, and the 12% pressed overlay. Opens a small Sheet of actions (`aria-haspopup`).
 */
export const OverflowButton = forwardRef<HTMLButtonElement, OverflowButtonProps>(
  function OverflowButton({ label, onObject = false, className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-haspopup="dialog"
        className={cn(
          'inline-flex size-target-min shrink-0 items-center justify-center rounded-full',
          onObject ? 'text-obj-ink press-overlay-obj' : 'text-ink press-overlay',
          className,
        )}
        data-component="overflow-button"
        {...props}
      >
        <DotsThree weight="bold" size={24} aria-hidden="true" focusable="false" />
      </button>
    )
  },
)
