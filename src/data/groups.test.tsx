import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { BackendError } from '@/domain/error-codes'
import type { EndedMembership, MyGroupsSnapshot } from '@/domain/groups'
import { getLastSeenCount } from '@/data/group-notices'
import {
  inviteKey,
  invitePreviewKey,
  membersKey,
  MY_GROUPS_KEY,
  remainingGroups,
  useCreateGroup,
  useEndedMemberships,
  useLeaveGroup,
  useMembers,
  useRemoveMember,
  useInvite,
  useInvitePreview,
  useJoinGroup,
  useMyGroups,
  useNewInvite,
  useSetGroupTimeZone,
} from '@/data/groups'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  TEST_INVITE,
  TEST_INVITE_PREVIEW,
  TEST_MEMBERS,
  withBackend,
} from '@/test/fake-backend'

function setup(backend = createFakeBackend()) {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    withBackend(backend, children, undefined, queryClient)
  return { backend, queryClient, wrapper }
}

describe('group data', () => {
  it("useMyGroups reads ['groups', 'me'] through the backend", async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(() => useMyGroups(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([TEST_GROUP]))
    expect(backend.listMyGroups).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(MY_GROUPS_KEY)).toEqual({ groups: [TEST_GROUP], ended: [] })
  })

  it('useCreateGroup calls create_group and refetches the groups before resolving', async () => {
    const { backend, queryClient, wrapper } = setup(createFakeBackend(undefined, { groups: [] }))
    const { result } = renderHook(() => ({ groups: useMyGroups(), create: useCreateGroup() }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.groups.data).toEqual([]))

    const id = await result.current.create.mutateAsync('Sunday Reset')
    expect(backend.createGroup).toHaveBeenCalledWith('Sunday Reset')
    expect(queryClient.getQueryData(MY_GROUPS_KEY)).toEqual({
      groups: [
        expect.objectContaining({ id, name: 'Sunday Reset', role: 'admin', memberCount: 1 }),
      ],
      ended: [],
    })
  })
})

describe('invite data', () => {
  it("useInvite reads ['invite', groupId] via create_invite(groupId, false), only when enabled", async () => {
    const { backend, queryClient, wrapper } = setup()
    const disabled = renderHook(() => useInvite('group-1', false), { wrapper })
    expect(disabled.result.current.fetchStatus).toBe('idle')
    expect(backend.createInvite).not.toHaveBeenCalled()

    const { result } = renderHook(() => useInvite('group-1', true), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TEST_INVITE))
    expect(backend.createInvite).toHaveBeenCalledWith('group-1', false)
    expect(queryClient.getQueryData(inviteKey('group-1'))).toEqual(TEST_INVITE)
  })

  it('useNewInvite calls create_invite(groupId, true) and replaces the cached invite', async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(() => useNewInvite('group-1'), { wrapper })
    const invite = await result.current.mutateAsync()
    expect(backend.createInvite).toHaveBeenCalledWith('group-1', true)
    expect(queryClient.getQueryData(inviteKey('group-1'))).toEqual(invite)
  })

  it("useInvitePreview reads ['invite', 'code', code] and does not retry an unknown code", async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(() => useInvitePreview('K7QX2M'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TEST_INVITE_PREVIEW))
    expect(queryClient.getQueryData(invitePreviewKey('K7QX2M'))).toEqual(TEST_INVITE_PREVIEW)

    const unknown = renderHook(() => useInvitePreview('ZZZZZZ'), { wrapper })
    await waitFor(() => expect(unknown.result.current.isError).toBe(true))
    expect(vi.mocked(backend.getInvite).mock.calls.filter(([c]) => c === 'ZZZZZZ')).toHaveLength(1)
  })

  it("useJoinGroup joins, refetches ['groups', 'me'] with the group, and marks the preview member", async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(
      () => ({
        groups: useMyGroups(),
        preview: useInvitePreview('K7QX2M'),
        join: useJoinGroup(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.preview.data?.status).toBe('valid'))
    const id = await result.current.join.mutateAsync('K7QX2M')
    expect(id).toBe(TEST_INVITE_PREVIEW.groupId)
    expect(backend.joinGroup).toHaveBeenCalledWith('K7QX2M')
    expect(
      queryClient.getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)?.groups.map((g) => g.id),
    ).toEqual(['group-1', TEST_INVITE_PREVIEW.groupId])
    expect(queryClient.getQueryData<{ status: string }>(invitePreviewKey('K7QX2M'))?.status).toBe(
      'member',
    )
  })
})

