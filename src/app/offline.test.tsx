import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  getOutboxEntry,
  listOutboxEntries,
  putOutboxEntry,
  type OutboxEntry,
} from '@/data/outbox-db'
import { canShowUpdatePrompt, setUploadRunning } from '@/ui/update-guard'
import { Toaster } from '@/ui/toaster'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_USER } from '@/test/fake-backend'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  })
}

function waitingEntry(id: string, overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id,
    userId: TEST_USER.id,
    groupId: TEST_GROUP.id,
    groupName: TEST_GROUP.name,
    commitmentId: 'c-gym',
    title: 'Gym',
    capturedAt: '2026-11-20T07:12:00.000Z',
    caption: null,
    firstQueuedAt: Date.now(),
    attempts: 0,
    rejection: null,
    photos: {
      1080: { bytes: new ArrayBuffer(4), type: 'image/webp' },
      360: { bytes: new ArrayBuffer(2), type: 'image/webp' },
    },
    uploaded: [],
    retryStreak: 0,
    nextAttemptAt: 0,
    ...overrides,
  }
}

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
  setUploadRunning(false)
})

describe('offline Banner', () => {
  it('shows what the app had while offline, and goes when the connection returns', async () => {
    renderRoutes(['/today'])
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByText(/^Offline · showing what you had at/)).not.toBeInTheDocument()

    setOnline(false)
    // The member zone (Asia/Manila) clock of the newest fetch.
    expect(
      await screen.findByText(/^Offline · showing what you had at \d\d:\d\d\.$/),
    ).toBeInTheDocument()

    setOnline(true)
    await waitFor(() =>
      expect(screen.queryByText(/^Offline · showing what you had at/)).not.toBeInTheDocument(),
    )
  })

  it('a cold start offline with no cache: "Can\'t reach Proofy right now." + Try again', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    const backend = createFakeBackend()
    vi.mocked(backend.listMyGroups).mockRejectedValue(
      new (await import('@/domain/error-codes')).BackendError('network'),
    )
    renderRoutes(['/today'], backend)
    expect(await screen.findByText("Can't reach Proofy right now.")).toBeInTheDocument()
    expect(screen.getByText('Check your signal and try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    // Offline: no retries (one read only).
    expect(backend.listMyGroups).toHaveBeenCalledTimes(1)
  })
})

describe('the outbox on Today', () => {
  it('shows a waiting photo from an earlier session and sends it on app start', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await putOutboxEntry(waitingEntry('k1'))
    const backend = createFakeBackend()
    renderRoutes(['/today'], backend)
    expect(
      await screen.findByText(/^1 photo waiting to send · Gym · Gym Rats · taken 15:12\./),
    ).toBeInTheDocument()
    expect(backend.postCheckin).not.toHaveBeenCalled()

    setOnline(true)
    await waitFor(() => expect(backend.postCheckin).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText(/photo waiting to send/)).not.toBeInTheDocument())
    expect(await getOutboxEntry('k1')).toBeUndefined()
    // A late send still plays the moment on Today.
    await waitFor(() =>
      expect(document.querySelector('[data-component="post-moment"]')).not.toBeNull(),
    )
  })

  it("another account's waiting photos are neither shown nor sent", async () => {
    await putOutboxEntry(waitingEntry('theirs', { userId: 'someone-else' }))
    const backend = createFakeBackend()
    renderRoutes(['/today'], backend)
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(/photo waiting to send/)).not.toBeInTheDocument()
    expect(backend.postCheckin).not.toHaveBeenCalled()
  })
})

describe('the update guard', () => {
  it('holds the "Update ready" toast while the outbox uploads, then lets it show', async () => {
    await putOutboxEntry(waitingEntry('k1'))
    const backend = createFakeBackend()
    let finish: () => void = () => {}
    vi.mocked(backend.uploadCheckinPhoto).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    renderRoutes(['/today'], backend)
    await waitFor(() => expect(backend.uploadCheckinPhoto).toHaveBeenCalledTimes(1))
    expect(canShowUpdatePrompt()).toBe(false)
    finish()
    await waitFor(() => expect(backend.postCheckin).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(canShowUpdatePrompt()).toBe(true))
  })
})

