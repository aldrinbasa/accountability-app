import { useMemo, useSyncExternalStore } from 'react'
import type { AuthUser } from '@/domain/auth'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'

export type AuthSession =
  | { status: 'loading'; user: null }
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'signed-out'; user: null }

const LOADING: AuthSession = { status: 'loading', user: null }
const SIGNED_OUT: AuthSession = { status: 'signed-out', user: null }

export interface AuthSessionStore {
  getSnapshot(): AuthSession
  subscribe(listener: () => void): () => void
  /** Start following the backend. Returns a stop function (StrictMode-safe: start, stop, start). */
  start(): () => void
  /** Record a session the app just created or ended, without waiting for the change event. */
  setUser(user: AuthUser | null): void
}

/**
 * One session state per app, shared by the gate, the sign-in screens and Settings. Reads the stored
 * session once, then follows `onAuthChange`. Once a change event has arrived it wins over a slower
 * `getSession()` result (e.g. a sign-out in another tab while the first read was in flight).
 */
export function createAuthSessionStore(
  backend: BackendPort,
  options: { onSignedOut?: () => void } = {},
): AuthSessionStore {
  let state: AuthSession = LOADING
  const listeners = new Set<() => void>()

  function set(user: AuthUser | null) {
    const next: AuthSession = user ? { status: 'signed-in', user } : SIGNED_OUT
    if (state.status === next.status && state.user?.id === next.user?.id) return
    const wasSignedIn = state.status === 'signed-in'
    state = next
    if (wasSignedIn) options.onSignedOut?.()
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      let active = true
      let sawEvent = false
      const unsubscribe = backend.onAuthChange((user) => {
        if (!active) return
        sawEvent = true
        set(user)
      })
      backend
        .getSession()
        .then((user) => {
          if (active && !sawEvent) set(user)
        })
        .catch(() => {
          if (active && !sawEvent) set(null)
        })
      return () => {
        active = false
        unsubscribe()
      }
    },
    setUser: set,
  }
}

/** The current session: loading (first read pending), signed-in with the user, or signed-out. */
export function useAuthSession(): AuthSession {
  const { session } = useBackendContext('useAuthSession')
  return useSyncExternalStore(session.subscribe, session.getSnapshot)
}

export interface AuthActions {
  sendEmailCode(email: string, redirectTo: string): Promise<void>
  signInWithGoogle(redirectTo: string): Promise<void>
  verifyEmailCode(email: string, code: string): Promise<AuthUser>
  verifyEmailLink(tokenHash: string): Promise<AuthUser>
  exchangeOAuthCode(code: string): Promise<AuthUser>
  signOut(): Promise<void>
}

/** Sign-in and sign-out through `BackendPort`. Each success updates the shared session at once. */
export function useAuthActions(): AuthActions {
  const { backend, session } = useBackendContext('useAuthActions')
  return useMemo<AuthActions>(
    () => ({
      sendEmailCode: (email, redirectTo) => backend.sendEmailCode(email, redirectTo),
      signInWithGoogle: (redirectTo) => backend.signInWithGoogle(redirectTo),
      async verifyEmailCode(email, code) {
        const user = await backend.verifyEmailCode(email, code)
        session.setUser(user)
        return user
      },
      async verifyEmailLink(tokenHash) {
        const user = await backend.verifyEmailLink(tokenHash)
        session.setUser(user)
        return user
      },
      async exchangeOAuthCode(code) {
        const user = await backend.exchangeOAuthCode(code)
        session.setUser(user)
        return user
      },
      async signOut() {
        await backend.signOut()
        session.setUser(null)
      },
    }),
    [backend, session],
  )
}
