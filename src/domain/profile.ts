import type { RpcErrorCode } from '@/domain/error-codes'

/** A member's profile (`public.profiles`). Story 3.6 fills `avatarPath`; Story 2.7 edits `timeZone`. */
export interface Profile {
  id: string
  displayName: string
  avatarPath: string | null
  timeZone: string
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
