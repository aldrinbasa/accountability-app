import { clearLastSeenRanks } from '@/data/board'
import { setStoredFocusedGroup } from '@/data/focused-group'
import { clearLastSeenCounts } from '@/data/group-notices'
import { clearRitualHints } from '@/data/ritual-hint'
import { clearWinnerSeen } from '@/data/winner'

/**
 * Clears the device state that belongs to the signed-in account: the focused group, every group's
 * last-seen member count, last-seen rank (Story 4.1), seen winner cards (Story 4.5) and dismissed ritual Hints (Story 5.6), in storage
 * and in the memory fallback.
 * Run when a session ends or another account takes over, next to clearing the query cache.
 * Device-wide state stays: the theme, the install flags and the removed notices (keyed by
 * membership id, so they cannot leak).
 */
export function clearAccountDeviceState(): void {
  setStoredFocusedGroup(null)
  clearLastSeenCounts()
  clearLastSeenRanks()
  clearWinnerSeen()
  clearRitualHints()
}
