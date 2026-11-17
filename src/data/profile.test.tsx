import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { deviceTimeZone, MY_PROFILE_KEY, useMyProfile, useSaveProfile } from '@/data/profile'
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
