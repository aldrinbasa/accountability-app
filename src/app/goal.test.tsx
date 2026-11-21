import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackendError } from '@/domain/error-codes'
import type { FeedGoal, GroupGoal } from '@/domain/goal'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_USER,
  testBoard,
  testGroupGoal,
} from '@/test/fake-backend'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'

// Tuesday 17 Nov 2026, 11:00 in Manila: last week (9 Nov) still awaits its lock.
const TUESDAY = new Date('2026-11-17T03:00:00Z')

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TUESDAY)
})

afterEach(() => {
  vi.useRealTimers()
  dismissToast()
  setOnline(true)
})

const MEMBER_GROUP = { ...TEST_GROUP, role: 'member' as const }

const WEEKLY: GroupGoal = testGroupGoal({
  target: 85,
  period: 'weekly',
  liveAverage: 72.5,
  contributions: [
    { userId: 'user-marco', name: 'Marco', weeklyPoints: 88 },
    { userId: TEST_USER.id, name: 'Jo', weeklyPoints: 57 },
    { userId: 'user-priya', name: 'Priya', weeklyPoints: null },
  ],
})

function renderBoard(options: Parameters<typeof createFakeBackend>[1] = {}) {
  render(<Toaster />)
  const backend = createFakeBackend(undefined, options)
  return { user: userEvent.setup(), ...renderRoutes(['/board'], backend) }
}

function panel() {
  return screen.findByRole('region', { name: /^Group goal/ })
}

