import { todayDayName } from '@/domain/today'

/**
 * Today's heading is the member-local day name, e.g. "Friday": from the server's `memberToday`
 * (profile zone) once Today's summary has loaded, else the device's day name.
 */
export function todayHeading(memberToday?: string | null, date: Date = new Date()): string {
  return todayDayName(memberToday, date)
}
