import { createElement, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import {
  createPhotoSigner,
  PHOTO_URL_REFRESH_MS,
  photoUrlKey,
  usePhotoUrl,
  type PhotoUrlOptions,
} from '@/data/photo-url'
import { shouldPersistQuery } from '@/data/query-persistence'
import {
  createFakeBackend,
  createTestQueryClient,
  FAKE_PHOTO_ORIGIN,
  withBackend,
  type FakeBackend,
} from '@/test/fake-backend'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

function setConnection(connection: { saveData?: boolean; effectiveType?: string } | undefined) {
  Object.defineProperty(navigator, 'connection', { configurable: true, get: () => connection })
}

afterEach(() => {
  setOnline(true)
  setConnection(undefined)
  vi.useRealTimers()
})

const signed = (path: string) => `${FAKE_PHOTO_ORIGIN}/sign/${path}?token=t`

function renderPhoto(
  backend: FakeBackend,
  options: PhotoUrlOptions = {},
  queryClient = createTestQueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    withBackend(backend, createElement('div', null, children), undefined, queryClient)
  const hook = renderHook(() => usePhotoUrl('group-1', 'checkin-1', options), { wrapper })
  return { ...hook, queryClient }
}

describe('createPhotoSigner', () => {
  it('signs every path asked for in the same tick with one request', async () => {
    const backend = createFakeBackend()
    const signer = createPhotoSigner(backend)
    const urls = await Promise.all([signer.sign('a/1/360.webp'), signer.sign('a/2/360.webp')])
    expect(urls).toEqual([signed('a/1/360.webp'), signed('a/2/360.webp')])
    expect(backend.signCheckinPhotos).toHaveBeenCalledTimes(1)
    expect(backend.signCheckinPhotos).toHaveBeenCalledWith(['a/1/360.webp', 'a/2/360.webp'])
  })

  it('rejects a path the server would not sign, and every path when the request fails', async () => {
    const backend = createFakeBackend()
    backend.signCheckinPhotos = vi.fn(async () => ({ 'a/1/360.webp': null }))
    const signer = createPhotoSigner(backend)
    await expect(signer.sign('a/1/360.webp')).rejects.toBeInstanceOf(BackendError)

    backend.signCheckinPhotos = vi.fn(async () => {
      throw new BackendError('network')
    })
    await expect(signer.sign('a/2/360.webp')).rejects.toMatchObject({ code: 'network' })
  })
})

describe('usePhotoUrl', () => {
  it('serves the 360 as src with a 360w / 1080w srcset by default', async () => {
    const backend = createFakeBackend()
    const { result } = renderPhoto(backend)
    await waitFor(() => expect(result.current.src).not.toBeNull())
    expect(result.current.src).toBe(signed('group-1/checkin-1/360.webp'))
    expect(result.current.srcSet).toBe(
      `${signed('group-1/checkin-1/360.webp')} 360w, ${signed('group-1/checkin-1/1080.webp')} 1080w`,
    )
    expect(backend.signCheckinPhotos).toHaveBeenCalledTimes(1)
  })

  it('uses the 360 only for small boxes, pruned photos, Save-Data and 2g', async () => {
    for (const [options, connection] of [
      [{ small: true }, undefined],
      [{ fullPrunedAt: '2027-02-01T00:00:00Z' }, undefined],
      [{}, { saveData: true }],
      [{}, { effectiveType: '2g' }],
    ] as const) {
      setConnection(connection)
      const backend = createFakeBackend()
      const { result, unmount } = renderPhoto(backend, options)
      await waitFor(() => expect(result.current.src).toBe(signed('group-1/checkin-1/360.webp')))
      expect(result.current.srcSet).toBeUndefined()
      expect(backend.signCheckinPhotos).toHaveBeenCalledWith(['group-1/checkin-1/360.webp'])
      unmount()
    }
  })

  it('re-mints the URL every 9 minutes while shown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const backend = createFakeBackend()
    const { result } = renderPhoto(backend, { small: true })
    await waitFor(() => expect(result.current.src).not.toBeNull())
    expect(backend.signCheckinPhotos).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(PHOTO_URL_REFRESH_MS - 1_000))
    expect(backend.signCheckinPhotos).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    await waitFor(() => expect(backend.signCheckinPhotos).toHaveBeenCalledTimes(2))
  })

  it('is never persisted', async () => {
    const backend = createFakeBackend()
    const { result, queryClient } = renderPhoto(backend, { small: true })
    await waitFor(() => expect(result.current.src).not.toBeNull())
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: photoUrlKey('group-1/checkin-1/360.webp') })
    expect(query).toBeDefined()
    expect(shouldPersistQuery(query as NonNullable<typeof query>)).toBe(false)
    expect(query?.meta).toEqual({ persist: false, silentRefresh: true })
  })

  it('offline, points at the token-less URL only the service worker cache can answer', () => {
    setOnline(false)
    const backend = createFakeBackend()
    const { result } = renderPhoto(backend)
    expect(result.current.fromCache).toBe(true)
    expect(result.current.src).toBe(`${FAKE_PHOTO_ORIGIN}/sign/group-1/checkin-1/360.webp`)
    expect(backend.signCheckinPhotos).not.toHaveBeenCalled()
  })

  it('offline, offers the cached copies with the online candidates (the size loaded then)', () => {
    setOnline(false)
    const { result } = renderPhoto(createFakeBackend())
    expect(result.current.fromCache).toBe(true)
    expect(result.current.srcSet).toMatch(/360\.webp 360w, .*1080\.webp 1080w$/)
  })

  it('shows the 360 alone when only the 1080 is refused', async () => {
    const backend = createFakeBackend()
    backend.signCheckinPhotos = vi.fn(async (paths: readonly string[]) =>
      Object.fromEntries(
        paths.map((path) => [path, path.endsWith('1080.webp') ? null : signed(path)]),
      ),
    )
    const { result } = renderPhoto(backend)
    await waitFor(() => expect(result.current.src).toBe(signed('group-1/checkin-1/360.webp')))
    expect(result.current.srcSet).toBeUndefined()
    expect(result.current.failed).toBe(false)
  })

  it('reports a failed sign and signs again on retry', async () => {
    const backend = createFakeBackend()
    backend.signCheckinPhotos = vi.fn(async () => {
      throw new BackendError('unknown')
    })
    const { result } = renderPhoto(backend, { small: true })
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.src).toBeNull()

    backend.signCheckinPhotos = vi.fn(async (paths: readonly string[]) =>
      Object.fromEntries(paths.map((path) => [path, signed(path)])),
    )
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.src).toBe(signed('group-1/checkin-1/360.webp')))
  })
})
