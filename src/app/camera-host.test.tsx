import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TodayItem } from '@/domain/today'
import { CameraError } from '@/ports/camera-port'
import { canShowUpdatePrompt } from '@/ui/update-guard'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_TODAY_SUMMARY,
} from '@/test/fake-backend'
import { createFakeCamera, type FakeCameraPort } from '@/test/fake-camera'
import { waitForGroupInUrl } from '@/test/router'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

const GYM: TodayItem = {
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

function backendWithGym(memberCount = 3) {
  return createFakeBackend(undefined, {
    groups: [{ ...TEST_GROUP, memberCount }],
    today: { [TEST_GROUP.id]: { items: [GYM], summary: TEST_TODAY_SUMMARY } },
  })
}

async function renderToday(camera: FakeCameraPort = createFakeCamera(), memberCount = 3) {
  const user = userEvent.setup()
  const result = renderRoutes(['/today'], backendWithGym(memberCount), { camera })
  await screen.findByRole('button', { name: 'Check in Gym' })
  // Today writes the focused group into the URL (a replace); let that settle first.
  await waitForGroupInUrl(result.router)
  return { user, camera, ...result }
}

function cameraButton() {
  return screen.getByRole('button', { name: 'Check in' })
}

function video(): HTMLVideoElement {
  const element = document.querySelector('video')
  if (!element) throw new Error('no viewfinder video')
  return element
}

/** The stream's first frame (the `playing` fallback; jsdom has no requestVideoFrameCallback). */
function firstFrame() {
  fireEvent(video(), new Event('playing'))
}

beforeEach(() => {
  toast.showToast.mockClear()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'CloseWatcher')
})

