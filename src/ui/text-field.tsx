import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { FieldError } from '@/ui/field-error'
import { cn } from '@/ui/lib/utils'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'disabled'> {
  /** Visible label above the field (never placeholder-only). */
  label: string
  /** Field error message. While set, the border turns cobalt and the field is `aria-invalid`. */
  error?: ReactNode
  /** Optional control under the error message, e.g. "Send a new one". */
  errorAction?: ReactNode
}

/**
 * Text field per DESIGN.md `text-field`: label above in `label` type, card fill, 2.5px line border,
 * 44px min height, body type; error border and a linked Field error below. Callers move focus to the
 * field when a submit fails, so the error is read with it.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, errorAction, id, className, ...props },
  ref,
) {
  const autoId = useId()
  const inputId = id ?? `field-${autoId}`
  const errorId = `${inputId}-error`
  const hasError = error !== undefined && error !== null && error !== false

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="type-label text-muted">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
        className={cn(
          'min-h-target-min w-full rounded-wob-sm border-[2.5px] border-line bg-card px-3 py-2 text-ink type-body',
          'placeholder:text-muted',
          hasError && 'border-error',
          className,
        )}
        {...props}
      />
      {hasError ? (
        <FieldError id={errorId} action={errorAction}>
          {error}
        </FieldError>
      ) : null}
    </div>
  )
})
