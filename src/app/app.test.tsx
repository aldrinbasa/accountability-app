import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { App } from '@/app/app'
import { THEME_STORAGE_KEY } from '@/domain/theme'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { lastSeenCountKey, removedNoticeKey } from '@/data/group-notices'
import { getPostMoment, setPostMoment } from '@/data/post-moment'
import type { FakeBackend } from '@/test/fake-backend'

// Signed in through a fake backend: no Supabase client in tests.
const fake = vi.hoisted(() => ({ backend: null as unknown as FakeBackend }))
vi.mock('@/app/composition', async () => {
  const { createFakeBackend } = await import('@/test/fake-backend')
  fake.backend = createFakeBackend()
  const { createFakeCamera } = await import('@/test/fake-camera')
  const { createFakeEncoder } = await import('@/test/fake-image-encoder')
  return {
    adapters: {
      backend: fake.backend,
      camera: createFakeCamera(),
      imageEncoder: createFakeEncoder(),
    },
  }
})

const sw = vi.hoisted(() => ({ needRefresh: false, updateServiceWorker: vi.fn() }))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: sw.updateServiceWorker,
  }),
}))

describe('App', () => {
  beforeEach(() => {
    // Only Date is faked (fixed to Friday noon), so render and assertion agree across midnight.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 20, 12, 0, 0))
    sw.needRefresh = false
    sw.updateServiceWorker.mockClear()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens Today inside the shell, headed by the day name', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Friday' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('shows "Update ready." for a waiting worker; Update activates it', async () => {
    sw.needRefresh = true
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('Update ready.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it("clears the query cache and the account's device state when the session ends", async () => {
    const clear = vi.spyOn(QueryClient.prototype, 'clear')
    try {
      render(<App />)
      await screen.findByRole('heading', { level: 1, name: 'Friday' })
      expect(clear).not.toHaveBeenCalled()
      localStorage.setItem(FOCUSED_GROUP_KEY, 'group-1')
      localStorage.setItem(lastSeenCountKey('group-1'), '3')
      localStorage.setItem(removedNoticeKey('m-1'), '1')
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      setPostMoment({
        checkinId: 'k1',
        groupId: 'group-1',
        commitmentId: 'c1',
        title: 'Gym',
        doneCount: 1,
        target: 3,
        counted: true,
        isLate: false,
        photoUrl: null,
        caption: null,
        postedAt: Date.now(),
        played: true,
        announced: true,
      })

      act(() => fake.backend.emit(null))
      // The session-only post moment goes with the account.
      expect(getPostMoment()).toBeNull()
      expect(clear).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBeNull()
      expect(localStorage.getItem(lastSeenCountKey('group-1'))).toBeNull()
      expect(localStorage.getItem(removedNoticeKey('m-1'))).toBe('1')
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
      expect(await screen.findByRole('heading', { name: 'Sign in to Proofy' })).toBeInTheDocument()
    } finally {
      clear.mockRestore()
    }
  })
})
