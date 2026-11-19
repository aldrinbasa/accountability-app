import {
  readDevice,
  removeDeviceKeysWithPrefix,
  resetDeviceMemory,
  writeDevice,
} from '@/data/device-storage'

/**
 * Device-only notice state for groups (AD-12): which "You're no longer in {Group}." notices this
 * device has shown, and the member count last seen per group (for "Everyone else left {Group}.").
 * Every access tolerates a blocked storage, falling back to memory for the session.
 * Removed notices are keyed by membership id, so they stay across sign-outs; last-seen counts are
 * keyed by group and belong to the signed-in account, so sign-out clears them.
 */
const REMOVED_NOTICE_PREFIX = 'proofy.notice.removed.'
const LAST_SEEN_COUNT_PREFIX = 'proofy.lastSeenCount.'

export function removedNoticeKey(membershipId: string): string {
  return `${REMOVED_NOTICE_PREFIX}${membershipId}`
}

export function lastSeenCountKey(groupId: string): string {
  return `${LAST_SEEN_COUNT_PREFIX}${groupId}`
}

export function hasSeenRemovedNotice(membershipId: string): boolean {
  return readDevice(removedNoticeKey(membershipId)) !== null
}

export function markRemovedNoticeSeen(membershipId: string): void {
  writeDevice(removedNoticeKey(membershipId), '1')
}

/** The member count this device last saw for the group, or null when it never saw one. */
export function getLastSeenCount(groupId: string): number | null {
  const value = readDevice(lastSeenCountKey(groupId))
  if (value === null) return null
  const count = Number.parseInt(value, 10)
  return Number.isNaN(count) ? null : count
}

export function setLastSeenCount(groupId: string, count: number): void {
  writeDevice(lastSeenCountKey(groupId), String(count))
}

/** Forget every group's last-seen member count (sign-out or another account signing in). */
export function clearLastSeenCounts(): void {
  removeDeviceKeysWithPrefix(LAST_SEEN_COUNT_PREFIX)
}

/** Tests only: forget the in-memory fallback. */
export function resetGroupNoticesMemory(): void {
  resetDeviceMemory(
    (key) => key.startsWith(REMOVED_NOTICE_PREFIX) || key.startsWith(LAST_SEEN_COUNT_PREFIX),
  )
}
