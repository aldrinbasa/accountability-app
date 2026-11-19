import { readDevice, resetDeviceMemory, writeDevice } from '@/data/device-storage'

/**
 * The focused group, stored on this device only (AD-12) so it survives restarts. The URL's `?g=`
 * wins over it; resolution lives in src/domain/groups.ts. Every access tolerates a blocked storage,
 * falling back to memory for the session. It belongs to the signed-in account: sign-out clears it
 * (`clearAccountDeviceState`).
 */
export const FOCUSED_GROUP_KEY = 'proofy.focusedGroup'

export function getStoredFocusedGroup(): string | null {
  return readDevice(FOCUSED_GROUP_KEY)
}

/** Store the focused group id; null forgets it. */
export function setStoredFocusedGroup(id: string | null): void {
  writeDevice(FOCUSED_GROUP_KEY, id)
}

/** Tests only: forget the in-memory fallback. */
export function resetFocusedGroupMemory(): void {
  resetDeviceMemory((key) => key === FOCUSED_GROUP_KEY)
}
