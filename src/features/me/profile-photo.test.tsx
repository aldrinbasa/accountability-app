import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import { MY_PROFILE_KEY } from '@/data/profile'
import {
  createFakeBackend,
  FAKE_PHOTO_ORIGIN,
  renderRoutes,
  TEST_GROUP,
  TEST_MEMBERS,
  TEST_PROFILE,
} from '@/test/fake-backend'
import { createFakeCamera } from '@/test/fake-camera'
import { createFakeEncoder } from '@/test/fake-image-encoder'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

afterEach(() => {
  setOnline(true)
  vi.restoreAllMocks()
})

async function openSettings(backend = createFakeBackend()) {
  const camera = createFakeCamera()
  const encoder = createFakeEncoder()
  const result = renderRoutes(['/me/settings?g=group-1'], backend, { camera, encoder })
  const row = await screen.findByText('Profile photo')
  return { ...result, camera, encoder, row: row.closest('[data-component="profile-photo-row"]')! }
}

async function shoot(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
  await user.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: 'Camera' })
  const video = dialog.querySelector('video') as HTMLVideoElement
  await waitFor(() => expect(video.srcObject).toBeTruthy())
  act(() => {
    fireEvent(video, new Event('playing'))
  })
  await user.click(await within(dialog).findByRole('button', { name: 'Take photo' }))
  return dialog
}

describe('Me > Settings: Profile photo', () => {
  it('the row shows the initial and "Add a photo" at the top of Settings', async () => {
    const { row } = await openSettings()
    const button = within(row as HTMLElement).getByRole('button', { name: 'Add a photo' })
    expect(button).toHaveClass('min-h-target-min')
    const circle = row.querySelector('[data-fill]')
    expect(circle).toHaveAttribute('aria-hidden', 'true')
    expect(circle).toHaveTextContent('J')
    expect(row.querySelector('img')).toBeNull()
  })

  it('Use photo uploads, sets avatar_path, closes the camera and the row shows the photo', async () => {
    const user = userEvent.setup()
    const { backend, camera, encoder, queryClient, row } = await openSettings()
    const trigger = within(row as HTMLElement).getByRole('button', { name: 'Add a photo' })
    const dialog = await shoot(user, trigger)
    expect(camera.start).toHaveBeenCalledWith('user')

    await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(camera.openStreams()).toHaveLength(0)
    expect(encoder.encodeWebp).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 256, 0.8)
    const path = (backend.uploadAvatar as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string
    expect(backend.setAvatarPath).toHaveBeenCalledWith(path)
    expect(queryClient.getQueryData(MY_PROFILE_KEY)).toMatchObject({ avatarPath: path })

    const change = await within(row as HTMLElement).findByRole('button', { name: 'Change photo' })
    expect(change).toHaveFocus()
    await waitFor(() =>
      expect(row.querySelector('img')).toHaveAttribute(
        'src',
        `${FAKE_PHOTO_ORIGIN}/avatars/${path}?token=t`,
      ),
    )
  })

  it('"Saving…" ignores repeat taps; a failed path update keeps the preview with Inline retry', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    let fail: () => void = () => {}
    const setPath = backend.setAvatarPath
    backend.setAvatarPath = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = () => reject(new BackendError('unknown'))
          }),
      )
      .mockImplementation(setPath) as typeof backend.setAvatarPath
    const { row } = await openSettings(backend)
    const dialog = await shoot(
      user,
      within(row as HTMLElement).getByRole('button', { name: 'Add a photo' }),
    )

    await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))
    const busy = await within(dialog).findByRole('button', { name: 'Saving…' })
    await user.click(busy)
    // Back while saving does nothing.
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByText('Discard this photo?')).not.toBeInTheDocument()
    expect(backend.uploadAvatar).toHaveBeenCalledTimes(1)

    act(() => fail())
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't save your photo. Tap Retry.",
    )
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.setAvatarPath).toHaveBeenCalledTimes(2)
  })

  it('a network failure reads as offline', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    backend.uploadAvatar = vi
      .fn()
      .mockRejectedValue(new BackendError('network')) as typeof backend.uploadAvatar
    const { row } = await openSettings(backend)
    const dialog = await shoot(
      user,
      within(row as HTMLElement).getByRole('button', { name: 'Add a photo' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Use photo' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "You're offline. Photos need a signal to save.",
    )
  })

  it('Retake goes back to the live viewfinder', async () => {
    const user = userEvent.setup()
    const { row } = await openSettings()
    const dialog = await shoot(
      user,
      within(row as HTMLElement).getByRole('button', { name: 'Add a photo' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Retake' }))
    expect(await within(dialog).findByRole('button', { name: 'Take photo' })).toBeInTheDocument()
  })

  it('with a photo set the row says "Change photo"', async () => {
    const backend = createFakeBackend(undefined, {
      profile: { ...TEST_PROFILE, avatarPath: 'user-1/v1.webp' },
    })
    const { row } = await openSettings(backend)
    expect(
      within(row as HTMLElement).getByRole('button', { name: 'Change photo' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(backend.signAvatarPhotos).toHaveBeenCalledWith(['user-1/v1.webp']))
  })
})

describe('Group settings: members show their photos', () => {
  it('signs each member avatar path', async () => {
    const backend = createFakeBackend(undefined, {
      members: {
        [TEST_GROUP.id]: TEST_MEMBERS.map((m) =>
          m.userId === 'user-2' ? { ...m, avatarPath: 'user-2/v1.webp' } : m,
        ),
      },
    })
    renderRoutes([`/me/groups/${TEST_GROUP.id}?g=${TEST_GROUP.id}`], backend)
    await screen.findByText('Priya')
    await waitFor(() => expect(backend.signAvatarPhotos).toHaveBeenCalledWith(['user-2/v1.webp']))
    const img = document.querySelector(
      `img[src="${FAKE_PHOTO_ORIGIN}/avatars/user-2/v1.webp?token=t"]`,
    )
    expect(img).toHaveAttribute('aria-hidden', 'true')
  })
})
