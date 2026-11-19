import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus } from '@phosphor-icons/react'
import {
  ACTIVITY_COPY,
  buildPickerSections,
  chipLabel,
  chipMeta,
  CUSTOM_ACTIVITY_MAX,
  isSameSelection,
  matchesGroupCustom,
  type ActivitySelection,
  type GroupActivity,
  type PickerChip,
  type PresetActivity,
} from '@/domain/activities'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import { TextField } from '@/ui/text-field'

export interface ActivityPickerProps {
  /** The 20 presets (`usePresetActivities`). */
  presets: readonly PresetActivity[]
  /** The group's activities (`useGroupActivities`). */
  groupActivities: readonly GroupActivity[]
  value: ActivitySelection
  onChange: (value: ActivitySelection) => void
  /** Id of the field's visible label ("Activity"), which names the radio group. */
  labelledBy: string
  /** Id for the "Something else" input, so a sheet can focus it. */
  customInputId?: string
  /** Id of a Field error for the whole picker (e.g. "Pick an activity."), on the radio group. */
  describedBy?: string
}

/**
 * Activity picker (DESIGN.md `activity-picker`, Story 2.1). A single-choice radio group of 44px
 * chips under `label` headings: In this group, Fitness, Mind, Creative, Life & work; then the
 * "Something else" text field. A preset in In this group is also in its category, and both chips
 * select it. Chips use roving tabindex: one tab stop, arrow keys (and Home/End) move and select.
 * Typing a custom name selects it and unchecks every chip; tapping a chip clears the text.
 */
export function ActivityPicker({
  presets,
  groupActivities,
  value,
  onChange,
  labelledBy,
  customInputId,
  describedBy,
}: ActivityPickerProps) {
  const sections = useMemo(
    () => buildPickerSections(presets, groupActivities),
    [presets, groupActivities],
  )
  const chips = useMemo(() => sections.flatMap((section) => section.chips), [sections])
  const refs = useRef(new Map<string, HTMLButtonElement>())
  // The chip that last had focus: it keeps the tab stop while it is checked (a preset has two).
  const [focusedId, setFocusedId] = useState<string | null>(null)

  const isSelected = (chip: PickerChip) => isSameSelection(value, chip.selection)
  const focused = chips.find((chip) => chip.id === focusedId)
  const tabStopId =
    (focused && isSelected(focused) ? focused.id : undefined) ??
    chips.find(isSelected)?.id ??
    chips[0]?.id

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % chips.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + chips.length) % chips.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = chips.length - 1
    if (next === null) return
    event.preventDefault()
    const chip = chips[next]
    if (!chip) return
    onChange(chip.selection)
    setFocusedId(chip.id)
    refs.current.get(chip.id)?.focus()
  }

  const customText = value?.kind === 'custom' ? value.name : ''
  const hint = matchesGroupCustom(customText, groupActivities) ? ACTIVITY_COPY.matchHint : undefined

  return (
    <div className="flex flex-col gap-[14px]">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={describedBy ? true : undefined}
        className="flex flex-col gap-[14px]"
      >
        {sections.map((section) => (
          <div key={section.key} className="flex flex-col gap-[6px]">
            <p className="type-label text-muted" data-picker-heading="">
              {section.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {section.chips.map((chip) => {
                const index = chips.indexOf(chip)
                const selected = isSelected(chip)
                const meta = chipMeta(chip)
                return (
                  <button
                    key={chip.id}
                    ref={(node) => {
                      if (node) refs.current.set(chip.id, node)
                      else refs.current.delete(chip.id)
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={chipLabel(chip)}
                    tabIndex={chip.id === tabStopId ? 0 : -1}
                    onClick={() => {
                      setFocusedId(chip.id)
                      if (!selected) onChange(chip.selection)
                    }}
                    onFocus={() => setFocusedId(chip.id)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    className={cn(
                      'inline-flex min-h-target-min max-w-full items-center gap-[6px] rounded-wob-sm border-2 px-3 text-left type-button',
                      selected
                        ? 'border-ink bg-ink text-card'
                        : 'border-line bg-card text-ink press-overlay',
                    )}
                  >
                    <Icon icon={chip.icon} size={20} />
                    <span className="min-w-0 break-words">
                      {chip.name}
                      {meta ? <span className="type-meta"> {meta}</span> : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <TextField
        id={customInputId}
        label={ACTIVITY_COPY.somethingElse}
        icon={Plus}
        maxLength={CUSTOM_ACTIVITY_MAX}
        autoComplete="off"
        value={customText}
        onChange={(event) => {
          const text = event.target.value
          onChange(text.trim() === '' ? null : { kind: 'custom', name: text })
        }}
        hint={hint}
      />
    </div>
  )
}
