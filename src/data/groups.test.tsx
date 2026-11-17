import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import {
  inviteKey,
  invitePreviewKey,
  MY_GROUPS_KEY,
  useCreateGroup,
  useInvite,
  useInvitePreview,
  useJoinGroup,
  useMyGroups,
  useNewInvite,
} from '@/data/groups'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  TEST_INVITE,
  TEST_INVITE_PREVIEW,
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
    expect(queryClient.getQueryData(MY_GROUPS_KEY)).toEqual([TEST_GROUP])
  })

  it('useCreateGroup calls create_group and refetches the groups before resolving', async () => {
    const { backend, queryClient, wrapper } = setup(createFakeBackend(undefined, { groups: [] }))
    const { result } = renderHook(() => ({ groups: useMyGroups(), create: useCreateGroup() }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.groups.data).toEqual([]))

    const id = await result.current.create.mutateAsync('Sunday Reset')
    expect(backend.createGroup).toHaveBeenCalledWith('Sunday Reset')
    expect(queryClient.getQueryData(MY_GROUPS_KEY)).toEqual([
      expect.objectContaining({ id, name: 'Sunday Reset', role: 'admin', memberCount: 1 }),
    ])
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
    expect(queryClient.getQueryData<{ id: string }[]>(MY_GROUPS_KEY)?.map((g) => g.id)).toEqual([
      'group-1',
      TEST_INVITE_PREVIEW.groupId,
    ])
    expect(queryClient.getQueryData<{ status: string }>(invitePreviewKey('K7QX2M'))?.status).toBe(
      'member',
    )
  })
})
