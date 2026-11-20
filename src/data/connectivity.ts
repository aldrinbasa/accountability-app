import { useCallback, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isOptimistic } from '@/data/optimistic-writes'

/**
 * Whether the device says it has no network. Only `onLine === false` counts: an unknown state is
 * treated as online, and a request that gets no response is caught separately (`network`).
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** Whether the device has a network (`online` / `offline` events); unknown counts as online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => !isOffline(),
    () => true,
  )
}

/**
 * The newest successful fetch among the cached queries (`dataUpdatedAt`, ms), for "Offline · showing
 * what you had at 07:40."; data written on the client does not count. Null when nothing is cached.
 */
export function useLastFetchedAt(): number | null {
  const queryClient = useQueryClient()
  const cache = queryClient.getQueryCache()
  return useSyncExternalStore(
    useCallback((listener) => cache.subscribe(listener), [cache]),
    () => {
      let newest: number | null = null
      for (const query of cache.getAll()) {
        const { data, dataUpdatedAt } = query.state
        if (data === undefined || dataUpdatedAt <= 0 || isOptimistic(query)) continue
        // Not saved for offline (signed photo URLs): not part of "what you had".
        if (query.meta?.persist === false) continue
        if (newest === null || dataUpdatedAt > newest) newest = dataUpdatedAt
      }
      return newest
    },
  )
}
