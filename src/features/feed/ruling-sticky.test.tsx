import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import type { FeedItem, FeedRuling } from '@/domain/feed'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_USER } from '@/test/fake-backend'
import { feedVote } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

// Friday 20 Nov 2026, 11:00 in Manila; the week locks Monday 00:00 Manila (Sun 23:59).
const NOW = new Date('2026-11-20T03:00:00Z')
const LOCK = '2026-11-22T16:00:00.000Z'
const BUTTON = 'Overturn (admin) until Sun 23:59'
const RULED = "Didn't count · Dev's Study · 2 said it doesn't count, 1 said it counts."
const OVERTURNED = "Overturned by you · Dev's Study is back."

function ruling(overrides: Partial<FeedRuling> = {}): FeedRuling {
  return {
    type: 'ruling',
    id: 'ruling-1',
    groupId: TEST_GROUP.id,
    sortAt: '2026-11-20T02:00:00.000000+00:00',
    challengeId: 'ch-1',
    checkinId: 'checkin-dev',
    challengerId: 'user-5',
    challengerName: 'Lena',
    ownerId: 'user-4',
    ownerName: 'Dev',
    title: 'Study',
    outcome: 'fake',
    fakeCount: 2,
    realCount: 1,
    variant: 'normal',
    overturnUntil: LOCK,
    canOverturn: true,
    overturnedById: null,
    overturnedByName: null,
    overturnedAt: null,
    ...overrides,
  }
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

async function renderFeed(items: FeedItem[], groupZone = TEST_GROUP.timeZone) {
  const backend = createFakeBackend(undefined, {
    groups: [{ ...TEST_GROUP, timeZone: groupZone }],
    feed: { [TEST_GROUP.id]: items },
  })
  render(<Toaster />)
  const result = renderRoutes(['/feed'], backend)
  await waitForGroupInUrl(result.router)
  return { ...result, backend }
}

function sticky(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-feed-item="ruling-1"]')
  if (!node) throw new Error('no ruling sticky')
  return node
}

async function findSticky(name = RULED): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 2, name })
  return sticky()
}

describe('Admin overturn on the ruling sticky (Story 5.3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    act(() => dismissToast())
    vi.useRealTimers()
    setOnline(true)
  })

  it('the admin overturns: the line changes in place, is read once, and the views refetch', async () => {
    const { backend } = await renderFeed([ruling()])
    const user = userEvent.setup()
    const node = await findSticky()
    const reads = vi.mocked(backend.listFeed).mock.calls.length
    await user.click(within(node).getByRole('button', { name: BUTTON }))

    expect(backend.overturnRuling).toHaveBeenCalledWith('ch-1')
    expect(
      await within(node).findByRole('heading', { level: 2, name: OVERTURNED }),
    ).toBeInTheDocument()
    expect(within(node).getByRole('status')).toHaveTextContent(OVERTURNED)
    expect(within(node).queryByRole('button', { name: BUTTON })).toBeNull()
    await waitFor(() =>
      expect(vi.mocked(backend.listFeed).mock.calls.length).toBeGreaterThan(reads),
    )
    // The refetched row (named by the server) keeps the same line and no button.
    expect(within(node).getByRole('heading', { level: 2, name: OVERTURNED })).toBeInTheDocument()
    expect(within(node).queryByRole('button', { name: BUTTON })).toBeNull()
  })

  it('names the group zone when the admin is elsewhere', async () => {
    await renderFeed([ruling({ overturnUntil: '2026-11-23T00:00:00.000Z' })], 'Europe/London')
    const node = await findSticky()
    expect(
      within(node).getByRole('button', { name: 'Overturn (admin) until Sun 23:59 London time' }),
    ).toBeInTheDocument()
  })

  it('no button when the server says no, on Real, at the lock, or once overturned', async () => {
    await renderFeed([
      ruling({ id: 'r-no', challengeId: 'ch-no', canOverturn: false }),
      ruling({
        id: 'r-real',
        challengeId: 'ch-real',
        outcome: 'real',
        fakeCount: 1,
        realCount: 2,
        overturnUntil: null,
        canOverturn: false,
      }),
      ruling({ id: 'r-late', challengeId: 'ch-late', overturnUntil: NOW.toISOString() }),
      ruling({
        id: 'r-done',
        challengeId: 'ch-done',
        canOverturn: false,
        overturnedById: 'user-9',
        overturnedByName: 'Ada',
        overturnedAt: '2026-11-20T02:30:00.000Z',
        ownerId: TEST_USER.id,
        ownerName: 'Jo',
      }),
    ])
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Overturned by Ada · Your Study is back.',
      }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2, name: RULED })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Overturn \(admin\)/ })).toBeNull()
  })

  it('offline: the error toast and nothing is sent', async () => {
    const { backend } = await renderFeed([ruling()])
    const user = userEvent.setup()
    const node = await findSticky()
    setOnline(false)
    await user.click(within(node).getByRole('button', { name: BUTTON }))
    expect(await screen.findByText("You're offline. Overturns need a signal.")).toBeInTheDocument()
    expect(backend.overturnRuling).not.toHaveBeenCalled()
    expect(within(node).getByRole('heading', { level: 2, name: RULED })).toBeInTheDocument()
  })

  it('an online failure shows the Inline retry on the sticky; Retry resends', async () => {
    const { backend } = await renderFeed([ruling()])
    vi.mocked(backend.overturnRuling).mockRejectedValueOnce(new BackendError('unknown'))
    const user = userEvent.setup()
    const node = await findSticky()
    await user.click(within(node).getByRole('button', { name: BUTTON }))
    const alert = await within(node).findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't overturn it. Tap Retry.")
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(backend.overturnRuling).toHaveBeenCalledTimes(2))
    expect(
      await within(node).findByRole('heading', { level: 2, name: OVERTURNED }),
    ).toBeInTheDocument()
    expect(within(node).queryByRole('alert')).toBeNull()
  })

  it('a locked week shows its copy and refetches the Feed', async () => {
    const { backend } = await renderFeed([ruling()])
    vi.mocked(backend.overturnRuling).mockRejectedValueOnce(new BackendError('week_locked'))
    const user = userEvent.setup()
    const node = await findSticky()
    const reads = vi.mocked(backend.listFeed).mock.calls.length
    await user.click(within(node).getByRole('button', { name: BUTTON }))
    expect(
      await screen.findByText('This week has locked. The result is final.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(vi.mocked(backend.listFeed).mock.calls.length).toBeGreaterThan(reads),
    )
  })

  it('an overturned Fake Vote card shows the overturned line and its thumbnail', async () => {
    const vote = feedVote({
      status: 'fake',
      fakeCount: 3,
      realCount: 1,
      variant: 'normal',
      canVote: false,
      overturnedById: TEST_USER.id,
      overturnedByName: 'Jo',
    })
    await renderFeed([vote])
    await screen.findByRole('heading', {
      level: 2,
      name: "Vote on whether Dev's Study check-in counts",
    })
    const card = document.querySelector<HTMLElement>(`[data-feed-item="${vote.id}"]`)
    if (!card) throw new Error('no vote card')
    expect(card).toHaveTextContent(OVERTURNED)
    expect(card).not.toHaveTextContent("Didn't count")
    expect(
      within(card).getByRole('button', { name: "View Dev's Study check-in photo" }),
    ).toBeInTheDocument()
  })
})
