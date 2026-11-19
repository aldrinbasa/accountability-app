import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_PROFILE } from '@/test/fake-backend'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'

const MEMBER_NOTE = 'Your sessions follow this zone. Changes start next week.'
const GROUP_NOTE = 'Sets the week lock and winner for everyone. Changes start next week.'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

afterEach(() => {
  // Sonner keeps toasts in a module store; drop them so the next test's Toaster starts empty.
  dismissToast()
  setOnline(true)
  vi.restoreAllMocks()
})

async function openSettings(backend = createFakeBackend()) {
  render(<Toaster />)
  const result = renderRoutes(['/me/settings?g=group-1'], backend)
  return { ...result, row: await screen.findByRole('button', { name: /^Time zone/ }) }
}

async function pick(user: ReturnType<typeof userEvent.setup>, search: string, label: string) {
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Search time zones'), search)
  await user.click(within(dialog).getByRole('button', { name: label }))
}

describe('Me > Settings: Time zone', () => {
  it('the row shows the current zone and opens the searchable picker with the note', async () => {
    const user = userEvent.setup()
    const { row } = await openSettings()
    expect(row).toHaveAccessibleName('Time zone, Manila · Asia')

    await user.click(row)
    const dialog = await screen.findByRole('dialog', { name: 'Time zone' })
    expect(dialog).toHaveAccessibleDescription(MEMBER_NOTE)
    const search = within(dialog).getByLabelText('Search time zones')
    expect(search).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Manila · Asia' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(dialog).getAllByRole('button').length).toBeGreaterThan(100)

    await user.type(search, 'new york')
    expect(
      within(dialog)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label') !== 'Close')
        .map((b) => b.textContent),
    ).toEqual(['New York · America'])

    await user.clear(search)
    await user.type(search, 'Mars')
    expect(within(dialog).getByText('No time zone matches that.')).toBeInTheDocument()
  })

  it('one tap saves and closes; the row shows the new zone "from Mon 23 Nov"', async () => {
    const user = userEvent.setup()
    const { row, backend } = await openSettings()
    await user.click(row)
    await pick(user, 'london', 'London · Europe')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(backend.setTimeZone).toHaveBeenCalledWith('Europe/London')
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, Manila · Asia, changes to London · Europe from Mon 23 Nov',
      ),
    )
  })

  it('a waiting change shows under the row and is the checked zone in the picker', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, {
      profile: {
        ...TEST_PROFILE,
        pendingTimeZone: 'Europe/London',
        pendingWeekStart: '2026-11-23',
      },
    })
    const { row } = await openSettings(backend)
    expect(row).toHaveAccessibleName(
      'Time zone, Manila · Asia, changes to London · Europe from Mon 23 Nov',
    )

    await user.click(row)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Search time zones'), 'london')
    expect(within(dialog).getByRole('button', { name: 'London · Europe' })).toHaveAttribute(
      'aria-current',
      'true',
    )

    // Back to the current zone clears the waiting change.
    await user.clear(within(dialog).getByLabelText('Search time zones'))
    await user.type(within(dialog).getByLabelText('Search time zones'), 'manila')
    await user.click(within(dialog).getByRole('button', { name: 'Manila · Asia' }))
    expect(backend.setTimeZone).toHaveBeenCalledWith('Asia/Manila')
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, Manila · Asia',
      ),
    )
  })

  it('offline: nothing is sent, the row keeps its zone and the offline toast shows', async () => {
    const user = userEvent.setup()
    const { row, backend } = await openSettings()
    await user.click(row)
    setOnline(false)
    await pick(user, 'london', 'London · Europe')

    expect(await screen.findByText("Couldn't save. You're offline.")).toBeInTheDocument()
    expect(backend.setTimeZone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
      'Time zone, Manila · Asia',
    )
  })

  it('no response: the row reverts and the offline toast shows', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    backend.setTimeZone = vi.fn().mockRejectedValue(new BackendError('network'))
    const { row } = await openSettings(backend)
    await user.click(row)
    await pick(user, 'london', 'London · Europe')

    expect(await screen.findByText("Couldn't save. You're offline.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
      'Time zone, Manila · Asia',
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('another failure: the row reverts, the error toast has Retry, and Retry saves', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    const set = backend.setTimeZone
    backend.setTimeZone = vi
      .fn()
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockImplementation(set) as typeof backend.setTimeZone
    const { row } = await openSettings(backend)
    await user.click(row)
    await pick(user, 'london', 'London · Europe')

    expect(await screen.findByText("Couldn't save your time zone.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
      'Time zone, Manila · Asia',
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(backend.setTimeZone).toHaveBeenCalledTimes(2)
    expect(backend.setTimeZone).toHaveBeenLastCalledWith('Europe/London')
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, Manila · Asia, changes to London · Europe from Mon 23 Nov',
      ),
    )
    // The successful save dismisses the failure toast, so its Retry cannot run again later.
    await vi.waitFor(() =>
      expect(screen.queryByText("Couldn't save your time zone.")).not.toBeInTheDocument(),
    )
  })

  it.each(['invalid_time_zone', 'not_member'] as const)(
    'a refused save (%s): the row reverts, the error toast has no Retry',
    async (code) => {
      const user = userEvent.setup()
      const backend = createFakeBackend()
      backend.setTimeZone = vi.fn().mockRejectedValue(new BackendError(code))
      const { row } = await openSettings(backend)
      await user.click(row)
      await pick(user, 'london', 'London · Europe')

      expect(await screen.findByText("Couldn't save your time zone.")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, Manila · Asia',
      )
    },
  )
})

describe('Group settings: Group time zone', () => {
  it('an admin opens the same picker with the group note and changes the group zone', async () => {
    const user = userEvent.setup()
    render(<Toaster />)
    const backend = createFakeBackend()
    renderRoutes(['/me/groups/group-1?g=group-1'], backend)
    const row = await screen.findByRole('button', { name: /^Group time zone/ })
    expect(row).toHaveAccessibleName('Group time zone, Manila · Asia')

    await user.click(row)
    const dialog = await screen.findByRole('dialog', { name: 'Group time zone' })
    expect(dialog).toHaveAccessibleDescription(GROUP_NOTE)
    await pick(user, 'new_york', 'New York · America')

    expect(backend.setTimeZone).toHaveBeenCalledWith('America/New_York', TEST_GROUP.id)
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Group time zone/ })).toHaveAccessibleName(
        'Group time zone, Manila · Asia, changes to New York · America from Mon 23 Nov',
      ),
    )
  })

  it('a non-admin sees the zone and the note, read-only', async () => {
    const backend = createFakeBackend(undefined, {
      groups: [
        {
          ...TEST_GROUP,
          role: 'member',
          pendingTimeZone: 'Europe/London',
          pendingWeekStart: '2026-11-23',
        },
      ],
    })
    renderRoutes(['/me/groups/group-1?g=group-1'], backend)
    expect(await screen.findByText('Group time zone')).toBeInTheDocument()
    expect(screen.getByText('Manila · Asia')).toBeInTheDocument()
    expect(screen.getByText(/London · Europe from Mon 23 Nov/)).toHaveTextContent(
      'changes to London · Europe from Mon 23 Nov',
    )
    expect(screen.getByText(GROUP_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Group time zone/ })).not.toBeInTheDocument()
  })
})
