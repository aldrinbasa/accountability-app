import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GroupActivity } from '@/domain/activities'
import { BackendError } from '@/domain/error-codes'
import type { CommitmentDetails } from '@/domain/my-plan'
import type { TaskDetails } from '@/domain/plan'
import {
  createFakeBackend,
  renderRoutes,
  TEST_COMMITMENT,
  TEST_GROUP,
  TEST_PLAN_PREVIEW,
  withBackend,
} from '@/test/fake-backend'
import { AddPlanButton } from '@/features/plan/add-plan-button'
import { usePlanSheet } from '@/features/plan/plan-sheet-context'
import { PlanSheetHost } from '@/features/plan/plan-sheet-host'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

const OFFLINE = "You're offline. Plans need a signal to save."
const FAILED = "Couldn't save your plan. Tap Retry."

const GYM_LOCKED: GroupActivity = {
  id: 'ga-gym',
  groupId: TEST_GROUP.id,
  presetKey: 'gym',
  customName: null,
  createdBy: 'user-2',
  lockedScheduleType: 'times_per_week',
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => toast.showToast.mockClear())
afterEach(() => setOnline(true))

async function openSheet(backend = createFakeBackend()) {
  const user = userEvent.setup()
  const result = renderRoutes(['/today'], backend)
  const add = await screen.findByRole('button', { name: 'Add a commitment or task' })
  await user.click(add)
  const dialog = await screen.findByRole('dialog', { name: 'Add a commitment or task' })
  // Presets and the start note have loaded.
  await within(dialog).findByText(
    'Starts next Monday, 23 Nov. New commitments never change this week.',
  )
  await within(dialog).findByRole('radio', { name: 'Run' })
  return { ...result, user, add, dialog }
}

function save(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: 'Save' })
}

