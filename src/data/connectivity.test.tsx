import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { useLastFetchedAt } from '@/data/connectivity'
import { createTestQueryClient } from '@/test/fake-backend'

describe('useLastFetchedAt', () => {
  it('ignores queries that are never saved (signed photo URLs)', async () => {
    const client = createTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    await client.fetchQuery({ queryKey: ['today', 'g'], queryFn: () => ({ ok: true }) })
    const fetchedAt = client.getQueryState(['today', 'g'])?.dataUpdatedAt ?? 0
    const { result } = renderHook(() => useLastFetchedAt(), { wrapper })
    expect(result.current).toBe(fetchedAt)

    await act(() =>
      client.fetchQuery({
        queryKey: ['photoUrl', 'g/c/360.webp'],
        queryFn: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return 'https://x'
        },
        meta: { persist: false, silentRefresh: true },
      }),
    )
    expect(client.getQueryState(['photoUrl', 'g/c/360.webp'])?.dataUpdatedAt).toBeGreaterThan(
      fetchedAt,
    )
    expect(result.current).toBe(fetchedAt)
  })
})
