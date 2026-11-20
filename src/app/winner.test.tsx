import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import type { FeedWinner } from '@/domain/feed'
import type { WinnerPodiumMember, WinnerWeek } from '@/domain/winner'
import { setStoredFocusedGroup } from '@/data/focused-group'
import { isWinnerSeen, markWinnerSeen } from '@/data/winner'
import { Toaster } from '@/ui/toaster'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_USER } from '@/test/fake-backend'
import { waitForGroupInUrl } from '@/test/router'

const WEEK = '2026-11-09'
// Thursday 19 Nov 00:00 Manila.
const LOCK = '2026-11-18T16:00:00.000Z'

function member(
  userId: string,
  displayName: string,
  weeklyPoints: number,
  rank: number,
  isWinner: boolean,
): WinnerPodiumMember {
  return { userId, displayName, avatarPath: null, weeklyPoints, rank, isWinner }
}

function winnerWeek(podium: WinnerPodiumMember[]): WinnerWeek {
  return {
    weekStart: WEEK,
    lockAt: LOCK,
    scored: true,
    ranked: true,
    winnerUserIds: podium.filter((m) => m.isWinner).map((m) => m.userId),
    podium,
  }
}

const MARCO_WINS = winnerWeek([
  member('user-marco', 'Marco', 94, 1, true),
  member(TEST_USER.id, 'Jo', 80, 2, false),
  member('user-sam', 'Sam', 60, 3, false),
])
const JO_WINS = winnerWeek([
  member(TEST_USER.id, 'Jo', 94, 1, true),
  member('user-marco', 'Marco', 80, 2, false),
])
const CO_WINNERS = winnerWeek([
  member(TEST_USER.id, 'Jo', 94, 1, true),
  member('user-marco', 'Marco', 94, 2, true),
  member('user-sam', 'Sam', 60, 3, false),
])

function renderApp(
  path: string,
  weeks: Record<string, WinnerWeek>,
  options: Parameters<typeof createFakeBackend>[1] = {},
) {
  const backend = createFakeBackend(undefined, { winnerWeeks: weeks, ...options })
  return renderRoutes([path], backend)
}

