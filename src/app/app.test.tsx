import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { dehydrate, QueryClient } from '@tanstack/react-query'
import { App } from '@/app/app'
import { BackendError } from '@/domain/error-codes'
import { THEME_STORAGE_KEY } from '@/domain/theme'
import type { TodayItem } from '@/domain/today'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { lastSeenCountKey, removedNoticeKey } from '@/data/group-notices'
import { MY_GROUPS_KEY } from '@/data/groups'
import { todayKey } from '@/data/plan'
import { getPostMoment, setPostMoment } from '@/data/post-moment'
import { MY_PROFILE_KEY } from '@/data/profile'
import { createIdbPersister, queryCacheKey, readPersistedClient } from '@/data/query-persistence'
import {
  TEST_GROUP,
  TEST_PROFILE,
  TEST_TODAY_SUMMARY,
  TEST_USER,
  type FakeBackend,
} from '@/test/fake-backend'

const GYM: TodayItem = {
  commitmentId: 'c-gym',
  kind: 'commitment',
  section: 'due_today',
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  name: null,
  scheduleType: 'fixed_days',
  days: [1, 3, 5],
  target: 3,
  counted: 1,
  deadline: null,
  startsOn: null,
  canDelete: false,
  countedToday: false,
  targetMet: false,
}

async function until(done: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (await done()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

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

  it('a cold start offline opens on the saved cache, with the offline Banner', async () => {
    // What an earlier session saved for this user and this build.
    const seed = new QueryClient()
    seed.setQueryData(MY_PROFILE_KEY, TEST_PROFILE)
    seed.setQueryData(MY_GROUPS_KEY, { groups: [TEST_GROUP], ended: [] })
    seed.setQueryData(todayKey(TEST_GROUP.id), {
      items: [GYM],
      summary: { ...TEST_TODAY_SUMMARY, planned: 3, hasPlan: true },
    })
    createIdbPersister(queryCacheKey(TEST_USER.id), 0).persistClient({
      buster: __PROOFY_BUILD_ID__,
      timestamp: Date.now(),
      clientState: dehydrate(seed),
    })
    await until(
      async () => (await readPersistedClient(queryCacheKey(TEST_USER.id))) !== undefined,
      'the seed',
    )

    const reads = [
      fake.backend.getMyProfile,
      fake.backend.listMyGroups,
      fake.backend.getTodayItems,
      fake.backend.getTodaySummary,
    ] as const
    const originals = reads.map((read) => vi.mocked(read).getMockImplementation())
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      for (const read of reads) {
        vi.mocked(read).mockImplementation(async () => {
          throw new BackendError('network')
        })
      }
      render(<App />)
      expect(await screen.findByRole('button', { name: 'Check in Gym' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 1, name: 'Friday' })).toBeInTheDocument()
      expect(
        screen.getByText(/^Offline · showing what you had at \d\d:\d\d\.$/),
      ).toBeInTheDocument()
      expect(screen.queryByText("Can't reach Proofy right now.")).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
      reads.forEach((read, index) => {
        const original = originals[index]
        if (original) vi.mocked(read).mockImplementation(original as never)
      })
    }
  })

  it("clears the query cache and the account's device state when the session ends", async () => {
    const clear = vi.spyOn(QueryClient.prototype, 'clear')
    try {
      render(<App />)
      await screen.findByRole('heading', { level: 1, name: 'Friday' })
      expect(clear).not.toHaveBeenCalled()
      // The saved cache exists once the 1 s throttle has passed.
      await until(
        async () => (await readPersistedClient(queryCacheKey(TEST_USER.id))) !== undefined,
        'a save',
      )
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
        weeklyPoints: null,
        rank: null,
        passedUserIds: [],
        passedShownIn: null,
        photoUrl: null,
        caption: null,
        postedAt: Date.now(),
        played: true,
        announced: true,
      })

      act(() => fake.backend.emit(null))
      // The session-only post moment goes with the account.
      expect(getPostMoment()).toBeNull()
      // So does the saved query cache.
      await waitFor(async () =>
        expect(await readPersistedClient(queryCacheKey(TEST_USER.id))).toBeUndefined(),
      )
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
