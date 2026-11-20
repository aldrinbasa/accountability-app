import { formatClock } from '@/domain/time-zones'

/** Copy for browsing offline from the saved cache (Story 3.3). */
export const OFFLINE_COPY = {
  refreshFailed: "Couldn't refresh.",
  retry: 'Retry',
} as const

/**
 * The offline Banner: "Offline · showing what you had at 07:40." `lastFetchedAt` is the newest
 * successful fetch (ms), shown in `zone` (the member's, else the device's).
 */
export function offlineBannerText(lastFetchedAt: number, zone: string): string {
  return `Offline · showing what you had at ${formatClock(new Date(lastFetchedAt), zone)}.`
}
