import { useMemo, useState } from 'react'
import { CaretRight, Check, Globe, MagnifyingGlass } from '@phosphor-icons/react'
import {
  filterZones,
  pendingFromText,
  pickerZones,
  TIME_ZONE_COPY,
  zoneLabel,
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
  'flex min-h-row-min w-full items-center gap-3 border-b-[1.5px] border-line/18 px-1 text-left text-ink press-overlay'

/**
 * The time zone picker (Story 2.7): a search field over `Intl.supportedValuesOf('timeZone')` (plus
 * the current and waiting zones), each row "City · Region". The chosen zone (the waiting one, else
 * the current one) is checked. One tap on another zone saves it and closes the sheet.
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
  const chosen = zones.pendingTimeZone ?? zones.timeZone
  const all = useMemo(
    () => pickerZones([zones.timeZone, zones.pendingTimeZone]),
    [zones.timeZone, zones.pendingTimeZone],
  )
  const shown = useMemo(() => filterZones(all, query), [all, query])

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
            {shown.map((zone) => {
              const selected = zone === chosen
              return (
                <li key={zone}>
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    onClick={() => pick(zone)}
                    className={ROW}
                  >
                    <span className="min-w-0 flex-1 break-words type-body">{zoneLabel(zone)}</span>
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

/** The zone line and, for a waiting change, "New York · America from Mon 23 Nov". */
function ZoneLines({ zones }: { zones: TimeZoneState }) {
  return (
    <>
      <span className="type-meta text-muted">{zoneLabel(zones.timeZone)}</span>
      {zones.pendingTimeZone ? (
        <span className="type-meta text-ink">
          {zoneLabel(zones.pendingTimeZone)}
          {zones.pendingWeekStart ? ` ${pendingFromText(zones.pendingWeekStart)}` : null}
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
      onClick={onOpen}
      className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 py-2 text-left text-ink press-overlay"
    >
      {content}
      <Icon icon={CaretRight} size={20} />
    </button>
  )
}
