import { useState } from 'react'
import {
  readDevice,
  removeDeviceKeysWithPrefix,
  resetDeviceMemory,
  writeDevice,
} from '@/data/device-storage'

/**
 * The ritual Hint on Today (Story 5.6): shown in an active group until "Not now", then never again
 * for that group on this device (AD-12: device-only state). Keyed by group and belonging to the
 * signed-in account, so sign-out clears it.
 */
const RITUAL_HINT_PREFIX = 'proofy.hint.ritual.'

export function ritualHintKey(groupId: string): string {
  return `${RITUAL_HINT_PREFIX}${groupId}`
}

export function isRitualHintDismissed(groupId: string): boolean {
  return readDevice(ritualHintKey(groupId)) !== null
}

export function dismissRitualHint(groupId: string): void {
  writeDevice(ritualHintKey(groupId), '1')
}

/** Forget every group's dismissal (sign-out or another account signing in). */
export function clearRitualHints(): void {
  removeDeviceKeysWithPrefix(RITUAL_HINT_PREFIX)
}

/** Tests only: forget the in-memory fallback. */
export function resetRitualHintMemory(): void {
  resetDeviceMemory((key) => key.startsWith(RITUAL_HINT_PREFIX))
}

/** Whether the group's ritual Hint shows, and its "Not now". */
export function useRitualHint(groupId: string): { visible: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(() => isRitualHintDismissed(groupId))
  return {
    visible: !dismissed,
    dismiss: () => {
      dismissRitualHint(groupId)
      setDismissed(true)
    },
  }
}
