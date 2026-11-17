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

  constructor(code: BackendErrorCode, message: string = code) {
    super(message)
    this.name = 'BackendError'
    this.code = code
  }
}

export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError
}
