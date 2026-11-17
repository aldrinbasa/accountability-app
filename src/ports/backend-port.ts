import type { AuthUser } from '@/domain/auth'
import type { MyGroup } from '@/domain/groups'
import type { Profile } from '@/domain/profile'

/**
 * The app's one backend contract (AD-1). Story 1.3 adds the auth surface; later stories add reads,
 * RPCs and uploads. Implemented in src/adapters/supabase, wired only in src/app/composition.ts.
 *
 * Every auth method rejects with `AuthError` (src/domain/auth.ts) carrying an `AuthErrorCode`.
 * Every data and RPC method rejects with `BackendError` (src/domain/error-codes.ts): an RPC error
 * code from the AD-14 table, `network`, or `unknown`.
 */
export interface BackendPort {
  /** The stored session's user (survives app restarts), or null when signed out. */
  getSession(): Promise<AuthUser | null>
  /** Subscribe to session changes (sign-in, sign-out, other tabs). Returns an unsubscribe function. */
  onAuthChange(callback: (user: AuthUser | null) => void): () => void
  /** Email a 6-digit code (the email is code-only; `redirectTo` is kept for a future link). */
  sendEmailCode(email: string, redirectTo: string): Promise<void>
  /** Verify the 6-digit code from the email. Creates the session in this browser context. */
  verifyEmailCode(email: string, code: string): Promise<AuthUser>
  /** Verify the `token_hash` from the email link. */
  verifyEmailLink(tokenHash: string): Promise<AuthUser>
  /** Finish a Google sign-in: exchange the `code` the OAuth redirect brought back (PKCE). */
  exchangeOAuthCode(code: string): Promise<AuthUser>
  /** Start Google sign-in. Navigates away; Google returns to `redirectTo`. */
  signInWithGoogle(redirectTo: string): Promise<void>
  /** End this device's session. */
  signOut(): Promise<void>

  /** The signed-in member's own profile, or null before Setup. */
  getMyProfile(): Promise<Profile | null>
  /**
   * `save_profile`: creates the caller's profile, or on an existing one changes only the display
   * name (the zone is kept). Resolves with the stored profile.
   */
  saveProfile(displayName: string, timeZone: string): Promise<Profile>

  /** The signed-in member's current groups (ended memberships left out), each with its member count. */
  listMyGroups(): Promise<MyGroup[]>
  /** `create_group`: a new group with the caller as admin and their profile zone. Resolves with its id. */
  createGroup(name: string): Promise<string>
}
