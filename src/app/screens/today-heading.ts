/** Today's heading is the day name, e.g. "Friday". */
export function todayHeading(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date)
}
