import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/ui/lib/utils'

export interface GoogleButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'children'
> {
  /** While true, taps are ignored (the browser is on its way to Google). */
  busy?: boolean
}

/** Google's four-colour "G" mark, unmodified (Google sign-in branding guidelines). */
function GoogleMark() {
  return (
    <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  )
}

/**
 * "Continue with Google" in Google's own branded style: the light theme in light mode, the dark
 * theme in dark mode (follows the app theme, `data-theme`, through the `dark:` variant), 44px minimum. A plain OAuth redirect, no
 * Google Identity Services script. Colours are Google's, not Proofy tokens, by design.
 */
export function GoogleButton({
  busy = false,
  className,
  onClick,
  type = 'button',
  ...props
}: GoogleButtonProps) {
  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
      className={cn(
        'inline-flex min-h-target-min w-full items-center justify-center gap-3 rounded-full border px-4 py-2',
        'border-[#747775] bg-[#FFFFFF] text-[#1F1F1F]',
        'dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]',
        'font-body text-[0.9375rem] leading-tight font-semibold press-overlay',
        className,
      )}
      {...props}
    >
      <GoogleMark />
      <span>Continue with Google</span>
    </button>
  )
}
