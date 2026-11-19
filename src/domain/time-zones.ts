import { formatShortDate } from '@/domain/plan'

/**
 * A member's or a group's zones after `set_time_zone` (Story 2.7): the zone in effect now and, when a
 * change is waiting, the new zone and the Monday it starts (`YYYY-MM-DD`, server-computed).
 */
export interface TimeZoneState {
  timeZone: string
  pendingTimeZone: string | null
  pendingWeekStart: string | null
}

/** Copy for the Time zone rows and picker (Story 2.7 ACs); the group's lives in `GROUP_COPY`. */
export const TIME_ZONE_COPY = {
  label: 'Time zone',
  memberNote: 'Your sessions follow this zone. Changes start next week.',
  search: 'Search time zones',
  searchPlaceholder: 'City or GMT+8',
  noMatch: 'No time zone matches that.',
  offline: "Couldn't save. You're offline.",
  saveFailed: "Couldn't save your time zone.",
  retry: 'Retry',
  /** Read before a waiting zone (visually hidden). */
  changesTo: 'changes to',
} as const

/** The city of an IANA name, from its last part: `America/New_York` → "New York". */
export function zoneCity(zone: string): string {
  const last = zone.slice(zone.lastIndexOf('/') + 1)
  return last.replace(/_/g, ' ')
}

/** The region of an IANA name (its first part), or null for a single-part name like `UTC`. */
export function zoneRegion(zone: string): string | null {
  const slash = zone.indexOf('/')
  return slash === -1 ? null : zone.slice(0, slash).replace(/_/g, ' ')
}

/** "City · Region" ("Kolkata · Asia", or just "UTC"): how a zone outside the 24 choices shows. */
export function zoneLabel(zone: string): string {
  const region = zoneRegion(zone)
  return region ? `${zoneCity(zone)} · ${region}` : zoneCity(zone)
}

/**
 * The zones right after the member picks `zone`, before the server answers (optimistic): the current
 * zone clears a waiting change; another zone waits, keeping a known start Monday (the server sets
 * it, the client never computes weeks).
 */
export function chooseZone<T extends TimeZoneState>(state: T, zone: string): T {
  if (zone === state.timeZone) return { ...state, pendingTimeZone: null, pendingWeekStart: null }
  return { ...state, pendingTimeZone: zone }
}

/** "from Mon 23 Nov": when a pending change starts. */
export function pendingFromText(pendingWeekStart: string): string {
  return `from ${formatShortDate(pendingWeekStart)}`
}

/** One picker choice: a whole-hour standard offset, sample cities and the IANA zone it saves. */
export interface ZoneChoice {
  /** Standard (non-DST) offset from GMT in hours, -11 to 12. */
  offset: number
  cities: readonly string[]
  zone: string
}

/** The picker's 24 choices, GMT−11 to GMT+12 (Aldrin, 2026-11-20). Labels use standard offsets. */
export const ZONE_CHOICES: readonly ZoneChoice[] = [
  { offset: -11, cities: ['Pago Pago', 'Midway'], zone: 'Pacific/Pago_Pago' },
  { offset: -10, cities: ['Honolulu'], zone: 'Pacific/Honolulu' },
  { offset: -9, cities: ['Anchorage'], zone: 'America/Anchorage' },
  { offset: -8, cities: ['Los Angeles', 'Vancouver'], zone: 'America/Los_Angeles' },
  { offset: -7, cities: ['Denver', 'Phoenix'], zone: 'America/Denver' },
  { offset: -6, cities: ['Chicago', 'Mexico City'], zone: 'America/Chicago' },
  { offset: -5, cities: ['New York', 'Toronto'], zone: 'America/New_York' },
  { offset: -4, cities: ['Halifax', 'Caracas'], zone: 'America/Halifax' },
  { offset: -3, cities: ['São Paulo', 'Buenos Aires'], zone: 'America/Sao_Paulo' },
  { offset: -2, cities: ['South Georgia'], zone: 'Atlantic/South_Georgia' },
  { offset: -1, cities: ['Azores', 'Cape Verde'], zone: 'Atlantic/Azores' },
  { offset: 0, cities: ['London', 'Lisbon'], zone: 'Europe/London' },
  { offset: 1, cities: ['Paris', 'Berlin', 'Lagos'], zone: 'Europe/Paris' },
  { offset: 2, cities: ['Athens', 'Cairo', 'Johannesburg'], zone: 'Europe/Athens' },
  { offset: 3, cities: ['Moscow', 'Istanbul', 'Nairobi'], zone: 'Europe/Moscow' },
  { offset: 4, cities: ['Dubai', 'Baku'], zone: 'Asia/Dubai' },
  { offset: 5, cities: ['Karachi', 'Tashkent'], zone: 'Asia/Karachi' },
  { offset: 6, cities: ['Dhaka', 'Almaty'], zone: 'Asia/Dhaka' },
  { offset: 7, cities: ['Bangkok', 'Jakarta', 'Ho Chi Minh City'], zone: 'Asia/Bangkok' },
  { offset: 8, cities: ['Manila', 'Singapore', 'Hong Kong'], zone: 'Asia/Manila' },
  { offset: 9, cities: ['Tokyo', 'Seoul'], zone: 'Asia/Tokyo' },
  { offset: 10, cities: ['Sydney', 'Brisbane'], zone: 'Australia/Sydney' },
  { offset: 11, cities: ['Nouméa', 'Solomon Islands'], zone: 'Pacific/Noumea' },
  { offset: 12, cities: ['Auckland', 'Fiji'], zone: 'Pacific/Auckland' },
]

