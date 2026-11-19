import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FALLBACK_TIME_ZONE, type Profile } from '@/domain/profile'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'

/** The signed-in member's own profile. Sign-out clears the whole query cache, this key included. */
export const MY_PROFILE_KEY = ['profile', 'me'] as const

export interface ProfileRepository {
  getMine(): Promise<Profile | null>
  save(displayName: string, timeZone: string): Promise<Profile>
}

/** Profile reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createProfileRepository(backend: BackendPort): ProfileRepository {
  return {
    getMine: () => backend.getMyProfile(),
    save: (displayName, timeZone) => backend.saveProfile(displayName, timeZone),
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

/** The device zone (`Intl`), or `UTC` when the runtime reports none. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone !== '' ? zone : FALLBACK_TIME_ZONE
  } catch {
    return FALLBACK_TIME_ZONE
  }
}
