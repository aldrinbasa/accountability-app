/**
 * Test-only zone math for the fake backend: the server's `private.week_start_of` and
 * `private.local_start`, worked out with `Intl` (no domain code).
 */

const formats = new Map<string, Intl.DateTimeFormat>()

function format(zone: string): Intl.DateTimeFormat {
  let f = formats.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formats.set(zone, f)
  }
  return f
}

/** The wall clock in `zone` at `instant`, read as if it were UTC (milliseconds). */
function wallClock(instant: number, zone: string): number {
  const parts = Object.fromEntries(
    format(zone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  )
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** The Monday (`YYYY-MM-DD`) of the week that contains `instant` in `zone`. */
export function weekStartOf(instant: string, zone: string): string {
  const wall = wallClock(Date.parse(instant), zone)
  const day = new Date(wall).getUTCDay() // 0 = Sunday
  const back = (day + 6) % 7
  return isoDate(wall - back * 86_400_000)
}

/** The instant (ISO) of 00:00 on `date` (`YYYY-MM-DD`) in `zone`. */
export function localStart(date: string, zone: string): string {
  const wall = Date.parse(`${date}T00:00:00Z`)
  let instant = wall - (wallClock(wall, zone) - wall)
  // A second pass settles a guess that crossed a daylight-saving change.
  instant = wall - (wallClock(instant, zone) - instant)
  return new Date(instant).toISOString()
}

/** `date` plus `days` (`YYYY-MM-DD`). */
export function addDays(date: string, days: number): string {
  return isoDate(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
}
