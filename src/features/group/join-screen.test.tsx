import { act, screen } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import type { InvitePreview, MyGroup } from '@/domain/groups'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { MY_GROUPS_KEY } from '@/data/groups'
import { NEXT_KEY } from '@/data/pending-signin'
import { MY_PROFILE_KEY } from '@/data/profile'
import {
  createFakeBackend,
  createTestQueryClient,
  renderRoutes,
  stubInstalled,
  TEST_GROUP,
  TEST_INVITE_PREVIEW,
  TEST_PROFILE,
  TEST_USER,
} from '@/test/fake-backend'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

afterEach(() => {
  setOnline(true)
  onlineManager.setOnline(true)
})

const SUNDAY: MyGroup = {
  id: TEST_INVITE_PREVIEW.groupId,
  name: TEST_INVITE_PREVIEW.groupName,
  timeZone: 'UTC',
  role: 'member',
  joinedAt: '2026-11-10T10:00:00.000Z',
  memberCount: 4,
}

/** A query cache already holding `['groups', 'me']` without the invite's group, and no observer. */
function staleCache() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData<MyGroup[]>(MY_GROUPS_KEY, [TEST_GROUP])
  return queryClient
}

/** Lets pending effects and refetches settle, then checks the URL is still on the joined group. */
async function expectStaysOn(router: { state: { location: { search: string } } }, search: string) {
  await screen.findByRole('button', { name: 'Group: Sunday Reset, switch group' })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  expect(router.state.location.search).toBe(search)
  expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe(TEST_INVITE_PREVIEW.groupId)
}

function backendWith(preview: Partial<InvitePreview>) {
  return createFakeBackend(undefined, {
    invites: { K7QX2M: { ...TEST_INVITE_PREVIEW, ...preview } },
  })
}

describe('join screen (/join/{code})', () => {
  it('valid: group name, admin, member count and Join; no nav', async () => {
    renderRoutes(['/join/K7QX2M'])
    expect(await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' })).toBeVisible()
    expect(screen.getByText("You're invited to")).toBeInTheDocument()
    expect(screen.getByText('Sam is the admin')).toBeInTheDocument()
    expect(screen.getByText('3 members')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('a lower-case code in the URL is looked up upper-cased', async () => {
    const { backend } = renderRoutes(['/join/k7qx2m'])
    await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' })
    expect(backend.getInvite).toHaveBeenCalledWith('K7QX2M')
  })

  it('Join reads "Joining…", then lands on /today?g={groupId} with that group focused', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    const real = backend.joinGroup.bind(backend)
    let finish: () => void = () => {}
    vi.mocked(backend.joinGroup).mockImplementationOnce(
      (code: string) =>
        new Promise<string>((resolve) => {
          finish = () => resolve(real(code))
        }),
    )
    const { router } = renderRoutes(['/join/K7QX2M'], backend)
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    const busy = screen.getByRole('button', { name: 'Joining…' })
    await user.click(busy)
    expect(backend.joinGroup).toHaveBeenCalledTimes(1)

    await act(async () => finish())
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.search).toBe('?g=group-9')
    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe('group-9')
    expect(
      await screen.findByRole('button', { name: 'Group: Sunday Reset, switch group' }),
    ).toBeInTheDocument()
  })

  it('expired: the story line and Go to Today', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(['/join/K7QX2M'], backendWith({ status: 'expired' }))
    expect(
      await screen.findByText('This invite expired. Ask Sam for a fresh one.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Go to Today' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
  })

  it('full: "{Group} is full. 10 is the max."', async () => {
    renderRoutes(['/join/K7QX2M'], backendWith({ status: 'full', memberCount: 10 }))
    expect(await screen.findByText('Sunday Reset is full. 10 is the max.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeInTheDocument()
  })

  it('unknown code: "That invite code doesn\'t work. Check it with whoever sent it."', async () => {
    renderRoutes(['/join/ZZZZZZ'])
    expect(
      await screen.findByText("That invite code doesn't work. Check it with whoever sent it."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeInTheDocument()
  })

  it('already a member: opens /today?g={groupId} directly', async () => {
    const backend = createFakeBackend(undefined, {
      invites: { K7QX2M: { ...TEST_INVITE_PREVIEW, groupId: TEST_GROUP.id } },
    })
    const { router } = renderRoutes(['/join/K7QX2M'], backend)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.search).toBe('?g=group-1')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(backend.joinGroup).not.toHaveBeenCalled()
  })

  it('invite_expired or group_full raised at Join switches to the matching state', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.joinGroup)
      .mockRejectedValueOnce(new BackendError('invite_expired'))
      .mockRejectedValueOnce(new BackendError('group_full'))
    const first = renderRoutes(['/join/K7QX2M'], backend)
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    expect(
      await screen.findByText('This invite expired. Ask Sam for a fresh one.'),
    ).toBeInTheDocument()
    first.unmount()

    renderRoutes(['/join/K7QX2M'], backend)
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    expect(await screen.findByText('Sunday Reset is full. 10 is the max.')).toBeInTheDocument()
  })

  it('an online failure at Join shows an Inline retry above Join; Retry joins', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.joinGroup).mockRejectedValueOnce(new BackendError('unknown'))
    const { router } = renderRoutes(['/join/K7QX2M'], backend)
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    const retry = await screen.findByRole('alert')
    expect(retry).toHaveTextContent("Couldn't join. Check your signal and tap Retry.")
    const join = screen.getByRole('button', { name: 'Join' })
    expect(retry.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.search).toBe('?g=group-9')
  })

  it('offline at Join: the full-screen Empty state; Try again brings the invite back', async () => {
    const user = userEvent.setup()
    const { backend } = renderRoutes(['/join/K7QX2M'])
    await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' })
    setOnline(false)
    await user.click(screen.getByRole('button', { name: 'Join' }))
    expect(screen.getByText("Can't reach Proofy.")).toBeInTheDocument()
    expect(screen.getByText('Joining needs a signal.')).toBeInTheDocument()
    expect(backend.joinGroup).not.toHaveBeenCalled()

    setOnline(true)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Join' })).toBeInTheDocument()
  })

  it('a network error at Join while the device says online: offline Empty state; Try again brings Join back', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.joinGroup).mockRejectedValueOnce(new BackendError('network'))
    renderRoutes(['/join/K7QX2M'], backend)
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    expect(await screen.findByText("Can't reach Proofy.")).toBeInTheDocument()
    expect(screen.getByText('Joining needs a signal.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Join' })).toBeInTheDocument()
  })

  it('invite_not_found at Join after a valid preview: the unknown-code copy and Go to Today', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.joinGroup).mockRejectedValueOnce(new BackendError('invite_not_found'))
    renderRoutes(['/join/K7QX2M'], backend)
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    expect(
      await screen.findByText("That invite code doesn't work. Check it with whoever sent it."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeInTheDocument()
  })

  it('opened offline (query paused): offline Empty state; Try again once online shows the invite', async () => {
    const user = userEvent.setup()
    setOnline(false)
    onlineManager.setOnline(false)
    // The profile comes from the persisted cache in the app; offline it cannot be fetched.
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(MY_PROFILE_KEY, TEST_PROFILE)
    renderRoutes(['/join/K7QX2M'], createFakeBackend(), { queryClient })
    expect(await screen.findByText("Can't reach Proofy.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument()

    setOnline(true)
    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    act(() => onlineManager.setOnline(true))
    if (tryAgain.isConnected) await user.click(tryAgain)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument()
  })

  it('a load that never got a response shows the offline Empty state with Try again', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.getInvite).mockRejectedValueOnce(new BackendError('network'))
    renderRoutes(['/join/K7QX2M'], backend)
    expect(await screen.findByText("Can't reach Proofy.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' })).toBeVisible()
  })

  it('any other load failure shows an Inline retry', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.getInvite).mockRejectedValueOnce(new BackendError('unknown'))
    renderRoutes(['/join/K7QX2M'], backend)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the invite. Check your signal and tap Retry.",
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Join' })).toBeInTheDocument()
  })

  it('signed out: sign-in, then back on /join/{code}', async () => {
    stubInstalled()
    const backend = createFakeBackend(null)
    const { router } = renderRoutes(['/join/K7QX2M'], backend)
    await screen.findByRole('heading', { level: 1, name: 'Sign in to Proofy' })
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/join/K7QX2M')

    act(() => backend.emit(TEST_USER))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/join/K7QX2M')
    expect(sessionStorage.getItem(NEXT_KEY)).toBeNull()
  })

  it('signed out new member: sign-in, setup, then back on /join/{code}', async () => {
    const user = userEvent.setup()
    stubInstalled()
    const backend = createFakeBackend(null, { profile: null, groups: [] })
    const { router } = renderRoutes(['/join/K7QX2M'], backend)
    await screen.findByRole('heading', { level: 1, name: 'Sign in to Proofy' })
    act(() => backend.emit(TEST_USER))

    await user.type(await screen.findByLabelText('Display name'), 'Jo')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sunday Reset' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/join/K7QX2M')
  })
})

