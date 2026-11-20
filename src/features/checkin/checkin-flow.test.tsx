import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CheckinTarget, PostCheckinInput } from '@/domain/checkin'
import { BackendError } from '@/domain/error-codes'
import type { TodayItem } from '@/domain/today'
import { getPostMoment } from '@/data/post-moment'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_TODAY_SUMMARY,
  type FakeBackend,
} from '@/test/fake-backend'
import { createFakeCamera } from '@/test/fake-camera'
import { createFakeEncoder, type FakeImageEncoder } from '@/test/fake-image-encoder'
import { waitForGroupInUrl } from '@/test/router'

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
  counted: 1,
  deadline: null,
  startsOn: null,
  canDelete: false,
  countedToday: false,
  targetMet: false,
}

const GYM_TARGET: CheckinTarget = {
  commitmentId: 'c-gym',
  kind: 'commitment',
  presetKey: 'gym',
  activityName: 'Gym',
  name: null,
  scheduleType: 'fixed_days',
  dueToday: true,
  memberToday: '2026-11-20',
  deadline: null,
  target: 3,
  doneCount: 1,
  wontCount: null,
}

const RUN_TARGET: CheckinTarget = {
  commitmentId: 'c-run',
  kind: 'commitment',
  presetKey: 'run',
  activityName: 'Run',
  name: null,
  scheduleType: 'times_per_week',
  dueToday: false,
  memberToday: '2026-11-20',
  deadline: null,
  target: 3,
  doneCount: 3,
  wontCount: 'target_met',
}

const READ_TARGET: CheckinTarget = {
  commitmentId: 'c-read',
  kind: 'commitment',
  presetKey: 'read',
  activityName: 'Read',
  name: null,
  scheduleType: 'fixed_days',
  dueToday: false,
  memberToday: '2026-11-20',
  deadline: null,
  target: 2,
  doneCount: 0,
  wontCount: 'not_today',
}

function backend(options: Parameters<typeof createFakeBackend>[1] = {}): FakeBackend {
  return createFakeBackend(undefined, {
    today: { [TEST_GROUP.id]: { items: [GYM], summary: { ...TEST_TODAY_SUMMARY, planned: 3 } } },
    checkinTargets: { [TEST_GROUP.id]: [GYM_TARGET, RUN_TARGET, READ_TARGET] },
    postCheckin: (input) => ({
      checkinId: input.id,
      sessionId: 's1',
      counted: true,
      isLate: false,
      weeklyPoints: null,
      rank: null,
      passedUserIds: [],
      doneCount: 2,
      target: 3,
    }),
    ...options,
  })
}

async function renderToday(fake: FakeBackend = backend(), encoder?: FakeImageEncoder) {
  const user = userEvent.setup()
  const camera = createFakeCamera()
  const result = renderRoutes(['/today'], fake, { camera, encoder })
  await screen.findByRole('button', { name: 'Check in Gym' })
  await waitForGroupInUrl(result.router)
  return { user, camera, ...result }
}

function video(): HTMLVideoElement {
  const element = document.querySelector('video')
  if (!element) throw new Error('no viewfinder video')
  return element
}

async function shoot(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: 'Camera' })
  await waitFor(() => expect(video().srcObject).not.toBeNull())
  act(() => {
    fireEvent(video(), new Event('playing'))
  })
  await user.click(await within(dialog).findByRole('button', { name: 'Take photo' }))
  return dialog
}

async function preview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Check in Gym' }))
  return shoot(user)
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  setOnline(true)
  vi.restoreAllMocks()
})

