import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedItem } from '@/domain/feed'
import { isRitualHintDismissed } from '@/data/ritual-hint'
import { openVotesKey } from '@/data/open-votes'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'
import { createFakeBackend, renderRoutes, TEST_GROUP } from '@/test/fake-backend'
import { feedCheckin, feedFreezeVote, feedVote } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

// Friday 20 Nov 2026, 11:00 in Manila; the fixtures close at 05:59 the next morning.
const NOW = new Date('2026-11-20T03:00:00Z')
const RITUAL =
  "The photo's a ritual, not a court case. Question a check-in only when something's clearly off."

const CHALLENGE = feedVote({ id: 'ch-1', closesAt: '2026-11-20T21:59:00.000Z' })
const FREEZE = feedFreezeVote({ id: 'fr-1', closesAt: '2026-11-20T09:00:00.000Z' })

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

async function renderToday(items: FeedItem[], memberCount = 3) {
  const backend = createFakeBackend(undefined, {
    groups: [{ ...TEST_GROUP, memberCount }],
    feed: { [TEST_GROUP.id]: items },
  })
  render(<Toaster />)
  const result = renderRoutes(['/today'], backend)
  await waitForGroupInUrl(result.router)
  return result
}

function section(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: 'Open votes' })
  const node = heading.closest('section')
  if (!node) throw new Error('no Open votes section')
  return node
}

describe('Today Open votes (Story 5.6)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    act(() => dismissToast())
    vi.useRealTimers()
    setOnline(true)
  })

  it('shows the votes waiting for the member, nearest deadline first, as the Feed cards', async () => {
    await renderToday([
      CHALLENGE,
      FREEZE,
      feedCheckin(),
      feedVote({ id: 'ch-later', canVote: false }),
      feedFreezeVote({ id: 'fr-mine', requesterId: 'user-1' }),
      feedVote({ id: 'ch-done', status: 'real', fakeCount: 1, realCount: 2 }),
    ])
    await screen.findByRole('heading', { level: 2, name: 'Open votes' })
    const cards = section().querySelectorAll('article')
    expect([...cards].map((card) => card.getAttribute('data-feed-item'))).toEqual(['fr-1', 'ch-1'])
    expect(within(section()).getByRole('button', { name: 'Vote: approve' })).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: 'Vote: counts' })).toBeInTheDocument()
    expect(
      within(section()).getByRole('button', { name: "View Dev's Study check-in photo" }),
    ).toBeInTheDocument()
  })

  it('is absent when nothing waits and in a waiting group', async () => {
    const first = await renderToday([feedVote({ canVote: false })])
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(first.backend.listOpenVotes).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { level: 2, name: 'Open votes' })).toBeNull()
    first.unmount()

    const waiting = await renderToday([CHALLENGE], 1)
    await screen.findByRole('heading', { level: 1 })
    expect(waiting.backend.listOpenVotes).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { level: 2, name: 'Open votes' })).toBeNull()
  })

  it('a vote from Today stays voted with Undo, then leaves on a fetch after 6 s', async () => {
    const { backend, queryClient } = await renderToday([CHALLENGE])
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 2, name: 'Open votes' })
    await user.click(within(section()).getByRole('button', { name: 'Vote: counts' }))
    expect(backend.castVote).toHaveBeenCalledWith('challenge', 'ch-1', 'real')
    await waitFor(() =>
      expect(within(section()).getByRole('button', { name: 'Vote: counts' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    expect(await screen.findByRole('button', { name: 'Undo' })).toBeInTheDocument()

    // A fetch inside the 6 s window keeps the voted card.
    vi.setSystemTime(new Date(NOW.getTime() + 3_000))
    await act(() => queryClient.invalidateQueries({ queryKey: openVotesKey(TEST_GROUP.id) }))
    expect(within(section()).getByRole('button', { name: 'Vote: counts' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // The next fetch after it drops the card and the section with it.
    vi.setSystemTime(new Date(NOW.getTime() + 7_000))
    await act(() => queryClient.invalidateQueries({ queryKey: openVotesKey(TEST_GROUP.id) }))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 2, name: 'Open votes' })).toBeNull(),
    )
  })

  it('after a vote, the scheduled fetch past the 6 s window takes the card away', async () => {
    const { backend } = await renderToday([CHALLENGE])
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 2, name: 'Open votes' })
    await user.click(within(section()).getByRole('button', { name: 'Vote: counts' }))
    await waitFor(() => expect(backend.castVote).toHaveBeenCalled())
    const calls = vi.mocked(backend.listOpenVotes).mock.calls.length
    // The clock moves past the ballot's window; the 6.5 s timer of useCastVote refetches by itself.
    vi.setSystemTime(new Date(NOW.getTime() + 7_000))
    await waitFor(
      () => expect(screen.queryByRole('heading', { level: 2, name: 'Open votes' })).toBeNull(),
      { timeout: 9_000 },
    )
    expect(vi.mocked(backend.listOpenVotes).mock.calls.length).toBeGreaterThan(calls)
  }, 15_000)

  it('a vote whose deadline passes while Today stays open leaves at the next minute tick', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval'] })
    vi.setSystemTime(NOW)
    await renderToday([feedVote({ id: 'ch-soon', closesAt: '2026-11-20T03:00:30.000Z' })])
    await screen.findByRole('heading', { level: 2, name: 'Open votes' })
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.queryByRole('heading', { level: 2, name: 'Open votes' })).toBeNull()
  })

  it('offline: a tap shows the offline vote toast and sends nothing', async () => {
    const { backend } = await renderToday([FREEZE])
    const user = userEvent.setup()
    await screen.findByRole('heading', { level: 2, name: 'Open votes' })
    setOnline(false)
    await user.click(within(section()).getByRole('button', { name: 'Vote: approve' }))
    expect(await screen.findByText("You're offline. Votes need a signal.")).toBeInTheDocument()
    expect(backend.castVote).not.toHaveBeenCalled()
    expect(within(section()).getByRole('button', { name: 'Vote: approve' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

describe('Today ritual Hint (Story 5.6)', () => {
  it('shows in an active group until Not now, remembered per group on this device', async () => {
    const first = await renderToday([])
    const user = userEvent.setup()
    const hint = (await screen.findByText(RITUAL)).closest('[data-component="hint"]')
    if (!(hint instanceof HTMLElement)) throw new Error('no hint')
    const notNow = within(hint).getByRole('button', { name: 'Not now' })
    expect(notNow).toHaveClass('min-h-target-min')
    await user.click(notNow)
    expect(screen.queryByText(RITUAL)).toBeNull()
    expect(isRitualHintDismissed(TEST_GROUP.id)).toBe(true)
    first.unmount()

    await renderToday([])
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(RITUAL)).toBeNull()
  })

  it('never shows in a waiting group', async () => {
    await renderToday([], 1)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(RITUAL)).toBeNull()
  })
})
