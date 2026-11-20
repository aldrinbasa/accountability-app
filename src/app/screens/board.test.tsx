import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Board } from '@/domain/board'
import { BackendError } from '@/domain/error-codes'
import {
  boardRow,
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_USER,
  testBoard,
} from '@/test/fake-backend'

// Tuesday 17 Nov 2026, 11:00 in Manila (the test group's zone): last week (9 Nov) locks Thursday
// 19 Nov 00:00 Manila = 18 Nov 16:00 UTC.
const TUESDAY = new Date('2026-11-17T03:00:00Z')
const LAST_LOCK = '2026-11-18T16:00:00.000Z'
const THIS_WEEK = '2026-11-16'
const LAST_WEEK = '2026-11-09'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TUESDAY)
})

afterEach(() => {
  vi.useRealTimers()
})

const jo = boardRow({
  userId: TEST_USER.id,
  displayName: 'Jo',
  weeklyPoints: 81,
  rank: 2,
  plan: [
    { activityName: 'Gym', scheduleType: 'times_per_week', days: null, target: 3 },
    { activityName: 'Study', scheduleType: 'fixed_days', days: [1, 3, 5], target: null },
  ],
  taskCount: 1,
  bestStreak: 6,
})
const marco = boardRow({
  userId: 'user-marco',
  displayName: 'Marco',
  weeklyPoints: 88,
  rank: 1,
  plan: [{ activityName: 'Gym', scheduleType: 'times_per_week', days: null, target: 5 }],
})
const dev = boardRow({
  userId: 'user-dev',
  displayName: 'Dev',
  weeklyPoints: 74,
  rank: 3,
  missCount: 2,
})
const lena = boardRow({
  userId: 'user-lena',
  displayName: 'Lena',
  weeklyPoints: 74,
  rank: 3,
  missCount: 1,
})
const sam = boardRow({
  userId: 'user-sam',
  displayName: 'Sam',
  weeklyPoints: 52,
  rank: 5,
  missCount: 1,
})
const priya = boardRow({ userId: 'user-priya', displayName: 'Priya' })

const FULL: Board = testBoard({ rows: [marco, jo, dev, lena, sam, priya] })

function renderBoard(options: Parameters<typeof createFakeBackend>[1] = {}) {
  const backend = createFakeBackend(undefined, options)
  return renderRoutes(['/board'], backend)
}

function podium() {
  return screen.findByRole('list', { name: "This week's podium" })
}

