import { QueryClient } from '@tanstack/react-query'
import { createAppQueryClient, QUERY_GC_TIME_MS } from '@/data/query-client'
import {
  createIdbPersister,
  createQueryPersistence,
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_CACHE_THROTTLE_MS,
  queryCacheKey,
  readPersistedClient,
  type QueryPersistence,
} from '@/data/query-persistence'

const DAY = 24 * 60 * 60_000

async function until(done: () => boolean | Promise<boolean>, what = 'condition'): Promise<void> {
  const started = performance.now()
  while (performance.now() - started < 3_000) {
    if (await done()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function stored(userId: string) {
  return readPersistedClient(queryCacheKey(userId))
}

function storedKeys(client: Awaited<ReturnType<typeof stored>>): string[] {
  return (client?.clientState.queries ?? []).map((query) => JSON.stringify(query.queryKey))
}

let running: QueryPersistence[] = []

function persist(queryClient: QueryClient, buster = 'build-1') {
  const persistence = createQueryPersistence(queryClient, { buster, throttleMs: 10 })
  running.push(persistence)
  return persistence
}

afterEach(async () => {
  for (const persistence of running) await persistence.stop()
  running = []
})

describe('query client defaults', () => {
  it('14-day gcTime and maxAge, saves throttled to 1 s, never pauses offline', () => {
    const client = createAppQueryClient()
    const defaults = client.getDefaultOptions().queries
    expect(defaults?.gcTime).toBe(14 * DAY)
    expect(QUERY_GC_TIME_MS).toBe(14 * DAY)
    expect(QUERY_CACHE_MAX_AGE_MS).toBe(14 * DAY)
    expect(QUERY_CACHE_THROTTLE_MS).toBe(1_000)
    expect(defaults?.networkMode).toBe('always')
  })

  it('does not retry while offline', async () => {
    const client = createAppQueryClient()
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      const queryFn = vi.fn(async () => {
        throw new Error('offline')
      })
      await expect(client.fetchQuery({ queryKey: ['x'], queryFn })).rejects.toThrow('offline')
      expect(queryFn).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    }
  })

  it('reports a failed refresh only when the query still has data and the device is online', async () => {
    const onRefreshFailed = vi.fn()
    const client = createAppQueryClient({ onRefreshFailed })
    const { BackendError } = await import('@/domain/error-codes')
    const fail = async () => {
      throw new BackendError('network')
    }
    await client.fetchQuery({ queryKey: ['empty'], queryFn: fail, retry: false }).catch(() => {})
    expect(onRefreshFailed).not.toHaveBeenCalled()

    client.setQueryData(['full'], 1)
    await client
      .fetchQuery({ queryKey: ['full'], queryFn: fail, retry: false, staleTime: 0 })
      .catch(() => {})
    expect(onRefreshFailed).toHaveBeenCalledTimes(1)

    // A server answer (e.g. not_member) is the screen's to handle.
    await client
      .fetchQuery({
        queryKey: ['full'],
        queryFn: async () => {
          throw new BackendError('not_member')
        },
        retry: false,
        staleTime: 0,
      })
      .catch(() => {})
    expect(onRefreshFailed).toHaveBeenCalledTimes(1)

    // Retry refetches that query.
    const refetch = vi.spyOn(client, 'refetchQueries')
    ;(onRefreshFailed.mock.calls[0]?.[0] as () => void)()
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['full'], exact: true })
  })
})