describe('pre-picked check-in', () => {
  it('the shutter goes straight to the preview: Polaroid, Caption 0/80, Retake, Post', async () => {
    const { user } = await renderToday()
    const dialog = await preview(user)
    const polaroid = within(dialog).getByRole('figure')
    expect(polaroid).toHaveAttribute('data-component', 'polaroid')
    expect(within(polaroid).getByRole('img', { name: 'Your photo' })).toBeInTheDocument()
    expect(dialog.querySelector('[data-component="target-chip"]')).toHaveTextContent('Gym')
    const caption = within(dialog).getByRole('textbox', { name: 'Caption' })
    expect(caption).toHaveAccessibleDescription('0/80')
    expect(caption).toHaveAttribute('maxLength', '80')
    expect(within(dialog).getByRole('button', { name: 'Retake' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Post' })).toBeInTheDocument()
    expect(dialog.querySelector('input[type=file]')).toBeNull()

    await user.type(caption, 'leg day')
    expect(caption).toHaveAccessibleDescription('7/80')
    expect(within(polaroid).getByText('leg day')).toBeInTheDocument()
  })

  it('Retake goes back to the live viewfinder; the next shot is a fresh photo', async () => {
    const { user, camera } = await renderToday()
    const dialog = await preview(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Caption' }), 'first')
    await user.click(within(dialog).getByRole('button', { name: 'Retake' }))
    const shutter = await within(dialog).findByRole('button', { name: 'Take photo' })
    await waitFor(() => expect(shutter).toHaveFocus())
    await user.click(shutter)
    expect(camera.capture).toHaveBeenCalledTimes(2)
    expect(await within(dialog).findByRole('textbox', { name: 'Caption' })).toHaveValue('')
  })

  it('Esc asks "Discard this photo?": Keep returns, Discard closes the camera', async () => {
    const { user, camera } = await renderToday()
    const dialog = await preview(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Caption' }), 'keep me')

    await user.keyboard('{Escape}')
    expect(within(dialog).getByText('Discard this photo?')).toBeInTheDocument()
    const keep = within(dialog).getByRole('button', { name: 'Keep' })
    await waitFor(() => expect(keep).toHaveFocus())
    // Esc again means Keep.
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByText('Discard this photo?')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: 'Caption' })).toHaveValue('keep me')

    await user.click(within(dialog).getByRole('button', { name: 'Close camera' }))
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(camera.openStreams()).toHaveLength(0)
  })

  it('system back from the preview asks first (one CloseWatcher per step)', async () => {
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
    try {
      const { user } = await renderToday()
      const dialog = await preview(user)
      const before = watchers.length
      act(() => watchers.at(-1)?.onclose?.())
      expect(await within(dialog).findByText('Discard this photo?')).toBeInTheDocument()
      expect(watchers.length).toBeGreaterThan(before)
      act(() => watchers.at(-1)?.onclose?.())
      await waitFor(() =>
        expect(within(dialog).queryByText('Discard this photo?')).not.toBeInTheDocument(),
      )
      expect(screen.getByRole('dialog', { name: 'Camera' })).toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(window, 'CloseWatcher')
    }
  })
})

describe('posting', () => {
  it('Post encodes, uploads both renditions, posts, closes the camera and plays the moment', async () => {
    const fake = backend()
    const encoder = createFakeEncoder()
    const { user, router } = await renderToday(fake, encoder)
    const dialog = await preview(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Caption' }), '  leg day  ')
    vi.mocked(fake.getTodayItems).mockResolvedValue([{ ...GYM, counted: 2, countedToday: true }])

    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(encoder.encodeWebp.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [1080, 0.8],
      [360, 0.8],
    ])
    expect(fake.uploadCheckinPhoto).toHaveBeenCalledTimes(2)
    const input = vi.mocked(fake.postCheckin).mock.calls[0]?.[0] as PostCheckinInput
    expect(input).toMatchObject({
      groupId: TEST_GROUP.id,
      commitmentId: 'c-gym',
      caption: 'leg day',
    })
    expect(input.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(vi.mocked(fake.uploadCheckinPhoto).mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [TEST_GROUP.id, input.id, 1080],
      [TEST_GROUP.id, input.id, 360],
    ])
    expect(router.state.location.pathname).toBe('/today')

    // The moment: the post leads Friends today, one polite announcement, and the server's row after
    // refetch.
    const moment = await waitFor(() => {
      const element = document.querySelector('[data-component="post-moment"]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    expect(moment).toHaveAccessibleName(/^Your Gym check-in, .*caption: leg day$/)
    expect(moment.closest('[data-component="friends-today"]')).not.toBeNull()
    expect(await screen.findByText('Posted. Gym 2 of 3.')).toHaveAttribute('role', 'status')
    const row = await waitFor(() => {
      const element = document.querySelector('[data-commitment-id="c-gym"]')
      expect(element).toHaveAttribute('data-done')
      return element as HTMLElement
    })
    expect(within(row).getByRole('img', { name: 'Done' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Check in Gym' })).not.toBeInTheDocument()
    expect(within(row).getByText('Fixed days · Mon Wed Fri · Done')).toBeInTheDocument()
    expect(getPostMoment()?.announced).toBe(true)
  })

  it('Post reads "Posting…" and ignores repeat taps', async () => {
    const fake = backend()
    let release: () => void = () => {}
    vi.mocked(fake.postCheckin).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              checkinId: input.id,
              sessionId: 's1',
              counted: true,
              isLate: false,
              weeklyPoints: null,
              rank: null,
              passedUserIds: [],
              doneCount: 2,
              target: 3,
            })
        }),
    )
    const { user } = await renderToday(fake)
    const dialog = await preview(user)
    const post = within(dialog).getByRole('button', { name: 'Post' })
    await user.click(post)
    await waitFor(() => expect(post).toHaveTextContent('Posting…'))
    await user.click(post)
    // Back does nothing while posting.
    await user.keyboard('{Escape}')
    expect(within(dialog).queryByText('Discard this photo?')).not.toBeInTheDocument()
    expect(fake.postCheckin).toHaveBeenCalledTimes(1)
    await act(async () => release())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('offline: the entry is queued, the camera closes at once, Today shows it waiting', async () => {
    const fake = backend()
    const encoder = createFakeEncoder()
    const { user, router } = await renderToday(fake, encoder)
    const dialog = await preview(user)
    await user.type(within(dialog).getByRole('textbox', { name: 'Caption' }), 'gym')
    setOnline(false)
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe('/today')
    expect(fake.uploadCheckinPhoto).not.toHaveBeenCalled()
    expect(fake.postCheckin).not.toHaveBeenCalled()

    // The waiting Banner, focused; no stick-down motion until the photo is sent.
    const banner = await screen.findByText(
      /^1 photo waiting to send · Gym · Gym Rats · taken \d\d:\d\d\. Sends when you're back online\.$/,
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector('[data-component="outbox-banners"]'),
      ),
    )
    expect(document.querySelector('[data-component="post-moment"]')).toBeNull()

    // Back online: sent from the entry, then the moment plays and the Banner goes.
    vi.mocked(fake.getTodayItems).mockResolvedValue([{ ...GYM, counted: 2, countedToday: true }])
    setOnline(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(fake.postCheckin).toHaveBeenCalledTimes(1))
    expect(vi.mocked(fake.postCheckin).mock.calls[0]?.[0]).toMatchObject({
      groupId: TEST_GROUP.id,
      commitmentId: 'c-gym',
      caption: 'gym',
    })
    expect(fake.uploadCheckinPhoto).toHaveBeenCalledTimes(2)
    expect(encoder.encodeWebp).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(banner).not.toBeInTheDocument())
    await waitFor(() =>
      expect(document.querySelector('[data-component="post-moment"]')).not.toBeNull(),
    )
  })

  it('online, a failed send: the camera closes, the photo waits; Retry sends it', async () => {
    const fake = backend()
    vi.mocked(fake.postCheckin).mockRejectedValueOnce(new BackendError('network'))
    const { user } = await renderToday(fake)
    const dialog = await preview(user)
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const banner = await screen.findByText(/^1 photo waiting to send · Gym/)
    const retry = within(banner.closest('[data-component="banner"]') as HTMLElement).getByRole(
      'button',
      { name: 'Retry' },
    )
    await user.click(retry)
    await waitFor(() => expect(fake.postCheckin).toHaveBeenCalledTimes(2))
    const calls = vi.mocked(fake.postCheckin).mock.calls.map((call) => call[0])
    expect(calls[1]).toEqual(calls[0])
    // Both renditions landed the first time: not uploaded again.
    expect(fake.uploadCheckinPhoto).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(banner).not.toBeInTheDocument())
  })

  it('a terminal code: the camera closes and Today explains it; Got it discards the photo', async () => {
    const fake = backend()
    vi.mocked(fake.postCheckin).mockRejectedValueOnce(
      new BackendError(
        'week_locked',
        'week_locked',
        '{"lock_at" : "2026-11-25T16:00:00+00:00", "time_zone" : "Asia/Manila"}',
      ),
    )
    const { user } = await renderToday(fake)
    const dialog = await preview(user)
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Thu 00:00 Manila reads "Wed 23:59"; the member is in Manila too (no city named).
    const banner = await screen.findByText(
      "Too late for last week. It locked Wed 23:59, so this photo can't count.",
    )
    expect(screen.queryByText(/waiting to send/)).not.toBeInTheDocument()
    await user.click(
      within(banner.closest('[data-component="banner"]') as HTMLElement).getByRole('button', {
        name: 'Got it',
      }),
    )
    await waitFor(() => expect(banner).not.toBeInTheDocument())
    expect(fake.postCheckin).toHaveBeenCalledTimes(1)
  })

  it('an encode failure keeps the preview with Inline retry; Retry queues and posts', async () => {
    const fake = backend()
    const encoder = createFakeEncoder()
    encoder.encodeWebp.mockRejectedValueOnce(new Error('no encoder'))
    const { user } = await renderToday(fake, encoder)
    const dialog = await preview(user)
    const caption = within(dialog).getByRole('textbox', { name: 'Caption' })
    await user.type(caption, 'gym')
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't post your photo. Tap Retry.",
    )
    // Frozen at the first Post: read-only, not disabled.
    expect(caption).toHaveAttribute('readonly')
    expect(caption).not.toBeDisabled()
    expect(fake.postCheckin).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fake.postCheckin).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fake.postCheckin).mock.calls[0]?.[0].caption).toBe('gym')
  })
})

