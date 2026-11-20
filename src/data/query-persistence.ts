import { useEffect, useSyncExternalStore } from 'react'
import { openDB, type IDBPDatabase } from 'idb'
import { hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/react-query'
import {
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister,
} from '@tanstack/react-query-persist-client'
import { useAuthSession } from '@/data/auth-session'
import { isOptimistic, trackOptimisticWrites } from '@/data/optimistic-writes'
import { QUERY_GC_TIME_MS } from '@/data/query-client'

/**
 * The persisted query cache (Story 3.3, AD-12): one IndexedDB record per signed-in user, so the app
 * opens on what it last showed, offline too. Database `proofy-cache`, store `query-cache`, key
 * `proofy-query-cache:{user_id}`. Kept 14 days, dropped on a new build (`buster`), deleted when the
 * session ends.
 */

export const QUERY_CACHE_DB_NAME = 'proofy-cache'
export const QUERY_CACHE_STORE = 'query-cache'
export const QUERY_CACHE_MAX_AGE_MS = QUERY_GC_TIME_MS
/** Saves are throttled: at most one write per second. */
export const QUERY_CACHE_THROTTLE_MS = 1_000
/** A restore that takes longer than this is given up on (the app fetches instead). */
const RESTORE_TIMEOUT_MS = 3_000

export function queryCacheKey(userId: string): string {
  return `proofy-query-cache:${userId}`
}

let dbPromise: Promise<IDBPDatabase> | null = null
/**
 * Every read, write and delete runs in order, across persisters: a sign-out's delete and a later
 * sign-in's restore never cross.
 */
let chain: Promise<unknown> = Promise.resolve()

function run<T>(operation: () => Promise<T>): Promise<T> {
  const next = chain.then(operation, operation)
  chain = next.catch(() => undefined)
  return next
}

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(QUERY_CACHE_DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(QUERY_CACHE_STORE)
    },
    blocking() {
      void dbPromise?.then((open) => open.close())
      dbPromise = null
    },
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

/** Reads the stored client of a key (tests and the persister). */
export async function readPersistedClient(key: string): Promise<PersistedClient | undefined> {
  return (await db()).get(QUERY_CACHE_STORE, key) as Promise<PersistedClient | undefined>
}

/** Tests only: close the connection so the next call opens a fresh database. */
export async function resetQueryCacheDb(): Promise<void> {
  const open = dbPromise
  dbPromise = null
  if (open) (await open.catch(() => null))?.close()
}

/**
 * What is persisted: queries holding data, except those tagged `meta: { persist: false }` (Story
 * 3.4's signed URLs) and data written on the client (`setQueryData`) that no fetch has replaced.
 */
export function shouldPersistQuery(query: Query): boolean {
  if (query.state.data === undefined) return false
  if (query.meta?.persist === false) return false
  return !isOptimistic(query)
}

/**
 * A failed refresh keeps its data but leaves the query in an error state: persist it as the data it
 * shows (no error, not fetching), so a restore never opens on an error.
 */
function cleanState(state: DehydratedState): DehydratedState {
  return {
    mutations: [],
    queries: state.queries.map((query) => ({
      ...query,
      state: {
        ...query.state,
        status: 'success',
        fetchStatus: 'idle',
        error: null,
        fetchFailureCount: 0,
        fetchFailureReason: null,
      },
    })),
  }
}

export interface ThrottledPersister extends Persister {
  removeClient(): Promise<void>
  /** Drops a save that has not been written yet. */
  cancel(): void
}

/**
 * An IndexedDB persister for one key. Writes are throttled (the latest state wins) and every
 * operation runs in order, so a removal always lands after any write that started before it.
 */
export function createIdbPersister(
  key: string,
  throttleMs: number = QUERY_CACHE_THROTTLE_MS,
): ThrottledPersister {
  let latest: PersistedClient | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    timer = null
    const client = latest
    latest = null
    if (!client) return
    void run(async () => {
      await (await db()).put(QUERY_CACHE_STORE, client, key)
    }).catch(() => {
      // Storage full or blocked: the app keeps working from memory.
    })
  }

  return {
    persistClient(client) {
      latest = { ...client, clientState: cleanState(client.clientState) }
      timer ??= setTimeout(flush, throttleMs)
    },
    restoreClient: () => run(() => readPersistedClient(key)),
    removeClient() {
      latest = null
      if (timer !== null) clearTimeout(timer)
      timer = null
      return run(async () => {
        await (await db()).delete(QUERY_CACHE_STORE, key)
      })
    },
    cancel() {
      latest = null
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

export interface QueryPersistence {
  /** Restores `userId`'s saved cache into the client, then saves every change. Idempotent. */
  start(userId: string): Promise<void>
  /**
   * The session ended: stop saving at once and delete the user's saved cache (before the caller
   * clears the in-memory cache, which would otherwise be saved empty).
   */
  stop(): Promise<void>
  /** The user whose cache has been restored (null while restoring or signed out). */
  getRestoredUserId(): string | null
  subscribe(listener: () => void): () => void
}

export interface QueryPersistenceOptions {
  /** The build version: a cache saved by another build is dropped. */
  buster: string
  throttleMs?: number
}

/** Drives the persisted cache per signed-in user (restore, subscribe, delete on sign-out). */
export function createQueryPersistence(
  queryClient: QueryClient,
  { buster, throttleMs }: QueryPersistenceOptions,
): QueryPersistence {
  trackOptimisticWrites(queryClient)
  let userId: string | null = null
  let restoredUserId: string | null = null
  let persister: ThrottledPersister | null = null
  let unsubscribe: (() => void) | null = null
  let starting: Promise<void> = Promise.resolve()
  const listeners = new Set<() => void>()

  function setRestored(next: string | null) {
    if (restoredUserId === next) return
    restoredUserId = next
    for (const listener of listeners) listener()
  }

  const dehydrateOptions = {
    shouldDehydrateQuery: shouldPersistQuery,
    shouldDehydrateMutation: () => false,
  }

  return {
    start(next) {
      if (userId === next) return starting
      userId = next
      const own = createIdbPersister(queryCacheKey(next), throttleMs)
      persister = own
      let timedOut = false
      // Restored by hand (as persistQueryClientRestore does), but hydrated only while this is still
      // the current user and the timeout has not won: a sign-out or a slow read never puts the old
      // cache back into the client after it was cleared or refetched.
      const restore = (async () => {
        let saved: PersistedClient | undefined
        try {
          saved = await own.restoreClient()
        } catch {
          // Unreadable or blocked storage: start from an empty cache.
          await own.removeClient().catch(() => {})
          return
        }
        if (!saved) return
        if (userId !== next || persister !== own || timedOut) return
        const expired = !saved.timestamp || Date.now() - saved.timestamp > QUERY_CACHE_MAX_AGE_MS
        if (expired || saved.buster !== buster) {
          await own.removeClient().catch(() => {})
          return
        }
        try {
          hydrate(queryClient, saved.clientState)
        } catch {
          // A malformed saved cache: drop it and start empty.
          await own.removeClient().catch(() => {})
        }
      })().catch(() => {})
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true
          resolve()
        }, RESTORE_TIMEOUT_MS),
      )
      starting = Promise.race([restore, timeout]).then(() => {
        // Signed out (or another account) while restoring: nothing to start.
        if (userId !== next || persister !== own) return
        unsubscribe = persistQueryClientSubscribe({
          queryClient,
          persister: own,
          buster,
          dehydrateOptions,
        })
        setRestored(next)
      })
      return starting
    },
    stop() {
      const own = persister
      unsubscribe?.()
      unsubscribe = null
      persister = null
      userId = null
      setRestored(null)
      if (!own) return Promise.resolve()
      own.cancel()
      return own.removeClient().catch(() => {
        // Could not delete (blocked storage): it expires after 14 days or on the next build.
      })
    },
    getRestoredUserId: () => restoredUserId,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Starts the persisted cache for the signed-in user and returns whether queries must hold off
 * (`IsRestoringProvider`): true from the first signed-in render until that user's restore finished.
 */
export function useRestoringQueryCache(persistence: QueryPersistence): boolean {
  const session = useAuthSession()
  const userId = session.status === 'signed-in' ? session.user.id : null
  const restored = useSyncExternalStore(persistence.subscribe, persistence.getRestoredUserId)

  useEffect(() => {
    if (userId !== null) void persistence.start(userId)
  }, [persistence, userId])

  return userId !== null && restored !== userId
}
