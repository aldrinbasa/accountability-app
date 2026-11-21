import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import type { FeedItem, FeedViewer } from '@/domain/feed'
import { UNDO_WINDOW_MS, type FeedVote, type VoteTally } from '@/domain/vote'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'
import { VoteCard } from '@/features/vote/vote-card'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_USER,
  withBackend,
} from '@/test/fake-backend'
import { feedCheckin, feedVote } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

// Friday 20 Nov 2026, 11:00 in Manila; the challenge closes at 05:59 the next morning (18 h 59 min).
const NOW = new Date('2026-11-20T03:00:00Z')

const VOTE = feedVote()
const TALLY: VoteTally = {
  targetKind: 'challenge',
  targetId: VOTE.id,
  votedCount: 2,
  eligibleCount: 4,
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

afterEach(() => {
  setOnline(true)
})

async function renderFeed(
  items: FeedItem[],
  options: { path?: string; tallies?: VoteTally[] } = {},
) {
  const feed = { [TEST_GROUP.id]: items }
  const backend = createFakeBackend(undefined, {
    feed,
    voteTallies: { [TEST_GROUP.id]: options.tallies ?? [TALLY] },
  })
  render(<Toaster />)
  const result = renderRoutes([options.path ?? '/feed'], backend)
  await waitForGroupInUrl(result.router)
  return { ...result, backend, feed }
}

function card(): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-feed-item="${VOTE.id}"]`)
  if (!node) throw new Error('no vote card')
  return node
}

async function findCard(): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 2, name: "Challenge vote on Dev's Study check-in" })
  return card()
}

describe('Vote card (Story 5.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    act(() => dismissToast())
    vi.useRealTimers()
  })

  it('shows the open card: kicker, thumbnail, who line, question, rule, buttons and tally', async () => {
    await renderFeed([VOTE])
    const node = await findCard()
    expect(node).toHaveAttribute('data-vote-state', 'open')
    expect(node.querySelector('[data-component="sticky-note"]')).toHaveClass('bg-vote')
    expect(within(node).getByText('CHALLENGE · 18 H LEFT')).toBeInTheDocument()
    expect(within(node).getByText('Challenge, 18 hours left')).toHaveClass('sr-only')
    expect(
      within(node).getByRole('button', { name: "View Dev's Study check-in photo" }),
    ).toBeInTheDocument()
    expect(node).toHaveTextContent("Lena challenged Dev's Study check-in.")
    expect(within(node).getByRole('heading', { level: 3, name: 'Fake or Real?' })).toBeVisible()
    expect(node).toHaveTextContent("If nobody else votes, it's ruled Fake.")
    const fake = within(node).getByRole('button', { name: 'Vote Fake' })
    const real = within(node).getByRole('button', { name: 'Vote Real' })
    expect(fake).toHaveAttribute('aria-pressed', 'false')
    expect(real).toHaveAttribute('aria-pressed', 'false')
    expect(fake).toHaveClass('flex-1')
    expect(fake.parentElement).toHaveClass('gap-vote-gap')
    expect(await within(node).findByText('2 of 4 voted')).toBeInTheDocument()
  })

  it('one tap votes: selected button, "You voted Real · 3 of 4 voted", toast with Undo; Undo restores', async () => {
    const { backend } = await renderFeed([VOTE])
    const user = userEvent.setup()
    const node = await findCard()
    await within(node).findByText('2 of 4 voted')
    await user.click(within(node).getByRole('button', { name: 'Vote Real' }))

    expect(backend.castVote).toHaveBeenCalledWith('challenge', VOTE.id, 'real')
    expect(await within(node).findByText('You voted Real · 3 of 4 voted')).toBeInTheDocument()
    expect(within(node).getByRole('button', { name: 'Vote Real' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(node).getByRole('button', { name: 'Vote Fake' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    // Inert once voted: a second tap sends nothing.
    await user.click(within(node).getByRole('button', { name: 'Vote Fake' }))
    expect(backend.castVote).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Voted Real')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(backend.undoVote).toHaveBeenCalledWith('challenge', VOTE.id)
    await waitFor(() =>
      expect(within(node).getByRole('button', { name: 'Vote Real' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    )
    expect(within(node).getByRole('status')).toHaveTextContent('Vote undone.')
    expect(await within(node).findByText('2 of 4 voted')).toBeInTheDocument()
  })

  it('maps the locked, closing, closed and cancelled states', async () => {
    const items: FeedItem[] = [
      feedVote({ id: 'v-challenger', challengerId: TEST_USER.id, sortAt: '2026-11-20T01:00:00Z' }),
      feedVote({ id: 'v-owner', ownerId: TEST_USER.id, sortAt: '2026-11-20T00:59:00Z' }),
      feedVote({ id: 'v-late', canVote: false, sortAt: '2026-11-20T00:58:00Z' }),
      feedVote({
        id: 'v-closing',
        closesAt: '2026-11-20T02:59:00Z',
        sortAt: '2026-11-20T00:57:00Z',
      }),
      feedVote({
        id: 'v-fake',
        status: 'fake',
        fakeCount: 3,
        realCount: 1,
        variant: 'normal',
        sortAt: '2026-11-20T00:56:00Z',
      }),
      feedVote({ id: 'v-cancelled', status: 'cancelled', sortAt: '2026-11-20T00:55:00Z' }),
    ]
    await renderFeed(items, {
      tallies: ['v-challenger', 'v-owner', 'v-late', 'v-closing'].map((id) => ({
        ...TALLY,
        targetId: id,
      })),
    })
    const at = (id: string) =>
      document.querySelector<HTMLElement>(`[data-feed-item="${id}"]`) as HTMLElement
    await waitFor(() => expect(at('v-cancelled')).toBeInTheDocument())

    const challenger = at('v-challenger')
    expect(challenger).toHaveTextContent("You challenged Dev's Study check-in.")
    expect(challenger).toHaveTextContent('You challenged · counts as Fake')
    expect(await within(challenger).findByText('2 of 4 voted')).toBeInTheDocument()
    expect(within(challenger).queryByRole('button', { name: /^Vote / })).toBeNull()

    const owner = at('v-owner')
    expect(owner).toHaveTextContent('Lena challenged your Study check-in.')
    expect(owner).toHaveTextContent('CHALLENGE · 18 H LEFT')
    expect(within(owner).queryByRole('heading', { level: 3 })).toBeNull()
    expect(within(owner).queryByRole('button', { name: /^Vote / })).toBeNull()
    expect(within(owner).getByText('2 of 4 voted')).toBeInTheDocument()

    expect(at('v-late')).toHaveTextContent('You joined after this vote opened.')
    expect(within(at('v-late')).queryByRole('button', { name: /^Vote / })).toBeNull()

    expect(at('v-closing')).toHaveTextContent("Voting's closed. The ruling is on its way.")
    expect(within(at('v-closing')).getByText('CHALLENGE')).toBeInTheDocument()

    const fake = at('v-fake')
    expect(fake).toHaveTextContent("Ruled Fake · Dev's Study removed. 3 Fake, 1 Real.")
    expect(within(fake).queryByRole('button')).toBeNull()
    expect(fake).not.toHaveTextContent(/voted/)

    const cancelled = at('v-cancelled')
    expect(within(cancelled).getByText('CHALLENGE')).toHaveClass('line-through')
    expect(cancelled).toHaveTextContent('Cancelled')
  })

  it('offline: the error toast, the card stays unvoted and nothing is sent', async () => {
    const { backend } = await renderFeed([VOTE])
    const user = userEvent.setup()
    const node = await findCard()
    setOnline(false)
    await user.click(within(node).getByRole('button', { name: 'Vote Fake' }))
    expect(await screen.findByText("You're offline. Votes need a signal.")).toBeInTheDocument()
    expect(backend.castVote).not.toHaveBeenCalled()
    expect(node).toHaveAttribute('data-vote-state', 'open')
  })

  it('an online failure shows the Inline retry on the card; Retry resends the same choice', async () => {
    const { backend } = await renderFeed([VOTE])
    vi.mocked(backend.castVote).mockRejectedValueOnce(new BackendError('unknown'))
    const user = userEvent.setup()
    const node = await findCard()
    await user.click(within(node).getByRole('button', { name: 'Vote Fake' }))
    const alert = await within(node).findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't send your vote. Check your signal and tap Retry.")
    expect(node).toHaveAttribute('data-vote-state', 'open')
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(backend.castVote).toHaveBeenCalledTimes(2))
    expect(backend.castVote).toHaveBeenLastCalledWith('challenge', VOTE.id, 'fake')
    expect(await within(node).findByText(/^You voted Fake/)).toBeInTheDocument()
    expect(within(node).queryByRole('alert')).toBeNull()
  })

  it('a refusal shows its copy and refetches the Feed', async () => {
    const { backend } = await renderFeed([VOTE])
    vi.mocked(backend.castVote).mockRejectedValueOnce(new BackendError('vote_closed'))
    const user = userEvent.setup()
    const node = await findCard()
    const reads = vi.mocked(backend.listFeed).mock.calls.length
    await user.click(within(node).getByRole('button', { name: 'Vote Real' }))
    expect(await screen.findByText("That vote's already wrapped up.")).toBeInTheDocument()
    await waitFor(() =>
      expect(vi.mocked(backend.listFeed).mock.calls.length).toBeGreaterThan(reads),
    )
  })

  it('an undo refusal shows its copy and refetches the Feed', async () => {
    const { backend } = await renderFeed([VOTE])
    const user = userEvent.setup()
    const node = await findCard()
    await user.click(within(node).getByRole('button', { name: 'Vote Fake' }))
    await screen.findByText('Voted Fake')
    vi.mocked(backend.undoVote).mockRejectedValueOnce(new BackendError('undo_expired'))
    const reads = vi.mocked(backend.listFeed).mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText("That vote's already final.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    await waitFor(() =>
      expect(vi.mocked(backend.listFeed).mock.calls.length).toBeGreaterThan(reads),
    )
  })

  it('undo failures: offline keeps the vote; an online failure offers Retry', async () => {
    const { backend } = await renderFeed([VOTE])
    const user = userEvent.setup()
    const node = await findCard()
    await user.click(within(node).getByRole('button', { name: 'Vote Fake' }))
    await screen.findByText('Voted Fake')
    vi.mocked(backend.undoVote).mockRejectedValueOnce(new BackendError('unknown'))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText("Couldn't undo your vote. Tap Retry.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(backend.undoVote).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(node).toHaveAttribute('data-vote-state', 'open'))

    await user.click(within(node).getByRole('button', { name: 'Vote Real' }))
    await screen.findByText('Voted Real')
    setOnline(false)
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText("Couldn't undo. You're offline.")).toBeInTheDocument()
    expect(backend.undoVote).toHaveBeenCalledTimes(2)
    expect(node).toHaveAttribute('data-vote-state', 'voted')
  })

  it('the thumbnail opens the Photo viewer on the challenged check-in', async () => {
    await renderFeed([VOTE])
    const user = userEvent.setup()
    const node = await findCard()
    await user.click(within(node).getByRole('button', { name: "View Dev's Study check-in photo" }))
    expect(await screen.findByRole('dialog', { name: /^Dev · Study/ })).toBeInTheDocument()
  })

  it('announces a ruling that arrives while the card is on screen, once', async () => {
    const { feed, queryClient } = await renderFeed([VOTE])
    const node = await findCard()
    expect(within(node).getByRole('status')).toBeEmptyDOMElement()
    feed[TEST_GROUP.id] = [
      { ...VOTE, status: 'real', fakeCount: 1, realCount: 2, variant: 'normal' } as FeedVote,
    ]
    await act(() => queryClient.refetchQueries())
    await waitFor(() =>
      expect(within(card()).getByRole('status')).toHaveTextContent(
        "Ruled Real · Dev's Study stands. 1 Fake, 2 Real.",
      ),
    )
    expect(card()).toHaveTextContent("Ruled Real · Dev's Study stands. 1 Fake, 2 Real.")
    // Still on Real for a closed Real ruling: the thumbnail stays.
    expect(
      within(card()).getByRole('button', { name: "View Dev's Study check-in photo" }),
    ).toBeInTheDocument()
  })

  it('a deep link scrolls to and focuses the Vote card', async () => {
    const { backend } = await renderFeed([feedCheckin(), VOTE], {
      path: `/feed/v/${VOTE.id}?g=${TEST_GROUP.id}`,
    })
    await waitFor(() => expect(card()).toHaveFocus())
    expect(backend.getFeedVote).toHaveBeenCalledWith(TEST_GROUP.id, VOTE.id)
    expect(screen.getByRole('link', { name: 'Feed' })).toHaveAttribute('aria-current', 'page')
  })

  it('a deep link to a gone vote opens the Feed with "That\'s already wrapped up."', async () => {
    const gone = '00000000-0000-4000-b000-000000000099'
    const { router } = await renderFeed([VOTE], { path: `/feed/v/${gone}?g=${TEST_GROUP.id}` })
    expect(await screen.findByText("That's already wrapped up.")).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
  })
})

describe('Vote card Undo timing', () => {
  const viewer: FeedViewer = { userId: TEST_USER.id, zone: 'Asia/Manila', now: NOW }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    act(() => {
      dismissToast()
      vi.runOnlyPendingTimers()
    })
    vi.useRealTimers()
  })

  it('shows "Voted Fake" with Undo for 5 s, then the vote stands', async () => {
    const backend = createFakeBackend(undefined, {
      feed: { [TEST_GROUP.id]: [VOTE] },
      voteTallies: { [TEST_GROUP.id]: [TALLY] },
    })
    render(<Toaster />)
    render(withBackend(backend, <VoteCard item={VOTE} viewer={viewer} tilt="left" />))
    fireEvent.click(screen.getByRole('button', { name: 'Vote Fake' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(backend.castVote).toHaveBeenCalledWith('challenge', VOTE.id, 'fake')
    expect(screen.getByText('Voted Fake')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_900)
    })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    for (let tick = 0; tick < 4; tick++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    }
    expect(screen.queryByText('Voted Fake')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(backend.undoVote).not.toHaveBeenCalled()
  })

  it('an undo that fails after the 5 s window offers no Retry', async () => {
    const backend = createFakeBackend(undefined, {
      feed: { [TEST_GROUP.id]: [VOTE] },
      voteTallies: { [TEST_GROUP.id]: [TALLY] },
    })
    // The answer arrives 300 ms after the tap at 4.9 s: past UNDO_WINDOW_MS.
    vi.mocked(backend.undoVote).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new BackendError('unknown')), 300),
        ),
    )
    render(<Toaster />)
    render(withBackend(backend, <VoteCard item={VOTE} viewer={viewer} tilt="left" />))
    fireEvent.click(screen.getByRole('button', { name: 'Vote Fake' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_900)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 4_900 + 200)
    })
    // The error toast reaches the Toaster on a later tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(backend.undoVote).toHaveBeenCalledWith('challenge', VOTE.id)
    expect(screen.getByText("Couldn't undo your vote. Tap Retry.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})
