import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import type { EndedMembership, MyGroup } from '@/domain/groups'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { removedNoticeKey } from '@/data/group-notices'
import { createFakeBackend, renderRoutes, TEST_GROUP, TEST_MEMBERS } from '@/test/fake-backend'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

const RESET: MyGroup = {
  id: 'group-2',
  name: 'Sunday Reset',
  timeZone: 'UTC',
  role: 'member',
  joinedAt: '2026-11-05T10:00:00.000Z',
  memberCount: 4,
}

const OLD: EndedMembership = {
  membershipId: 'm-old',
  groupId: 'group-old',
  name: 'Old crew',
  endReason: 'left',
  endedAt: '2026-11-10T10:00:00.000Z',
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
  toast.showToast.mockClear()
  setOnline(true)
})

async function openSettings(path = '/me/groups/group-1?g=group-1', backend = createFakeBackend()) {
  const result = renderRoutes([path], backend)
  await screen.findByRole('heading', { level: 1, name: 'Gym Rats' })
  return result
}

describe('group settings: Members (admin)', () => {
  it('lists each member with avatar, name and role chip; Remove only on other members', async () => {
    await openSettings()
    const section = await screen.findByRole('region', { name: 'Members' })
    const rows = await within(section).findAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'JJoAdmin',
      'PPriyaMemberRemove',
      'SSamMemberRemove',
    ])
    expect(within(rows[0]).getByText('Admin')).toHaveClass('bg-vote')
    expect(within(rows[0]).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[2]).getByRole('button', { name: 'Remove Sam' })).toBeInTheDocument()
    expect(rows[0]).toHaveClass('min-h-row-min')
  })

  it('a member who is not admin sees no Members list, but sees Leave group', async () => {
    await openSettings(
      '/me/groups/group-1?g=group-1',
      createFakeBackend(undefined, { groups: [{ ...TEST_GROUP, role: 'member' }] }),
    )
    expect(screen.queryByRole('region', { name: 'Members' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave group' })).toHaveClass('text-miss')
  })

  it('a failed members load shows Inline retry, which refetches', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.listMembers).mockRejectedValue(new BackendError('network'))
    await openSettings(undefined, backend)
    expect(
      await screen.findByText(
        "Couldn't load the members. Check your signal and tap Retry.",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument()
    vi.mocked(backend.listMembers).mockResolvedValue(TEST_MEMBERS)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Priya')).toBeInTheDocument()
  })
})

describe('remove a member', () => {
  it('confirms with the story copy, removes, closes and refreshes the list', async () => {
    const user = userEvent.setup()
    const { backend } = await openSettings()
    await user.click(await screen.findByRole('button', { name: 'Remove Sam' }))

    const sheet = await screen.findByRole('dialog', { name: 'Remove Sam?' })
    expect(
      within(sheet).getByText(
        'Their open challenges and freeze requests are cancelled and they leave the leaderboard.',
      ),
    ).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }))

    expect(backend.removeMember).toHaveBeenCalledWith('group-1', 'user-3')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const section = screen.getByRole('region', { name: 'Members' })
    expect(within(section).queryByText('Sam')).not.toBeInTheDocument()
    expect(within(section).getByText('Priya')).toBeInTheDocument()
    // The trigger row is gone, so focus lands on the Members heading, not <body>.
    await vi.waitFor(() =>
      expect(within(section).getByRole('heading', { name: 'Members' })).toHaveFocus(),
    )
  })

  it('a failed call shows Inline retry in the sheet, which stays open; Retry sends it again', async () => {
    const user = userEvent.setup()
    const { backend } = await openSettings()
    vi.mocked(backend.removeMember).mockRejectedValueOnce(new BackendError('unknown'))
    await user.click(await screen.findByRole('button', { name: 'Remove Sam' }))
    const sheet = await screen.findByRole('dialog', { name: 'Remove Sam?' })
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }))

    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "Couldn't update the group. Tap Retry.",
    )
    expect(screen.getByRole('dialog', { name: 'Remove Sam?' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Retry' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backend.removeMember).toHaveBeenCalledTimes(2)
  })

  it('a known backend code shows its own copy (not_admin: "Only the group\'s admin can do that.")', async () => {
    const user = userEvent.setup()
    const { backend } = await openSettings()
    vi.mocked(backend.removeMember).mockRejectedValueOnce(new BackendError('not_admin'))
    await user.click(await screen.findByRole('button', { name: 'Remove Sam' }))
    const sheet = await screen.findByRole('dialog', { name: 'Remove Sam?' })
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "Only the group's admin can do that.",
    )
    expect(within(sheet).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('offline: the offline Inline retry, without calling the server', async () => {
    const user = userEvent.setup()
    const { backend } = await openSettings()
    await user.click(await screen.findByRole('button', { name: 'Remove Priya' }))
    const sheet = await screen.findByRole('dialog', { name: 'Remove Priya?' })
    setOnline(false)
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "You're offline. Group changes need a signal.",
    )
    expect(backend.removeMember).not.toHaveBeenCalled()
  })

  it('a request that never got a response shows the offline copy too', async () => {
    const user = userEvent.setup()
    const { backend } = await openSettings()
    vi.mocked(backend.removeMember).mockRejectedValueOnce(new BackendError('network'))
    await user.click(await screen.findByRole('button', { name: 'Remove Priya' }))
    const sheet = await screen.findByRole('dialog', { name: 'Remove Priya?' })
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "You're offline. Group changes need a signal.",
    )
  })
})