describe('after the post', () => {
  it("focus goes to the post moment (the row's Check in is gone once it is Done)", async () => {
    const fake = backend()
    const { user } = await renderToday(fake)
    const dialog = await preview(user)
    vi.mocked(fake.getTodayItems).mockResolvedValue([{ ...GYM, counted: 2, countedToday: true }])
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => {
      const moment = document.querySelector('[data-component="post-moment"]')
      expect(moment).not.toBeNull()
      expect(document.activeElement).toBe(moment)
    })
  })

  it('a snap-first post from another tab ends on Today with the post moment', async () => {
    const fake = backend()
    const user = userEvent.setup()
    const result = renderRoutes(['/feed'], fake, { camera: createFakeCamera() })
    await waitForGroupInUrl(result.router)
    await user.click(await screen.findByRole('button', { name: 'Check in' }))
    const dialog = await shoot(user)
    await user.click(await within(dialog).findByRole('button', { name: 'Gym, Fri · due' }))
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(result.router.state.location.pathname).toBe('/today'))
    await waitFor(() =>
      expect(document.querySelector('[data-component="post-moment"]')).not.toBeNull(),
    )
  })
})

describe('snap-first picker', () => {
  it("lists Due today first, then the rest, with the won't-count notes", async () => {
    const { user } = await renderToday()
    await user.click(screen.getByRole('button', { name: 'Check in' }))
    const dialog = await shoot(user)
    const title = await within(dialog).findByRole('heading', { name: "What's this check-in for?" })
    await waitFor(() => expect(title).toHaveFocus())
    const rows = await within(dialog).findAllByRole('button', { name: /,/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Gym, Fri · due',
      "Run, target met · won't add points",
      "Read, not today · won't count",
    ])
    expect(within(dialog).getByRole('heading', { name: 'Due today' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'This week' })).toBeInTheDocument()
  })

  it("one tap picks and goes to the preview; a won't-count pick still posts", async () => {
    const fake = backend()
    const { user } = await renderToday(fake)
    await user.click(screen.getByRole('button', { name: 'Check in' }))
    const dialog = await shoot(user)
    await user.click(
      await within(dialog).findByRole('button', { name: "Read, not today · won't count" }),
    )
    expect(dialog.querySelector('[data-component="target-chip"]')).toHaveTextContent('Read')
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(vi.mocked(fake.postCheckin).mock.calls[0]?.[0].commitmentId).toBe('c-read')
  })

  it('Close (or back) discards the frame and returns to the live viewfinder', async () => {
    const { user, camera } = await renderToday()
    await user.click(screen.getByRole('button', { name: 'Check in' }))
    const dialog = await shoot(user)
    await within(dialog).findByRole('heading', { name: "What's this check-in for?" })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    const shutter = await within(dialog).findByRole('button', { name: 'Take photo' })
    expect(camera.openStreams()).toHaveLength(1)
    await user.click(shutter)
    await within(dialog).findByRole('heading', { name: "What's this check-in for?" })
    await user.keyboard('{Escape}')
    expect(await within(dialog).findByRole('button', { name: 'Take photo' })).toBeInTheDocument()
  })

  it('nothing to pick: "Nothing to check in for here yet." and only Close', async () => {
    const { user } = await renderToday(backend({ checkinTargets: {} }))
    await user.click(screen.getByRole('button', { name: 'Check in' }))
    const dialog = await shoot(user)
    expect(await within(dialog).findByText('Nothing to check in for here yet.')).toBeInTheDocument()
    expect(within(dialog).getByText('Add a commitment or a task first.')).toBeInTheDocument()
    const panel = dialog.querySelector('[data-component="picker-sheet"]') as HTMLElement
    expect(
      within(panel)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Close'])
  })
})