describe('Board (Story 4.3)', () => {
  it('heading, week chip, podium in rank order with a shared 3rd block, rows and unscored last', async () => {
    renderBoard({ board: { [TEST_GROUP.id]: FULL } })
    expect(
      await screen.findByRole('heading', { level: 1, name: `Leaderboard · ${TEST_GROUP.name}` }),
    ).toBeInTheDocument()
    expect(await screen.findByText(/^This week · locks Wed 23:59/)).toBeInTheDocument()

    const places = within(await podium()).getAllByRole('listitem')
    expect(places.map((place) => place.getAttribute('data-place'))).toEqual(['1', '2', '3'])
    expect(places[0]).toHaveTextContent('Marco, rank 1, 88 weekly points, Gym 5x.')
    expect(places[1]).toHaveTextContent(
      'Jo, rank 2, 81 weekly points, Gym 3x · Study MWF · 1 task, best current streak 6.',
    )
    // Dev and Lena share the 3rd block, by name, each read with their misses.
    expect(places[2]).toHaveTextContent(
      'Dev, rank 3, 74 weekly points, 2 misses this week. Lena, rank 3, 74 weekly points, 1 miss this week.',
    )
    expect(within(places[2]!).getAllByText('74')).toHaveLength(1)
    // The flame: small Streak counter with the best streak, hidden at 0.
    expect(within(places[1]!).getByRole('img', { hidden: true, name: 'Best current streak 6' }))
    expect(within(places[0]!).queryByRole('img', { hidden: true, name: /streak/ })).toBeNull()

    const rows = screen
      .getAllByRole('listitem')
      .filter((item) => item.matches('[data-component="leaderboard-row"]'))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Sam, rank 5, 52 weekly points, 1 miss this week.')
    expect(rows[1]).toHaveAttribute('data-unscored')
    expect(rows[1]).toHaveTextContent('Priya · no score this week')
  })

  it('two ranked members: 1st and 2nd blocks only, no rows', async () => {
    renderBoard({ board: { [TEST_GROUP.id]: testBoard({ rows: [marco, jo] }) } })
    const places = within(await podium()).getAllByRole('listitem')
    expect(places.map((place) => place.getAttribute('data-place'))).toEqual(['1', '2'])
    expect(document.querySelector('[data-component="leaderboard"]')).toBeNull()
  })

  it('whole week frozen: the unscored row says why', async () => {
    const frozen = { ...priya, sessionsPlanned: 3, sessionsFrozen: 3 }
    renderBoard({ board: { [TEST_GROUP.id]: testBoard({ rows: [marco, jo, frozen] }) } })
    expect(
      await screen.findByText('· Whole week frozen · back Mon · no score this week', {
        exact: false,
      }),
    ).toBeInTheDocument()
  })

  it('a group of one: the own block with the points, no podium, the waiting line and Invite', async () => {
    const solo = { ...TEST_GROUP, memberCount: 1 }
    const me = { ...jo, rank: null, weeklyPoints: 100 }
    const user = userEvent.setup()
    renderBoard({
      groups: [solo],
      board: { [TEST_GROUP.id]: testBoard({ waiting: true, rows: [me] }) },
    })
    const stand = await screen.findByText(/^Jo, 100 weekly points, Gym 3x/)
    expect(stand).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: "This week's podium" })).toBeNull()
    expect(
      screen.getByText('The leaderboard starts when a second friend joins.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect(await screen.findByText('Share link')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
    // The button left: focus moved to the panel that replaced it.
    expect(document.activeElement).toBe(
      document.querySelector('[data-component="invite-panel"]')?.parentElement,
    )
  })

  it('a group of one without a score: the dashed row', async () => {
    const solo = { ...TEST_GROUP, memberCount: 1 }
    renderBoard({
      groups: [solo],
      board: {
        [TEST_GROUP.id]: testBoard({ waiting: true, rows: [{ ...priya, userId: TEST_USER.id }] }),
      },
    })
    expect(await screen.findByText('· no score this week', { exact: false })).toBeInTheDocument()
    expect(
      screen.getByText('The leaderboard starts when a second friend joins.'),
    ).toBeInTheDocument()
  })

  it('Mon-Wed before last week locks: the switch shows Last week with its chip and marks', async () => {
    const user = userEvent.setup()
    const lastBoard = testBoard({
      isCurrentWeek: false,
      lockAt: LAST_LOCK,
      rows: [
        { ...sam, rank: 1, missCount: 2 },
        { ...jo, rank: 2 },
      ],
    })
    renderBoard({
      boards: {
        [`${TEST_GROUP.id}:${THIS_WEEK}`]: FULL,
        [`${TEST_GROUP.id}:${LAST_WEEK}`]: lastBoard,
      },
    })
    const group = await screen.findByRole('radiogroup', { name: 'Week' })
    const lastTab = within(group).getByRole('radio', { name: 'Last week' })
    await user.click(lastTab)
    expect(await screen.findByText(/^Locks Wed 23:59.* · can still change$/)).toBeInTheDocument()
    const places = within(
      await screen.findByRole('list', { name: "Last week's podium" }),
    ).getAllByRole('listitem')
    expect(places[0]).toHaveTextContent('Sam, rank 1, 52 weekly points, 2 misses last week.')
    // Arrow keys move back.
    await user.keyboard('{ArrowLeft}')
    expect(await podium()).toBeInTheDocument()
  })

  it('after last week locks the switch is not offered', async () => {
    vi.setSystemTime(new Date('2026-11-19T03:00:00Z'))
    renderBoard({
      boards: {
        [`${TEST_GROUP.id}:${THIS_WEEK}`]: FULL,
        [`${TEST_GROUP.id}:${LAST_WEEK}`]: testBoard({ isCurrentWeek: false, lockAt: LAST_LOCK }),
      },
    })
    await podium()
    // Both boards have loaded; still no switch.
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Week' })).toBeNull())
  })

  it('the lock passes while Last week is open: "Locked", then the switch goes after This week', async () => {
    const user = userEvent.setup()
    const lastBoard = testBoard({ isCurrentWeek: false, lockAt: LAST_LOCK, rows: [marco, jo] })
    const { queryClient } = renderBoard({
      boards: {
        [`${TEST_GROUP.id}:${THIS_WEEK}`]: FULL,
        [`${TEST_GROUP.id}:${LAST_WEEK}`]: lastBoard,
      },
    })
    await user.click(await screen.findByRole('radio', { name: 'Last week' }))
    await screen.findByText(/can still change$/)

    vi.setSystemTime(new Date('2026-11-18T17:00:00Z'))
    await act(() => queryClient.invalidateQueries({ queryKey: ['board'] }))
    expect(await screen.findByText('Locked')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'This week' }))
    await waitFor(() => expect(screen.queryByRole('radiogroup', { name: 'Week' })).toBeNull())
    expect(await podium()).toBeInTheDocument()
  })

  it('no cache: the skeleton after 300 ms, busy', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.getBoard).mockImplementation(() => new Promise(() => {}))
    renderRoutes(['/board'], backend)
    await waitFor(() =>
      expect(document.querySelector('[data-component="board-skeleton"]')).not.toBeNull(),
    )
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('no cache and a failure: "Can\'t reach Proofy right now." with Try again', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.getBoard).mockRejectedValue(new BackendError('unknown'))
    renderRoutes(['/board'], backend)
    expect(
      await screen.findByText("Can't reach Proofy right now.", {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    vi.mocked(backend.getBoard).mockResolvedValue(FULL)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await podium()).toBeInTheDocument()
  })

  it('a failed groups load: the Empty state with Try again', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.listMyGroups).mockRejectedValue(new BackendError('network'))
    renderRoutes(['/board'], backend)
    expect(
      await screen.findByText("Can't reach Proofy right now.", {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    vi.mocked(backend.listMyGroups).mockResolvedValue({ groups: [TEST_GROUP], ended: [] })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: `Leaderboard · ${TEST_GROUP.name}` }),
    ).toBeInTheDocument()
  })

  it('no groups: the create screen', async () => {
    renderRoutes(['/board'], createFakeBackend(undefined, { groups: [] }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Start a group' }),
    ).toBeInTheDocument()
  })
})

