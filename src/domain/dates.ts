/**
 * Calendar-date formatting shared by the domain (Epic 2 retro D3): the one `YYYY-MM-DD` parser and
 * the day and month name tables. Formatting only, never week math: the server owns weeks (AD-11).
 */

/** Short day names by JavaScript day number (`getDay` / `getUTCDay`): Sunday = 0. */
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Long day names by JavaScript day number: Sunday = 0. */
export const DAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** Short month names by JavaScript month number (`getMonth` / `getUTCMonth`): January = 0. */
export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * A server date (`YYYY-MM-DD`) as a calendar date at UTC midnight. Read with the `getUTC*` methods,
 * so the device zone never moves it to another day. Null when the text is not in that form.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(date.getTime()) ? null : date
}