describe('members, leave and remove data', () => {
  const ENDED: EndedMembership = {
    membershipId: 'm-old',
    groupId: 'group-old',
    name: 'Old crew',
    endReason: 'removed',
    endedAt: '2026-11-10T10:00:00.000Z',
  }

  it("useEndedMemberships reads the ended part of ['groups', 'me']", async () => {
    const { backend, wrapper } = setup(createFakeBackend(undefined, { ended: [ENDED] }))
    const { result } = renderHook(() => ({ ended: useEndedMemberships(), groups: useMyGroups() }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.ended.data).toEqual([ENDED]))
    expect(result.current.groups.data).toEqual([TEST_GROUP])
    expect(backend.listMyGroups).toHaveBeenCalledTimes(1)
  })

  it("useMembers reads ['members', groupId], only when enabled", async () => {
    const { backend, queryClient, wrapper } = setup()
    const disabled = renderHook(() => useMembers('group-1', false), { wrapper })
    expect(disabled.result.current.fetchStatus).toBe('idle')
    expect(backend.listMembers).not.toHaveBeenCalled()

    const { result } = renderHook(() => useMembers('group-1', true), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(TEST_MEMBERS))
    expect(queryClient.getQueryData(membersKey('group-1'))).toEqual(TEST_MEMBERS)
  })

  it("useLeaveGroup leaves, refetches ['groups', 'me'] with no observer and drops the group's queries", async () => {
    const other = { ...TEST_GROUP, id: 'group-2', name: 'Sunday Reset' }
    const { backend, queryClient, wrapper } = setup(
      createFakeBackend(undefined, { groups: [TEST_GROUP, other] }),
    )
    queryClient.setQueryData(MY_GROUPS_KEY, { groups: [TEST_GROUP, other], ended: [] })
    queryClient.setQueryData(membersKey('group-1'), TEST_MEMBERS)
    queryClient.setQueryData(inviteKey('group-1'), TEST_INVITE)
    queryClient.setQueryData(invitePreviewKey('K7QX2M'), {
      ...TEST_INVITE_PREVIEW,
      status: 'member',
    })
    queryClient.setQueryData(invitePreviewKey('AB12CD'), TEST_INVITE_PREVIEW)
    const { result } = renderHook(() => useLeaveGroup('group-1'), { wrapper })

    await result.current.mutateAsync()
    expect(backend.leaveGroup).toHaveBeenCalledWith('group-1')
    const snapshot = queryClient.getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)
    expect(snapshot?.groups.map((g) => g.id)).toEqual(['group-2'])
    expect(snapshot?.ended.map((e) => e.groupId)).toEqual(['group-1'])
    expect(remainingGroups(queryClient, 'group-1').map((g) => g.id)).toEqual(['group-2'])
    expect(queryClient.getQueryData(membersKey('group-1'))).toBeUndefined()
    expect(queryClient.getQueryData(inviteKey('group-1'))).toBeUndefined()
    // Every cached invite preview goes, so a rejoin with a code joined before is not bounced.
    expect(queryClient.getQueryData(invitePreviewKey('K7QX2M'))).toBeUndefined()
    expect(queryClient.getQueryData(invitePreviewKey('AB12CD'))).toBeUndefined()
  })

  it('useLeaveGroup treats not_member as already left and rejects other failures', async () => {
    const { backend, wrapper } = setup()
    const { result } = renderHook(() => useLeaveGroup('group-1'), { wrapper })
    vi.mocked(backend.leaveGroup).mockRejectedValueOnce(new BackendError('not_member'))
    await expect(result.current.mutateAsync()).resolves.toBeUndefined()
    vi.mocked(backend.leaveGroup).mockRejectedValueOnce(new BackendError('network'))
    await expect(result.current.mutateAsync()).rejects.toMatchObject({ code: 'network' })
  })

  it('useRemoveMember treats not_member as already gone and rejects other failures', async () => {
    const { backend, wrapper } = setup()
    const { result } = renderHook(() => useRemoveMember('group-1'), { wrapper })
    vi.mocked(backend.removeMember).mockRejectedValueOnce(new BackendError('not_member'))
    await expect(result.current.mutateAsync('user-3')).resolves.toBeUndefined()
    vi.mocked(backend.removeMember).mockRejectedValueOnce(new BackendError('network'))
    await expect(result.current.mutateAsync('user-3')).rejects.toMatchObject({ code: 'network' })
  })

  it('useRemoveMember removes, refreshes members and groups, and stores the new member count', async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(
      () => ({ members: useMembers('group-1', true), remove: useRemoveMember('group-1') }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.members.data).toEqual(TEST_MEMBERS))
    await result.current.remove.mutateAsync('user-3')
    expect(backend.removeMember).toHaveBeenCalledWith('group-1', 'user-3')
    expect(
      queryClient.getQueryData<{ userId: string }[]>(membersKey('group-1'))?.map((m) => m.userId),
    ).toEqual(['user-1', 'user-2'])
    expect(queryClient.getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)?.groups[0]?.memberCount).toBe(
      2,
    )
    expect(getLastSeenCount('group-1')).toBe(2)
  })

  it("useSetGroupTimeZone shows the choice at once, then the server's zones", async () => {
    const { backend, queryClient, wrapper } = setup()
    const other = { ...TEST_GROUP, id: 'group-2', name: 'Other' }
    queryClient.setQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY, {
      groups: [TEST_GROUP, other],
      ended: [],
    })
    let resolve: () => void = () => {}
    const gate = new Promise<void>((r) => (resolve = r))
    const set = backend.setTimeZone
    backend.setTimeZone = vi.fn(async (zone: string, groupId?: string) => {
      await gate
      return set(zone, groupId)
    })
    const { result } = renderHook(() => useSetGroupTimeZone(TEST_GROUP.id), { wrapper })
    const done = result.current.mutateAsync('Europe/London')
    await waitFor(() =>
      expect(queryClient.getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)?.groups[0]).toMatchObject({
        pendingTimeZone: 'Europe/London',
        pendingWeekStart: null,
      }),
    )
    resolve()
    await done
    expect(backend.setTimeZone).toHaveBeenCalledWith('Europe/London', TEST_GROUP.id)
    expect(queryClient.getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)?.groups).toEqual([
      { ...TEST_GROUP, pendingTimeZone: 'Europe/London', pendingWeekStart: '2026-11-23' },
      other,
    ])
  })

  it("useSetGroupTimeZone puts the group's zones back when the call fails", async () => {
    const { backend, queryClient, wrapper } = setup()
    queryClient.setQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY, { groups: [TEST_GROUP], ended: [] })
    backend.setTimeZone = vi.fn().mockRejectedValue(new BackendError('not_admin'))
    const { result } = renderHook(() => useSetGroupTimeZone(TEST_GROUP.id), { wrapper })
    await expect(result.current.mutateAsync('Europe/London')).rejects.toThrow()
    expect(queryClient.getQueryData<MyGroupsSnapshot>(MY_GROUPS_KEY)?.groups).toEqual([TEST_GROUP])
  })
})
