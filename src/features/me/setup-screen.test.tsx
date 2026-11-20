import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { NEXT_KEY } from '@/data/pending-signin'
import { MY_PROFILE_KEY } from '@/data/profile'
import { createFakeBackend, renderRoutes, TEST_USER } from '@/test/fake-backend'
import { createFakeCamera } from '@/test/fake-camera'
import { createFakeEncoder } from '@/test/fake-image-encoder'
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
  const camera = createFakeCamera()
  const encoder = createFakeEncoder()
  const result = renderRoutes([path], backend, { camera, encoder })
  await screen.findByRole('heading', { level: 1, name: HEADING })
  return { ...result, camera, encoder }
}

/** Add a photo → the live front camera → shutter: resolves with the camera dialog on the preview. */
async function shootSetupPhoto(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add a photo' }))
  const dialog = await screen.findByRole('dialog', { name: 'Camera' })
  const video = dialog.querySelector('video') as HTMLVideoElement
  await waitFor(() => expect(video.srcObject).toBeTruthy())
  act(() => {
    fireEvent(video, new Event('playing'))
  })
  await user.click(await within(dialog).findByRole('button', { name: 'Take photo' }))
  return { dialog, video }
}

/** The whole photo step: shoot, Use photo, and wait for the camera to close. */
async function takeSetupPhoto(user: ReturnType<typeof userEvent.setup>) {
  const { dialog } = await shootSetupPhoto(user)
  await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:setup-photo'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})

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

  it('Add a photo opens the front camera in avatar mode: square, no target chip, no file input', async () => {
    const user = userEvent.setup()
    const { camera, router } = await openSetup()
    const location = router.state.location
    const { dialog, video } = await shootSetupPhoto(user)
    expect(dialog).toHaveAttribute('data-mode', 'avatar')
    expect(camera.start).toHaveBeenCalledWith('user')
    expect(dialog.querySelector('[data-component="target-chip"]')).toBeNull()
    expect(dialog.querySelector('[data-component="viewfinder"]')).toHaveClass('aspect-square')
    expect(dialog.querySelector('input')).toBeNull()
    expect(router.state.location).toBe(location)
    expect(camera.capture).toHaveBeenCalledWith(video, 1)

    expect(
      within(dialog).getByRole('heading', { name: 'Your new profile photo' }),
    ).toBeInTheDocument()
    expect(dialog.querySelector('[data-component="avatar-circle"]')).toHaveClass('rounded-full')
    expect(within(dialog).getByRole('button', { name: 'Retake' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Use photo' })).toHaveClass('bg-primary')

    // Close from the preview asks first; Discard closes, stops the stream, returns focus.
    await user.click(within(dialog).getByRole('button', { name: 'Close camera' }))
    expect(within(dialog).getByText('Discard this photo?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep' }))
    expect(within(dialog).queryByText('Discard this photo?')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close camera' }))
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(camera.openStreams()).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Add a photo' })).toHaveFocus()
  })

  it('Use photo uploads one 256 px WebP; Continue saves the name, then the photo path', async () => {
    const user = userEvent.setup()
    const { backend, encoder, router, queryClient } = await openSetup()
    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await takeSetupPhoto(user)

    expect(encoder.encodeWebp).toHaveBeenCalledTimes(1)
    expect(encoder.encodeWebp).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 256, 0.8)
    expect(backend.uploadAvatar).toHaveBeenCalledTimes(1)
    const [path, photo] = vi.mocked(backend.uploadAvatar).mock.calls[0] as [string, Blob]
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.webp$/)
    expect(photo.type).toBe('image/webp')
    // Not on the profile yet: there is no profile row before Continue.
    expect(backend.setAvatarPath).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', 'blob:setup-photo')

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(backend.saveProfile).toHaveBeenCalledWith('Jo', expect.any(String))
    expect(backend.setAvatarPath).toHaveBeenCalledWith(path)
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toMatchObject({ avatarPath: path })
  })

  it('a failed path update keeps Setup with the save-failed toast; Retry saves both again', async () => {
    const user = userEvent.setup()
    const backend = newMember()
    const setPath = backend.setAvatarPath
    backend.setAvatarPath = vi
      .fn()
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockImplementation(setPath) as typeof backend.setAvatarPath
    const { router, queryClient } = await openSetup(backend)
    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await takeSetupPhoto(user)

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup')
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toBeFalsy()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(backend.saveProfile).toHaveBeenCalledTimes(2)
    expect(backend.setAvatarPath).toHaveBeenCalledTimes(2)
  })

  it('offline Use photo keeps the preview with Inline retry and sends nothing', async () => {
    const user = userEvent.setup()
    const { backend } = await openSetup()
    const { dialog } = await shootSetupPhoto(user)
    setOnline(false)
    await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      "You're offline. Photos need a signal to save.",
    )
    expect(backend.uploadAvatar).not.toHaveBeenCalled()

    setOnline(true)
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.uploadAvatar).toHaveBeenCalledTimes(1)
  })

  it('a failed upload shows the failure copy; Retry resends the same photo and version', async () => {
    const user = userEvent.setup()
    const backend = newMember()
    backend.uploadAvatar = vi
      .fn()
      .mockRejectedValueOnce(new BackendError('unknown'))
      .mockResolvedValue(undefined) as typeof backend.uploadAvatar
    const { encoder } = await openSetup(backend)
    const { dialog } = await shootSetupPhoto(user)
    await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't save your photo. Tap Retry.",
    )
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(encoder.encodeWebp).toHaveBeenCalledTimes(1)
    const calls = (backend.uploadAvatar as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]?.[0]).toBe(calls[0]?.[0])
    expect(calls[1]?.[1]).toBe(calls[0]?.[1])
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
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toMatchObject({
      displayName: 'Jo',
      avatarPath: null,
    })
    // Skipped the photo: the name only.
    expect(backend.setAvatarPath).not.toHaveBeenCalled()
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
    sessionStorage.setItem(NEXT_KEY, '/board?g=group-1')
    const { router } = await openSetup(backend)

    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    const busy = screen.getByRole('button', { name: 'Saving…' })
    await user.click(busy)
    await user.click(busy)
    expect(backend.saveProfile).toHaveBeenCalledTimes(1)

    finish()
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/board'))
    expect(router.state.location.search).toBe('?g=group-1')
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
    await vi.waitFor(() =>
      expect(screen.queryByText("Couldn't save. Try again.")).not.toBeInTheDocument(),
    )
  })

  it('a zone Postgres does not know: saves again with UTC and goes to /today', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Ciudad_Juarez',
    } as Intl.ResolvedDateTimeFormatOptions)
    const user = userEvent.setup()
    const backend = newMember()
    const save = backend.saveProfile
    backend.saveProfile = vi
      .fn()
      .mockRejectedValueOnce(new BackendError('invalid_time_zone'))
      .mockImplementation(save) as typeof backend.saveProfile
    const { router } = await openSetup(backend)

    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(backend.saveProfile).toHaveBeenNthCalledWith(1, 'Jo', 'America/Ciudad_Juarez')
    expect(backend.saveProfile).toHaveBeenNthCalledWith(2, 'Jo', 'UTC')
  })

  it('UTC rejected too: zone toast without Retry, name kept', async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Ciudad_Juarez',
    } as Intl.ResolvedDateTimeFormatOptions)
    const user = userEvent.setup()
    const backend = newMember()
    backend.saveProfile = vi.fn(async () => {
      throw new BackendError('invalid_time_zone')
    })
    const { router } = await openSetup(backend)

    await user.type(screen.getByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/time zone isn't one we know/)).toBeInTheDocument()
    expect(backend.saveProfile).toHaveBeenCalledTimes(2)
    expect(backend.saveProfile).toHaveBeenLastCalledWith('Jo', 'UTC')
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toHaveValue('Jo')
    expect(router.state.location.pathname).toBe('/setup')
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
