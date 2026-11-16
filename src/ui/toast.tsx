import type { ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'
import { ToastSlip } from '@/ui/toaster'

/** 4 s plain, 5 s when the toast carries an action (EXPERIENCE.md Toast). */
export const TOAST_DURATION_MS = 4000
export const TOAST_WITH_ACTION_DURATION_MS = 5000

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** `sticky` = the yellow sticky slip (default); `error` = pola slip with a cobalt edge and icon. */
  variant?: 'sticky' | 'error'
  /** One button on object, e.g. Undo, Retry, Update. */
  action?: ToastAction
  /** Stays until tapped, swiped or acted on (e.g. "Update ready."). */
  persistent?: boolean
  /** Reuse an id to replace a toast instead of raising a second one. */
  id?: string
}

/** Raise a toast. Only one shows at a time; it never takes focus and is read politely. */
export function showToast(message: ReactNode, options: ToastOptions = {}): string | number {
  const { variant = 'sticky', action, persistent = false, id } = options
  const duration = persistent
    ? Number.POSITIVE_INFINITY
    : action
      ? TOAST_WITH_ACTION_DURATION_MS
      : TOAST_DURATION_MS
  return sonnerToast.custom(
    (toastId) => <ToastSlip id={toastId} message={message} variant={variant} action={action} />,
    { duration, id },
  )
}

export function dismissToast(id?: string | number): void {
  sonnerToast.dismiss(id)
}
