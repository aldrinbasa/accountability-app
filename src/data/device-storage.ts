/**
 * Device-only storage (AD-12) that tolerates a blocked storage (private mode, quota, a disabled
 * Storage API). A value that could not be written is kept in memory for the session and read before
 * the real storage; a removal that could not be applied is kept as a null there, so it still reads
 * as gone. One memory per storage area.
 */
export type StorageArea = 'local' | 'session'

const memory: Record<StorageArea, Map<string, string | null>> = {
  local: new Map(),
  session: new Map(),
}

function storage(area: StorageArea): Storage {
  // Reading the property itself can throw (SecurityError) when storage is disabled.
  return area === 'local' ? localStorage : sessionStorage
}

/** The stored value, or null when there is none or storage cannot be read. */
export function readDevice(key: string, area: StorageArea = 'local'): string | null {
  const held = memory[area]
  if (held.has(key)) return held.get(key) ?? null
  try {
    return storage(area).getItem(key)
  } catch {
    return null
  }
}

/** Store a value; null removes it. Falls back to memory for the session when storage refuses. */
export function writeDevice(key: string, value: string | null, area: StorageArea = 'local'): void {
  try {
    if (value === null) storage(area).removeItem(key)
    else storage(area).setItem(key, value)
    memory[area].delete(key)
  } catch {
    memory[area].set(key, value)
  }
}

/** Remove every key that starts with `prefix`, from storage and from memory. */
export function removeDeviceKeysWithPrefix(prefix: string, area: StorageArea = 'local'): void {
  const held = memory[area]
  for (const key of [...held.keys()]) {
    if (key.startsWith(prefix)) held.delete(key)
  }
  try {
    const store = storage(area)
    const matching: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index)
      if (key?.startsWith(prefix)) matching.push(key)
    }
    for (const key of matching) {
      try {
        store.removeItem(key)
      } catch {
        held.set(key, null)
      }
    }
  } catch {
    // Storage cannot be listed: whatever it holds stays unreadable to this session anyway.
  }
}

/**
 * Tests only: forget the in-memory fallback, for the keys `matches` accepts (default all), in both
 * areas.
 */
export function resetDeviceMemory(matches: (key: string) => boolean = () => true): void {
  for (const held of Object.values(memory)) {
    for (const key of [...held.keys()]) {
      if (matches(key)) held.delete(key)
    }
  }
}
