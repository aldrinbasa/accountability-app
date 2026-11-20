import type { Query, QueryCache, QueryClient } from '@tanstack/react-query'

/**
 * Queries whose data was written on the client (`setQueryData`, e.g. an optimistic update) and not
 * yet replaced by a fetch. The persisted cache leaves them out, and the offline Banner's "showing
 * what you had at" time ignores them.
 */
const optimistic = new WeakSet<Query>()
const tracked = new WeakSet<QueryCache>()

/** Starts following `setQueryData` writes in the client's cache (once per cache). */
export function trackOptimisticWrites(queryClient: QueryClient): void {
  const cache = queryClient.getQueryCache()
  if (tracked.has(cache)) return
  tracked.add(cache)
  cache.subscribe((event) => {
    if (event.type === 'removed') {
      optimistic.delete(event.query)
      return
    }
    if (event.type !== 'updated' || event.action.type !== 'success') return
    if (event.action.manual) optimistic.add(event.query)
    else optimistic.delete(event.query)
  })
}

/** Whether the query's data came from the client rather than a fetch. */
export function isOptimistic(query: Query): boolean {
  return optimistic.has(query)
}
