import type { AuthUser } from '@/domain/auth'

/**
 * The app's one backend contract (AD-1). Story 1.3 adds the auth surface; later stories add reads,
 * RPCs and uploads. Implemented in src/adapters/supabase, wired only in src/app/composition.ts.
 *
 * Every auth method rejects with `AuthError` (src/domain/auth.ts) carrying an `AuthErrorCode`.
 */
export interface BackendPort {
  /** The stored session's user (survives app restarts), or null when signed out. */
  getSession(): Promise<AuthUser | null>
  /** Subscribe to session changes (sign-in, sign-out, other tabs). Returns an unsubscribe function. */
  onAuthChange(callback: (user: AuthUser | null) => void): () => void
  /** Email a magic link and a 6-digit code. The link points at `redirectTo` plus the token hash. */
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
}
