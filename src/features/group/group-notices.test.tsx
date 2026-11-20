import { screen } from '@testing-library/react'
import type { EndedMembership } from '@/domain/groups'
import { FOCUSED_GROUP_KEY } from '@/data/focused-group'
import { lastSeenCountKey, removedNoticeKey } from '@/data/group-notices'
import { createFakeBackend, renderRoutes, TEST_GROUP } from '@/test/fake-backend'
import { waitForGroupInUrl } from '@/test/router'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

const DAY = 24 * 60 * 60 * 1000

function removed(membershipId: string, name: string, agoMs: number): EndedMembership {
  return {
    membershipId,
    groupId: `group-${membershipId}`,
    name,
    endReason: 'removed',
    endedAt: new Date(Date.now() - agoMs).toISOString(),
  }
}

beforeEach(() => toast.showToast.mockClear())

async function openToday(backend = createFakeBackend()) {
  const result = renderRoutes(['/today'], backend)
  await screen.findByRole('button', { name: /switch group/ })
  return result
}

describe('Today: removed from a group', () => {
  it('a removal in the last 7 days: the group is gone, focus moved on, one toast once', async () => {
    localStorage.setItem(FOCUSED_GROUP_KEY, 'group-m1')
    const backend = createFakeBackend(undefined, {
      ended: [removed('m1', 'Sunday Reset', DAY)],
    })
    const { router, unmount } = await openToday(backend)
    expect(
      screen.getByRole('button', { name: 'Group: Gym Rats, switch group' }),
    ).toBeInTheDocument()
    await waitForGroupInUrl(router, 'group-1')
    await vi.waitFor(() =>
      expect(toast.showToast).toHaveBeenCalledWith("You're no longer in Sunday Reset.", {
        id: 'removed-m1',
      }),
    )
    expect(localStorage.getItem(removedNoticeKey('m1'))).toBe('1')
    unmount()

    toast.showToast.mockClear()
    await openToday(backend)
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('removed while the URL held the synced ?g=: focus moves on and the toast shows (no Empty state)', async () => {
    localStorage.setItem(FOCUSED_GROUP_KEY, 'group-m1')
    const { router } = renderRoutes(
      ['/today?g=group-m1'],
      createFakeBackend(undefined, { ended: [removed('m1', 'Sunday Reset', DAY)] }),
    )
    expect(
      await screen.findByRole('button', { name: 'Group: Gym Rats, switch group' }),
    ).toBeInTheDocument()
    await waitForGroupInUrl(router, 'group-1')
    expect(screen.queryByText("You're not in Sunday Reset anymore.")).not.toBeInTheDocument()
    await vi.waitFor(() =>
      expect(toast.showToast).toHaveBeenCalledWith("You're no longer in Sunday Reset.", {
        id: 'removed-m1',
      }),
    )
  })

  it('two recent removals: one toast per visit, newest first, then none', async () => {
    const backend = createFakeBackend(undefined, {
      ended: [removed('m1', 'Sunday Reset', 2 * DAY), removed('m2', 'Book Club', DAY)],
    })
    const first = await openToday(backend)
    await vi.waitFor(() => expect(toast.showToast).toHaveBeenCalledTimes(1))
    expect(toast.showToast).toHaveBeenCalledWith("You're no longer in Book Club.", {
      id: 'removed-m2',
    })
    first.unmount()

    toast.showToast.mockClear()
    const second = await openToday(backend)
    await vi.waitFor(() => expect(toast.showToast).toHaveBeenCalledTimes(1))
    expect(toast.showToast).toHaveBeenCalledWith("You're no longer in Sunday Reset.", {
      id: 'removed-m1',
    })
    second.unmount()

    toast.showToast.mockClear()
    await openToday(backend)
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('an older removal (a fresh device) and a plain leave stay silent', async () => {
    await openToday(
      createFakeBackend(undefined, {
        ended: [
          removed('m1', 'Sunday Reset', 8 * DAY),
          { ...removed('m2', 'Old crew', DAY), endReason: 'left' },
        ],
      }),
    )
    expect(toast.showToast).not.toHaveBeenCalled()
  })
})

describe('Today: everyone else left', () => {
  it('last seen 2 or more, now 1: the waiting state and a toast once', async () => {
    localStorage.setItem(lastSeenCountKey('group-1'), '3')
    const backend = createFakeBackend(undefined, { groups: [{ ...TEST_GROUP, memberCount: 1 }] })
    const { unmount } = await openToday(backend)
    expect(screen.getByText('Just you in here so far.')).toBeInTheDocument()
    await vi.waitFor(() =>
      expect(toast.showToast).toHaveBeenCalledWith(
        'Everyone else left Gym Rats. Scoring pauses until someone joins.',
        { id: 'everyone-left-group-1' },
      ),
    )
    expect(localStorage.getItem(lastSeenCountKey('group-1'))).toBe('1')
    unmount()

    toast.showToast.mockClear()
    await openToday(backend)
    expect(toast.showToast).not.toHaveBeenCalled()
  })

  it('a new 1-member group never seen with more stays silent, and the count is stored', async () => {
    await openToday(createFakeBackend(undefined, { groups: [{ ...TEST_GROUP, memberCount: 1 }] }))
    await vi.waitFor(() => expect(localStorage.getItem(lastSeenCountKey('group-1'))).toBe('1'))
    expect(toast.showToast).not.toHaveBeenCalled()
  })
})
