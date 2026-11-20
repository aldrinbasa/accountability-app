import { forwardRef, useId, useRef, type ReactNode } from 'react'
import { CalendarBlank, X } from '@phosphor-icons/react'
import { FieldError } from '@/ui/field-error'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { cn } from '@/ui/lib/utils'

export interface DateFieldProps {
  /** Visible label above the field. */
  label: string
  /** `YYYY-MM-DD`, or null when empty. */
  value: string | null
  /** What the box reads when set, formatted by the caller (e.g. "Sun 22 Nov"). */
  displayValue: string
  /** What the box reads when empty (e.g. "No end date"). */
  emptyText: string
  /** The earliest choice (`YYYY-MM-DD`). */
  min?: string
  onChange: (value: string | null) => void
  /** Accessible name of the clear button (shown only when set), e.g. "Clear end date". */
  clearLabel: string
  /** Field error under the field (cobalt border, `aria-invalid`). */
  error?: ReactNode
  /** Note under the field in `meta` muted, linked with `aria-describedby`. */
  hint?: ReactNode
  id?: string
}

function openPicker(input: HTMLInputElement) {
  try {
    input.showPicker?.()
  } catch {
    // Not allowed here (e.g. no user gesture): the native input still opens on its own tap.
  }
}

/**
 * Date field (DESIGN.md `date-field`): a field-styled box with a calendar icon reading the chosen
 * date or `emptyText`, with a transparent native `<input type="date">` over it, so a tap opens the
 * platform picker (iOS, Android; `showPicker` on desktop). When set, a 44px clear button sits beside
 * the box. The ref goes to the native input (focus target for a Field error).
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  { label, value, displayValue, emptyText, min, onChange, clearLabel, error, hint, id },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const autoId = useId()
  const inputId = id ?? `date-${autoId}`
  const errorId = `${inputId}-error`
  const hintId = `${inputId}-hint`
  const hasError = error !== undefined && error !== null && error !== false
  const hasHint = hint !== undefined && hint !== null && hint !== false
  const describedBy =
    [hasHint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="type-label text-muted">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'relative flex min-h-target-min min-w-0 flex-1 items-center gap-2 rounded-wob-sm border-[2.5px] border-line bg-card px-3 py-2 text-ink type-body',
            hasError && 'border-error',
          )}
          data-date-box=""
        >
          <Icon icon={CalendarBlank} size={20} />
          <span aria-hidden="true" className={cn('min-w-0 flex-1', value === null && 'text-muted')}>
            {value === null ? emptyText : displayValue}
          </span>
          <input
            ref={(node) => {
              inputRef.current = node
              if (typeof ref === 'function') ref(node)
              else if (ref) ref.current = node
            }}
            id={inputId}
            type="date"
            value={value ?? ''}
            min={min}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            onClick={(event) => openPicker(event.currentTarget)}
            onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        {value !== null ? (
          <IconButton
            icon={X}
            label={clearLabel}
            onClick={() => {
              onChange(null)
              // The clear button goes away with the value: keep focus in the field, not on body.
              inputRef.current?.focus()
            }}
          />
        ) : null}
      </div>
      {hasHint ? (
        <p id={hintId} className="type-meta text-muted">
          {hint}
        </p>
      ) : null}
      {hasError ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  )
})
