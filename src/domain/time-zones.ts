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
  searchPlaceholder: 'City or region',
  noMatch: 'No time zone matches that.',
  offline: "Couldn't save. You're offline.",
  saveFailed: "Couldn't save your time zone.",
  retry: 'Retry',
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

/** The picker's line for a zone: "London · Europe", or just "UTC". */
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

/**
 * The zones the picker offers: `Intl.supportedValuesOf('timeZone')` plus the given zones (the
 * current and pending ones, which a runtime may leave out, e.g. `UTC`), sorted. When the runtime has
 * no `supportedValuesOf`, only the given zones.
 */
export function pickerZones(
  include: readonly (string | null | undefined)[],
  supported: () => readonly string[] = runtimeZones,
): string[] {
  let all: readonly string[]
  try {
    all = supported()
  } catch {
    all = []
  }
  const set = new Set(all)
  for (const zone of include) if (zone) set.add(zone)
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function runtimeZones(): readonly string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  return typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : []
}

function searchable(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, ' ')
}

/**
 * The zones matching a search: by IANA name or city, case-insensitive, spaces matching underscores
 * ("new york" finds `America/New_York`). A blank search keeps every zone.
 */
export function filterZones(zones: readonly string[], query: string): string[] {
  const needle = searchable(query)
  if (needle === '') return [...zones]
  return zones.filter((zone) => searchable(zone).includes(needle))
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
