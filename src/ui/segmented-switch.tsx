import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { LockSimple } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/**
 * The group's name: the id of its visible label, or (only when it has no visible label, like the
 * Plan sheet's kind switch) an accessible name. Exactly one, so the radio group is always named.
 */
export type SegmentedSwitchName =
  { labelledBy: string; label?: never } | { label: string; labelledBy?: never }

export type SegmentedSwitchProps<T extends string> = SegmentedSwitchName & {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /**
   * Locked: only the selected segment shows, with a lock icon, and `lockedNote` sits under the
   * track (DESIGN.md `segmented-switch` locked state). Arrow keys do nothing.
   */
  locked?: boolean
  /** The note under a locked switch in `meta` muted, linked with `aria-describedby`. */
  lockedNote?: ReactNode
  /** Announce the note when it appears (e.g. the server just reported the lock). */
  announceNote?: boolean
}

/**
 * Segmented switch per DESIGN.md `segmented-switch`: paper track, 2.5px line outline, wob-sm, 44px
 * tall; segments in `button` type; the selected one ink with card text. A radio group: one tab stop,
 * arrow keys (and Home/End) move and select (EXPERIENCE.md Segmented switch).
 */
export function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  label,
  locked = false,
  lockedNote,
  announceNote = false,
}: SegmentedSwitchProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const noteId = `${useId()}-note`

  if (locked) {
    const option = options.find((o) => o.value === value)
    return (
      <div className="flex flex-col gap-[6px]">
        <div
          role="radiogroup"
          aria-labelledby={labelledBy}
          aria-label={label}
          aria-describedby={lockedNote ? noteId : undefined}
          aria-readonly="true"
          className="flex min-h-target-min gap-1 rounded-wob-sm border-[2.5px] border-line bg-paper p-[3px]"
          data-locked=""
        >
          {option ? (
            <button
              type="button"
              role="radio"
              aria-checked={true}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-[6px] rounded-wob-xs bg-ink px-2 text-card type-button"
            >
              <Icon icon={LockSimple} size={20} />
              {option.label}
            </button>
          ) : null}
        </div>
        {lockedNote ? (
          <p
            id={noteId}
            role={announceNote ? 'alert' : undefined}
            className="flex items-center gap-[6px] type-meta text-muted"
          >
            <Icon icon={LockSimple} size={20} />
            <span>{lockedNote}</span>
          </p>
        ) : null}
      </div>
    )
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + options.length) % options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    if (next === null) return
    event.preventDefault()
    const option = options[next]
    if (!option) return
    onChange(option.value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={label}
      className="flex min-h-target-min gap-1 rounded-wob-sm border-[2.5px] border-line bg-paper p-[3px]"
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(option.value)
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'min-w-0 flex-1 rounded-wob-xs px-2 type-button',
              selected ? 'bg-ink text-card' : 'text-ink press-overlay',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