describe('join screen with a stale groups cache and no observer', () => {
  it('Join lands on /today?g={joined id} and stays there', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(['/join/K7QX2M'], createFakeBackend(), {
      queryClient: staleCache(),
    })
    await user.click(await screen.findByRole('button', { name: 'Join' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    await expectStaysOn(router, '?g=group-9')
  })

  it('already a member: refetches the groups, then opens /today?g={groupId} and stays', async () => {
    const backend = createFakeBackend(undefined, { groups: [TEST_GROUP, SUNDAY] })
    const { router } = renderRoutes(['/join/K7QX2M'], backend, { queryClient: staleCache() })
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    await expectStaysOn(router, '?g=group-9')
    expect(backend.joinGroup).not.toHaveBeenCalled()
  })
})

describe('the admin after a second member joins', () => {
  it("on the next refetch the waiting Empty state is gone and the switcher's dot fills", async () => {
    const waiting: MyGroup = { ...TEST_GROUP, memberCount: 1 }
    const backend = createFakeBackend(undefined, { groups: [waiting] })
    const { queryClient } = renderRoutes(['/today?g=group-1'], backend)
    expect(await screen.findByText('Just you in here so far.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Invite friends' })).toBeInTheDocument()
    const switcher = screen.getByRole('button', { name: 'Group: Gym Rats, switch group' })
    expect(switcher.querySelector('[data-waiting]')).not.toBeNull()

    vi.mocked(backend.listMyGroups).mockResolvedValue([{ ...waiting, memberCount: 2 }])
    await act(() => queryClient.invalidateQueries({ queryKey: MY_GROUPS_KEY }))
    await vi.waitFor(() =>
      expect(screen.queryByText('Just you in here so far.')).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('region', { name: 'Invite friends' })).not.toBeInTheDocument()
    expect(
      screen
        .getByRole('button', { name: 'Group: Gym Rats, switch group' })
        .querySelector('[data-waiting]'),
    ).toBeNull()
  })
})
