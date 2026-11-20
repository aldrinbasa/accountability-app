import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import type { TaskDetails } from '@/domain/plan'
import type { TodayItem, TodaySummary } from '@/domain/today'
import {
  createFakeBackend,
  renderRoutes,
  TEST_COMMITMENT,
  TEST_GROUP,
  TEST_TODAY_SUMMARY,
} from '@/test/fake-backend'

const ROW: TodayItem = {
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
  counted: 0,
  deadline: null,
  startsOn: null,
  canDelete: false,
  countedToday: false,
  targetMet: false,
}

const TASK_TODAY: TodayItem = {
  ...ROW,
  commitmentId: 't-groceries',
  kind: 'task',
  presetKey: 'groceries',
  activityName: 'Groceries',
  name: 'Grocery run',
  scheduleType: null,
  days: null,
  target: 1,
  deadline: '2026-11-18',
}

const RUN: TodayItem = {
  ...ROW,
  commitmentId: 'c-run',
  section: 'this_week',
  presetKey: 'run',
  activityName: 'Run',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
}

const TASK_SUNDAY: TodayItem = {
  ...TASK_TODAY,
  commitmentId: 't-garage',
  section: 'this_week',
  presetKey: 'clean',
  activityName: 'Clean',
  name: 'Garage',
  deadline: '2026-11-22',
  canDelete: true,
}

const READ_NEXT: TodayItem = {
  ...ROW,
  commitmentId: 'c-read',
  section: 'starts_next_week',
  presetKey: 'read',
  activityName: 'Read',
  scheduleType: 'times_per_week',
  days: null,
  target: 4,
  startsOn: '2026-11-23',
}

const WEDNESDAY: TodaySummary = {
  memberToday: '2026-11-18',
  weekStart: '2026-11-16',
  weekNumber: 4,
  planned: 9,
  done: 0,
  left: 9,
  hasPlan: true,
}

const GARAGE_TASK: TaskDetails = {
  commitmentId: 't-garage',
  groupId: TEST_GROUP.id,
  presetKey: 'clean',
  customName: null,
  name: 'Garage',
  deadline: '2026-11-22',
  canDelete: true,
  canRename: true,
}

function withToday(items: TodayItem[], summary: TodaySummary = WEDNESDAY, waiting = false) {
  return createFakeBackend(undefined, {
    groups: [{ ...TEST_GROUP, memberCount: waiting ? 1 : 3 }],
    today: { [TEST_GROUP.id]: { items, summary } },
    tasks: [GARAGE_TASK],
  })
}