/** "GMT+8", "GMT+0", "GMT−11" (a real minus sign). */
export function offsetLabel(offset: number): string {
  return offset < 0 ? `GMT−${-offset}` : `GMT+${offset}`
}

/** "GMT+8 · Manila, Singapore, Hong Kong". */
export function choiceLabel(choice: ZoneChoice): string {
  return `${offsetLabel(choice.offset)} · ${choice.cities.join(', ')}`
}

/**
 * How a row shows a zone: its choice label when it is one of the 24, else "City · Region" (a zone
 * from sign-up such as `Asia/Kolkata`).
 */
export function displayZone(zone: string): string {
  const choice = ZONE_CHOICES.find((c) => c.zone === zone)
  return choice ? choiceLabel(choice) : zoneLabel(zone)
}

/** One picker row: the zone it saves and its label. */
export interface PickerOption {
  zone: string
  label: string
  /** What the search matches against (label, cities and IANA name, normalized). */
  search: string
  /** The offset, for "+8" style searches; null for a zone outside the 24. */
  offset: number | null
}

/** Lower case, accents dropped, "−" as "-", underscores as spaces, spaces collapsed. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/−/g, '-')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The picker's rows: the current and waiting zones that are not among the 24 first ("Kolkata · Asia
 * (current)"; choosing one keeps it), then the 24 choices from GMT−11 to GMT+12.
 */
export function pickerOptions(include: readonly (string | null | undefined)[]): PickerOption[] {
  const extras: PickerOption[] = []
  for (const zone of include) {
    if (!zone || ZONE_CHOICES.some((c) => c.zone === zone) || extras.some((e) => e.zone === zone)) {
      continue
    }
    const label = `${zoneLabel(zone)} (current)`
    extras.push({ zone, label, search: normalize(`${label} ${zone}`), offset: null })
  }
  return [
    ...extras,
    ...ZONE_CHOICES.map((choice) => {
      const label = choiceLabel(choice)
      return {
        zone: choice.zone,
        label,
        search: normalize(`${label} ${choice.zone}`),
        offset: choice.offset,
      }
    }),
  ]
}

/**
 * The rows matching a search, case- and accent-insensitive ("sao paulo" finds São Paulo). An offset
 * ("GMT+8", "+8", "gmt-3", "GMT−3") matches that offset exactly, so "+1" is not "+11"; anything else
 * matches label text (offset, cities, region) and the IANA name. A blank search keeps every row.
 */
export function filterOptions(options: readonly PickerOption[], query: string): PickerOption[] {
  const needle = normalize(query)
  if (needle === '') return [...options]
  const offset = /^(?:gmt|utc)? ?([+-]) ?(\d{1,2})$/.exec(needle)
  if (offset) {
    const value = Number(offset[2]) * (offset[1] === '-' ? -1 : 1)
    return options.filter((option) => option.offset === value)
  }
  return options.filter((option) => option.search.includes(needle))
}

interface ZoneParts {
  weekday: string
  hour: string
  minute: string
}

function partsIn(at: Date, zone: string): ZoneParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return { weekday: part('weekday'), hour: part('hour'), minute: part('minute') }
}

/**
 * "14:32": the local time now in a zone, through its real IANA rules (live DST, so London shows
 * summer time in July). The picker's rows show it next to each choice.
 */
export function formatClock(now: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now)
}

/** "Wed 07:12": a member's session time in their stored zone (never the device's). */
export function formatSessionTime(timestamp: string, memberZone: string): string {
  const { weekday, hour, minute } = partsIn(new Date(timestamp), memberZone)
  return `${weekday} ${hour}:${minute}`
}

/**
 * A group-wide time (week lock, overturn deadline, winner) in the group zone: "Wed 23:59", plus the
 * zone's city when it differs from the member's ("Wed 23:59 London time"). A time at local 00:00
 * shows as 23:59 the day before (a lock stored as Thursday 00:00 reads "Wed 23:59").
 */
export function formatLockTime(lockAt: string, groupZone: string, memberZone: string): string {
  const at = new Date(lockAt)
  let parts = partsIn(at, groupZone)
  if (parts.hour === '00' && parts.minute === '00') {
    parts = partsIn(new Date(at.getTime() - 60_000), groupZone)
  }
  const text = `${parts.weekday} ${parts.hour}:${parts.minute}`
  return groupZone === memberZone ? text : `${text} ${zoneCity(groupZone)} time`
}
