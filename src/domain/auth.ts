/** The signed-in member as the app sees it. The display name lives in `Profile` (profile.ts). */
export interface AuthUser {
  id: string
  email: string | null
  /** The provider's given name (Google), used only to prefill Setup. Absent for email sign-ins. */
  givenName?: string
}

/** Stable auth failure codes. Adapters map provider errors onto these; copy lives in auth-errors.ts. */
export type AuthErrorCode =
  'code_rejected' | 'link_rejected' | 'rate_limited' | 'network' | 'unknown'

/** The only error type `BackendPort` auth methods throw. */
export class AuthError extends Error {
  readonly code: AuthErrorCode

  constructor(code: AuthErrorCode, message: string = code) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError
}

/** Email code and link lifetime (`otp_expiry = 900` in supabase/config.toml). */
export const OTP_EXPIRY_MS = 15 * 60 * 1000

/** Minimum gap between two sends to one email (`max_frequency = "30s"`, the Resend cooldown). */
export const RESEND_COOLDOWN_MS = 30 * 1000

export const CODE_LENGTH = 6

/** A pragmatic shape check: something@something.tld, no spaces. The server has the final say. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/** Digits only, at most 6: typed or pasted input ("123 456", "123-456") becomes "123456". */
export function normalizeCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH)
}
