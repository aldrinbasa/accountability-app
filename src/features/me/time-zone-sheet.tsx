import { useEffect, useMemo, useState } from 'react'
import { CaretRight, Check, Globe, MagnifyingGlass } from '@phosphor-icons/react'
import {
  displayZone,
  filterOptions,
  formatClock,
  pendingFromText,
  pickerOptions,
  TIME_ZONE_COPY,
  type TimeZoneState,
} from '@/domain/time-zones'
import { Icon } from '@/ui/icon'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'

export interface TimeZoneSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** The note under the title ("Your sessions follow this zone. Changes start next week."). */
  note: string
  zones: TimeZoneState
  /** A zone was picked (never the one already chosen). The sheet closes itself. */
  onChoose: (zone: string) => void
}

const ROW =
  'flex min-h-row-min w-full items-center gap-3 border-b-[1.5px] border-line/18 px-1 py-2 text-left text-ink press-overlay'

/** The clock the picker shows: taken when it opens, then once a minute while it stays open. */
function useMinuteClock(running: boolean): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!running) return
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [running])
  return now
}

/**
 * The time zone picker (Story 2.7; 24 choices at Aldrin's request, 2026-11-20): a search field over
 * the 24 whole-hour GMT choices ("GMT+8 · Manila, Singapore, Hong Kong", each with its current local
 * time), led by the current or waiting zone when it is not one of them ("Kolkata · Asia (current)").
 * The chosen zone (the waiting one, else the current one) is checked. One tap on another zone saves
 * it and closes the sheet.
 */
export function TimeZoneSheet({
  open,
  onOpenChange,
  title,
  note,
  zones,
  onChoose,
}: TimeZoneSheetProps) {
  const [query, setQuery] = useState('')
  const now = useMinuteClock(open)
  const chosen = zones.pendingTimeZone ?? zones.timeZone
  const all = useMemo(
    () => pickerOptions([zones.timeZone, zones.pendingTimeZone]),
    [zones.timeZone, zones.pendingTimeZone],
  )
  const shown = useMemo(() => filterOptions(all, query), [all, query])

  function setOpen(next: boolean) {
    if (!next) setQuery('')
    onOpenChange(next)
  }

  function pick(zone: string) {
    setOpen(false)
    if (zone !== chosen) onChoose(zone)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen} title={title} description={note}>
      <div className="flex flex-col gap-3 pb-2">
        <TextField
          label={TIME_ZONE_COPY.search}
          icon={MagnifyingGlass}
          type="search"
          placeholder={TIME_ZONE_COPY.searchPlaceholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-autofocus=""
        />
        {shown.length === 0 ? (
          <p className="type-body-sm text-muted">{TIME_ZONE_COPY.noMatch}</p>
        ) : (
          <ul className="flex flex-col" aria-label={title}>
            {shown.map((option) => {
              const selected = option.zone === chosen
              const clock = formatClock(now, option.zone)
              return (
                <li key={option.zone}>
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    aria-label={`${option.label.replace(' · ', ', ')}, ${clock}`}
                    onClick={() => pick(option.zone)}
                    className={ROW}
                  >
                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0 break-words type-body">{option.label}</span>
                      <span className="type-meta text-muted tabular-nums">{clock}</span>
                    </span>
                    {selected ? <Icon icon={Check} size={24} className="text-success" /> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Sheet>
  )
}

/** "GMT−5 · New York, Toronto from Mon 23 Nov" (no date while the server has not answered yet). */
function pendingLine(zone: string, weekStart: string | null): string {
  return weekStart ? `${displayZone(zone)} ${pendingFromText(weekStart)}` : displayZone(zone)
}

/**
 * What a screen reader reads for the row: "Time zone, GMT+8 · Manila, Singapore, Hong Kong, changes
 * to GMT−5 · New York, Toronto from Mon 23 Nov".
 */
function rowName(label: string, zones: TimeZoneState): string {
  const current = `${label}, ${displayZone(zones.timeZone)}`
  return zones.pendingTimeZone
    ? `${current}, ${TIME_ZONE_COPY.changesTo} ${pendingLine(zones.pendingTimeZone, zones.pendingWeekStart)}`
    : current
}

/**
 * The zone line and, for a waiting change, "GMT−5 · New York, Toronto from Mon 23 Nov" (with a visually
 * hidden "changes to" before it).
 */
function ZoneLines({ zones }: { zones: TimeZoneState }) {
  return (
    <>
      <span className="type-meta text-muted">{displayZone(zones.timeZone)}</span>
      {zones.pendingTimeZone ? (
        <span className="type-meta text-ink">
          <span className="sr-only">{`${TIME_ZONE_COPY.changesTo} `}</span>
          {pendingLine(zones.pendingTimeZone, zones.pendingWeekStart)}
        </span>
      ) : null}
    </>
  )
}

export interface TimeZoneRowProps {
  label: string
  zones: TimeZoneState
  /** Opens the picker; without it the row is read-only (a group's non-admin member). */
  onOpen?: () => void
}

/** A Time zone row: the label, the current zone and a waiting change under it. */
export function TimeZoneRow({ label, zones, onOpen }: TimeZoneRowProps) {
  const content = (
    <>
      <Icon icon={Globe} size={24} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body">{label}</span>
        <ZoneLines zones={zones} />
      </span>
    </>
  )
  if (!onOpen) {
    return <div className="flex min-h-row-min w-full items-center gap-3 px-3 py-2">{content}</div>
  }
  return (
    <button
      type="button"
      aria-label={rowName(label, zones)}
      onClick={onOpen}
      className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 py-2 text-left text-ink press-overlay"
    >
      {content}
      <Icon icon={CaretRight} size={20} />
    </button>
  )
}
