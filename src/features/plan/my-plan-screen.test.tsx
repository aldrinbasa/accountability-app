import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import type { MyPlanItem } from '@/domain/my-plan'
import type { TaskDetails } from '@/domain/plan'
import { createFakeBackend, renderRoutes, TEST_COMMITMENT, TEST_GROUP } from '@/test/fake-backend'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

const GYM: MyPlanItem = {
  commitmentId: 'c-gym',
  kind: 'commitment',
  section: 'current',
  state: 'pending_change',
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  name: null,
  scheduleType: 'times_per_week',
  days: null,
  target: 4,
  endDate: null,
  deadline: null,
  startsOn: '2026-11-23',
  endsOn: null,
  canEdit: true,
  canDelete: false,
}

const RUN: MyPlanItem = {
  ...GYM,
  commitmentId: 'c-run',
  state: 'ending',
  presetKey: 'run',
  activityName: 'Run',
  scheduleType: 'fixed_days',
  days: [1, 3, 5],
  target: null,
  startsOn: null,
  endsOn: '2026-11-22',
  canEdit: false,
}

const READ: MyPlanItem = {
  ...GYM,
  commitmentId: 'c-read',
  state: 'starts_next_week',
  presetKey: 'read',
  activityName: 'Read',
  target: 2,
}

const GARAGE: MyPlanItem = {
  ...GYM,
  commitmentId: 't-garage',
  kind: 'task',
  state: 'open',
  presetKey: 'clean',
  activityName: 'Clean',
  name: 'Garage',
  scheduleType: null,
  target: null,
  deadline: '2026-11-22',
  startsOn: null,
  canDelete: true,
}