describe('Today states', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 20, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('an active group with no plan: "No plan here yet." with Add as its one action', async () => {
    renderRoutes(['/today'])
    expect(await screen.findByRole('heading', { level: 1, name: 'Friday' })).toBeInTheDocument()
    expect(await screen.findByText('No plan here yet.')).toBeInTheDocument()
    expect(screen.getByText('Add a commitment or a task to start scoring.')).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add a commitment or task' })
    expect(add).toHaveTextContent('Add')
    expect(add.closest('[data-component="empty-state"]')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: 'Add a commitment or task' })).toHaveLength(1)
    expect(screen.queryByText('Just you in here so far.')).not.toBeInTheDocument()
    // Nothing planned this week: no week line, no sections.
    expect(screen.queryByText(/of the grind/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: /Due today/ })).not.toBeInTheDocument()
  })

  it('a waiting group with no plan: the waiting state, then the Add button only', async () => {
    renderRoutes(
      ['/today'],
      createFakeBackend(undefined, { groups: [{ ...TEST_GROUP, memberCount: 1 }] }),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Friday' })).toBeInTheDocument()
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
    // Plans work in a waiting group too (FR-4): the Add button sits under the waiting state.
    const add = await screen.findByRole('button', { name: 'Add a commitment or task' })
    expect(add.closest('[data-component="empty-state"]')).toBeNull()
    expect(screen.queryByText('No plan here yet.')).not.toBeInTheDocument()
  })

  it('a waiting group with a plan: the waiting state on top, then the sections', async () => {
    renderRoutes(['/today'], withToday([ROW], WEDNESDAY, true))
    expect(await screen.findByRole('heading', { level: 2, name: /Due today/ })).toBeInTheDocument()
    const waiting = screen.getByText('Just you in here so far.')
    const due = screen.getByRole('heading', { level: 2, name: /Due today/ })
    expect(waiting.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a failed groups load: the Empty state with Try again, which refetches', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.listMyGroups).mockRejectedValue(new BackendError('network'))
    renderRoutes(['/today'], backend)
    expect(
      await screen.findByText("Can't reach Proofy right now.", {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Check your signal and try again.')).toBeInTheDocument()

    vi.mocked(backend.listMyGroups).mockResolvedValue({ groups: [TEST_GROUP], ended: [] })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' }),
    ).toBeInTheDocument()
    expect(screen.queryByText("Can't reach Proofy right now.")).not.toBeInTheDocument()
  })
})

describe('Today with a plan', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // The device says Friday; the member's own zone says Wednesday (the server wins).
    vi.setSystemTime(new Date(2026, 10, 20, 12, 0, 0))
  })
  afterEach(() => vi.useRealTimers())

  it('reads top to bottom: day, week line, Due today, This week, next week, then Add', async () => {
    renderRoutes(['/today'], withToday([ROW, TASK_TODAY, RUN, TASK_SUNDAY, READ_NEXT]))
    expect(await screen.findByRole('heading', { level: 1, name: 'Wednesday' })).toBeInTheDocument()
    expect(screen.getByText('Week 4 of the grind · 0 of 9 done')).toBeInTheDocument()

    const due = screen.getByRole('heading', { level: 2, name: 'Due today · 9 left this week' })
    const week = screen.getByRole('heading', { level: 2, name: 'This week' })
    const next = screen.getByRole('heading', { level: 2, name: 'Your plan here · starts Mon' })
    const add = screen.getByRole('button', { name: 'Add a commitment or task' })
    const order = [due, week, next, add]
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }

    // Rows keep the server's order within each section.
    const dueList = within(due.closest('section')!).getAllByRole('heading', { level: 3 })
    expect(dueList.map((h) => h.textContent)).toEqual(['Gym', 'Grocery run'])
    const weekList = within(week.closest('section')!).getAllByRole('heading', { level: 3 })
    expect(weekList.map((h) => h.textContent)).toEqual(['Run', 'Garage'])

    expect(screen.getByText('Fixed days · Mon Wed Fri')).toBeInTheDocument()
    expect(screen.getByText('Task · by Wed')).toBeInTheDocument()
    expect(screen.getByText('3 times per week · 3 to go')).toBeInTheDocument()
    expect(screen.getByText('Task · by Sun')).toBeInTheDocument()
    expect(screen.getByText('4 times per week · starts Mon 23 Nov')).toBeInTheDocument()

    // Times per week shows the ring with the fraction; the other rows do not.
    const ring = screen.getByRole('img', { name: 'Run, 0 of 3 this week' })
    expect(ring).toHaveTextContent('0/3')
    expect(screen.getAllByRole('img')).toHaveLength(1)

    // Due today and This week rows end with Overflow, then Check in (Story 3.1); next week's row
    // has no Check in.
    for (const title of ['Gym', 'Grocery run', 'Run', 'Garage']) {
      const checkIn = screen.getByRole('button', { name: `Check in ${title}` })
      expect(checkIn).toHaveTextContent('Check in')
      const buttons = within(checkIn.closest('li')!).getAllByRole('button')
      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
        `More actions for ${title}`,
        `Check in ${title}`,
      ])
    }
    const nextRow = screen.getByRole('heading', { level: 3, name: 'Read' }).closest('li')!
    expect(within(nextRow).queryByRole('button', { name: /Check in/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions for Grocery run' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions for Garage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions for Gym' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions for Run' })).toBeInTheDocument()
  })

  it('nothing due today: the couch Empty state, This week still shows', async () => {
    renderRoutes(['/today'], withToday([RUN, TASK_SUNDAY], { ...WEDNESDAY, planned: 4, left: 4 }))
    expect(
      await screen.findByText('Nothing due today. The couch is suspicious.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Due today · 4 left this week' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'This week' })).toBeInTheDocument()
    expect(screen.queryByText('No plan here yet.')).not.toBeInTheDocument()
  })

  it('a plan with nothing listed today (fixed days on another day): the couch, not "No plan here yet." (retro F1)', async () => {
    renderRoutes(['/today'], withToday([], { ...WEDNESDAY, planned: 3, left: 2, hasPlan: true }))
    expect(
      await screen.findByText('Nothing due today. The couch is suspicious.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Due today · 2 left this week' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('No plan here yet.')).not.toBeInTheDocument()
    // Add stays available as the "+ Add" button, not as an Empty state action.
    const add = screen.getByRole('button', { name: 'Add a commitment or task' })
    expect(add.closest('[data-component="empty-state"]')).toBeNull()
  })

  it('only next week planned: no week line, the couch, and the next-week block', async () => {
    renderRoutes(
      ['/today'],
      withToday([READ_NEXT], { ...TEST_TODAY_SUMMARY, planned: 0, done: 0, left: 0 }),
    )
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Your plan here · starts Mon' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Nothing due today. The couch is suspicious.')).toBeInTheDocument()
    expect(screen.queryByText(/of the grind/)).not.toBeInTheDocument()
    // Nothing planned this week: the Due today heading has no "0 left this week" count.
    expect(screen.getByRole('heading', { level: 2, name: 'Due today' })).toBeInTheDocument()
    expect(screen.queryByText(/left this week/)).not.toBeInTheDocument()
  })

  it('a task Overflow opens a Sheet with Edit, which opens the task edit mode', async () => {
    const user = userEvent.setup()
    renderRoutes(['/today'], withToday([RUN, TASK_SUNDAY]))
    const more = await screen.findByRole('button', { name: 'More actions for Garage' })
    await user.click(more)
    const actions = await screen.findByRole('dialog', { name: 'Garage' })
    await user.click(within(actions).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: 'Edit task' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Garage' })).not.toBeInTheDocument()

    // Closing the edit sheet returns focus to the row's Overflow.
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(more).toHaveFocus())
  })

  it('a commitment Overflow opens a Sheet with Edit, which opens the commitment edit mode', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, {
      today: { [TEST_GROUP.id]: { items: [RUN, TASK_SUNDAY], summary: WEDNESDAY } },
      commitments: [
        { ...TEST_COMMITMENT, commitmentId: 'c-run', presetKey: 'run', activityName: 'Run' },
      ],
    })
    renderRoutes(['/today'], backend)
    const more = await screen.findByRole('button', { name: 'More actions for Run' })
    await user.click(more)
    const actions = await screen.findByRole('dialog', { name: 'Run' })
    await user.click(within(actions).getByRole('button', { name: 'Edit' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit commitment' })
    expect(await within(edit).findByText('Changes start Mon 23 Nov.')).toBeInTheDocument()
    expect(backend.getCommitment).toHaveBeenCalledWith('c-run')
    expect(backend.getTask).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(more).toHaveFocus())
  })

  it('deleting a task from its row: the row goes and "+ Add" gets focus', async () => {
    const user = userEvent.setup()
    const backend = withToday([RUN, TASK_SUNDAY])
    let items = [RUN, TASK_SUNDAY]
    vi.mocked(backend.getTodayItems).mockImplementation(async () => items)
    vi.mocked(backend.deleteTask).mockImplementation(async () => {
      items = [RUN]
    })
    renderRoutes(['/today'], backend)
    await user.click(await screen.findByRole('button', { name: 'More actions for Garage' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Garage' })).getByRole('button', {
        name: 'Edit',
      }),
    )
    const edit = await screen.findByRole('dialog', { name: 'Edit task' })
    await user.click(await within(edit).findByRole('button', { name: 'Delete task' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Garage?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 3, name: 'Garage' })).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add a commitment or task' })).toHaveFocus(),
    )
  })

  it('a refetch that removes the open row closes its actions Sheet; focus goes to "+ Add"', async () => {
    const user = userEvent.setup()
    const backend = withToday([RUN, TASK_SUNDAY])
    const { queryClient } = renderRoutes(['/today'], backend)
    await user.click(await screen.findByRole('button', { name: 'More actions for Garage' }))
    await screen.findByRole('dialog', { name: 'Garage' })

    vi.mocked(backend.getTodayItems).mockResolvedValue([RUN])
    await queryClient.invalidateQueries({ queryKey: ['today', TEST_GROUP.id] })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Garage' })).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add a commitment or task' })).toHaveFocus(),
    )
  })

  it('closing the row actions Sheet returns focus to the Overflow', async () => {
    const user = userEvent.setup()
    renderRoutes(['/today'], withToday([TASK_SUNDAY]))
    const more = await screen.findByRole('button', { name: 'More actions for Garage' })
    await user.click(more)
    await screen.findByRole('dialog', { name: 'Garage' })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(more).toHaveFocus())
  })
})

