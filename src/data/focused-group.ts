/**
 * The focused group, stored on this device only (AD-12) so it survives restarts. The URL's `?g=`
 * wins over it; resolution lives in src/domain/groups.ts. Every access tolerates a blocked storage,
 * falling back to memory for the session.
 */
export const FOCUSED_GROUP_KEY = 'proofy.focusedGroup'

/** The value written while localStorage refused it. Read before localStorage. */
let memory: { value: string | null } | null = null

export function getStoredFocusedGroup(): string | null {
  if (memory) return memory.value
  try {
    return localStorage.getItem(FOCUSED_GROUP_KEY)
  } catch {
    return null
  }
}

/** Store the focused group id; null forgets it. */
export function setStoredFocusedGroup(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(FOCUSED_GROUP_KEY)
    else localStorage.setItem(FOCUSED_GROUP_KEY, id)
    memory = null
  } catch {
    // Storage blocked (private mode, quota): keep it for this session only.
    memory = { value: id }
  }
}

/** Tests only: forget the in-memory fallback. */
export function resetFocusedGroupMemory(): void {
  memory = null
}
