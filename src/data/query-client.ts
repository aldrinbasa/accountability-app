import { QueryCache, QueryClient } from '@tanstack/react-query'
import { backendErrorCode } from '@/domain/error-codes'
import { isOffline } from '@/data/connectivity'
import { trackOptimisticWrites } from '@/data/optimistic-writes'

/** Cached queries live 14 days, as long as the persisted cache (Story 3.3). */
export const QUERY_GC_TIME_MS = 14 * 24 * 60 * 60_000

/**
 * A query `retry` that never retries while the device is offline (so a screen with no cache fails
 * fast into its "Can't reach Proofy right now." Empty state), and otherwise retries up to `times`
 * unless `skip` says the error is final.
 */
export function retryOnline(times: number, skip?: (error: unknown) => boolean) {
  return (failureCount: number, error: unknown): boolean =>
    !isOffline() && failureCount < times && !(skip?.(error) ?? false)
}

export interface AppQueryClientOptions {
  /**
   * A refresh failed while online and the query still shows older data: the app raises the
   * "Couldn't refresh." toast, whose Retry calls `retry` (refetches that query).
   */
  onRefreshFailed?: (retry: () => void) => void
}

/**
 * The app's query client (Story 3.3 defaults): `networkMode: 'always'` so queries never pause on a
 * blank screen offline (they fail fast instead, no retries while offline), a 14-day `gcTime` to
 * match the persisted cache, silent refetch on reconnect. A failed refresh of a query that still
 * has data, while online, reports through `onRefreshFailed` (network or unexpected errors only: a
 * server answer such as `not_member` is the screen's to handle).
 */
export function createAppQueryClient(options: AppQueryClientOptions = {}): QueryClient {
  const queryCache = new QueryCache({
    onError: (error, query) => {
      if (query.state.data === undefined || isOffline()) return
      const code = backendErrorCode(error)
      if (code !== 'network' && code !== 'unknown') return
      options.onRefreshFailed?.(() => {
        void queryClient.refetchQueries({ queryKey: query.queryKey, exact: true })
      })
    },
  })
  const queryClient = new QueryClient({
    queryCache,
    defaultOptions: {
      queries: {
        networkMode: 'always',
        gcTime: QUERY_GC_TIME_MS,
        retry: retryOnline(3),
        refetchOnReconnect: true,
      },
    },
  })
  trackOptimisticWrites(queryClient)
  return queryClient
}
