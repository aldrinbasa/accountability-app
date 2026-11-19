import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import type { GroupActivity } from '@/domain/activities'
import {
  groupActivitiesKey,
  PRESET_ACTIVITIES_KEY,
  useGroupActivities,
  usePresetActivities,
} from '@/data/activities'
import {
  createFakeBackend,
  createTestQueryClient,
  TEST_GROUP,
  TEST_PRESETS,
  withBackend,
} from '@/test/fake-backend'

const POTTERY: GroupActivity = {
  id: 'ga-pottery',
  groupId: TEST_GROUP.id,
  presetKey: null,
  customName: 'Pottery',
  createdBy: 'user-2',
  lockedScheduleType: null,
}

function setup(backend = createFakeBackend()) {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    withBackend(backend, children, undefined, queryClient)
  return { backend, queryClient, wrapper }
}

describe('activity data', () => {
  it("usePresetActivities reads the presets once under ['presetActivities'] and keeps them fresh", async () => {
    const { backend, queryClient, wrapper } = setup()
    const { result } = renderHook(() => usePresetActivities(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(TEST_PRESETS)
    expect(queryClient.getQueryData(PRESET_ACTIVITIES_KEY)).toEqual(TEST_PRESETS)
    expect(result.current.isStale).toBe(false)
    renderHook(() => usePresetActivities(), { wrapper })
    expect(backend.listPresetActivities).toHaveBeenCalledTimes(1)
  })

  it("useGroupActivities reads a group's activities under ['groupActivities', groupId]", async () => {
    const { backend, queryClient, wrapper } = setup(
      createFakeBackend(undefined, { groupActivities: { [TEST_GROUP.id]: [POTTERY] } }),
    )
    const { result } = renderHook(() => useGroupActivities(TEST_GROUP.id), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([POTTERY])
    expect(backend.listGroupActivities).toHaveBeenCalledWith(TEST_GROUP.id)
    expect(queryClient.getQueryData(groupActivitiesKey(TEST_GROUP.id))).toEqual([POTTERY])
    expect(groupActivitiesKey('g9')).toEqual(['groupActivities', 'g9'])
  })
})
