import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FALLBACK_TIME_ZONE, type Profile } from '@/domain/profile'
import { chooseZone, type TimeZoneState } from '@/domain/time-zones'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'

/** The signed-in member's own profile. Sign-out clears the whole query cache, this key included. */
export const MY_PROFILE_KEY = ['profile', 'me'] as const

export interface ProfileRepository {
  getMine(): Promise<Profile | null>
  save(displayName: string, timeZone: string): Promise<Profile>
  setTimeZone(timeZone: string): Promise<TimeZoneState>
}

/** Profile reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createProfileRepository(backend: BackendPort): ProfileRepository {
  return {
    getMine: () => backend.getMyProfile(),
    save: (displayName, timeZone) => backend.saveProfile(displayName, timeZone),
    setTimeZone: (timeZone) => backend.setTimeZone(timeZone),
  }
}

function useProfileRepository(hook: string): ProfileRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createProfileRepository(backend), [backend])
}

/**
 * `['profile', 'me']`: `null` before Setup. Retries once, then fails (the gate shows the app rather
 * than a blank screen) and refetches on focus as usual.
 */
export function useMyProfile() {
  const repository = useProfileRepository('useMyProfile')
  return useQuery({
    queryKey: MY_PROFILE_KEY,
    queryFn: () => repository.getMine(),
    retry: 1,
    retryDelay: 500,
  })
}

export interface SaveProfileInput {
  displayName: string
  timeZone: string
}

/** `save_profile`. Success writes the stored profile into `['profile', 'me']`. */
export function useSaveProfile() {
  const repository = useProfileRepository('useSaveProfile')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ displayName, timeZone }: SaveProfileInput) =>
      repository.save(displayName, timeZone),
    onSuccess: async (profile) => {
      // A focus refetch started before the save could land after it and write `null` back.
      await queryClient.cancelQueries({ queryKey: MY_PROFILE_KEY })
      queryClient.setQueryData(MY_PROFILE_KEY, profile)
    },
  })
}

/**
 * `set_time_zone` for the member's own zone. Optimistic: `['profile', 'me']` shows the choice at once
 * and goes back to what it was if the call fails; success writes the server's zones (with the start
 * Monday of a waiting change).
 */
export function useSetMyTimeZone() {
  const repository = useProfileRepository('useSetMyTimeZone')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (timeZone: string) => repository.setTimeZone(timeZone),
    onMutate: async (timeZone) => {
      await queryClient.cancelQueries({ queryKey: MY_PROFILE_KEY })
      const previous = queryClient.getQueryData<Profile | null>(MY_PROFILE_KEY)
      if (previous)
        queryClient.setQueryData<Profile>(MY_PROFILE_KEY, chooseZone(previous, timeZone))
      return { previous }
    },
    onError: (_error, _timeZone, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(MY_PROFILE_KEY, context.previous)
      }
    },
    onSuccess: async (state) => {
      await queryClient.cancelQueries({ queryKey: MY_PROFILE_KEY })
      queryClient.setQueryData<Profile | null>(MY_PROFILE_KEY, (profile) =>
        profile ? { ...profile, ...state } : profile,
      )
    },
  })
}

/** The device zone (`Intl`), or `UTC` when the runtime reports none. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone !== '' ? zone : FALLBACK_TIME_ZONE
  } catch {
    return FALLBACK_TIME_ZONE
  }
}
