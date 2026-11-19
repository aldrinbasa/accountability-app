/**
 * Module-level in-flight guard: a token from the URL (`token_hash`, OAuth `code`) is sent to the
 * backend at most once per page load, even when StrictMode runs the effect twice or the screen
 * remounts. Every caller with the same key shares the first call's promise.
 */
const inFlight = new Map<string, Promise<unknown>>()

export function verifyOnce<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>
  const promise = run()
  inFlight.set(key, promise)
  return promise
}