describe('Plan sheet (add a commitment)', () => {
  it('"+ Add" opens the sheet with the commitment fields, the start note and Save', async () => {
    const { add, dialog } = await openSheet()
    expect(add).toHaveTextContent('Add')
    expect(
      within(dialog).getByRole('heading', { name: 'Add a commitment or task' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('radiogroup', { name: 'Activity' })).toBeInTheDocument()
    const schedule = within(dialog).getByRole('radiogroup', { name: 'Schedule' })
    expect(within(schedule).getByRole('radio', { name: 'Fixed days' })).toBeChecked()
    expect(within(schedule).getByRole('radio', { name: 'Times per week' })).not.toBeChecked()
    expect(within(dialog).getByRole('group', { name: 'Days' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('End date (optional)')).toHaveAttribute(
      'min',
      '2026-11-29',
    )
    expect(within(dialog).getByText('No end date')).toBeInTheDocument()
    expect(save(dialog)).toBeInTheDocument()
  })

  it('Times per week shows the Stepper at 3', async () => {
    const { user, dialog } = await openSheet()
    await user.click(within(dialog).getByRole('radio', { name: 'Times per week' }))
    expect(within(dialog).queryByRole('group', { name: 'Days' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Times per week' })).toHaveTextContent(
      '3 times per week',
    )
  })

  it('Save with nothing picked: both Field errors, focus on the first, each clears once valid', async () => {
    const { user, dialog, backend } = await openSheet()
    await user.click(save(dialog))
    const alerts = within(dialog).getAllByRole('alert')
    expect(alerts.map((a) => a.textContent)).toEqual([
      'Pick an activity.',
      'Pick at least one day.',
    ])
    const activityGroup = within(dialog).getByRole('radiogroup', { name: 'Activity' })
    expect(activityGroup).toHaveAccessibleDescription('Pick an activity.')
    expect(activityGroup).toHaveAttribute('aria-invalid', 'true')
    const daysGroup = within(dialog).getByRole('group', { name: 'Days' })
    expect(daysGroup).toHaveAccessibleDescription('Pick at least one day.')
    expect(daysGroup).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() =>
      expect(within(dialog).getAllByRole('radio', { name: 'Gym' })[0]).toHaveFocus(),
    )
    expect(backend.addCommitment).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    expect(within(dialog).queryByText('Pick an activity.')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Pick at least one day.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Wednesday' }))
    expect(within(dialog).queryByText('Pick at least one day.')).not.toBeInTheDocument()
  })

  it('an end date before the first Sunday is a Field error with the real date', async () => {
    const { user, dialog } = await openSheet()
    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    await user.click(within(dialog).getByRole('button', { name: 'Monday' }))
    const endDate = within(dialog).getByLabelText('End date (optional)')
    fireEvent.change(endDate, { target: { value: '2026-11-25' } })
    expect(within(dialog).getByText('Wed 25 Nov')).toBeInTheDocument()
    await user.click(save(dialog))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'End date has to be on or after Sun 29 Nov.',
    )
    await waitFor(() => expect(endDate).toHaveFocus())
    fireEvent.change(endDate, { target: { value: '2026-11-29' } })
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a valid save: Saving…, repeat taps ignored, toast with the real date, closed, focus back on Add', async () => {
    const backend = createFakeBackend()
    let finish: () => void = () => {}
    const original = backend.addCommitment
    vi.mocked(backend.addCommitment).mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          finish = () => resolve(original(input))
        }),
    )
    const { user, dialog, add } = await openSheet(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Gym' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Times per week' }))
    await user.click(within(dialog).getByRole('button', { name: 'More' }))
    await user.click(save(dialog))
    const busy = within(dialog).getByRole('button', { name: 'Saving…' })
    await user.click(busy)
    await user.click(busy)
    expect(backend.addCommitment).toHaveBeenCalledTimes(1)
    expect(backend.addCommitment).toHaveBeenCalledWith({
      groupId: TEST_GROUP.id,
      activity: { kind: 'preset', presetKey: 'gym' },
      scheduleType: 'times_per_week',
      days: null,
      target: 4,
      endDate: null,
    })
    finish()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toast.showToast).toHaveBeenCalledWith('Gym added · starts Mon 23 Nov.')
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('fixed days sends the sorted days and the end date', async () => {
    const { user, dialog, backend } = await openSheet()
    await user.click(within(dialog).getByRole('radio', { name: 'Study' }))
    await user.click(within(dialog).getByRole('button', { name: 'Friday' }))
    await user.click(within(dialog).getByRole('button', { name: 'Monday' }))
    fireEvent.change(within(dialog).getByLabelText('End date (optional)'), {
      target: { value: '2026-12-20' },
    })
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.addCommitment).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleType: 'fixed_days',
        days: [1, 5],
        target: null,
        endDate: '2026-12-20',
      }),
    )
  })

  it('a locked activity shows only its segment, the lock note, and sends the locked type', async () => {
    const backend = createFakeBackend(undefined, {
      groupActivities: { [TEST_GROUP.id]: [GYM_LOCKED] },
    })
    const { user, dialog } = await openSheet(backend)
    await user.click(within(dialog).getAllByRole('radio', { name: 'Gym, times per week' })[0]!)
    const schedule = within(dialog).getByRole('radiogroup', { name: 'Schedule' })
    expect(within(schedule).getAllByRole('radio')).toHaveLength(1)
    expect(within(schedule).getByRole('radio', { name: 'Times per week' })).toBeChecked()
    expect(schedule).toHaveAccessibleDescription('Gym is times per week in this group.')
    expect(within(dialog).getByRole('group', { name: 'Times per week' })).toBeInTheDocument()
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.addCommitment).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleType: 'times_per_week', target: 3, days: null }),
    )
  })

  it('a short last week shows the pro-rated note from plan_preview', async () => {
    const { user, dialog } = await openSheet()
    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Times per week' }))
    fireEvent.change(within(dialog).getByLabelText('End date (optional)'), {
      target: { value: '2026-12-04' },
    })
    expect(
      await within(dialog).findByText('Last week is short: 2 times instead of 3.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Clear end date' }))
    expect(within(dialog).queryByText(/Last week is short/)).not.toBeInTheDocument()
  })

  it('schedule_type_locked from the server: the lock note under Schedule and a refetch', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('schedule_type_locked'))
    const { user, dialog } = await openSheet(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Gym' }))
    await user.click(within(dialog).getByRole('button', { name: 'Tuesday' }))
    const before = vi.mocked(backend.listGroupActivities).mock.calls.length
    await user.click(save(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Gym is times per week in this group.',
    )
    const schedule = within(dialog).getByRole('radiogroup', { name: 'Schedule' })
    expect(within(schedule).getAllByRole('radio')).toHaveLength(1)
    await waitFor(() =>
      expect(vi.mocked(backend.listGroupActivities).mock.calls.length).toBeGreaterThan(before),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('offline: Inline retry with inputs kept; Retry re-sends the same request', async () => {
    const { user, dialog, backend } = await openSheet()
    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    await user.click(within(dialog).getByRole('button', { name: 'Thursday' }))
    setOnline(false)
    await user.click(save(dialog))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(OFFLINE)
    expect(backend.addCommitment).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('radio', { name: 'Run' })).toBeChecked()

    setOnline(true)
    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('unknown'))
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByText(FAILED)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.addCommitment).toHaveBeenCalledTimes(2)
    expect(vi.mocked(backend.addCommitment).mock.calls[0]).toEqual(
      vi.mocked(backend.addCommitment).mock.calls[1],
    )
    expect(toast.showToast).toHaveBeenCalledWith('Run added · starts Mon 23 Nov.')
  })

  it('a request that never got a response reads as offline', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('network'))
    const { user, dialog } = await openSheet(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    await user.click(within(dialog).getByRole('button', { name: 'Thursday' }))
    await user.click(save(dialog))
    expect(await within(dialog).findByText(OFFLINE)).toBeInTheDocument()
  })

  it('closing with unsaved input asks "Discard this?"; Discard closes and focus returns to Add', async () => {
    const { user, dialog, add } = await openSheet()
    await user.click(within(dialog).getByRole('button', { name: 'Saturday' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(within(dialog).getByText('Discard this?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }))
    expect(within(dialog).getByRole('button', { name: 'Saturday, selected' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('closing an untouched sheet needs no confirm', async () => {
    const { user, dialog } = await openSheet()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('invalid_end_date from the server: End date Field error, invalid, focused, no Retry', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('invalid_end_date'))
    const { user, dialog } = await openSheet(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    await user.click(within(dialog).getByRole('button', { name: 'Monday' }))
    const endDate = within(dialog).getByLabelText('End date (optional)')
    fireEvent.change(endDate, { target: { value: '2026-12-20' } })
    await user.click(save(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Pick a later end date.')
    expect(endDate).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(endDate).toHaveFocus())
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    // Editing another field keeps the server's end-date error while the date is unchanged.
    await user.click(within(dialog).getByRole('button', { name: 'Tuesday' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick a later end date.')
  })

  it('an edit after a failed save clears the Inline retry', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('unknown'))
    const { user, dialog } = await openSheet(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    await user.click(within(dialog).getByRole('button', { name: 'Monday' }))
    await user.click(save(dialog))
    expect(await within(dialog).findByText(FAILED)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Friday' }))
    expect(within(dialog).queryByText(FAILED)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('an RPC failure without a field of its own reads as the generic failure', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.addCommitment).mockRejectedValueOnce(new BackendError('not_member'))
    const { user, dialog } = await openSheet(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Run' }))
    await user.click(within(dialog).getByRole('button', { name: 'Monday' }))
    await user.click(save(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(FAILED)
  })
})

const TASK: TaskDetails = {
  commitmentId: 'task-1',
  groupId: TEST_GROUP.id,
  presetKey: 'groceries',
  customName: null,
  name: 'Grocery run',
  deadline: '2026-11-22',
  canDelete: true,
  canRename: true,
}

async function openTaskMode(backend = createFakeBackend()) {
  const opened = await openSheet(backend)
  await opened.user.click(within(opened.dialog).getByRole('radio', { name: 'Task' }))
  await within(opened.dialog).findByRole('radio', { name: 'Sunday' })
  return opened
}

describe('Plan sheet (add a task)', () => {
  it('an unlabeled Commitment / Task switch sits on top, Commitment selected; arrow keys switch', async () => {
    const { user, dialog } = await openSheet()
    const kind = within(dialog).getByRole('radiogroup', { name: 'Commitment or task' })
    expect(kind).not.toHaveAttribute('aria-labelledby')
    expect(within(dialog).queryByText('Commitment or task')).not.toBeInTheDocument()
    const commitment = within(kind).getByRole('radio', { name: 'Commitment' })
    expect(commitment).toBeChecked()
    expect(within(kind).getByRole('radio', { name: 'Task' })).not.toBeChecked()
    // The switch comes before every field.
    expect(
      kind.compareDocumentPosition(within(dialog).getByRole('radiogroup', { name: 'Activity' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    commitment.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(kind).getByRole('radio', { name: 'Task' })).toBeChecked()
    expect(within(kind).getByRole('radio', { name: 'Task' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(commitment).toBeChecked()
  })

  it('Task mode: Activity, Name, Deadline from today to Sunday (default Sunday) and the note', async () => {
    const { dialog } = await openTaskMode()
    expect(within(dialog).getByRole('radiogroup', { name: 'Activity' })).toBeInTheDocument()
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    expect(name).toHaveAttribute('placeholder', 'Grocery run')
    expect(name).toHaveAttribute('maxlength', '40')
    const deadline = within(dialog).getByRole('radiogroup', { name: 'Deadline' })
    expect(
      within(deadline)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(['Today', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    expect(within(deadline).getByRole('radio', { name: 'Sunday' })).toBeChecked()
    expect(within(deadline).getByText('Today')).toBeInTheDocument()
    expect(within(dialog).getByText('Counts this week, starting now.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('radiogroup', { name: 'Schedule' })).not.toBeInTheDocument()
    // The Commitment form stays mounted (input survives a switch) but hidden.
    expect(within(dialog).getByLabelText('End date (optional)')).not.toBeVisible()
    expect(within(dialog).getByText(/Starts next Monday/)).not.toBeVisible()
  })

  it('on a Sunday only "Today" shows', async () => {
    const backend = createFakeBackend(undefined, {
      planPreview: {
        memberToday: '2026-11-22',
        weekStart: '2026-11-16',
        weekEnd: '2026-11-22',
        startsOn: '2026-11-23',
        minEndDate: '2026-11-29',
      },
    })
    const user = userEvent.setup()
    renderRoutes(['/today'], backend)
    await user.click(await screen.findByRole('button', { name: 'Add a commitment or task' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a commitment or task' })
    await user.click(within(dialog).getByRole('radio', { name: 'Task' }))
    const deadline = await within(dialog).findByRole('radiogroup', { name: 'Deadline' })
    await within(deadline).findByRole('radio', { name: 'Today' })
    expect(within(deadline).getAllByRole('radio')).toHaveLength(1)
    expect(within(deadline).getByRole('radio', { name: 'Today' })).toBeChecked()
  })

  it('Save with nothing: "Pick an activity." and "Give the task a short name.", focus on the first', async () => {
    const { user, dialog, backend } = await openTaskMode()
    await user.click(save(dialog))
    expect(
      within(dialog)
        .getAllByRole('alert')
        .map((a) => a.textContent),
    ).toEqual(['Pick an activity.', 'Give the task a short name.'])
    await waitFor(() =>
      expect(within(dialog).getAllByRole('radio', { name: 'Gym' })[0]).toHaveFocus(),
    )
    expect(backend.addTask).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('radio', { name: 'Groceries' }))
    expect(within(dialog).queryByText('Pick an activity.')).not.toBeInTheDocument()
    await user.click(save(dialog))
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAccessibleDescription('Give the task a short name.')
    await user.type(name, '   ')
    expect(within(dialog).getByText('Give the task a short name.')).toBeInTheDocument()
    await user.type(name, 'Milk')
    expect(within(dialog).queryByText('Give the task a short name.')).not.toBeInTheDocument()
  })

  it('a valid save: the picked deadline, then closed with "Grocery run added · counts this week."', async () => {
    const { user, dialog, backend, add } = await openTaskMode()
    await user.click(within(dialog).getByRole('radio', { name: 'Groceries' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '  Grocery run ')
    await user.click(within(dialog).getByRole('radio', { name: 'Friday' }))
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.addTask).toHaveBeenCalledWith({
      groupId: TEST_GROUP.id,
      activity: { kind: 'preset', presetKey: 'groceries' },
      name: 'Grocery run',
      deadline: '2026-11-20',
    })
    expect(backend.addCommitment).not.toHaveBeenCalled()
    expect(toast.showToast).toHaveBeenCalledWith('Grocery run added · counts this week.')
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('the default deadline is Sunday; a task to a locked activity is allowed', async () => {
    const backend = createFakeBackend(undefined, {
      groupActivities: { [TEST_GROUP.id]: [GYM_LOCKED] },
    })
    const { user, dialog } = await openTaskMode(backend)
    await user.click(within(dialog).getAllByRole('radio', { name: 'Gym, times per week' })[0]!)
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Leg day')
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.addTask).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Leg day', deadline: '2026-11-22' }),
    )
  })

  it('offline: the Plan sheet Inline retry with inputs kept; Retry sends', async () => {
    const { user, dialog, backend } = await openTaskMode()
    await user.click(within(dialog).getByRole('radio', { name: 'Groceries' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Grocery run')
    setOnline(false)
    await user.click(save(dialog))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(OFFLINE)
    expect(backend.addTask).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Grocery run')
    setOnline(true)
    vi.mocked(backend.addTask).mockRejectedValueOnce(new BackendError('unknown'))
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByText(FAILED)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.addTask).toHaveBeenCalledTimes(2)
  })

  it('invalid_deadline from the server: a Deadline Field error, focused', async () => {
    const backend = createFakeBackend()
    vi.mocked(backend.addTask).mockRejectedValueOnce(new BackendError('invalid_deadline'))
    const { user, dialog } = await openTaskMode(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Groceries' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Grocery run')
    await user.click(save(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Pick a deadline from today to Sunday.',
    )
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: 'Sunday' })).toHaveFocus())
  })

  it('switching Task, Commitment, Task keeps the typed name; either form makes the sheet dirty', async () => {
    const { user, dialog } = await openTaskMode()
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Grocery run')
    await user.click(within(dialog).getByRole('radio', { name: 'Commitment' }))
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('radiogroup', { name: 'Schedule' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('radio', { name: 'Task' }))
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Grocery run')
    await user.click(within(dialog).getByRole('radio', { name: 'Commitment' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(within(dialog).getByText('Discard this?')).toBeInTheDocument()
  })

  it("a picked day that leaves the server's days is cleared with the Deadline error, not swapped", async () => {
    const backend = createFakeBackend()
    const { user, dialog, queryClient } = await openTaskMode(backend)
    await user.click(within(dialog).getByRole('radio', { name: 'Groceries' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Grocery run')
    await user.click(within(dialog).getByRole('radio', { name: 'Thursday' }))
    // The member's day rolls over to Friday.
    vi.mocked(backend.planPreview).mockResolvedValue({
      ...TEST_PLAN_PREVIEW,
      memberToday: '2026-11-20',
    })
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    const deadline = within(dialog).getByRole('radiogroup', { name: 'Deadline' })
    await waitFor(() =>
      expect(within(deadline).queryByRole('radio', { name: 'Thursday' })).not.toBeInTheDocument(),
    )
    expect(within(deadline).queryAllByRole('radio', { checked: true })).toHaveLength(0)
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Pick a deadline from today to Sunday.',
    )
    await user.click(save(dialog))
    expect(backend.addTask).not.toHaveBeenCalled()
    await user.click(within(deadline).getByRole('radio', { name: 'Saturday' }))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(save(dialog))
    await waitFor(() =>
      expect(backend.addTask).toHaveBeenCalledWith(
        expect.objectContaining({ deadline: '2026-11-21' }),
      ),
    )
  })

  it('closing with a typed name asks "Discard this?"; an untouched Task mode does not', async () => {
    const { user, dialog } = await openTaskMode()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const again = await openTaskMode()
    await again.user.type(within(again.dialog).getByRole('textbox', { name: 'Name' }), 'G')
    await again.user.click(within(again.dialog).getByRole('button', { name: 'Close' }))
    expect(within(again.dialog).getByText('Discard this?')).toBeInTheDocument()
  })
})

function EditOpener({
  commitmentId,
  kind = 'task',
}: {
  commitmentId: string
  kind?: 'commitment' | 'task'
}) {
  const { openPlanSheet } = usePlanSheet()
  return (
    <button type="button" onClick={() => openPlanSheet({ mode: 'edit', commitmentId, kind })}>
      Edit
    </button>
  )
}

async function openEdit(
  task: TaskDetails = TASK,
  backend = createFakeBackend(undefined, { tasks: [task] }),
) {
  const user = userEvent.setup()
  render(
    withBackend(
      backend,
      <PlanSheetHost groupId={TEST_GROUP.id}>
        <EditOpener commitmentId={task.commitmentId} />
        <AddPlanButton />
      </PlanSheetHost>,
    ),
  )
  const opener = screen.getByRole('button', { name: 'Edit' })
  await user.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
  await within(dialog).findByText('Groceries')
  return { user, dialog, backend, opener }
}

describe('Plan sheet (task edit mode)', () => {
  it('hides the switch, shows activity and deadline read-only and the Name to edit', async () => {
    const { dialog } = await openEdit()
    expect(
      within(dialog).queryByRole('radiogroup', { name: 'Commitment or task' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('radiogroup', { name: 'Activity' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('radiogroup', { name: 'Deadline' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Groceries')).toBeInTheDocument()
    expect(within(dialog).getByText('Sun 22 Nov')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Grocery run')
  })

  it('"Delete task" shows only while the server says can_delete', async () => {
    const { dialog } = await openEdit()
    expect(within(dialog).getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
    cleanup()
    const due = await openEdit({ ...TASK, canDelete: false })
    expect(
      within(due.dialog).queryByRole('button', { name: 'Delete task' }),
    ).not.toBeInTheDocument()
  })

  it('Save renames through rename_task and closes', async () => {
    const { user, dialog, backend } = await openEdit()
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.click(save(dialog))
    await waitFor(() => expect(name).toHaveFocus())
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the task a short name.')
    await user.type(name, ' Big shop ')
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.renameTask).toHaveBeenCalledWith('task-1', 'Big shop')
  })

  it('task_locked on rename shows its copy without Retry', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    vi.mocked(backend.renameTask).mockRejectedValueOnce(new BackendError('task_locked'))
    const { user, dialog } = await openEdit(TASK, backend)
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), '!')
    await user.click(save(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "This task's deadline has passed. It can't change now.",
    )
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('after the session ended (can_rename false) the name is read-only and there is no Save', async () => {
    const { dialog } = await openEdit({ ...TASK, canDelete: false, canRename: false })
    expect(within(dialog).queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Grocery run')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument()
  })

  it('invalid_plan on rename focuses Name with its error', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    vi.mocked(backend.renameTask).mockRejectedValueOnce(new BackendError('invalid_plan'))
    const { user, dialog } = await openEdit(TASK, backend)
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await user.type(name, '!')
    name.blur()
    await user.click(save(dialog))
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAccessibleDescription('Give the task a short name.')
  })

  it('a failed load shows "Couldn\'t load this task. Tap Retry." and Retry refetches', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    // The read retries once by itself before showing the failure.
    vi.mocked(backend.getTask)
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockRejectedValueOnce(new BackendError('unknown'))
    const user = userEvent.setup()
    render(
      withBackend(
        backend,
        <PlanSheetHost groupId={TEST_GROUP.id}>
          <EditOpener commitmentId={TASK.commitmentId} />
        </PlanSheetHost>,
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(
      await within(dialog).findByText("Couldn't load this task. Tap Retry.", {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByRole('textbox', { name: 'Name' })).toHaveValue('Grocery run')
  })

  it('"Delete task" replaces the sheet with the confirm; Delete task deletes and returns to Today', async () => {
    const { user, dialog, backend, opener } = await openEdit()
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Grocery run?' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(within(confirm).getByText("It comes off this week's plan.")).toBeInTheDocument()
    // One coral button; the close is the cancel.
    expect(within(confirm).getAllByRole('button')).toHaveLength(2)
    expect(within(confirm).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.deleteTask).toHaveBeenCalledWith('task-1')
    // The deleted task's row (the opener) is about to go: focus lands on "+ Add".
    expect(opener).not.toHaveFocus()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add a commitment or task' })).toHaveFocus(),
    )
  })

  it('closing the confirm cancels and returns to Today, not to the edit sheet', async () => {
    const { user, dialog, backend } = await openEdit()
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Grocery run?' })
    await user.click(within(confirm).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.deleteTask).not.toHaveBeenCalled()
  })

  it('task_locked on delete: "Too late to delete. Its day has started." without Retry', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    vi.mocked(backend.deleteTask).mockRejectedValueOnce(new BackendError('task_locked'))
    const { user, dialog } = await openEdit(TASK, backend)
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Grocery run?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Too late to delete. Its day has started.',
    )
    expect(within(confirm).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Delete Grocery run?' })).toBeInTheDocument()
  })

  it('not_found on delete: "That\'s not on your plan anymore." without Retry', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    vi.mocked(backend.deleteTask).mockRejectedValueOnce(new BackendError('not_found'))
    const { user, dialog } = await openEdit(TASK, backend)
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Grocery run?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      "That's not on your plan anymore.",
    )
    expect(within(confirm).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('a failed delete shows the generic copy; Retry sends again', async () => {
    const backend = createFakeBackend(undefined, { tasks: [TASK] })
    vi.mocked(backend.deleteTask).mockRejectedValueOnce(new BackendError('unknown'))
    const { user, dialog } = await openEdit(TASK, backend)
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Grocery run?' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(FAILED)
    await user.click(within(confirm).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.deleteTask).toHaveBeenCalledTimes(2)
  })

  it('offline on delete: the Plan sheet offline copy with Retry', async () => {
    const { user, dialog, backend } = await openEdit()
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete Grocery run?' })
    setOnline(false)
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))
    expect(within(confirm).getByRole('alert')).toHaveTextContent(OFFLINE)
    expect(backend.deleteTask).not.toHaveBeenCalled()
    setOnline(true)
    await user.click(within(confirm).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.deleteTask).toHaveBeenCalledWith('task-1')
  })

  it('a task that is gone reads as not found', async () => {
    const user = userEvent.setup()
    render(
      withBackend(
        createFakeBackend(),
        <PlanSheetHost groupId={TEST_GROUP.id}>
          <EditOpener commitmentId="nope" />
        </PlanSheetHost>,
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "That's not on your plan anymore.",
    )
  })
})

async function openCommitmentEdit(
  commitment: CommitmentDetails = TEST_COMMITMENT,
  backend = createFakeBackend(undefined, { commitments: [commitment] }),
) {
  const user = userEvent.setup()
  render(
    withBackend(
      backend,
      <PlanSheetHost groupId={TEST_GROUP.id}>
        <EditOpener commitmentId={commitment.commitmentId} kind="commitment" />
        <AddPlanButton />
      </PlanSheetHost>,
    ),
  )
  const opener = screen.getByRole('button', { name: 'Edit' })
  await user.click(opener)
  const dialog = await screen.findByRole('dialog', { name: 'Edit commitment' })
  await within(dialog).findByText('Changes start Mon 23 Nov.')
  return { user, dialog, backend, opener }
}

const STUDY_FIXED: CommitmentDetails = {
  ...TEST_COMMITMENT,
  commitmentId: 'c-study',
  presetKey: 'study',
  activityName: 'Study',
  scheduleType: 'fixed_days',
  days: [1, 3],
  target: null,
  endDate: '2026-12-20',
}

const WRAPPED_UP = "That's already wrapped up."

describe('Plan sheet (commitment edit mode)', () => {
  it('hides the switch, activity read-only, only the locked type with its note, the real start note', async () => {
    const { dialog } = await openCommitmentEdit()
    expect(
      within(dialog).queryByRole('radiogroup', { name: 'Commitment or task' }),
    ).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('radiogroup', { name: 'Activity' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Gym')).toBeInTheDocument()
    const schedule = within(dialog).getByRole('radiogroup', { name: 'Schedule' })
    expect(within(schedule).getAllByRole('radio')).toHaveLength(1)
    expect(within(schedule).getByRole('radio', { name: 'Times per week' })).toBeChecked()
    expect(schedule).toHaveAccessibleDescription(
      "Schedule type can't change while this commitment is active. End it and add a new one.",
    )
    expect(within(dialog).getByRole('group', { name: 'Times per week' })).toHaveTextContent(
      '3 times per week',
    )
    expect(within(dialog).getByText('Changes start Mon 23 Nov.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'End commitment' })).toBeInTheDocument()
  })

  it('Save sends update_commitment and shows "Gym changes to 4 times per week from Mon 23 Nov."', async () => {
    const { user, dialog, backend, opener } = await openCommitmentEdit()
    await user.click(within(dialog).getByRole('button', { name: 'More' }))
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.updateCommitment).toHaveBeenCalledWith({
      commitmentId: 'c-gym',
      days: null,
      target: 4,
      endDate: null,
    })
    expect(toast.showToast).toHaveBeenCalledWith('Gym changes to 4 times per week from Mon 23 Nov.')
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('fixed days: days and end date start from the latest version; the toast names the days', async () => {
    const { user, dialog, backend } = await openCommitmentEdit(STUDY_FIXED)
    expect(within(dialog).getByText('Sun 20 Dec')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Friday' }))
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.updateCommitment).toHaveBeenCalledWith({
      commitmentId: 'c-study',
      days: [1, 3, 5],
      target: null,
      endDate: '2026-12-20',
    })
    expect(toast.showToast).toHaveBeenCalledWith('Study changes to Mon Wed Fri from Mon 23 Nov.')
  })

  it('no days or an early end date: Field errors, nothing sent', async () => {
    const { user, dialog, backend } = await openCommitmentEdit(STUDY_FIXED)
    await user.click(within(dialog).getByRole('button', { name: 'Monday, selected' }))
    await user.click(within(dialog).getByRole('button', { name: 'Wednesday, selected' }))
    fireEvent.change(within(dialog).getByLabelText('End date (optional)'), {
      target: { value: '2026-11-25' },
    })
    await user.click(save(dialog))
    expect(
      within(dialog)
        .getAllByRole('alert')
        .map((a) => a.textContent),
    ).toEqual(['Pick at least one day.', 'End date has to be on or after Sun 29 Nov.'])
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Monday' })).toHaveFocus(),
    )
    expect(backend.updateCommitment).not.toHaveBeenCalled()
  })

  it('an unchanged Save just closes', async () => {
    const { user, dialog, backend } = await openCommitmentEdit()
    await user.click(save(dialog))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.updateCommitment).not.toHaveBeenCalled()
  })

  it('offline: the Plan sheet Inline retry with inputs kept; Retry re-sends', async () => {
    const { user, dialog, backend } = await openCommitmentEdit()
    await user.click(within(dialog).getByRole('button', { name: 'Fewer' }))
    setOnline(false)
    await user.click(save(dialog))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(OFFLINE)
    expect(within(dialog).getByRole('group', { name: 'Times per week' })).toHaveTextContent(
      '2 times per week',
    )
    expect(backend.updateCommitment).not.toHaveBeenCalled()
    setOnline(true)
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.updateCommitment).toHaveBeenCalledWith(expect.objectContaining({ target: 2 }))
  })

  it('a failed save shows the generic copy; commitment_ended shows the wrapped-up copy without Retry', async () => {
    const backend = createFakeBackend(undefined, { commitments: [TEST_COMMITMENT] })
    vi.mocked(backend.updateCommitment)
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockRejectedValueOnce(new BackendError('commitment_ended'))
    const { user, dialog } = await openCommitmentEdit(TEST_COMMITMENT, backend)
    await user.click(within(dialog).getByRole('button', { name: 'More' }))
    await user.click(save(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(FAILED)
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByText(WRAPPED_UP)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('invalid_end_date from the server: the End date Field error, focused', async () => {
    const backend = createFakeBackend(undefined, { commitments: [TEST_COMMITMENT] })
    vi.mocked(backend.updateCommitment).mockRejectedValueOnce(new BackendError('invalid_end_date'))
    const { user, dialog } = await openCommitmentEdit(TEST_COMMITMENT, backend)
    const endDate = within(dialog).getByLabelText('End date (optional)')
    fireEvent.change(endDate, { target: { value: '2026-12-06' } })
    await user.click(save(dialog))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'End date has to be on or after Sun 29 Nov.',
    )
    await waitFor(() => expect(endDate).toHaveFocus())
  })

  it('closing with a change asks "Discard this?"', async () => {
    const { user, dialog } = await openCommitmentEdit()
    await user.click(within(dialog).getByRole('button', { name: 'More' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(within(dialog).getByText('Discard this?')).toBeInTheDocument()
  })

  it('an ending commitment, or a task id, closes the sheet with the wrapped-up toast', async () => {
    const user = userEvent.setup()
    render(
      withBackend(
        createFakeBackend(undefined, {
          commitments: [{ ...TEST_COMMITMENT, state: 'ending', canEdit: false }],
        }),
        <PlanSheetHost groupId={TEST_GROUP.id}>
          <EditOpener commitmentId="c-gym" kind="commitment" />
          <EditOpener commitmentId="task-1" kind="commitment" />
        </PlanSheetHost>,
      ),
    )
    const [ending, task] = screen.getAllByRole('button', { name: 'Edit' })
    await user.click(ending!)
    await waitFor(() => expect(toast.showToast).toHaveBeenCalledWith(WRAPPED_UP))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    toast.showToast.mockClear()
    // A task id opened as a commitment: get_commitment answers not_found.
    await user.click(task!)
    await waitFor(() => expect(toast.showToast).toHaveBeenCalledWith(WRAPPED_UP))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('"End commitment" swaps in the confirm; End ends it and returns to the screen', async () => {
    const { user, dialog, backend, opener } = await openCommitmentEdit()
    await user.click(within(dialog).getByRole('button', { name: 'End commitment' }))
    const confirm = await screen.findByRole('dialog', { name: 'End Gym?' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(
      within(confirm).getByText('It stops after this Sunday. Past check-ins stay in the Feed.'),
    ).toBeInTheDocument()
    // One coral button; the close is the cancel.
    expect(within(confirm).getAllByRole('button')).toHaveLength(2)
    await user.click(within(confirm).getByRole('button', { name: 'End' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.endCommitment).toHaveBeenCalledWith('c-gym')
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('closing the End confirm cancels; offline and commitment_ended show Inline retry copy', async () => {
    const backend = createFakeBackend(undefined, { commitments: [TEST_COMMITMENT] })
    const { user, dialog } = await openCommitmentEdit(TEST_COMMITMENT, backend)
    await user.click(within(dialog).getByRole('button', { name: 'End commitment' }))
    let confirm = await screen.findByRole('dialog', { name: 'End Gym?' })
    await user.click(within(confirm).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.endCommitment).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const again = await screen.findByRole('dialog', { name: 'Edit commitment' })
    await user.click(await within(again).findByRole('button', { name: 'End commitment' }))
    confirm = await screen.findByRole('dialog', { name: 'End Gym?' })
    setOnline(false)
    await user.click(within(confirm).getByRole('button', { name: 'End' }))
    expect(within(confirm).getByRole('alert')).toHaveTextContent(OFFLINE)
    setOnline(true)
    vi.mocked(backend.endCommitment).mockRejectedValueOnce(new BackendError('commitment_ended'))
    await user.click(within(confirm).getByRole('button', { name: 'Retry' }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(WRAPPED_UP)
    expect(within(confirm).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})
