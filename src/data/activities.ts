import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { GroupActivity, PresetActivity } from '@/domain/activities'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'

/** `['presetActivities']`: the 20 global presets. They never change at runtime. */
export const PRESET_ACTIVITIES_KEY = ['presetActivities'] as const

/** `['groupActivities', groupId]`: a group's activities for the picker. */
export function groupActivitiesKey(groupId: string) {
  return ['groupActivities', groupId] as const
}

export interface ActivityRepository {
  presets(): Promise<PresetActivity[]>
  groupActivities(groupId: string): Promise<GroupActivity[]>
}

/** Activity reads over `BackendPort` (AD-2: feature hook → repository → adapter). Read-only. */
export function createActivityRepository(backend: BackendPort): ActivityRepository {
  return {
    presets: () => backend.listPresetActivities(),
    groupActivities: (groupId) => backend.listGroupActivities(groupId),
  }
}

function useActivityRepository(hook: string): ActivityRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createActivityRepository(backend), [backend])
}

/** `['presetActivities']`: the presets in display order. Fetched once (staleTime Infinity). */
export function usePresetActivities() {
  const repository = useActivityRepository('usePresetActivities')
  return useQuery({
    queryKey: PRESET_ACTIVITIES_KEY,
    queryFn: () => repository.presets(),
    staleTime: Infinity,
    retry: 1,
    retryDelay: 500,
  })
}

/** `['groupActivities', groupId]`: the group's preset rows and custom activities. Retries once. */
export function useGroupActivities(groupId: string) {
  const repository = useActivityRepository('useGroupActivities')
  return useQuery({
    queryKey: groupActivitiesKey(groupId),
    queryFn: () => repository.groupActivities(groupId),
    retry: 1,
    retryDelay: 500,
  })
}