describe('leave a group', () => {
  it('the admin with others left: names the next admin; focus moves to the next group on Today', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend(undefined, { groups: [TEST_GROUP, RESET] })
    const { router } = await openSettings('/me/groups/group-1?g=group-1', backend)
    await screen.findByText('Priya')
    await user.click(screen.getByRole('button', { name: 'Leave group' }))

    const sheet = await screen.findByRole('dialog', { name: 'Leave Gym Rats?' })
    expect(
      within(sheet).getByText(
        'Your check-ins disappear from the Feed and you leave the leaderboard. Priya becomes admin.',
      ),
    ).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Leave group' }))

    expect(backend.leaveGroup).toHaveBeenCalledWith('group-1')
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/today'))
    expect(router.state.location.search).toBe('?g=group-2')
    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe('group-2')
    expect(
      await screen.findByRole('button', { name: 'Group: Sunday Reset, switch group' }),
    ).toBeInTheDocument()
    expect(screen.queryByText("You're not in Gym Rats anymore.")).not.toBeInTheDocument()
  })

  it('a member: just the story line', async () => {
    const user = userEvent.setup()
    await openSettings(
      '/me/groups/group-1?g=group-1',
      createFakeBackend(undefined, { groups: [{ ...TEST_GROUP, role: 'member' }] }),
    )
    await user.click(screen.getByRole('button', { name: 'Leave group' }))
    const sheet = await screen.findByRole('dialog', { name: 'Leave Gym Rats?' })
    expect(
      within(sheet).getByText(
        'Your check-ins disappear from the Feed and you leave the leaderboard.',
      ),
    ).toBeInTheDocument()
  })

  it('the last member: "This deletes the group."; with no groups left, Today shows the create screen', async () => {
    const user = userEvent.setup()
    const solo = { ...TEST_GROUP, memberCount: 1 }
    const { router } = await openSettings(
      '/me/groups/group-1?g=group-1',
      createFakeBackend(undefined, { groups: [solo], members: { 'group-1': [TEST_MEMBERS[0]] } }),
    )
    const visited: string[] = []
    router.subscribe((state) => visited.push(state.location.pathname))
    await user.click(screen.getByRole('button', { name: 'Leave group' }))
    const sheet = await screen.findByRole('dialog', { name: 'Leave Gym Rats?' })
    expect(
      within(sheet).getByText(
        'Your check-ins disappear from the Feed and you leave the leaderboard. This deletes the group.',
      ),
    ).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Leave group' }))

    expect(await screen.findByText('Start a group')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.search).toBe('')
    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBeNull()
    expect(visited).not.toContain('/me')
  })

  it("the admin's loaded Members list decides the last member over a stale cached count", async () => {
    const user = userEvent.setup()
    await openSettings(
      '/me/groups/group-1?g=group-1',
      createFakeBackend(undefined, { members: { 'group-1': [TEST_MEMBERS[0]] } }),
    )
    const section = await screen.findByRole('region', { name: 'Members' })
    await within(section).findByText('Jo')
    await user.click(screen.getByRole('button', { name: 'Leave group' }))
    const sheet = await screen.findByRole('dialog', { name: 'Leave Gym Rats?' })
    expect(within(sheet).getByText(/This deletes the group\.$/)).toBeInTheDocument()
  })

  it('offline: the offline Inline retry in the sheet, which stays open', async () => {
    const user = userEvent.setup()
    const { backend } = await openSettings()
    await user.click(screen.getByRole('button', { name: 'Leave group' }))
    const sheet = await screen.findByRole('dialog', { name: 'Leave Gym Rats?' })
    setOnline(false)
    await user.click(within(sheet).getByRole('button', { name: 'Leave group' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "You're offline. Group changes need a signal.",
    )
    expect(screen.getByRole('dialog', { name: 'Leave Gym Rats?' })).toBeInTheDocument()
    expect(backend.leaveGroup).not.toHaveBeenCalled()
  })

  it('a failed leave keeps the sheet open with Inline retry', async () => {
    const user = userEvent.setup()
    const backend = createFakeBackend()
    vi.mocked(backend.leaveGroup).mockRejectedValueOnce(new BackendError('unknown'))
    const { router } = await openSettings(undefined, backend)
    await user.click(screen.getByRole('button', { name: 'Leave group' }))
    const sheet = await screen.findByRole('dialog', { name: 'Leave Gym Rats?' })
    await user.click(within(sheet).getByRole('button', { name: 'Leave group' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "Couldn't update the group. Tap Retry.",
    )
    expect(router.state.location.pathname).toBe('/me/groups/group-1')
  })
})

describe('links to a group the member is no longer in', () => {
  it('/me/groups/{id}: "not in {Group} anymore"; Go to Today drops ?g=', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(
      ['/me/groups/group-old?g=group-old'],
      createFakeBackend(undefined, { ended: [OLD] }),
    )
    expect(await screen.findByText("You're not in Old crew anymore.")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/me/groups/group-old')
    await user.click(screen.getByRole('button', { name: 'Go to Today' }))
    expect(router.state.location.pathname).toBe('/today')
    await vi.waitFor(() => expect(router.state.location.search).toBe('?g=group-1'))
  })

  it('a tab with ?g= of an ended group: the Empty state, no switcher, and ?g= stays', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(
      ['/feed?g=group-old'],
      createFakeBackend(undefined, { ended: [OLD] }),
    )
    expect(await screen.findByText("You're not in Old crew anymore.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /switch group/ })).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?g=group-old')

    await user.click(screen.getByRole('button', { name: 'Go to Today' }))
    expect(
      await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/today')
    await vi.waitFor(() => expect(router.state.location.search).toBe('?g=group-1'))
  })

  it('Me with ?g= of an ended group shows Me, not the Empty state', async () => {
    renderRoutes(['/me?g=group-old'], createFakeBackend(undefined, { ended: [OLD] }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Me' })).toBeInTheDocument()
    expect(screen.queryByText("You're not in Old crew anymore.")).not.toBeInTheDocument()
  })

  it('a removal shown as the Empty state marks its removed notice seen', async () => {
    renderRoutes(
      ['/today?g=group-old'],
      createFakeBackend(undefined, {
        ended: [{ ...OLD, endReason: 'removed', endedAt: new Date().toISOString() }],
      }),
    )
    expect(await screen.findByText("You're not in Old crew anymore.")).toBeInTheDocument()
    await vi.waitFor(() => expect(localStorage.getItem(removedNoticeKey('m-old'))).toBe('1'))
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('an id the member was never in still goes back to Me', async () => {
    const { router } = renderRoutes(['/me/groups/nope?g=group-1'], createFakeBackend())
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
    expect(router.state.location.search).toBe('?g=group-1')
  })
})