describe('Today done and counted states (Story 3.2)', () => {
  it('done rows: dashed, the Done doodle instead of Check in, "· Done" in the meta', async () => {
    renderRoutes(
      ['/today'],
      withToday([
        { ...ROW, counted: 1, countedToday: true },
        { ...TASK_TODAY, counted: 1, countedToday: true, targetMet: true },
      ]),
    )
    const gym = await screen.findByRole('heading', { level: 3, name: 'Gym' })
    const gymRow = gym.closest('li') as HTMLElement
    expect(gymRow).toHaveAttribute('data-done')
    expect(gymRow).toHaveClass('border-dashed', 'bg-transparent')
    expect(within(gymRow).getByRole('img', { name: 'Done' })).toBeInTheDocument()
    expect(within(gymRow).queryByRole('button', { name: 'Check in Gym' })).not.toBeInTheDocument()
    expect(within(gymRow).getByText('Fixed days · Mon Wed Fri · Done')).toBeInTheDocument()
    const taskRow = screen.getByRole('heading', { level: 3, name: 'Grocery run' }).closest('li')
    expect(within(taskRow as HTMLElement).getByText('Task · by Wed · Done')).toBeInTheDocument()
  })

  it('times per week keeps Check in: "counted today", then "target met" with a full ring', async () => {
    const { unmount } = renderRoutes(
      ['/today'],
      withToday([{ ...RUN, counted: 1, countedToday: true }]),
    )
    const run = await screen.findByRole('heading', { level: 3, name: 'Run' })
    const row = run.closest('li') as HTMLElement
    expect(row).not.toHaveAttribute('data-done')
    expect(within(row).getByText('3 times per week · 2 to go · counted today')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Check in Run' })).toBeInTheDocument()
    unmount()

    renderRoutes(
      ['/today'],
      withToday([{ ...RUN, counted: 3, countedToday: true, targetMet: true }]),
    )
    const met = (await screen.findByRole('heading', { level: 3, name: 'Run' })).closest('li')
    expect(
      within(met as HTMLElement).getByText('3 times per week · target met'),
    ).toBeInTheDocument()
    expect(
      within(met as HTMLElement).getByRole('img', { name: 'Run, 3 of 3 this week' }),
    ).toHaveAttribute('data-met')
    expect(
      within(met as HTMLElement).getByRole('button', { name: 'Check in Run' }),
    ).toBeInTheDocument()
  })
})

describe('Today loading', () => {
  it('a cold load shows the Skeleton only after 300 ms, aria-busy', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.getTodayItems).mockReturnValue(new Promise(() => {}))
    renderRoutes(['/today'], backend)
    await screen.findByRole('heading', { level: 1 })
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect(await screen.findByRole('status')).toHaveTextContent('Loading')
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('a failed cold load: "Can\'t reach Proofy right now." with Try again, which refetches', async () => {
    const user = userEvent.setup()
    const backend = withToday([ROW])
    vi.mocked(backend.getTodayItems).mockRejectedValue(new BackendError('network'))
    renderRoutes(['/today'], backend)
    expect(
      await screen.findByText("Can't reach Proofy right now.", {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    vi.mocked(backend.getTodayItems).mockResolvedValue([ROW])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Gym' })).toBeInTheDocument()
  })
})
