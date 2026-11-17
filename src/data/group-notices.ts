/**
 * Device-only notice state for groups (AD-12): which "You're no longer in {Group}." notices this
 * device has shown, and the member count last seen per group (for "Everyone else left {Group}.").
 * Every access tolerates a blocked storage, falling back to memory for the session.
 */
export function removedNoticeKey(membershipId: string): string {
  return `proofy.notice.removed.${membershipId}`
}

export function lastSeenCountKey(groupId: string): string {
  return `proofy.lastSeenCount.${groupId}`
}

/** Values written while localStorage refused them. Read before localStorage. */
const memory = new Map<string, string>()

function read(key: string): string | null {
  const held = memory.get(key)
  if (held !== undefined) return held
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
    memory.delete(key)
  } catch {
    // Storage blocked (private mode, quota): keep it for this session only.
    memory.set(key, value)
  }
}

export function hasSeenRemovedNotice(membershipId: string): boolean {
  return read(removedNoticeKey(membershipId)) !== null
}

export function markRemovedNoticeSeen(membershipId: string): void {
  write(removedNoticeKey(membershipId), '1')
}

/** The member count this device last saw for the group, or null when it never saw one. */
export function getLastSeenCount(groupId: string): number | null {
  const value = read(lastSeenCountKey(groupId))
  if (value === null) return null
  const count = Number.parseInt(value, 10)
  return Number.isNaN(count) ? null : count
}

export function setLastSeenCount(groupId: string, count: number): void {
  write(lastSeenCountKey(groupId), String(count))
}

/** Tests only: forget the in-memory fallback. */
export function resetGroupNoticesMemory(): void {
  memory.clear()
}