describe('Board: Goal panel (Story 4.7)', () => {
  it('no goal: the admin sees "Set a group goal"', async () => {
    renderBoard()
    const goal = await panel()
    expect(within(goal).getByRole('heading', { name: 'Group goal' })).toBeInTheDocument()
    expect(within(goal).getByRole('button', { name: 'Set a group goal' })).toBeInTheDocument()
    expect(within(goal).queryByText("Everyone's part")).not.toBeInTheDocument()
  })

  it('no goal: a member sees "No group goal yet." and no button', async () => {
    renderBoard({ groups: [MEMBER_GROUP] })
    const goal = await panel()
    expect(within(goal).getByText('No group goal yet.')).toBeInTheDocument()
    expect(within(goal).queryByRole('button')).not.toBeInTheDocument()
  })

  it('a weekly goal: summary, target, now, contributions with labels and the no-score note', async () => {
    renderBoard({ goals: { [TEST_GROUP.id]: WEEKLY } })
    const goal = await screen.findByRole('region', {
      name: 'Group goal 85% this week. Now 72.5%.',
    })
    expect(within(goal).getByRole('heading', { name: 'Group goal · 85% this week' })).toBeVisible()
    expect(goal.querySelector('[data-goal-now]')).toHaveTextContent('72.5%')
    expect(within(goal).getByRole('heading', { name: "Everyone's part" })).toBeInTheDocument()
    expect(
      within(goal)
        .getAllByRole('img')
        .map((row) => row.getAttribute('aria-label')),
    ).toEqual(['Marco, 88%', 'Jo, 57%', 'Priya, no score'])
    expect(
      within(goal).getByText("Priya has no score, so they're left out of the average."),
    ).toBeInTheDocument()
    expect(within(goal).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('a member never sees Edit', async () => {
    renderBoard({ groups: [MEMBER_GROUP], goals: { [TEST_GROUP.id]: WEEKLY } })
    const goal = await panel()
    expect(within(goal).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('the last result hit: the sticky; missed: the meta line without naming anyone', async () => {
    const hit = { weekStart: '2026-11-09', period: 'weekly' as const, target: 85, average: 86 }
    const first = renderBoard({
      goals: { [TEST_GROUP.id]: { ...WEEKLY, lastResult: { ...hit, hit: true } } },
    })
    expect(
      within(await panel()).getByText('Goal hit. Nobody let the group down. This time.'),
    ).toBeInTheDocument()
    first.unmount()

    renderBoard({
      goals: {
        [TEST_GROUP.id]: { ...WEEKLY, lastResult: { ...hit, average: 80.5, hit: false } },
      },
    })
    expect(within(await panel()).getByText('Missed by 5%. Next week, then.')).toBeInTheDocument()
  })

  it('monthly: the month so far as now, one tick bar per locked week', async () => {
    renderBoard({
      goals: {
        [TEST_GROUP.id]: {
          ...WEEKLY,
          period: 'monthly',
          monthWeeks: [
            { weekStart: '2026-11-02', average: 70 },
            { weekStart: '2026-11-09', average: 81 },
          ],
          monthAverage: 75.5,
        },
      },
    })
    const goal = await screen.findByRole('region', {
      name: 'Group goal 85% this month. Now 75.5%.',
    })
    expect(within(goal).getByRole('img', { name: 'Week of 2 Nov, 70%' })).toBeInTheDocument()
    expect(within(goal).getByRole('img', { name: 'Week of 9 Nov, 81%' })).toBeInTheDocument()
  })

  it('a group of one: no Goal panel', async () => {
    const solo = { ...TEST_GROUP, memberCount: 1 }
    renderBoard({
      groups: [solo],
      board: { [solo.id]: testBoard({ waiting: true, rows: [] }) },
      goals: { [solo.id]: { ...WEEKLY, memberCount: 1 } },
    })
    expect(
      await screen.findByText('The leaderboard starts when a second friend joins.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^Group goal/ })).not.toBeInTheDocument()
  })

  it('the Last week view shows no Goal panel', async () => {
    const { user } = renderBoard({
      goals: { [TEST_GROUP.id]: WEEKLY },
      boards: {
        [`${TEST_GROUP.id}:2026-11-09`]: testBoard({ lockAt: '2026-11-18T16:00:00.000Z' }),
      },
    })
    await panel()
    await user.click(await screen.findByRole('radio', { name: 'Last week' }))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /^Group goal/ })).not.toBeInTheDocument(),
    )
  })

  it('a failed goal load: Inline retry, then the panel', async () => {
    const backend = createFakeBackend()
    // The read retries once by itself.
    vi.mocked(backend.getGroupGoal)
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockRejectedValueOnce(new BackendError('unknown'))
    render(<Toaster />)
    const user = userEvent.setup()
    renderRoutes(['/board'], backend)
    expect(await screen.findByText("Couldn't load the group goal.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await panel()).toBeInTheDocument()
  })
})

describe('Goal Sheet (Story 4.7)', () => {
  async function openSheet(options: Parameters<typeof createFakeBackend>[1] = {}) {
    const result = renderBoard(options)
    const goal = await panel()
    const opener = within(goal).getByRole('button', { name: /Set a group goal|Edit/ })
    await result.user.click(opener)
    const dialog = await screen.findByRole('dialog')
    return { ...result, dialog, opener }
  }

  it('sets a goal: stepper from 85, Monthly, Save, "Saving…", toast and the panel updates', async () => {
    const { user, dialog, backend } = await openSheet()
    expect(within(dialog).getByRole('heading', { name: 'Set a group goal' })).toBeInTheDocument()
    expect(within(dialog).getByText('85 percent')).toBeInTheDocument()
    expect(within(dialog).getByText('Average of everyone with a score.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Raise target' }))
    expect(within(dialog).getByText('90 percent')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Monthly' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Goal set: 90% this month.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.setGroupGoal).toHaveBeenCalledWith(TEST_GROUP.id, 90, 'monthly')
    expect(
      await screen.findByRole('heading', { name: 'Group goal · 90% this month' }),
    ).toBeInTheDocument()
  })

  it('the stepper stops at 50 and 100', async () => {
    const { user, dialog } = await openSheet()
    for (let i = 0; i < 3; i += 1) {
      await user.click(within(dialog).getByRole('button', { name: 'Raise target' }))
    }
    expect(within(dialog).getByText('100 percent')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Raise target' })).not.toBeInTheDocument()
  })

  it('Edit starts from the goal in effect', async () => {
    const { dialog } = await openSheet({ goals: { [TEST_GROUP.id]: WEEKLY } })
    expect(within(dialog).getByRole('heading', { name: 'Edit group goal' })).toBeInTheDocument()
    expect(within(dialog).getByText('85 percent')).toBeInTheDocument()
    // The stepper counts steps of 5; the value shown is the target.
    expect(dialog.querySelector('[data-stepper-value] [aria-hidden="true"]')).toHaveTextContent(
      /^85%$/,
    )
    expect(within(dialog).getByRole('radio', { name: 'Weekly' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('offline: Inline retry above Save, inputs kept; Retry sends once back online', async () => {
    const { user, dialog, backend } = await openSheet()
    await user.click(within(dialog).getByRole('button', { name: 'Lower target' }))
    setOnline(false)
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(
      await within(dialog).findByText("You're offline. Goals need a signal to save."),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('80 percent')).toBeInTheDocument()
    expect(backend.setGroupGoal).not.toHaveBeenCalled()
    setOnline(true)
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Goal set: 80% this week.')).toBeInTheDocument()
  })

  it('a failure shows Inline retry; not_admin shows the AD-14 copy without Retry', async () => {
    const { user, dialog, backend } = await openSheet()
    vi.mocked(backend.setGroupGoal).mockRejectedValueOnce(new BackendError('unknown'))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText("Couldn't save the goal. Tap Retry.")).toBeVisible()
    vi.mocked(backend.setGroupGoal).mockRejectedValueOnce(new BackendError('not_admin'))
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByText("Only the group's admin can do that.")).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('closing with changed input asks "Discard this?"; Keep stays, Discard closes', async () => {
    const { user, dialog } = await openSheet()
    await user.click(within(dialog).getByRole('radio', { name: 'Monthly' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(within(dialog).getByText('Discard this?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }))
    expect(within(dialog).getByRole('radio', { name: 'Monthly' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closing unchanged closes at once', async () => {
    const { user, dialog } = await openSheet()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Group settings: Group goal row (Story 4.7)', () => {
  it('the admin row reads the goal and opens the Sheet', async () => {
    render(<Toaster />)
    const user = userEvent.setup()
    renderRoutes(
      [`/me/groups/${TEST_GROUP.id}?g=${TEST_GROUP.id}`],
      createFakeBackend(undefined, { goals: { [TEST_GROUP.id]: WEEKLY } }),
    )
    const row = await screen.findByRole('button', { name: 'Group goal, 85% this week' })
    await user.click(row)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Edit group goal' })).toBeInTheDocument()
  })

  it('the row opens nothing until the goal has loaded; a failed load shows Inline retry', async () => {
    const backend = createFakeBackend(undefined, { goals: { [TEST_GROUP.id]: WEEKLY } })
    vi.mocked(backend.getGroupGoal)
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockRejectedValueOnce(new BackendError('unknown'))
    const user = userEvent.setup()
    renderRoutes([`/me/groups/${TEST_GROUP.id}?g=${TEST_GROUP.id}`], backend)
    expect(await screen.findByText("Couldn't load the group goal.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Group goal/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('button', { name: 'Group goal, 85% this week' }),
    ).toBeInTheDocument()
  })

  it('a group of one: the admin can set a goal; the note says it starts with a friend', async () => {
    const solo = { ...TEST_GROUP, memberCount: 1 }
    renderRoutes(
      [`/me/groups/${solo.id}?g=${solo.id}`],
      createFakeBackend(undefined, { groups: [solo] }),
    )
    expect(await screen.findByRole('button', { name: 'Group goal, None' })).toBeInTheDocument()
    expect(screen.getByText('Starts counting when a friend joins.')).toBeInTheDocument()
  })

  it("a member's row is read-only", async () => {
    renderRoutes(
      [`/me/groups/${TEST_GROUP.id}?g=${TEST_GROUP.id}`],
      createFakeBackend(undefined, {
        groups: [MEMBER_GROUP],
        goals: { [TEST_GROUP.id]: WEEKLY },
      }),
    )
    expect(await screen.findByText('85% this week')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Group goal/ })).not.toBeInTheDocument()
  })
})

describe('Feed: goal result sticky (Story 4.7)', () => {
  const base: FeedGoal = {
    type: 'goal',
    id: 'goal-1',
    groupId: TEST_GROUP.id,
    sortAt: '2026-11-12T00:00:01Z',
    weekStart: '2026-11-02',
    period: 'weekly',
    target: 85,
    average: 86,
    hit: true,
  }

  it('hit and missed results with their kicker', async () => {
    renderRoutes(
      ['/feed'],
      createFakeBackend(undefined, {
        feed: {
          [TEST_GROUP.id]: [
            base,
            {
              ...base,
              id: 'goal-2',
              sortAt: '2026-11-19T00:00:01Z',
              weekStart: '2026-11-09',
              average: 81,
              hit: false,
            },
          ],
        },
      }),
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Goal hit · 85% this week. Nobody let the group down. This time.',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Goal missed by 4% · 85% this week. Next week, then.' }),
    ).toBeInTheDocument()
    expect(screen.getByText('· week of 9 Nov')).toBeInTheDocument()
  })
})
