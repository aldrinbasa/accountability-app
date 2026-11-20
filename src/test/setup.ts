import '@testing-library/jest-dom/vitest'
// A real IndexedDB for the persisted query cache and the check-in outbox (idb).
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, vi } from 'vitest'
import { resetDeviceMemory } from '@/data/device-storage'
import { resetOutboxDb } from '@/data/outbox-db'
import { resetQueryCacheDb } from '@/data/query-persistence'
import { clearPostMoment } from '@/data/post-moment'

// Some runners expose a broken global `localStorage` (Node's experimental stub, active without a
// backing file). Install a deterministic in-memory Storage so app persistence works in tests.
class MemoryStorage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage() as unknown as Storage,
})
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: new MemoryStorage() as unknown as Storage,
})

// jsdom does not implement matchMedia. Installable so tests can simulate a system preference.
export function installMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  })
}

// Node-environment tests (e.g. the lint test) have no window.
const hasWindow = typeof window !== 'undefined'
if (hasWindow) {
  installMatchMedia(false)
  // jsdom does not implement scrolling; the shell scrolls to top on a tab re-tap and on navigation.
  Object.defineProperty(window, 'scrollTo', { writable: true, configurable: true, value: vi.fn() })
  // jsdom does not play media; the camera viewfinder calls play() on its stream.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
  })
  // jsdom has no pointer capture; sonner calls it when a toast is pressed (swipe tracking).
  for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { configurable: true, value: () => false })
    }
  }
}

// Reset shared global state so tests are order-independent.
afterEach(async () => {
  // A fresh, empty IndexedDB per test (the outbox and the saved query cache).
  await resetOutboxDb()
  await resetQueryCacheDb()
  globalThis.indexedDB = new IDBFactory()
  localStorage.clear()
  sessionStorage.clear()
  resetDeviceMemory()
  clearPostMoment()
  if (hasWindow) installMatchMedia(false)
})
