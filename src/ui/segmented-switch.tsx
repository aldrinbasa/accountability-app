import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/ui/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedSwitchProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Id of the visible label for the group. */
  labelledBy: string
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
}: SegmentedSwitchProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

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
