import { setStoredFocusedGroup } from '@/data/focused-group'
import { clearLastSeenCounts } from '@/data/group-notices'

/**
 * Clears the device state that belongs to the signed-in account: the focused group and every
 * group's last-seen member count, in storage and in the memory fallback. Run when a session ends or
 * another account takes over, next to clearing the query cache. Device-wide state stays: the theme,
 * the install flags and the removed notices (keyed by membership id, so they cannot leak).
 */
export function clearAccountDeviceState(): void {
  setStoredFocusedGroup(null)
  clearLastSeenCounts()
}