describe('camera overlay', () => {
  it('the Camera button opens it snap-first, with no URL, history or hash change', async () => {
    const { user, router, camera } = await renderToday()
    const before = { href: window.location.href, length: window.history.length }
    const location = router.state.location

    await user.click(cameraButton())
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    expect(dialog).toHaveAccessibleDescription('Live only')
    expect(router.state.location).toBe(location)
    expect(window.location.href).toBe(before.href)
    expect(window.history.length).toBe(before.length)

    expect(camera.start).toHaveBeenCalledWith('environment')
    expect(dialog.querySelector('[data-component="target-chip"]')).toBeNull()
    expect(within(dialog).getByText('Waking up the camera')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Take photo' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close camera' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Switch camera' })).toBeInTheDocument()
    expect(dialog.querySelector('input')).toBeNull()
    // The update toast waits while the camera is open.
    expect(canShowUpdatePrompt()).toBe(false)

    await waitFor(() => expect(video().srcObject).toBe(camera.streams[0]?.media))
    act(() => firstFrame())
    const shutter = await within(dialog).findByRole('button', { name: 'Take photo' })
    expect(within(dialog).queryByText('Waking up the camera')).not.toBeInTheDocument()
    await waitFor(() => expect(shutter).toHaveFocus())
    expect(video().dataset.firstFrameMs).toMatch(/^\d+$/)
  })

  it('a row Check in opens it with the row pre-picked in the Target chip', async () => {
    const { user } = await renderToday()
    await user.click(screen.getByRole('button', { name: 'Check in Gym' }))
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    const chip = dialog.querySelector<HTMLElement>('[data-component="target-chip"]')
    expect(chip).toHaveTextContent('Gym')
    expect(chip?.querySelector('svg')).not.toBeNull()
    // Screen readers hear the target with the "Live only" note.
    expect(dialog).toHaveAccessibleDescription(/Live only.*Gym/)
    for (const id of (dialog.getAttribute('aria-describedby') ?? '').split(' ')) {
      expect(document.getElementById(id)).not.toBeNull()
    }
  })

  it('a waiting group still shows Check in', async () => {
    await renderToday(createFakeCamera(), 1)
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check in Gym' })).toBeInTheDocument()
  })

  it('Esc closes it, stops every track, returns focus to the trigger and clears the toast guard', async () => {
    const { user, camera } = await renderToday()
    const rowButton = screen.getByRole('button', { name: 'Check in Gym' })
    await user.click(rowButton)
    await screen.findByRole('dialog', { name: 'Camera' })
    await waitFor(() => expect(camera.streams).toHaveLength(1))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(camera.openStreams()).toHaveLength(0)
    expect(rowButton).toHaveFocus()
    expect(canShowUpdatePrompt()).toBe(true)
    // Esc in the camera does not also leave Today.
    expect(screen.getByRole('button', { name: 'Check in Gym' })).toBeInTheDocument()
  })

  it('Close camera closes it and returns focus to the Camera button', async () => {
    const { user, camera } = await renderToday()
    await user.click(cameraButton())
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    await user.click(within(dialog).getByRole('button', { name: 'Close camera' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(camera.openStreams()).toHaveLength(0)
    expect(cameraButton()).toHaveFocus()
  })

  it('traps focus: Tab cycles inside the overlay', async () => {
    const { user } = await renderToday()
    await user.click(cameraButton())
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    act(() => firstFrame())
    await within(dialog).findByRole('button', { name: 'Take photo' })
    for (let i = 0; i < 6; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('the shutter hands a capture to the check-in handler: the preview, the stream still live', async () => {
    const { user, camera } = await renderToday()
    await user.click(screen.getByRole('button', { name: 'Check in Gym' }))
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    act(() => firstFrame())
    const viewfinder = video()
    await user.click(await within(dialog).findByRole('button', { name: 'Take photo' }))
    expect(camera.capture).toHaveBeenCalledWith(viewfinder, 4 / 3)
    expect(await within(dialog).findByRole('button', { name: 'Post' })).toBeInTheDocument()
    // The viewfinder stays mounted (hidden), so Retake is instant.
    expect(video()).toBe(viewfinder)
    expect(camera.openStreams()).toHaveLength(1)
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('a fast double tap on the shutter hands over one shot', async () => {
    const { user, camera } = await renderToday()
    await user.click(screen.getByRole('button', { name: 'Check in Gym' }))
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    act(() => firstFrame())
    const shutter = await within(dialog).findByRole('button', { name: 'Take photo' })
    act(() => {
      fireEvent.click(shutter)
      fireEvent.click(shutter)
    })
    expect(await within(dialog).findByRole('button', { name: 'Post' })).toBeInTheDocument()
    expect(camera.capture).toHaveBeenCalledTimes(1)
  })

  it('leaving the shell with the camera open (sign-out) stops the stream and clears the toast guard', async () => {
    const { user, camera, unmount } = await renderToday()
    await user.click(cameraButton())
    await screen.findByRole('dialog', { name: 'Camera' })
    await waitFor(() => expect(camera.streams).toHaveLength(1))
    expect(canShowUpdatePrompt()).toBe(false)
    unmount()
    expect(camera.openStreams()).toHaveLength(0)
    expect(canShowUpdatePrompt()).toBe(true)
  })

  it('page hidden stops the stream; visible again restarts it while open', async () => {
    const { user, camera } = await renderToday()
    await user.click(cameraButton())
    await screen.findByRole('dialog', { name: 'Camera' })
    await waitFor(() => expect(camera.streams).toHaveLength(1))

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(camera.openStreams()).toHaveLength(0)
    expect(screen.getByText('Waking up the camera')).toBeInTheDocument()

    visibility.mockReturnValue('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitFor(() => expect(camera.streams).toHaveLength(2))
    expect(camera.openStreams()).toHaveLength(1)
  })

  it('Switch camera asks for the front camera after stopping the back one', async () => {
    const { user, camera } = await renderToday()
    await user.click(cameraButton())
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    await waitFor(() => expect(camera.streams).toHaveLength(1))
    await user.click(within(dialog).getByRole('button', { name: 'Switch camera' }))
    await waitFor(() => expect(camera.streams).toHaveLength(2))
    expect(camera.start).toHaveBeenLastCalledWith('user')
    expect(camera.streams[0]?.stopped).toBe(true)
    expect(camera.openStreams()).toHaveLength(1)
    // The front camera preview is mirrored; the back camera's was not.
    await waitFor(() => expect(video()).toHaveClass('-scale-x-100'))
    await user.click(within(dialog).getByRole('button', { name: 'Switch camera' }))
    await waitFor(() => expect(video()).not.toHaveClass('-scale-x-100'))
  })

  it('system back without CloseWatcher: a popstate closes it', async () => {
    const { user, camera } = await renderToday()
    await user.click(cameraButton())
    await screen.findByRole('dialog', { name: 'Camera' })
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(camera.openStreams()).toHaveLength(0)
  })

  it('system back with CloseWatcher: its close request closes it; closing destroys it', async () => {
    const watchers: { onclose: (() => void) | null; destroy: ReturnType<typeof vi.fn> }[] = []
    Object.defineProperty(window, 'CloseWatcher', {
      configurable: true,
      writable: true,
      value: class {
        onclose: (() => void) | null = null
        destroy = vi.fn()
        constructor() {
          watchers.push(this)
        }
      },
    })
    const { user } = await renderToday()
    await user.click(cameraButton())
    await screen.findByRole('dialog', { name: 'Camera' })
    expect(watchers).toHaveLength(1)
    act(() => watchers[0]?.onclose?.())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(watchers[0]?.destroy).toHaveBeenCalled()
  })

  it('permission pending: the dimmed frame and the iPhone helper sticky; Allow goes live in place', async () => {
    const camera = createFakeCamera({ mode: 'manual', permission: 'prompt' })
    const { user } = await renderToday(camera)
    await user.click(screen.getByRole('button', { name: 'Check in Gym' }))
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    expect(
      await within(dialog).findByText(
        "iPhone asks again sometimes. That's iOS, not us. Tap Allow and you're back to checking in. We only use the camera while this screen is open.",
      ),
    ).toBeInTheDocument()
    expect(dialog.querySelector('[data-component="viewfinder"]')).toHaveClass('opacity-40')

    act(() => {
      camera.resolveNext()
    })
    await waitFor(() => expect(video().srcObject).toBe(camera.streams[0]?.media))
    act(() => firstFrame())
    await within(dialog).findByRole('button', { name: 'Take photo' })
    expect(within(dialog).queryByText(/iPhone asks again/)).not.toBeInTheDocument()
    expect(dialog.querySelector('[data-component="target-chip"]')).toHaveTextContent('Gym')
  })

  it('denied: the Fix-it card with steps; Try again re-requests the stream', async () => {
    const camera = createFakeCamera({ mode: 'manual' })
    const { user } = await renderToday(camera)
    await user.click(cameraButton())
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    act(() => camera.rejectNext(new CameraError('denied')))

    const heading = await within(dialog).findByRole('heading', { name: "Camera's blocked" })
    const card = heading.closest('section')!
    expect(within(card).getAllByRole('listitem').length).toBeGreaterThan(0)
    const tryAgain = within(card).getByRole('button', { name: 'Try again' })
    await waitFor(() => expect(tryAgain).toHaveFocus())

    await user.click(tryAgain)
    expect(camera.start).toHaveBeenCalledTimes(2)
    act(() => {
      camera.resolveNext()
    })
    await waitFor(() =>
      expect(within(dialog).queryByText("Camera's blocked")).not.toBeInTheDocument(),
    )
  })

  it('no camera: "No camera found." with Close', async () => {
    const camera = createFakeCamera({ mode: 'manual' })
    const { user } = await renderToday(camera)
    await user.click(cameraButton())
    const dialog = await screen.findByRole('dialog', { name: 'Camera' })
    act(() => camera.rejectNext(new CameraError('no_camera')))
    expect(await within(dialog).findByText('No camera found.')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Check-ins need a camera. Try on your phone.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(cameraButton()).toHaveFocus()
  })
})
