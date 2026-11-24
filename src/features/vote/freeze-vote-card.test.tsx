import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import type { FeedItem } from '@/domain/feed'
import type { VoteTally } from '@/domain/vote'
import { planKey, todayKey } from '@/data/plan'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_USER } from '@/test/fake-backend'
import { feedFreezeResult, feedFreezeVote } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

// Friday 20 Nov 2026, 11:00 in Manila; the request closes at 05:59 the next morning (18 h 59 min).
const NOW = new Date('2026-11-20T03:00:00Z')

const FREEZE = feedFreezeVote()
const TALLY: VoteTally = {
  targetKind: 'freeze',
  targetId: FREEZE.id,
  votedCount: 0,
  eligibleCount: 2,
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

async function renderFeed(items: FeedItem[], tallies: VoteTally[] = [TALLY], path = '/feed') {
  const feed = { [TEST_GROUP.id]: items }
  const backend = createFakeBackend(undefined, {
    feed,
    voteTallies: { [TEST_GROUP.id]: tallies },
  })
  render(<Toaster />)
  const result = renderRoutes([path], backend)
  await waitForGroupInUrl(result.router)
  return { ...result, backend, feed }
}

function at(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-feed-item="${id}"]`)
  if (!node) throw new Error(`no item ${id}`)
  return node
}

async function findCard(): Promise<HTMLElement> {
  await screen.findByRole('heading', { level: 2, name: "Vote on Dev's freeze request for Study" })
  return at(FREEZE.id)
}

describe('freeze Vote card (Story 5.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    act(() => dismissToast())
    vi.useRealTimers()
    setOnline(true)
  })

  it('shows the open card on the yellow sticky: kicker, request, reason, buttons, rule, tally', async () => {
    await renderFeed([FREEZE])
    const node = await findCard()
    expect(node).toHaveAttribute('data-vote-state', 'open')
    expect(node.querySelector('[data-component="sticky-note"]')).toHaveClass('bg-sticky')
    expect(within(node).getByText('FREEZE REQUEST · 18 H LEFT')).toBeInTheDocument()
    expect(within(node).getByText('Freeze request, 18 hours left')).toHaveClass('sr-only')
    expect(node).toHaveTextContent('Dev wants Study on Sat frozen.')
    expect(within(node).getByText('Reason: flu, in bed')).toHaveClass('sr-only')
    expect(within(node).getByText('flu, in bed')).toHaveAttribute('aria-hidden', 'true')
    expect(node).toHaveTextContent('No votes means approved.')
    const approve = within(node).getByRole('button', { name: 'Vote: approve' })
    const deny = within(node).getByRole('button', { name: 'Vote: deny' })
    expect(approve).toHaveTextContent('Approve')
    expect(deny).toHaveTextContent('Deny')
    expect(approve).toHaveClass('flex-1')
    expect(approve.parentElement).toHaveClass('gap-vote-gap')
    expect(await within(node).findByText('0 of 2 voted')).toBeInTheDocument()
  })

  it('one tap votes: "Voted Approve" toast with Undo, "Voted Approve · 1 of 2 voted"; Undo restores', async () => {
    const { backend } = await renderFeed([FREEZE])
    const user = userEvent.setup()
    const node = await findCard()
    await within(node).findByText('0 of 2 voted')
    await user.click(within(node).getByRole('button', { name: 'Vote: approve' }))
    expect(backend.castVote).toHaveBeenCalledWith('freeze', FREEZE.id, 'approve')
    expect(await within(node).findByText('Voted Approve · 1 of 2 voted')).toBeInTheDocument()
    expect(within(node).getByRole('button', { name: 'Vote: approve' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await screen.findByText('Voted Approve')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(backend.undoVote).toHaveBeenCalledWith('freeze', FREEZE.id)
    await waitFor(() =>
      expect(within(node).getByRole('button', { name: 'Vote: approve' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    )
    expect(within(node).getByRole('status')).toHaveTextContent('Vote undone.')
  })

  it('Deny: the toast says "Voted Deny"', async () => {
    const { backend } = await renderFeed([FREEZE])
    const user = userEvent.setup()
    const node = await findCard()
    await user.click(within(node).getByRole('button', { name: 'Vote: deny' }))
    expect(backend.castVote).toHaveBeenCalledWith('freeze', FREEZE.id, 'deny')
    expect(await screen.findByText('Voted Deny')).toBeInTheDocument()
  })

  it('maps the requester, two-person, times-per-week, closed and cancelled cards', async () => {
    const items: FeedItem[] = [
      feedFreezeVote({ id: 'f-own', requesterId: TEST_USER.id, sortAt: '2026-11-20T01:00:00Z' }),
      feedFreezeVote({ id: 'f-duo', twoPerson: true, sortAt: '2026-11-20T00:59:00Z' }),
      feedFreezeVote({
        id: 'f-gym',
        title: 'Gym',
        scheduleType: 'times_per_week',
        sessionDay: null,
        sortAt: '2026-11-20T00:58:00Z',
      }),
      feedFreezeVote({ id: 'f-denied', status: 'denied', sortAt: '2026-11-20T00:57:00Z' }),
      feedFreezeVote({
        id: 'f-cancelled',
        status: 'cancelled',
        sortAt: '2026-11-20T00:56:00Z',
        cancelReason: 'removed',
        cancelledById: 'user-4',
      }),
    ]
    await renderFeed(items, [{ ...TALLY, targetId: 'f-own' }])
    await waitFor(() => expect(at('f-cancelled')).toBeInTheDocument())

    const own = at('f-own')
    expect(own).toHaveTextContent('You want Study on Sat frozen.')
    expect(own).toHaveTextContent('Your request · waiting on the group')
    expect(within(own).queryByRole('button', { name: /^Vote: / })).toBeNull()
    expect(await within(own).findByText('0 of 2 voted')).toBeInTheDocument()

    expect(at('f-duo')).toHaveTextContent('Just you deciding. No vote means approved.')
    expect(at('f-gym')).toHaveTextContent('Dev wants one Gym session off this week.')

    const denied = at('f-denied')
    expect(denied).toHaveTextContent('Freeze denied · Study on Sat still counts.')
    expect(within(denied).queryByRole('button')).toBeNull()
    expect(within(denied).getByText('FREEZE REQUEST')).toBeInTheDocument()

    const cancelled = at('f-cancelled')
    expect(within(cancelled).getByText('FREEZE REQUEST')).toHaveClass('line-through')
    expect(cancelled).toHaveTextContent('Cancelled · Dev was removed from the group')
  })

  it('offline: the error toast and nothing is sent; an online failure shows the Inline retry', async () => {
    const { backend } = await renderFeed([FREEZE])
    const user = userEvent.setup()
    const node = await findCard()
    setOnline(false)
    await user.click(within(node).getByRole('button', { name: 'Vote: approve' }))
    expect(await screen.findByText("You're offline. Votes need a signal.")).toBeInTheDocument()
    expect(backend.castVote).not.toHaveBeenCalled()
    setOnline(true)
    vi.mocked(backend.castVote).mockRejectedValueOnce(new BackendError('unknown'))
    await user.click(within(node).getByRole('button', { name: 'Vote: deny' }))
    const alert = await within(node).findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(backend.castVote).toHaveBeenLastCalledWith('freeze', FREEZE.id, 'deny'),
    )
  })

  it('announces an outcome that arrives while the card is on screen, once, and refetches Today', async () => {
    const { feed, queryClient } = await renderFeed([FREEZE])
    const node = await findCard()
    expect(within(node).getByRole('status')).toBeEmptyDOMElement()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    feed[TEST_GROUP.id] = [{ ...FREEZE, status: 'approved' }]
    await act(() => queryClient.refetchQueries())
    await waitFor(() =>
      expect(within(at(FREEZE.id)).getByRole('status')).toHaveTextContent(
        'Freeze approved · Study on Sat is off the plan.',
      ),
    )
    expect(at(FREEZE.id)).toHaveAttribute('data-vote-state', 'closed')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: todayKey(TEST_GROUP.id) })
    // The Feed refetch it triggers brings the same closed status: nothing runs again.
    await act(() => queryClient.refetchQueries())
    const todayCalls = invalidate.mock.calls.filter(
      ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(todayKey(TEST_GROUP.id)),
    )
    expect(todayCalls).toHaveLength(1)
  })

  it('an approved freeze cancelled by an overturn refetches the views once and says so (Epic 5 retro)', async () => {
    const approved = { ...FREEZE, status: 'approved' as const, canVote: false }
    const { feed, queryClient } = await renderFeed([approved])
    await findCard()
    expect(at(FREEZE.id)).toHaveAttribute('data-vote-state', 'closed')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    feed[TEST_GROUP.id] = [
      { ...approved, status: 'cancelled', cancelReason: 'overturned', cancelledById: 'user-1' },
    ]
    await act(() => queryClient.refetchQueries())
    await waitFor(() =>
      expect(within(at(FREEZE.id)).getByRole('status')).toHaveTextContent(
        'Cancelled · the check-in counts again',
      ),
    )
    expect(at(FREEZE.id)).toHaveAttribute('data-vote-state', 'cancelled')
    for (const queryKey of [todayKey(TEST_GROUP.id), planKey(TEST_GROUP.id)]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
    }
    await act(() => queryClient.refetchQueries())
    const planCalls = invalidate.mock.calls.filter(
      ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(planKey(TEST_GROUP.id)),
    )
    expect(planCalls).toHaveLength(1)
  })

  it('a deep link scrolls to and focuses the freeze Vote card', async () => {
    const { backend } = await renderFeed(
      [FREEZE],
      [TALLY],
      `/feed/v/${FREEZE.id}?g=${TEST_GROUP.id}`,
    )
    await waitFor(() => expect(at(FREEZE.id)).toHaveFocus())
    expect(backend.getFeedVote).toHaveBeenCalledWith(TEST_GROUP.id, FREEZE.id)
  })

  it('a requester refusal reads its copy and refetches the Feed', async () => {
    const { backend } = await renderFeed([FREEZE])
    vi.mocked(backend.castVote).mockRejectedValueOnce(new BackendError('vote_closed'))
    const user = userEvent.setup()
    const node = await findCard()
    const reads = vi.mocked(backend.listFeed).mock.calls.length
    await user.click(within(node).getByRole('button', { name: 'Vote: approve' }))
    expect(await screen.findByText("That vote's already wrapped up.")).toBeInTheDocument()
    await waitFor(() =>
      expect(vi.mocked(backend.listFeed).mock.calls.length).toBeGreaterThan(reads),
    )
  })
})

describe('freeze result sticky (Story 5.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('approved with a removed miss, denied for a week; the reason stays and no overturn', async () => {
    await renderFeed(
      [
        feedFreezeResult({ id: 'r-ok', missRemoved: true }),
        feedFreezeResult({
          id: 'r-no',
          outcome: 'denied',
          title: 'Gym',
          scheduleType: 'times_per_week',
          sessionDay: null,
          weekTarget: 3,
          requesterId: TEST_USER.id,
          reason: 'knee',
          sortAt: '2026-11-20T02:00:00.000000+00:00',
        }),
      ],
      [],
    )
    const ok = await screen.findByRole('heading', {
      level: 2,
      name: 'Freeze approved · Study on Sat is off the plan. Miss removed.',
    })
    const okItem = at('r-ok')
    expect(okItem).toContainElement(ok)
    expect(okItem.querySelector('[data-component="sticky-note"]')).toHaveClass('bg-sticky')
    expect(within(okItem).getByText('FREEZE')).toBeInTheDocument()
    expect(within(okItem).getByText('Reason: flu, in bed')).toHaveClass('sr-only')
    expect(okItem).toHaveTextContent("Dev's request")

    const no = at('r-no')
    expect(
      within(no).getByRole('heading', {
        level: 2,
        name: 'Freeze denied · Gym still needs 3 this week.',
      }),
    ).toBeInTheDocument()
    expect(no).toHaveTextContent('Your request')
    expect(within(no).queryByRole('button')).toBeNull()
  })
})
