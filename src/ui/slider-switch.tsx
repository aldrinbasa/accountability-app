import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface SliderOption<T extends string> {
  value: T
  label: string
  icon: PhosphorIcon
}

export interface SliderSwitchProps<T extends string> {
  options: readonly SliderOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Id of the visible label for the group. */
  labelledBy: string
}

/**
 * Slider switch (Appearance picker, approved sample `appearance-switch-sample.html` option B): a card
 * pill with a 2.5px line outline and ink offset; a coral sticker knob springs under the chosen
 * segment, whose icon tilts. A radio group: one tab stop, arrow keys and Home/End move and select.
 * The knob slide is the only motion and stops under Reduce Motion (app.css).
 */
export function SliderSwitch<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
}: SliderSwitchProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

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

  const knobStyle = {
    width: `calc((100% - 8px) / ${options.length})`,
    transform: `translateX(${selectedIndex * 100}%)`,
  } as CSSProperties

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="relative grid rounded-full border-[2.5px] border-line bg-card p-1 shadow-ink"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        data-knob=""
        className="absolute top-1 bottom-1 left-1 rounded-full border-[2.5px] border-obj-ink bg-primary transition-transform duration-[220ms] ease-[cubic-bezier(.3,1.4,.5,1)]"
        style={knobStyle}
      />
      {options.map((option, index) => {
        const selected = index === selectedIndex
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
              'relative flex min-h-[48px] min-w-0 items-center justify-center gap-[6px] rounded-full px-2 type-button',
              selected ? 'text-on-primary' : 'text-ink press-overlay',
            )}
          >
            <Icon
              icon={option.icon}
              size={20}
              tone={selected ? 'sticky' : 'primary'}
              className={cn(
                'transition-transform duration-[220ms] ease-[cubic-bezier(.3,1.4,.5,1)]',
                selected && '-rotate-12 scale-110',
              )}
            />
            <span className="truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
