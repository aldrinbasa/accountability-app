import type { RpcErrorCode } from '@/domain/error-codes'

/**
 * A member's profile (`public.profiles`). Story 3.6 fills `avatarPath`. `timeZone` changes only
 * through `set_time_zone` (Story 2.7): a waiting change has `pendingTimeZone` and the Monday it
 * starts, `pendingWeekStart` (both null otherwise).
 */
export interface Profile {
  id: string
  displayName: string
  avatarPath: string | null
  timeZone: string
  pendingTimeZone: string | null
  pendingWeekStart: string | null
}

/** Display names are trimmed and 1 to 24 characters (the same rule as the database check). */
export const DISPLAY_NAME_MAX = 24

/** Time zone used when the device reports none. */
export const FALLBACK_TIME_ZONE = 'UTC'

/** Copy for saving a profile that is not an RPC error code (EXPERIENCE.md Settings row). */
export const PROFILE_COPY = {
  offline: "Couldn't save. You're offline.",
  saveFailed: "Couldn't save. Try again.",
  retry: 'Retry',
} as const

/** Avatars are one 256 px square WebP (Story 3.6). */
export const AVATAR_EDGE = 256

/** WebP quality for the avatar (the same as check-in photos). */
export const AVATAR_PHOTO_QUALITY = 0.8

/**
 * The avatar's object path in bucket `avatars`: `{user_id}/{version}.webp`, both lowercase UUIDs
 * (the Storage INSERT policy accepts nothing else). A new version per photo: objects are never
 * overwritten.
 */
export function avatarObjectPath(userId: string, version: string): string {
  return `${userId.toLowerCase()}/${version.toLowerCase()}.webp`
}

/** A profile photo that is in Storage: its object path and the encoded WebP (for a local preview). */
export interface SavedAvatar {
  path: string
  photo: Blob
}

/** Copy for the profile photo (Story 3.6 ACs). */
export const AVATAR_COPY = {
  rowLabel: 'Profile photo',
  addPhoto: 'Add a photo',
  changePhoto: 'Change photo',
  /** The preview's heading (visually hidden). */
  preview: 'Your new profile photo',
  retake: 'Retake',
  usePhoto: 'Use photo',
  saving: 'Saving…',
  offline: "You're offline. Photos need a signal to save.",
  failed: "Couldn't save your photo. Tap Retry.",
  discardTitle: 'Discard this photo?',
  keep: 'Keep',
  discard: 'Discard',
  retry: 'Retry',
} as const

/** The avatar image's alt text: "Jo's photo". */
export function avatarPhotoLabel(name: string): string {
  return `${name}'s photo`
}

/** Characters as the database counts them (code points), so an emoji is one, not two. */
function characters(value: string): string[] {
  return Array.from(value)
}

export function trimDisplayName(value: string): string {
  return value.trim()
}

/** `invalid_display_name` for a blank or over-24-character name (after trimming), else null. */
export function validateDisplayName(value: string): RpcErrorCode | null {
  const length = characters(trimDisplayName(value)).length
  return length >= 1 && length <= DISPLAY_NAME_MAX ? null : 'invalid_display_name'
}

/** The Setup field's starting value: the given name, trimmed and cut to 24 characters. */
export function prefillName(givenName: string | null | undefined): string {
  if (!givenName) return ''
  return characters(givenName.trim()).slice(0, DISPLAY_NAME_MAX).join('').trim()
}