const STUDY_ENDED: MyPlanItem = {
  ...GYM,
  commitmentId: 'c-study',
  section: 'past',
  state: 'ended',
  presetKey: 'study',
  activityName: 'Study',
  scheduleType: 'fixed_days',
  days: [2],
  target: null,
  startsOn: null,
  canEdit: false,
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

function withPlan(items: MyPlanItem[] = [GYM, RUN, READ, GARAGE, STUDY_ENDED]) {
  return createFakeBackend(undefined, {
    myPlan: { [TEST_GROUP.id]: items },
    commitments: [
      TEST_COMMITMENT,
      {
        ...TEST_COMMITMENT,
        commitmentId: 'c-read',
        activityName: 'Read',
        presetKey: 'read',
        state: 'starts_next_week',
      },
    ],
    tasks: [GARAGE_TASK],
  })
}

const PLAN_PATH = `/me/plan?g=${TEST_GROUP.id}`

beforeEach(() => toast.showToast.mockClear())

describe('My plan', () => {
  it('Me > My plan: a pushed screen with Back, one h1, Current rows with state labels and Past', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes([`/me?g=${TEST_GROUP.id}`], withPlan())
    await user.click(await screen.findByRole('link', { name: 'My plan' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
    expect(router.state.location.search).toBe(`?g=${TEST_GROUP.id}`)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'My plan' })).toBeInTheDocument()
    const current = await screen.findByRole('region', { name: 'Current' })
    const rows = within(current).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Gym',
      'Run',
      'Read',
      'Garage',
    ])
    expect(within(current).getByText('4 times per week from Mon')).toBeInTheDocument()
    expect(within(current).getByText('Fixed days · Mon Wed Fri · ends Sun')).toBeInTheDocument()
    expect(within(current).getByText('2 times per week · starts Mon 23 Nov')).toBeInTheDocument()
    expect(within(current).getByText('Task · by Sun')).toBeInTheDocument()
    // Edit only where the server allows it (an ending commitment has none).
    expect(within(current).getByRole('button', { name: 'Edit Gym' })).toBeInTheDocument()
    expect(within(current).queryByRole('button', { name: 'Edit Run' })).not.toBeInTheDocument()

    const past = screen.getByRole('region', { name: 'Past' })
    expect(within(past).getByRole('heading', { level: 3, name: 'Study' })).toBeInTheDocument()
    expect(within(past).getByText('Fixed days · Tue')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })

  it('without ?g= it shows the focused group; with nothing planned, "No plan here yet."', async () => {
    const backend = withPlan([])
    renderRoutes(['/me/plan'], backend)
    expect(await screen.findByText('No plan here yet.')).toBeInTheDocument()
    expect(backend.getMyPlan).toHaveBeenCalledWith(TEST_GROUP.id)
    expect(screen.queryByRole('region', { name: 'Past' })).not.toBeInTheDocument()
  })

  it('Edit on a commitment opens the edit sheet; End shows "ends Sun" in My plan', async () => {
    const user = userEvent.setup()
    const backend = withPlan([{ ...GYM, state: 'active', startsOn: null, target: 3 }])
    vi.mocked(backend.endCommitment).mockImplementation(async () => {
      vi.mocked(backend.getMyPlan).mockResolvedValue([
        {
          ...GYM,
          state: 'ending',
          target: 3,
          startsOn: null,
          endsOn: '2026-11-22',
          canEdit: false,
        },
      ])
      return { endsAfterWeekStart: '2026-11-16' }
    })
    renderRoutes([PLAN_PATH], backend)
    await user.click(await screen.findByRole('button', { name: 'Edit Gym' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit commitment' })
    await user.click(await within(edit).findByRole('button', { name: 'End commitment' }))
    const confirm = await screen.findByRole('dialog', { name: 'End Gym?' })
    await user.click(within(confirm).getByRole('button', { name: 'End' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('3 times per week · ends Sun')).toBeInTheDocument()
    expect(backend.endCommitment).toHaveBeenCalledWith('c-gym')
    // The row's Edit is gone with the end: focus falls back to the h1.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'My plan' })).toHaveFocus(),
    )
  })

  it('ending a commitment that has not started moves it to Past at once', async () => {
    const user = userEvent.setup()
    const backend = withPlan([READ])
    vi.mocked(backend.endCommitment).mockImplementation(async () => {
      vi.mocked(backend.getMyPlan).mockResolvedValue([
        { ...READ, section: 'past', state: 'ended', canEdit: false },
      ])
      return { endsAfterWeekStart: '2026-11-09' }
    })
    renderRoutes([PLAN_PATH], backend)
    await user.click(await screen.findByRole('button', { name: 'Edit Read' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit commitment' })
    await user.click(await within(edit).findByRole('button', { name: 'End commitment' }))
    await user.click(
      within(await screen.findByRole('dialog', { name: 'End Read?' })).getByRole('button', {
        name: 'End',
      }),
    )
    const past = await screen.findByRole('region', { name: 'Past' })
    expect(within(past).getByRole('heading', { level: 3, name: 'Read' })).toBeInTheDocument()
  })

  it('Edit on a task opens the task edit mode', async () => {
    const user = userEvent.setup()
    renderRoutes([PLAN_PATH], withPlan())
    await user.click(await screen.findByRole('button', { name: 'Edit Garage' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(await within(edit).findByRole('textbox', { name: 'Name' })).toHaveValue('Garage')
  })

  it('the deep link opens the edit sheet over My plan; closing it returns to /me/plan', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes([`/me/plan/c-gym?g=${TEST_GROUP.id}`], withPlan())
    const edit = await screen.findByRole('dialog', { name: 'Edit commitment' })
    expect(await within(edit).findByText('Changes start Mon 23 Nov.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'My plan', hidden: true })).toBeTruthy()
    await user.click(within(edit).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
    expect(router.state.location.search).toBe(`?g=${TEST_GROUP.id}`)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Current' })).toBeInTheDocument()
  })

  it('a deep link to a gone, ended or task id opens My plan with "That\'s already wrapped up."', async () => {
    for (const id of ['c-none', 't-garage']) {
      const backend = withPlan()
      const { router, unmount } = renderRoutes([`/me/plan/${id}?g=${TEST_GROUP.id}`], backend)
      await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
      expect(toast.showToast).toHaveBeenCalledWith("That's already wrapped up.")
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await screen.findByRole('heading', { level: 1, name: 'My plan' })).toBeInTheDocument()
      toast.showToast.mockClear()
      unmount()
    }

    const ended = createFakeBackend(undefined, {
      myPlan: { [TEST_GROUP.id]: [STUDY_ENDED] },
      commitments: [
        { ...TEST_COMMITMENT, commitmentId: 'c-study', state: 'ended', canEdit: false },
      ],
    })
    const { router } = renderRoutes([`/me/plan/c-study?g=${TEST_GROUP.id}`], ended)
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
    expect(toast.showToast).toHaveBeenCalledWith("That's already wrapped up.")
  })

  it('a deep link to a commitment of another current group switches ?g= to that group', async () => {
    const other = { ...TEST_GROUP, id: 'group-2', name: 'Book Club' }
    const backend = createFakeBackend(undefined, {
      groups: [TEST_GROUP, other],
      myPlan: { [other.id]: [{ ...GYM, commitmentId: 'c-book' }] },
      commitments: [{ ...TEST_COMMITMENT, commitmentId: 'c-book', groupId: other.id }],
    })
    const { router } = renderRoutes([`/me/plan/c-book?g=${TEST_GROUP.id}`], backend)
    await waitFor(() => expect(router.state.location.search).toBe(`?g=${other.id}`))
    expect(router.state.location.pathname).toBe('/me/plan/c-book')
    expect(await screen.findByRole('dialog', { name: 'Edit commitment' })).toBeInTheDocument()
    await waitFor(() => expect(backend.getMyPlan).toHaveBeenCalledWith(other.id))
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('a deep link to a commitment of a group the member is not in reads as wrapped up', async () => {
    const backend = createFakeBackend(undefined, {
      myPlan: { [TEST_GROUP.id]: [] },
      commitments: [{ ...TEST_COMMITMENT, commitmentId: 'c-old', groupId: 'group-gone' }],
    })
    const { router } = renderRoutes([`/me/plan/c-old?g=${TEST_GROUP.id}`], backend)
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/plan'))
    expect(toast.showToast).toHaveBeenCalledWith("That's already wrapped up.")
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a failed load: the load-failed Empty state with Try again, which refetches', async () => {
    const user = userEvent.setup()
    const backend = withPlan()
    vi.mocked(backend.getMyPlan).mockRejectedValue(new BackendError('network'))
    renderRoutes([PLAN_PATH], backend)
    expect(
      await screen.findByText("Can't reach Proofy right now.", {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    vi.mocked(backend.getMyPlan).mockResolvedValue([GYM])
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Gym' })).toBeInTheDocument()
  })
})
