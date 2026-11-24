/**
 * RPC error contract (AD-14). RPCs raise exceptions whose message is a stable snake_case code; this
 * is the one table that turns a code into copy. Later stories add their codes here.
 */
export const ERROR_COPY = {
  invalid_display_name: 'Pick a name your friends will recognize.',
  invalid_time_zone:
    "Your phone's time zone isn't one we know. Check its date and time settings, then try again.",
  invalid_group_name: 'Give the group a name.',
  profile_required: 'Set your display name first, then try again.',
  not_admin: "Only the group's admin can do that.",
  not_member: "You're not in this group anymore.",
  invite_not_found: "That invite code doesn't work. Check it with whoever sent it.",
  invite_expired: 'This invite expired. Ask the admin for a fresh one.',
  group_full: 'That group is full. 10 is the max.',
  cannot_remove_self: "You can't remove yourself. Use Leave group instead.",
  invalid_activity: 'Pick an activity.',
  invalid_plan: 'Check the days or times per week, then try again.',
  invalid_end_date: 'Pick a later end date.',
  schedule_type_locked: 'This activity already has a schedule type in this group.',
  invalid_deadline: 'Pick a deadline from today to Sunday.',
  task_locked: "This task's deadline has passed. It can't change now.",
  not_found: "That's not on your plan anymore.",
  commitment_ended: "That's already wrapped up.",
  bad_capture_time: "Your phone's clock is ahead. Fix its date and time, then retake the photo.",
  week_locked: "That week has locked, so this photo can't count.",
  photo_missing: "The photo didn't finish uploading. Tap Retry.",
  checkin_conflict: 'That photo was already posted.',
  invalid_caption: 'Keep the caption to 80 characters.',
  invalid_goal: 'Pick a target from 50% to 100%, in steps of 5.',
  // Story 5.1 (challenges). `week_locked` keeps its check-in copy above; the challenge flow shows
  // the "can't be challenged anymore" line for it (src/domain/challenge.ts).
  own_checkin: "You can't challenge your own check-in.",
  already_challenged: "That check-in can't be challenged anymore.",
  challenge_expired: "That check-in can't be challenged anymore.",
  group_waiting: 'Challenges need a second member in the group.',
  // Story 5.2 (votes).
  vote_closed: "That vote's already wrapped up.",
  undo_expired: "That vote's already final.",
  not_eligible: "You can't vote on this one.",
  already_voted: 'You already voted on this one.',
  invalid_vote: 'Pick Fake or Real.',
  // Story 5.3 (overturn). `not_admin` and `week_locked` keep their copy above; the overturn flow
  // shows its own lines for them (src/domain/challenge.ts).
  not_fake_ruling: 'Only a Fake ruling can be overturned.',
  already_overturned: "That ruling's already overturned.",
  // Raised from Epic 5 (freezes); the outbox already treats it as final (Story 3.3).
  session_frozen: 'That session is already frozen.',
  // Story 5.4 (freeze requests). `week_locked` and `not_member` keep their copy above; the freeze
  // flow shows its own line for `week_locked` (src/domain/freeze.ts).
  reason_required: 'Add a reason so the group knows why.',
  invalid_freeze: "That can't be frozen. Pick another session.",
  freeze_window_closed: "That session can't be frozen anymore.",
  session_done: "That session's already done, so there's nothing to freeze.",
  freeze_pending: 'There is already a freeze request on that session.',
  fake_ruling_miss: "The group said that check-in doesn't count, so this miss can't be frozen.",
  target_met: "That week's target is already met, so there's nothing to freeze.",
} as const

export type RpcErrorCode = keyof typeof ERROR_COPY

export function isRpcErrorCode(value: unknown): value is RpcErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_COPY, value)
}

export function errorCopy(code: RpcErrorCode): string {
  return ERROR_COPY[code]
}

/** `network`: no response at all (offline, DNS). `unknown`: anything not in the table. */
export type BackendErrorCode = RpcErrorCode | 'network' | 'unknown'

/** The only error type `BackendPort` data and RPC methods throw. */
export class BackendError extends Error {
  readonly code: BackendErrorCode
  /**
   * The RPC exception's DETAIL, when it carries one (PostgREST `details`), e.g. `week_locked`'s JSON
   * `{lock_at, time_zone}`. Null when there is none.
   */
  readonly detail: string | null

  constructor(code: BackendErrorCode, message: string = code, detail: string | null = null) {
    super(message)
    this.name = 'BackendError'
    this.code = code
    this.detail = detail
  }
}

export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError
}

/** The code of a `BackendError`; `unknown` for anything else thrown. */
export function backendErrorCode(error: unknown): BackendErrorCode {
  return isBackendError(error) ? error.code : 'unknown'
}