describe('sign-out with waiting photos', () => {
  async function openSettings() {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await putOutboxEntry(waitingEntry('k1'))
    await putOutboxEntry(waitingEntry('k2', { firstQueuedAt: Date.now() + 1 }))
    const user = userEvent.setup()
    const backend = createFakeBackend()
    const result = renderRoutes(['/today', '/me/settings'], backend, { initialIndex: 1 })
    // The outbox has loaded the two entries.
    await screen.findByRole('heading', { level: 1, name: 'Settings' })
    await waitFor(async () => expect(await listOutboxEntries(TEST_USER.id)).toHaveLength(2))
    return { ...result, user, backend }
  }

  it('asks first; closing the Sheet keeps everything', async () => {
    const { user, backend } = await openSettings()
    await waitFor(async () => {
      await user.click(screen.getByRole('button', { name: 'Sign out' }))
      expect(screen.getByRole('dialog', { name: 'Sign out?' })).toBeInTheDocument()
    })
    const sheet = screen.getByRole('dialog', { name: 'Sign out?' })
    expect(
      within(sheet).getByText('2 photos are still waiting to send. Signing out deletes them.'),
    ).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.signOut).not.toHaveBeenCalled()
    expect(await listOutboxEntries(TEST_USER.id)).toHaveLength(2)
  })

  it('Sign out in the Sheet signs out, then deletes the waiting photos', async () => {
    const { user, backend, router } = await openSettings()
    await waitFor(async () => {
      await user.click(screen.getByRole('button', { name: 'Sign out' }))
      expect(screen.getByRole('dialog', { name: 'Sign out?' })).toBeInTheDocument()
    })
    const sheet = screen.getByRole('dialog', { name: 'Sign out?' })
    await user.click(within(sheet).getByRole('button', { name: 'Sign out' }))
    expect(backend.signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
    await waitFor(async () => expect(await listOutboxEntries(TEST_USER.id)).toEqual([]))
  })

  it('a failed sign-out keeps the photos', async () => {
    const { user, backend } = await openSettings()
    backend.signOut = vi.fn(async () => {
      throw new Error('offline')
    })
    render(<Toaster />)
    await waitFor(async () => {
      await user.click(screen.getByRole('button', { name: 'Sign out' }))
      expect(screen.getByRole('dialog', { name: 'Sign out?' })).toBeInTheDocument()
    })
    const sheet = screen.getByRole('dialog', { name: 'Sign out?' })
    await user.click(within(sheet).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText("Couldn't sign out. Try again.")).toBeInTheDocument()
    expect(await listOutboxEntries(TEST_USER.id)).toHaveLength(2)
  })
})

describe('sign-out before the outbox has loaded', () => {
  it('reads the store first, so the waiting photos are never deleted unwarned', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await putOutboxEntry(waitingEntry('k1'))
    const user = userEvent.setup()
    const backend = createFakeBackend()
    // The snapshot read is slow: the first listing never settles before the tap.
    const outboxDb = await import('@/data/outbox-db')
    const list = vi.spyOn(outboxDb, 'listOutboxEntries')
    list.mockImplementationOnce(() => new Promise(() => {}))
    renderRoutes(['/today', '/me/settings'], backend, { initialIndex: 1 })
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    const sheet = await screen.findByRole('dialog', { name: 'Sign out?' })
    expect(
      within(sheet).getByText('1 photo is still waiting to send. Signing out deletes it.'),
    ).toBeInTheDocument()
    expect(backend.signOut).not.toHaveBeenCalled()
    expect(await getOutboxEntry('k1')).toBeDefined()
    // The outbox's own reads went through the held listing (the snapshot never loaded).
    expect(list).toHaveBeenCalled()
  })
})