describe('persisted query cache', () => {
  it("saves under the user's key with the buster, leaving out unsaveable queries", async () => {
    const client = createAppQueryClient()
    const persistence = persist(client)
    await persistence.start('user-a')
    expect(persistence.getRestoredUserId()).toBe('user-a')

    await client.fetchQuery({ queryKey: ['today', 'g1'], queryFn: async () => ({ n: 1 }) })
    await client.fetchQuery({
      queryKey: ['photoUrl', 'k1'],
      queryFn: async () => 'https://signed',
      meta: { persist: false },
    })
    // Written on the client (optimistic): not saved until a fetch replaces it.
    client.setQueryData(['groups', 'me'], { groups: ['optimistic'] })
    await until(async () => (await stored('user-a')) !== undefined, 'a save')
    await until(async () => storedKeys(await stored('user-a')).length === 1, 'one query')

    const saved = await stored('user-a')
    expect(saved?.buster).toBe('build-1')
    expect(storedKeys(saved)).toEqual(['["today","g1"]'])
    expect(await stored('user-b')).toBeUndefined()

    await client.fetchQuery({
      queryKey: ['groups', 'me'],
      queryFn: async () => ({ groups: ['fetched'] }),
      staleTime: 0,
    })
    await until(async () => storedKeys(await stored('user-a')).length === 2, 'the fetched groups')
  })

  it('saves a query whose refresh failed as the data it shows', async () => {
    const client = createAppQueryClient()
    const persistence = persist(client)
    await persistence.start('user-a')
    await client.fetchQuery({ queryKey: ['today', 'g1'], queryFn: async () => 1 })
    await client
      .fetchQuery({
        queryKey: ['today', 'g1'],
        queryFn: async () => {
          throw new Error('down')
        },
        retry: false,
        staleTime: 0,
      })
      .catch(() => {})
    expect(client.getQueryState(['today', 'g1'])?.status).toBe('error')
    await until(async () => {
      const query = (await stored('user-a'))?.clientState.queries[0]
      return query?.state.status === 'success' && query.state.error === null
    }, 'a clean save')
  })

  it('restores the same build within 14 days into a new client', async () => {
    const first = createAppQueryClient()
    const persistence = persist(first)
    await persistence.start('user-a')
    await first.fetchQuery({ queryKey: ['today', 'g1'], queryFn: async () => 'cached' })
    await until(async () => storedKeys(await stored('user-a')).length === 1, 'a save')

    const second = createAppQueryClient()
    await persist(second).start('user-a')
    expect(second.getQueryData(['today', 'g1'])).toBe('cached')

    // Another account on this device restores nothing of it.
    const third = createAppQueryClient()
    await persist(third).start('user-b')
    expect(third.getQueryData(['today', 'g1'])).toBeUndefined()
  })

  it('drops a cache from another build (buster) or older than 14 days', async () => {
    const persister = createIdbPersister(queryCacheKey('user-a'), 0)
    const clientState = {
      mutations: [],
      queries: [
        {
          queryKey: ['today', 'g1'],
          queryHash: '["today","g1"]',
          dehydratedAt: Date.now(),
          state: {
            data: 'old',
            dataUpdateCount: 1,
            dataUpdatedAt: Date.now(),
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: 'success' as const,
            fetchStatus: 'idle' as const,
          },
        },
      ],
    }
    persister.persistClient({ buster: 'build-0', timestamp: Date.now(), clientState })
    await until(async () => (await stored('user-a')) !== undefined, 'the old build')
    const busted = createAppQueryClient()
    await persist(busted, 'build-1').start('user-a')
    expect(busted.getQueryData(['today', 'g1'])).toBeUndefined()
    await until(async () => (await stored('user-a')) === undefined, 'the drop')
    await running.pop()?.stop()

    persister.persistClient({
      buster: 'build-1',
      timestamp: Date.now() - 14 * DAY - 1,
      clientState,
    })
    await until(async () => (await stored('user-a')) !== undefined, 'the stale save')
    const expired = createAppQueryClient()
    await persist(expired, 'build-1').start('user-a')
    expect(expired.getQueryData(['today', 'g1'])).toBeUndefined()
  })

  it("sign-out stops saving and deletes that user's saved cache", async () => {
    const client = createAppQueryClient()
    const persistence = persist(client)
    await persistence.start('user-a')
    await client.fetchQuery({ queryKey: ['today', 'g1'], queryFn: async () => 1 })
    await until(async () => (await stored('user-a')) !== undefined, 'a save')

    await persistence.stop()
    client.clear()
    await client.fetchQuery({ queryKey: ['today', 'g2'], queryFn: async () => 2 })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await stored('user-a')).toBeUndefined()
    expect(persistence.getRestoredUserId()).toBeNull()
  })

  it('a sign-out while the restore is pending never puts the old cache back', async () => {
    const first = createAppQueryClient()
    const saver = persist(first)
    await saver.start('user-a')
    await first.fetchQuery({ queryKey: ['today', 'g1'], queryFn: async () => 'old' })
    await until(async () => storedKeys(await stored('user-a')).length === 1, 'a save')
    running = running.filter((p) => p !== saver)

    const second = createAppQueryClient()
    const persistence = persist(second)
    const starting = persistence.start('user-a')
    await persistence.stop()
    second.clear()
    await starting
    expect(second.getQueryData(['today', 'g1'])).toBeUndefined()
    expect(persistence.getRestoredUserId()).toBeNull()
  })
})