describe('Board week lock (Story 4.4)', () => {
  /** Opens Last week with `before`, then answers `after` for last week and refetches. */
  async function lockWhileOpen(before: Board, after: Board) {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, {
      boards: {
        [`${TEST_GROUP.id}:${THIS_WEEK}`]: FULL,
        [`${TEST_GROUP.id}:${LAST_WEEK}`]: before,
      },
    })
    const { queryClient } = renderRoutes(['/board'], backend)
    await user.click(await screen.findByRole('radio', { name: 'Last week' }))
    await screen.findByText(/can still change$/)
    vi.mocked(backend.getBoard).mockImplementation(async (_groupId, weekStart) =>
      weekStart === LAST_WEEK ? after : FULL,
    )
    await act(() => queryClient.invalidateQueries({ queryKey: ['board'] }))
  }

  it('the server marks last week locked: "Locked" with the frozen results, even before the device clock reaches the lock', async () => {
    const before = testBoard({ isCurrentWeek: false, lockAt: LAST_LOCK, rows: [marco, jo] })
    await lockWhileOpen(before, {
      ...before,
      locked: true,
      rows: [
        { ...jo, rank: 1, weeklyPoints: 90 },
        { ...marco, rank: 2 },
      ],
    })
    expect(await screen.findByText('Locked')).toBeInTheDocument()
    const places = within(
      await screen.findByRole('list', { name: "Last week's podium" }),
    ).getAllByRole('listitem')
    expect(places[0]).toHaveTextContent(/^Jo, rank 1, 90 weekly points/)
  })

  it('a locked week that had one member: their block, without the waiting line or Invite once the group has grown', async () => {
    const before = testBoard({ isCurrentWeek: false, lockAt: LAST_LOCK, rows: [marco, jo] })
    await lockWhileOpen(before, {
      ...before,
      locked: true,
      waiting: true,
      rows: [{ ...marco, rank: null }],
    })
    expect(await screen.findByText('Locked')).toBeInTheDocument()
    expect(await screen.findByText(/^Marco, 88 weekly points/)).toBeInTheDocument()
    expect(screen.queryByText('The leaderboard starts when a second friend joins.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
  })
})
