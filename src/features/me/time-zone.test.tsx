import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_PROFILE } from '@/test/fake-backend'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'

const MEMBER_NOTE = 'Your sessions follow this zone. Changes start next week.'
const TIME_ZONE_MANILA = 'GMT+8, Manila, Singapore, Hong Kong'
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

/** An option's accessible name starts with `name` and ends with its clock ("…, 14:32"). */
function option(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, \\d\\d:\\d\\d$`)
}

async function pick(user: ReturnType<typeof userEvent.setup>, search: string, name: string) {
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Search time zones'), search)
  await user.click(within(dialog).getByRole('button', { name: option(name) }))
}

describe('Me > Settings: Time zone', () => {
  it('the row shows the current zone and opens the searchable picker with the note', async () => {
    const user = userEvent.setup()
    const { row } = await openSettings()
    expect(row).toHaveAccessibleName('Time zone, GMT+8 · Manila, Singapore, Hong Kong')

    await user.click(row)
    const dialog = await screen.findByRole('dialog', { name: 'Time zone' })
    expect(dialog).toHaveAccessibleDescription(MEMBER_NOTE)
    const search = within(dialog).getByLabelText('Search time zones')
    expect(search).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: option(TIME_ZONE_MANILA) })).toHaveAttribute(
      'aria-current',
      'true',
    )
    const options = () =>
      within(dialog)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label') !== 'Close')
    expect(options()).toHaveLength(24)
    expect(options()[0]).toHaveAccessibleName(option('GMT−11, Pago Pago, Midway'))
    expect(options()[23]).toHaveAccessibleName(option('GMT+12, Auckland, Fiji'))

    await user.type(search, '+8')
    expect(options().map((b) => b.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(option(TIME_ZONE_MANILA)),
    ])
    await user.clear(search)
    await user.type(search, 'sao paulo')
    expect(options()).toHaveLength(1)
    expect(options()[0]).toHaveTextContent('GMT−3 · São Paulo, Buenos Aires')

    await user.clear(search)
    await user.type(search, 'Mars')
    expect(within(dialog).getByText('No time zone matches that.')).toBeInTheDocument()
  })

  it('one tap saves and closes; the row shows the new zone "from Mon 23 Nov"', async () => {
    const user = userEvent.setup()
    const { row, backend } = await openSettings()
    await user.click(row)
    await pick(user, 'london', 'GMT+0, London, Lisbon')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(backend.setTimeZone).toHaveBeenCalledWith('Europe/London')
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, GMT+8 · Manila, Singapore, Hong Kong, changes to GMT+0 · London, Lisbon from Mon 23 Nov',
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
      'Time zone, GMT+8 · Manila, Singapore, Hong Kong, changes to GMT+0 · London, Lisbon from Mon 23 Nov',
    )

    await user.click(row)
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Search time zones'), 'london')
    expect(within(dialog).getByRole('button', { name: /^GMT\+0, London, Lisbon/ })).toHaveAttribute(
      'aria-current',
      'true',
    )

    // Back to the current zone clears the waiting change.
    await user.clear(within(dialog).getByLabelText('Search time zones'))
    await user.type(within(dialog).getByLabelText('Search time zones'), 'manila')
    await user.click(within(dialog).getByRole('button', { name: /^GMT\+8, Manila/ }))
    expect(backend.setTimeZone).toHaveBeenCalledWith('Asia/Manila')
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, GMT+8 · Manila, Singapore, Hong Kong',
      ),
    )
  })

  it('offline: nothing is sent, the row keeps its zone and the offline toast shows', async () => {
    const user = userEvent.setup()
    const { row, backend } = await openSettings()
    await user.click(row)
    setOnline(false)
    await pick(user, 'london', 'GMT+0, London, Lisbon')

    expect(await screen.findByText("Couldn't save. You're offline.")).toBeInTheDocument()
    expect(backend.setTimeZone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
      'Time zone, GMT+8 · Manila, Singapore, Hong Kong',
    )
  })

  it('no response: the row reverts and the offline toast shows', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    backend.setTimeZone = vi.fn().mockRejectedValue(new BackendError('network'))
    const { row } = await openSettings(backend)
    await user.click(row)
    await pick(user, 'london', 'GMT+0, London, Lisbon')

    expect(await screen.findByText("Couldn't save. You're offline.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
      'Time zone, GMT+8 · Manila, Singapore, Hong Kong',
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
    await pick(user, 'london', 'GMT+0, London, Lisbon')

    expect(await screen.findByText("Couldn't save your time zone.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
      'Time zone, GMT+8 · Manila, Singapore, Hong Kong',
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(backend.setTimeZone).toHaveBeenCalledTimes(2)
    expect(backend.setTimeZone).toHaveBeenLastCalledWith('Europe/London')
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, GMT+8 · Manila, Singapore, Hong Kong, changes to GMT+0 · London, Lisbon from Mon 23 Nov',
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
      await pick(user, 'london', 'GMT+0, London, Lisbon')

      expect(await screen.findByText("Couldn't save your time zone.")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Time zone/ })).toHaveAccessibleName(
        'Time zone, GMT+8 · Manila, Singapore, Hong Kong',
      )
    },
  )
})

describe('Time zone picker clock and fallback', () => {
  afterEach(() => vi.useRealTimers())

  it('each choice shows its current local time (live DST), refreshed once a minute while open', async () => {
    // Fake only the clock and intervals: user-event and the queries keep real timeouts.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-07-15T06:32:00Z'))
    const user = userEvent.setup()
    const { row } = await openSettings()
    await user.click(row)
    const dialog = await screen.findByRole('dialog')
    const manila = within(dialog).getByRole('button', { name: /^GMT\+8, Manila/ })
    expect(manila).toHaveAccessibleName('GMT+8, Manila, Singapore, Hong Kong, 14:32')
    expect(manila).toHaveTextContent('GMT+8 · Manila, Singapore, Hong Kong14:32')
    // London is on summer time in July: 07:32, not 06:32.
    expect(within(dialog).getByRole('button', { name: /^GMT\+0, London/ })).toHaveAccessibleName(
      'GMT+0, London, Lisbon, 07:32',
    )

    act(() => {
      vi.setSystemTime(new Date('2026-07-15T06:33:00Z'))
      vi.advanceTimersByTime(60_000)
    })
    expect(within(dialog).getByRole('button', { name: /^GMT\+8, Manila/ })).toHaveAccessibleName(
      /, 14:3[34]$/,
    )
  })

  it('a zone outside the 24 shows as itself and leads the picker as "(current)"', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, {
      profile: { ...TEST_PROFILE, timeZone: 'Asia/Kolkata' },
    })
    const { row } = await openSettings(backend)
    expect(row).toHaveAccessibleName('Time zone, Kolkata · Asia')
    await user.click(row)
    const dialog = await screen.findByRole('dialog')
    const first = within(dialog)
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-label') !== 'Close')[0]
    expect(first).toHaveAccessibleName(option('Kolkata, Asia (current)'))
    expect(first).toHaveAttribute('aria-current', 'true')

    // Choosing it keeps it: nothing is sent.
    await user.click(first)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(backend.setTimeZone).not.toHaveBeenCalled()
  })
})

describe('Group settings: Group time zone', () => {
  it('an admin opens the same picker with the group note and changes the group zone', async () => {
    const user = userEvent.setup()
    render(<Toaster />)
    const backend = createFakeBackend()
    renderRoutes(['/me/groups/group-1?g=group-1'], backend)
    const row = await screen.findByRole('button', { name: /^Group time zone/ })
    expect(row).toHaveAccessibleName('Group time zone, GMT+8 · Manila, Singapore, Hong Kong')

    await user.click(row)
    const dialog = await screen.findByRole('dialog', { name: 'Group time zone' })
    expect(dialog).toHaveAccessibleDescription(GROUP_NOTE)
    await pick(user, 'new york', 'GMT−5, New York, Toronto')

    expect(backend.setTimeZone).toHaveBeenCalledWith('America/New_York', TEST_GROUP.id)
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /^Group time zone/ })).toHaveAccessibleName(
        'Group time zone, GMT+8 · Manila, Singapore, Hong Kong, changes to GMT−5 · New York, Toronto from Mon 23 Nov',
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
    expect(screen.getByText('GMT+8 · Manila, Singapore, Hong Kong')).toBeInTheDocument()
    expect(screen.getByText(/London, Lisbon from Mon 23 Nov/)).toHaveTextContent(
      'changes to GMT+0 · London, Lisbon from Mon 23 Nov',
    )
    expect(screen.getByText(GROUP_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Group time zone/ })).not.toBeInTheDocument()
  })
})
