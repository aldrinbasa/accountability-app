import type { BackendErrorCode } from '@/domain/error-codes'
import { formatClock, formatLockTime } from '@/domain/time-zones'

/**
 * The check-in outbox's rules and copy (Story 3.3). Every Post goes through a device outbox; the
 * sender retries with backoff until the server answers. The server still decides timing, lateness,
 * counts and the lock time: nothing here computes them.
 */

/** Codes that can never succeed for a held photo: the entry is rejected, its photo dropped. */
export const OUTBOX_TERMINAL_CODES = [
  'week_locked',
  'commitment_ended',
  'not_member',
  'session_frozen',
  'bad_capture_time',
  'checkin_conflict',
  'invalid_caption',
] as const

export type OutboxRejectionCode = (typeof OUTBOX_TERMINAL_CODES)[number]

/** Whether a failed send is final. Everything else (`network`, `unknown`, `photo_missing`) retries. */
export function isTerminalPostError(code: BackendErrorCode): code is OutboxRejectionCode {
  return (OUTBOX_TERMINAL_CODES as readonly string[]).includes(code)
}

/** A rejected entry's reason, with the lock details `week_locked` carries (else null). */
export interface OutboxRejection {
  code: OutboxRejectionCode
  /** `week_locked` only: the week's lock time (ISO) and the group zone of that week. */
  lockAt: string | null
  timeZone: string | null
}

/** An outbox entry as the UI sees it (no photo bytes). */
export interface OutboxItem {
  id: string
  groupId: string
  groupName: string
  commitmentId: string
  /** The target's title (task name, else activity name). */
  title: string
  /** The device clock at the shutter, ISO 8601. */
  capturedAt: string
  caption: string | null
  /** `Date.now()` when Post first wrote the entry. */
  firstQueuedAt: number
  /** Failed sends so far. */
  attempts: number
  /** Set once the server answered with a terminal code; the entry then only shows its banner. */
  rejection: OutboxRejection | null
}

export const OUTBOX_BACKOFF_BASE_MS = 5_000
export const OUTBOX_BACKOFF_CAP_MS = 5 * 60_000

/** "Couldn't send yet." shows once an entry has failed this many times. */
export const OUTBOX_STUCK_ATTEMPTS = 3

/** The "clear it" warning shows once the oldest entry has waited this long. */
export const OUTBOX_OLD_MS = 5 * 24 * 60 * 60_000

/** The wait after the `streak`-th failed send in a row: 5 s, 10 s, 20 s … capped at 5 min. */
export function backoffDelay(streak: number): number {
  const step = Math.max(1, Math.floor(streak))
  // 2^7 × 5 s is already past the cap; stop doubling there.
  return Math.min(OUTBOX_BACKOFF_CAP_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** Math.min(step - 1, 7))
}

/** Send order: oldest `firstQueuedAt` first, then by id (stable). */
export function compareSendOrder(
  a: Pick<OutboxItem, 'firstQueuedAt' | 'id'>,
  b: Pick<OutboxItem, 'firstQueuedAt' | 'id'>,
): number {
  if (a.firstQueuedAt !== b.firstQueuedAt) return a.firstQueuedAt - b.firstQueuedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export const OUTBOX_COPY = {
  retry: 'Retry',
  gotIt: 'Got it',
  backOnline: "Sends when you're back online.",
  stuck: "Couldn't send yet.",
  old: "Open Proofy now and then so your phone doesn't clear it.",
  signOutTitle: 'Sign out?',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
} as const

/** The reasons in "Couldn't post your Gym photo: {reason}." (`week_locked` has its own line). */
export const REJECTION_REASONS: Record<Exclude<OutboxRejectionCode, 'week_locked'>, string> = {
  commitment_ended: 'commitment ended',
  not_member: 'removed from the group',
  session_frozen: 'session already frozen',
  bad_capture_time: "your phone's clock was ahead",
  checkin_conflict: 'it was already posted',
  invalid_caption: 'the caption was too long',
}

/**
 * The photo-waiting Banner for the waiting entries (none rejected), in send order: "1 photo waiting
 * to send · Gym · Sunday Reset · taken 07:12. Sends when you're back online." With several, "{n}
 * photos" and the oldest's details. Adds "Couldn't send yet." when any entry failed 3 times, and the
 * "clear it" warning once the oldest has waited 5 days. `zone`: the member's zone (else the
 * device's). Null when nothing waits.
 */
export function waitingBannerText(
  waiting: readonly OutboxItem[],
  now: number,
  zone: string,
): string | null {
  if (waiting.length === 0) return null
  const oldest = [...waiting].sort(compareSendOrder)[0] as OutboxItem
  const count = waiting.length === 1 ? '1 photo' : `${waiting.length} photos`
  const taken = formatClock(new Date(oldest.capturedAt), zone)
  const group = oldest.groupName === '' ? '' : ` · ${oldest.groupName}`
  let text = `${count} waiting to send · ${oldest.title}${group} · taken ${taken}. ${OUTBOX_COPY.backOnline}`
  if (waiting.some((item) => item.attempts >= OUTBOX_STUCK_ATTEMPTS))
    text += ` ${OUTBOX_COPY.stuck}`
  if (now - oldest.firstQueuedAt >= OUTBOX_OLD_MS) text += ` ${OUTBOX_COPY.old}`
  return text
}

/**
 * A rejected entry's Banner. `week_locked`: "Too late for last week. It locked Wed 23:59, so this
 * photo can't count." (the server's lock time in the group zone, the city named when it differs from
 * `memberZone`; without the details, "That week has locked"). Other codes: "Couldn't post your Gym
 * photo: commitment ended."
 */
export function rejectionBannerText(
  title: string,
  rejection: OutboxRejection,
  memberZone: string,
): string {
  if (rejection.code === 'week_locked') {
    if (rejection.lockAt && rejection.timeZone) {
      const at = formatLockTime(rejection.lockAt, rejection.timeZone, memberZone)
      return `Too late for last week. It locked ${at}, so this photo can't count.`
    }
    return "Too late for last week. That week has locked, so this photo can't count."
  }
  return `Couldn't post your ${title} photo: ${REJECTION_REASONS[rejection.code]}.`
}

/** The sign-out confirm's line for `count` waiting photos. */
export function signOutWarning(count: number): string {
  return count === 1
    ? '1 photo is still waiting to send. Signing out deletes it.'
    : `${count} photos are still waiting to send. Signing out deletes them.`
}

function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * The rejection from a terminal code and the error's DETAIL: `week_locked`'s JSON
 * `{lock_at, time_zone}` (anything unreadable is left out).
 */
export function toRejection(code: OutboxRejectionCode, detail: string | null): OutboxRejection {
  const rejection: OutboxRejection = { code, lockAt: null, timeZone: null }
  if (code !== 'week_locked' || !detail) return rejection
  try {
    const parsed: unknown = JSON.parse(detail)
    if (typeof parsed !== 'object' || parsed === null) return rejection
    const { lock_at: lockAt, time_zone: timeZone } = parsed as Record<string, unknown>
    if (
      typeof lockAt === 'string' &&
      !Number.isNaN(Date.parse(lockAt)) &&
      typeof timeZone === 'string' &&
      isKnownZone(timeZone)
    ) {
      return { code, lockAt, timeZone }
    }
  } catch {
    // Not JSON: the banner falls back to "That week has locked".
  }
  return rejection
}
