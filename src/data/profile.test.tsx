import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { BackendError } from '@/domain/error-codes'
import type { Profile } from '@/domain/profile'
import {
  deviceTimeZone,
  MY_PROFILE_KEY,
  useMyProfile,
  useSaveProfile,
  useSetMyTimeZone,
} from '@/data/profile'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_PROFILE,
  withBackend,
} from '@/test/fake-backend'

afterEach(() => vi.restoreAllMocks())

function setup(backend = createFakeBackend()) {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    withBackend(backend, children, undefined, queryClient)
  return { backend, queryClient, wrapper }
}

describe('profile data', () => {
  it("useMyProfile reads ['profile', 'me'] through the backend", async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(() => useMyProfile(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TEST_PROFILE))
    expect(backend.getMyProfile).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toEqual(TEST_PROFILE)
  })

  it('useSaveProfile calls save_profile and writes the result into the cache', async () => {
    const { backend, queryClient, wrapper } = setup(createFakeBackend(undefined, { profile: null }))
    const { result } = renderHook(() => useSaveProfile(), { wrapper })
    await result.current.mutateAsync({ displayName: 'Jo', timeZone: 'Asia/Manila' })
    expect(backend.saveProfile).toHaveBeenCalledWith('Jo', 'Asia/Manila')
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toMatchObject({
      displayName: 'Jo',
      timeZone: 'Asia/Manila',
    })
  })

  it("useSetMyTimeZone shows the choice at once, then the server's start Monday", async () => {
    const { backend, queryClient, wrapper } = setup()
    queryClient.setQueryData(MY_PROFILE_KEY, TEST_PROFILE)
    let resolve: () => void = () => {}
    const gate = new Promise<void>((r) => (resolve = r))
    const set = backend.setTimeZone
    backend.setTimeZone = vi.fn(async (zone: string) => {
      await gate
      return set(zone)
    })
    const { result } = renderHook(() => useSetMyTimeZone(), { wrapper })
    const done = result.current.mutateAsync('Europe/London')
    await waitFor(() =>
      expect(queryClient.getQueryData<Profile>(MY_PROFILE_KEY)).toMatchObject({
        timeZone: 'Asia/Manila',
        pendingTimeZone: 'Europe/London',
        pendingWeekStart: null,
      }),
    )
    resolve()
    await done
    expect(backend.setTimeZone).toHaveBeenCalledWith('Europe/London')
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toEqual({
      ...TEST_PROFILE,
      pendingTimeZone: 'Europe/London',
      pendingWeekStart: '2026-11-23',
    })
  })

  it('useSetMyTimeZone puts the profile back when the call fails', async () => {
    const { backend, queryClient, wrapper } = setup()
    const before = {
      ...TEST_PROFILE,
      pendingTimeZone: 'Asia/Tokyo',
      pendingWeekStart: '2026-11-23',
    }
    queryClient.setQueryData(MY_PROFILE_KEY, before)
    backend.setTimeZone = vi.fn().mockRejectedValue(new BackendError('unknown'))
    const { result } = renderHook(() => useSetMyTimeZone(), { wrapper })
    await expect(result.current.mutateAsync('Asia/Manila')).rejects.toThrow()
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toEqual(before)
  })

  it('deviceTimeZone falls back to UTC', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    spy.mockReturnValue({ timeZone: 'Asia/Manila' } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceTimeZone()).toBe('Asia/Manila')
    spy.mockReturnValue({ timeZone: '' } as Intl.ResolvedDateTimeFormatOptions)
    expect(deviceTimeZone()).toBe('UTC')
    spy.mockImplementation(() => {
      throw new RangeError('no Intl data')
    })
    expect(deviceTimeZone()).toBe('UTC')
  })
})
