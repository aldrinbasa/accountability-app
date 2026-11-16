import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/ui/lib/utils'

/**
 * Buttons per DESIGN.md Components. There is no disabled look anywhere: a busy button swaps its
 * label (e.g. "Saving…") and ignores repeat taps, but stays focusable and fully drawn.
 * `secondary`, `ghost` and `link` belong on paper and card only; on objects use `on-object` or
 * `primary-on-object`.
 */
const buttonVariants = cva(
  'inline-flex min-h-target-min items-center justify-center gap-2 text-center select-none',
  {
    variants: {
      variant: {
        primary:
          'rounded-wob-sm border-[2.5px] border-line bg-primary px-4 py-2 text-on-primary shadow-ink-lg type-button-lg press-offset-lg',
        secondary:
          'rounded-wob-sm border-[2.5px] border-line bg-card px-4 py-2 text-ink shadow-ink type-button press-offset',
        ghost:
          'rounded-wob-sm border-[2.5px] border-dashed border-line bg-transparent px-4 py-2 text-ink type-button press-overlay',
        link: 'rounded-wob-xs px-1 text-ink underline decoration-2 underline-offset-3 type-button press-overlay',
        'on-object':
          'on-object rounded-wob-sm border-[2.5px] border-obj-ink bg-pola px-4 py-2 text-obj-ink shadow-obj type-button press-offset aria-pressed:bg-obj-ink aria-pressed:text-pola',
        'primary-on-object':
          'on-object rounded-wob-sm border-[2.5px] border-obj-ink bg-primary px-4 py-2 text-on-primary shadow-obj-lg type-button-lg press-offset-lg',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', fullWidth: false },
  },
)

/** `disabled` is left out on purpose: no disabled-looking buttons anywhere (use `busy`). */
export interface ButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'>,
    VariantProps<typeof buttonVariants> {
  /** While true, the label reads `busyLabel` and taps are ignored. */
  busy?: boolean
  /** Label shown while busy, e.g. "Saving…" or "Posting…". */
  busyLabel?: string
  /** For `on-object` buttons that show a cast choice (vote). Sets aria-pressed. */
  selected?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    fullWidth,
    busy = false,
    busyLabel,
    selected,
    className,
    children,
    onClick,
    type = 'button',
    ...props
  },
  ref,
) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, fullWidth }), className)}
      aria-busy={busy || undefined}
      aria-pressed={selected}
      onClick={handleClick}
      {...props}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
})