function card() {
  return screen.findByRole('dialog', { name: /^Last week's winners?$/ })
}

describe('Winner card, shown once (Story 4.5)', () => {
  it('opens full screen on app open for the latest locked week: heading focused, podium, points, seal, tease and "Fine."', async () => {
    renderApp('/today', { [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS })
    const dialog = await card()
    const heading = within(dialog).getByRole('heading', { name: "Last week's winner" })
    await waitFor(() => expect(heading).toHaveFocus())
    const places = within(
      within(dialog).getByRole('list', { name: "Last week's podium" }),
    ).getAllByRole('listitem')
    expect(places.map((place) => place.getAttribute('data-place'))).toEqual(['1', '2', '3'])
    expect(places[0]).toHaveTextContent('Marco, rank 1, weekly winner, 94 weekly points.')
    expect(within(dialog).getByText('94 weekly points')).toBeInTheDocument()
    expect(within(dialog).getByText('Weekly Winner')).toBeInTheDocument()
    expect(within(dialog).getByText('Bow down. Or just beat Marco.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Fine.' })).toBeInTheDocument()
  })

  it('"Nice" for the winner; closing stores the seen key and the card never comes back', async () => {
    const user = userEvent.setup()
    const { unmount } = renderApp('/today', { [`${TEST_GROUP.id}:${WEEK}`]: JO_WINS })
    const dialog = await card()
    expect(
      within(dialog).getByText('Top of the board. Enjoy it while it lasts.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Nice' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(isWinnerSeen(TEST_GROUP.id, WEEK)).toBe(true)
    unmount()

    // The app opens again: nothing.
    const { backend } = renderApp('/today', { [`${TEST_GROUP.id}:${WEEK}`]: JO_WINS })
    await waitFor(() => expect(backend.getWinnerWeek).toHaveBeenCalledWith(TEST_GROUP.id, null))
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('co-winners share the 1st block under one crown: "winners", names joined with "&", "94 each"', async () => {
    renderApp('/today', { [`${TEST_GROUP.id}:${WEEK}`]: CO_WINNERS })
    const dialog = await card()
    expect(within(dialog).getByRole('heading', { name: "Last week's winners" })).toBeInTheDocument()
    const places = within(
      within(dialog).getByRole('list', { name: "Last week's podium" }),
    ).getAllByRole('listitem')
    expect(places.map((place) => place.getAttribute('data-place'))).toEqual(['1', '3'])
    expect(places[0]).toHaveTextContent(
      'Jo, rank 1, weekly winner, 94 weekly points. Marco, rank 1, weekly winner, 94 weekly points.',
    )
    expect(within(dialog).getAllByText('Jo & Marco').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('94 each')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Nice' })).toBeInTheDocument()
  })

  it('Esc closes it and counts as seen', async () => {
    const user = userEvent.setup()
    renderApp('/today', { [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS })
    await card()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(isWinnerSeen(TEST_GROUP.id, WEEK)).toBe(true)
  })

  it('stays away from a member who joined after the lock', async () => {
    const { backend } = renderApp(
      '/today',
      { [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS },
      { groups: [{ ...TEST_GROUP, joinedAt: '2026-11-19T02:00:00.000Z' }] },
    )
    await waitFor(() => expect(backend.getWinnerWeek).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('waits while the camera is open, then opens once it closes', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, {})
    let resolve: (week: WinnerWeek | null) => void = () => {}
    backend.getWinnerWeek = vi.fn(
      () =>
        new Promise<WinnerWeek | null>((done) => {
          resolve = done
        }),
    )
    const { router } = renderRoutes(['/today'], backend)
    await waitForGroupInUrl(router)
    await user.click(screen.getByRole('button', { name: 'Check in' }))
    const camera = await screen.findByRole('dialog', { name: 'Camera' })
    await act(async () => resolve(MARCO_WINS))
    expect(screen.queryByRole('dialog', { name: /^Last week's winner/ })).not.toBeInTheDocument()
    await user.click(within(camera).getByRole('button', { name: 'Close camera' }))
    expect(await card()).toBeInTheDocument()
  })

  it('leaves an open sheet alone and opens on the next screen change', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, {})
    let resolve: (week: WinnerWeek | null) => void = () => {}
    backend.getWinnerWeek = vi.fn(
      () =>
        new Promise<WinnerWeek | null>((done) => {
          resolve = done
        }),
    )
    const { router } = renderRoutes(['/today'], backend)
    await waitForGroupInUrl(router)
    await user.click(await screen.findByRole('button', { name: 'Add a commitment or task' }))
    const sheet = await screen.findByRole('dialog', { name: 'Add a commitment or task' })
    await act(async () => resolve(MARCO_WINS))
    expect(screen.queryByRole('dialog', { name: /^Last week's winner/ })).not.toBeInTheDocument()
    expect(sheet).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('link', { name: 'Feed' }))
    expect(await card()).toBeInTheDocument()
  })

  it('only the latest locked week: an older unseen week never shows', async () => {
    markWinnerSeen(TEST_GROUP.id, '2026-11-16')
    const { backend } = renderApp('/today', {
      [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS,
      [`${TEST_GROUP.id}:2026-11-16`]: { ...MARCO_WINS, weekStart: '2026-11-16' },
    })
    await waitFor(() => expect(backend.getWinnerWeek).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Winner card deep link (Story 4.5)', () => {
  it('shows the card even when seen; closing opens the Feed', async () => {
    const user = userEvent.setup()
    markWinnerSeen(TEST_GROUP.id, WEEK)
    const { router, backend } = renderApp(`/winner/${WEEK}?g=${TEST_GROUP.id}`, {
      [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS,
    })
    const dialog = await card()
    expect(backend.getWinnerWeek).toHaveBeenCalledWith(TEST_GROUP.id, WEEK)
    await user.click(within(dialog).getByRole('button', { name: 'Fine.' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(router.state.location.search).toBe(`?g=${TEST_GROUP.id}`)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closing an unseen deep-linked card stores its seen key', async () => {
    const user = userEvent.setup()
    renderApp(`/winner/${WEEK}?g=${TEST_GROUP.id}`, { [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS })
    const dialog = await card()
    expect(isWinnerSeen(TEST_GROUP.id, WEEK)).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Fine.' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(isWinnerSeen(TEST_GROUP.id, WEEK)).toBe(true)
  })

  it('a failed read opens the Feed without a card', async () => {
    const backend = createFakeBackend(undefined, {})
    backend.getWinnerWeek = vi.fn(async () => {
      throw new BackendError('network')
    })
    const { router } = renderRoutes([`/winner/${WEEK}?g=${TEST_GROUP.id}`], backend)
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(screen.queryByRole('dialog', { name: /winner/ })).not.toBeInTheDocument()
  })

  it('an unknown or winnerless week opens the Feed with "That\'s already wrapped up."', async () => {
    render(<Toaster />)
    // The latest week was seen, so nothing opens by itself on the Feed either.
    markWinnerSeen(TEST_GROUP.id, WEEK)
    const { router } = renderApp(`/winner/2026-10-05?g=${TEST_GROUP.id}`, {
      [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS,
    })
    expect(await screen.findByText("That's already wrapped up.")).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
    expect(screen.queryByRole('dialog', { name: /winner/ })).not.toBeInTheDocument()
  })

  it('a malformed week opens the Feed with "That\'s already wrapped up."', async () => {
    render(<Toaster />)
    const { router } = renderApp(`/winner/yesterday?g=${TEST_GROUP.id}`, {})
    expect(await screen.findByText("That's already wrapped up.")).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/feed'))
  })

  it('says "Switched to {Group}." when the link moved the focus', async () => {
    render(<Toaster />)
    setStoredFocusedGroup('group-other')
    const other = { ...TEST_GROUP, id: 'group-other', name: 'Other' }
    renderApp(
      `/winner/${WEEK}?g=${TEST_GROUP.id}`,
      { [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS },
      { groups: [other, TEST_GROUP] },
    )
    expect(await screen.findByText('Switched to Gym Rats.')).toBeInTheDocument()
    expect(await card()).toBeInTheDocument()
  })

  it('a group the member left: "You\'re not in {Group} anymore." + Go to Today', async () => {
    // The focused group has an unseen week, but no card covers the not-in-group state.
    const { backend } = renderApp(
      `/winner/${WEEK}?g=group-left`,
      { [`${TEST_GROUP.id}:${WEEK}`]: MARCO_WINS },
      {
        ended: [
          {
            groupId: 'group-left',
            membershipId: 'm-left',
            name: 'Old Crew',
            endedAt: '2026-11-10T00:00:00.000Z',
            endReason: 'left',
          },
        ],
      },
    )
    expect(await screen.findByText("You're not in Old Crew anymore.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeInTheDocument()
    await act(async () => {})
    expect(backend.getWinnerWeek).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /winner/ })).not.toBeInTheDocument()
  })
})

describe('Feed winner sticky (Story 4.5)', () => {
  it('a yellow sticky with a text kicker and the winner line', async () => {
    const item: FeedWinner = {
      type: 'winner',
      id: 'w-1',
      groupId: TEST_GROUP.id,
      sortAt: '2026-11-18T16:00:30.000000+00:00',
      weekStart: WEEK,
      weeklyPoints: 94,
      winners: [{ userId: 'user-marco', name: 'Marco' }],
    }
    markWinnerSeen(TEST_GROUP.id, WEEK)
    renderApp('/feed', {}, { feed: { [TEST_GROUP.id]: [item] } })
    const sticky = await screen.findByRole('heading', {
      level: 2,
      name: "Last week's winner · Marco · 94 · Bow down. Or just beat Marco.",
    })
    const article = sticky.closest('article') as HTMLElement
    expect(article).toHaveAttribute('data-kind', 'weekly_winner')
    expect(within(article).getByText('Weekly winner')).toBeInTheDocument()
    expect(within(article).getByText('· week of 9 Nov')).toBeInTheDocument()
  })
})
