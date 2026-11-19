import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GroupActivity } from '@/domain/activities'
import { BackendError } from '@/domain/error-codes'
import { createFakeBackend, renderRoutes, TEST_GROUP } from '@/test/fake-backend'

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
})
