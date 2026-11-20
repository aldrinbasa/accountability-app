import { useCallback, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AVATAR_EDGE,
  AVATAR_PHOTO_QUALITY,
  avatarObjectPath,
  FALLBACK_TIME_ZONE,
  type Profile,
  type SavedAvatar,
} from '@/domain/profile'
import { chooseZone, type TimeZoneState } from '@/domain/time-zones'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { useImageEncoder } from '@/data/image-encoder-context'
import { retryOnline } from '@/data/query-client'
import { useSaveFlow, type SaveFailure } from '@/data/save-flow'

/** The signed-in member's own profile. Sign-out clears the whole query cache, this key included. */
export const MY_PROFILE_KEY = ['profile', 'me'] as const

export interface ProfileRepository {
  getMine(): Promise<Profile | null>
  save(displayName: string, timeZone: string): Promise<Profile>
  setTimeZone(timeZone: string): Promise<TimeZoneState>
  uploadAvatar(path: string, photo: Blob): Promise<void>
  setAvatarPath(path: string): Promise<Profile>
}

/** Profile reads and writes over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createProfileRepository(backend: BackendPort): ProfileRepository {
  return {
    getMine: () => backend.getMyProfile(),
    save: (displayName, timeZone) => backend.saveProfile(displayName, timeZone),
    setTimeZone: (timeZone) => backend.setTimeZone(timeZone),
    uploadAvatar: (path, photo) => backend.uploadAvatar(path, photo),
    setAvatarPath: (path) => backend.setAvatarPath(path),
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
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

export interface SaveProfileInput {
  displayName: string
  timeZone: string
  /** Setup's photo, already in Storage (Story 3.6): set as `avatar_path` after `save_profile`. */
  avatarPath?: string | null
}

/**
 * `save_profile`, then, with an `avatarPath`, the `avatar_path` update. Success (both) writes the
 * stored profile into `['profile', 'me']`; a failed path update writes nothing, so a retry runs both
 * again (`save_profile` is idempotent).
 */
export function useSaveProfile() {
  const repository = useProfileRepository('useSaveProfile')
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ displayName, timeZone, avatarPath }: SaveProfileInput) => {
      const saved = await repository.save(displayName, timeZone)
      return avatarPath ? repository.setAvatarPath(avatarPath) : saved
    },
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

const selectZone = (profile: Profile | null): string | null => profile?.timeZone ?? null

/**
 * The member's zone for showing times (offline Banner, outbox Banners): the cached profile's, else
 * the device's. Reads the cache only: it never fetches the profile itself (the profile gate does),
 * so mounting it cannot restart a failed read.
 */
export function useMemberTimeZone(): string {
  const repository = useProfileRepository('useMemberTimeZone')
  const { data } = useQuery({
    queryKey: MY_PROFILE_KEY,
    queryFn: () => repository.getMine(),
    enabled: false,
    select: selectZone,
  })
  return data ?? deviceTimeZone()
}

export interface SaveAvatarOptions {
  /** The square shot. */
  canvas: HTMLCanvasElement
  /** The signed-in member, whose folder the photo goes in. */
  userId: string
  /** Also point the profile's `avatar_path` at the upload (Settings), or only upload (Setup). */
  saveToProfile: boolean
  /** In Storage (and on the profile with `saveToProfile`). */
  onSaved: (saved: SavedAvatar) => void
}

export interface SaveAvatarFlow {
  /** "Saving…": taps are ignored. */
  busy: boolean
  /** The busy guard itself (no render lag), for back during a save. */
  isBusy: () => boolean
  /** Inline retry: `offline` (no request was sent, or none got through) or `failed`. */
  failure: SaveFailure | null
  /** Use photo. */
  save: () => void
  /** Retry: the same encoded photo and version again. */
  retry: () => void
}

/**
 * Use photo (Story 3.6): encodes one 256 px square WebP through `ImageEncodePort` (once per shot),
 * uploads it to `avatars/{user_id}/{version}.webp` with a new version id, then (Settings) updates
 * the member's own `avatar_path` and writes `['profile', 'me']`. Avatars never queue offline: offline
 * sends nothing and `network` reads as offline; anything else is `failed`. Retry reuses the blob and
 * version, and an upload that already landed counts as done.
 */
export function useSaveAvatar({
  canvas,
  userId,
  saveToProfile,
  onSaved,
}: SaveAvatarOptions): SaveAvatarFlow {
  const repository = useProfileRepository('useSaveAvatar')
  const encoder = useImageEncoder('useSaveAvatar')
  const queryClient = useQueryClient()
  const prepared = useRef<SavedAvatar | null>(null)

  const run = useCallback(async (): Promise<SavedAvatar> => {
    if (prepared.current === null) {
      const photo = await encoder.encodeWebp(canvas, AVATAR_EDGE, AVATAR_PHOTO_QUALITY)
      prepared.current = { path: avatarObjectPath(userId, crypto.randomUUID()), photo }
    }
    const saved = prepared.current
    await repository.uploadAvatar(saved.path, saved.photo)
    if (saveToProfile) {
      const profile = await repository.setAvatarPath(saved.path)
      await queryClient.cancelQueries({ queryKey: MY_PROFILE_KEY })
      queryClient.setQueryData(MY_PROFILE_KEY, profile)
      // Members lists carry avatar paths too.
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    }
    return saved
  }, [canvas, encoder, queryClient, repository, saveToProfile, userId])

  const flow = useSaveFlow<undefined, SavedAvatar>({
    run,
    onSaved: (saved, _input, live) => {
      if (live) onSaved(saved)
    },
    // The camera closes on success: Use photo must not send twice meanwhile.
    holdBusyOnSaved: true,
  })

  return {
    busy: flow.busy,
    isBusy: flow.isBusy,
    failure: flow.failure,
    save: () => void flow.send(undefined),
    retry: () => {
      if (!flow.retry()) void flow.send(undefined)
    },
  }
}
