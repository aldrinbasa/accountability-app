import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { NEXT_KEY } from '@/data/pending-signin'
import { MY_PROFILE_KEY } from '@/data/profile'
import { createFakeBackend, renderRoutes, TEST_USER } from '@/test/fake-backend'
import { dismissToast } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'

const HEADING = 'What do your friends call you?'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

afterEach(() => {
  // Sonner keeps toasts in a module store; drop them so the next test's Toaster starts empty.
  dismissToast()
  setOnline(true)
  vi.restoreAllMocks()
})

function newMember(user = TEST_USER) {
  return createFakeBackend(user, { profile: null })
}

async function openSetup(backend = newMember(), path = '/setup') {
  render(<Toaster />)
  const result = renderRoutes([path], backend)
  await screen.findByRole('heading', { level: 1, name: HEADING })
  return result
}

describe('SetupScreen', () => {
  it('shows the Display name field and a coral Continue button', async () => {
    await openSetup()
    const field = screen.getByLabelText('Display name')
    expect(field).toHaveAttribute('autocomplete', 'nickname')
    expect(field).toHaveAttribute('maxlength', '24')
    expect(field).toBeRequired()
    expect(field).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('bg-primary')
    expect(screen.getByText('add a photo later')).toBeInTheDocument()
  })

  it('prefills a Google given name cut to 24 characters', async () => {
    await openSetup(newMember({ ...TEST_USER, givenName: 'Josephine Annabelle Cruz-Santos' }))
    expect(screen.getByLabelText('Display name')).toHaveValue('Josephine Annabelle Cruz')
  })

  it('the avatar initial follows the typed name; blank shows no letter', async () => {
    const user = userEvent.setup()
    const { container } = await openSetup()
    const circle = () => container.ownerDocument.querySelector('[data-fill]')
    expect(circle()).toHaveTextContent(/^$/)
    await user.type(screen.getByLabelText('Display name'), 'marco')
    expect(circle()).toHaveTextContent(/^M$/)
  })

  it('the camera badge says photos come later', async () => {
    const user = userEvent.setup()
    await openSetup()
    await user.click(screen.getByRole('button', { name: 'Add a photo' }))
    expect(await screen.findByText('Photos come with the camera. Soon.')).toBeInTheDocument()
  })

  it('an empty name shows the focused Field error, which clears on typing', async () => {
    const user = userEvent.setup()
    const { backend } = await openSetup()
    const field = screen.getByLabelText('Display name')
    await user.type(field, '   ')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Pick a name your friends will recognize.')
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(backend.saveProfile).not.toHaveBeenCalled()

    await user.type(field, 'J')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('saves the trimmed name with the device zone, then goes to /today', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Asia/Manila',
    } as Intl.ResolvedDateTimeFormatOptions)
    const user = userEvent.setup()
    const { backend, router, queryClient } = await openSetup()
    await user.type(screen.getByLabelText('Display name'), '  Jo ')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(backend.saveProfile).toHaveBeenCalledWith('Jo', 'Asia/Manila')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toMatchObject({ displayName: 'Jo' })
  })

  it('without an Intl zone, saves UTC', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: undefined,
    } as unknown as Intl.ResolvedDateTimeFormatOptions)
    const user = userEvent.setup()
    const { backend } = await openSetup()
    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(backend.saveProfile).toHaveBeenCalledWith('Jo', 'UTC')
  })

  it('reads "Saving…" and ignores repeat taps while busy; then goes to the pending next', async () => {
    const user = userEvent.setup()
    const backend = newMember()
    let finish: () => void = () => {}
    const save = backend.saveProfile
    backend.saveProfile = vi.fn(
      (name: string, zone: string) =>
        new Promise((resolve) => {
          finish = () => resolve(save(name, zone))
        }),
    ) as typeof backend.saveProfile
    sessionStorage.setItem(NEXT_KEY, '/board?g=x')
    const { router } = await openSetup(backend)

    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const busy = screen.getByRole('button', { name: 'Saving…' })
    await user.click(busy)
    await user.click(busy)
    expect(backend.saveProfile).toHaveBeenCalledTimes(1)

    finish()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/board'))
    expect(router.state.location.search).toBe('?g=x')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('offline: error toast, name kept, nothing sent', async () => {
    const user = userEvent.setup()
    const { backend } = await openSetup()
    await user.type(screen.getByLabelText('Display name'), 'Jo')
    setOnline(false)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText("Couldn't save. You're offline.")).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toHaveValue('Jo')
    expect(backend.saveProfile).not.toHaveBeenCalled()
  })

  it('a network failure on save shows the offline toast', async () => {
    const user = userEvent.setup()
    const backend = newMember()
    backend.saveProfile = vi.fn(async () => {
      throw new BackendError('network')
    })
    await openSetup(backend)
    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText("Couldn't save. You're offline.")).toBeInTheDocument()
  })

  it('a failed call shows an error toast with Retry; the name is kept and Retry saves', async () => {
    const user = userEvent.setup()
    const backend = newMember()
    const save = backend.saveProfile
    backend.saveProfile = vi
      .fn()
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockImplementation(save) as typeof backend.saveProfile
    const { router } = await openSetup(backend)

    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toHaveValue('Jo')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(backend.saveProfile).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('invalid_display_name from the server shows the Field error copy', async () => {
    const user = userEvent.setup()
    const backend = newMember()
    backend.saveProfile = vi.fn(async () => {
      throw new BackendError('invalid_display_name')
    })
    await openSetup(backend)
    const field = screen.getByLabelText('Display name')
    await user.type(field, 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pick a name your friends will recognize.',
    )
    expect(field).toHaveFocus()
  })
})
