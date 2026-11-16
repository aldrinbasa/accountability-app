import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type Session,
  type User,
} from '@supabase/supabase-js'
import { AuthError, type AuthErrorCode, type AuthUser } from '@/domain/auth'
import type { BackendPort } from '@/ports/backend-port'
import { supabase } from '@/adapters/supabase/client'

function toAuthUser(user: User): AuthUser {
  return { id: user.id, email: user.email ?? null }
}

function sessionUser(session: Session | null): AuthUser | null {
  return session?.user ? toAuthUser(session.user) : null
}

/**
 * Maps a supabase-js error onto an `AuthErrorCode`. `rejected` is the code for "the token was
 * refused" in the calling context: Supabase returns one error (`otp_expired`, 403) for a wrong and
 * an expired code, and the app tells them apart by time (src/domain/auth-errors.ts).
 */
function toAuthError(error: unknown, rejected: AuthErrorCode = 'unknown'): AuthError {
  // A fetch that never got a response (offline, DNS, CORS) surfaces as a retryable error, status 0.
  if (isAuthRetryableFetchError(error) && error.status === 0) {
    return new AuthError('network', error.message)
  }
  if (isAuthApiError(error)) {
    if (error.status === 429 || error.code?.startsWith('over_')) {
      return new AuthError('rate_limited', error.message)
    }
    if (
      rejected !== 'unknown' &&
      (error.code === 'otp_expired' || error.status === 403 || error.status === 401)
    ) {
      return new AuthError(rejected, error.message)
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return new AuthError('unknown', message)
}

function requireUser(user: User | null | undefined, rejected: AuthErrorCode): AuthUser {
  if (!user) throw new AuthError(rejected, 'No user in the auth response')
  return toAuthUser(user)
}

/** Supabase implementation of `BackendPort` (auth surface, Story 1.3). */
export const supabaseBackendAdapter: BackendPort = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw toAuthError(error)
    return sessionUser(data.session)
  },

  onAuthChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(sessionUser(session))
    })
    return () => data.subscription.unsubscribe()
  },

  async sendEmailCode(email, redirectTo) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    })
    if (error) throw toAuthError(error)
  },

  async verifyEmailCode(email, code) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) throw toAuthError(error, 'code_rejected')
    return requireUser(data.user, 'code_rejected')
  },

  async verifyEmailLink(tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
    if (error) throw toAuthError(error, 'link_rejected')
    return requireUser(data.user, 'link_rejected')
  },

  async exchangeOAuthCode(code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw toAuthError(error)
    return requireUser(data.user, 'unknown')
  },

  async signInWithGoogle(redirectTo) {
    // Plain OAuth redirect (PKCE: the code verifier waits in storage until exchangeOAuthCode).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) throw toAuthError(error)
  },

  async signOut() {
    // This device only: the Safari tab and the installed iOS app hold separate sessions, and signing
    // out of one should not end the other.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw toAuthError(error)
  },
}
