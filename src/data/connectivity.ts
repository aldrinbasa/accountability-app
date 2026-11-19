/**
 * Whether the device says it has no network. Only `onLine === false` counts: an unknown state is
 * treated as online, and a request that gets no response is caught separately (`network`).
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
