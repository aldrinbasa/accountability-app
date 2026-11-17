import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { MY_GROUPS_KEY, useCreateGroup, useMyGroups } from '@/data/groups'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
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
