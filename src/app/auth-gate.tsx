import { useEffect, useRef, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { DEFAULT_NEXT_PATH } from '@/domain/next-path'
import { useAuthSession } from '@/data/auth-session'
import { useMyProfile } from '@/data/profile'
import {
  clearPendingNext,
  clearPendingSignIn,
  peekPendingNext,
  savePendingNext,
} from '@/data/pending-signin'
import { useFocusHeadingOnRouteChange } from '@/app/shell/use-shell-history'

export const SIGN_IN_PATH = '/signin'
export const SETUP_PATH = '/setup'

/**
 * Layout over every app route. While the stored session is read it shows blank paper. Signed out on
 * a cold open, it saves the asked-for path plus query as the pending `next` and goes to /signin. After
 * a sign-out (or a session that ended in another tab) it goes to /signin without saving one.
 */
export function AuthGate() {
  const session = useAuthSession()
  const location = useLocation()
  const navigate = useNavigate()
  const wasSignedIn = useRef(false)

  useEffect(() => {
    if (session.status === 'signed-in') {
      wasSignedIn.current = true
      return
    }
    if (session.status !== 'signed-out') return
    if (!wasSignedIn.current) savePendingNext(`${location.pathname}${location.search}`)
    void navigate(SIGN_IN_PATH, { replace: true })
    // Reacts to session changes only; the location is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status])

  if (session.status !== 'signed-in') return null
  return <ProfileGate />
}

type ProfileState = 'loading' | 'failed' | 'none' | 'has'

/**
 * Inside the auth gate: a member without a profile goes to /setup, with the asked-for path saved as
 * the pending `next` (the sign-in layout cleared it on the way in). With a profile, /setup forwards
 * to the pending `next` (cleared) or /today: that is also how Setup leaves after a save. While the
 * profile loads it shows blank paper; if the read fails it shows the app (fail open, a returning
 * member is the likely case) and the query refetches on focus.
 */
function ProfileGate() {
  const profile = useMyProfile()
  const location = useLocation()
  const navigate = useNavigate()
  const onSetup = location.pathname === SETUP_PATH
  // Picked once per visit to /setup, so StrictMode's second effect run keeps the same target.
  const target = useRef<string | null>(null)

  const state: ProfileState = profile.isPending
    ? 'loading'
    : profile.data === undefined
      ? 'failed'
      : profile.data === null
        ? 'none'
        : 'has'

  useEffect(() => {
    if (!onSetup) target.current = null
    if (state === 'none' && !onSetup) {
      savePendingNext(`${location.pathname}${location.search}`)
      void navigate(SETUP_PATH, { replace: true })
    } else if (state === 'has' && onSetup) {
      target.current ??= peekPendingNext() ?? DEFAULT_NEXT_PATH
      clearPendingNext()
      void navigate(target.current, { replace: true })
    }
    // Reacts to the profile state and to entering or leaving /setup; the location is read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onSetup])

  if (state === 'loading') return null
  if (state === 'none' && !onSetup) return null
  if (state === 'has' && onSetup) return null
  return <Outlet />
}

/** A phone-width, full-height column with no nav, for screens outside the shell. */
function FullScreenColumn({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-content-max flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <main className="flex flex-1 flex-col px-gutter pb-8">{children}</main>
    </div>
  )
}

/** Layout for /setup: the same full-screen column as sign-in, inside the auth gate. */
export function SetupLayout() {
  useFocusHeadingOnRouteChange()
  return (
    <FullScreenColumn>
      <Outlet />
    </FullScreenColumn>
  )
}

/**
 * Layout for /signin and /signin/code: a phone-width column with no nav. Signed in (on open, or the
 * moment a code, link or Google return verifies), it goes to the pending `next` path, clearing it,
 * else /today.
 */
export function SignInLayout() {
  const session = useAuthSession()
  const navigate = useNavigate()
  // Picked once, so StrictMode's second effect run cannot fall back to /today after the clear.
  const target = useRef<string | null>(null)

  useFocusHeadingOnRouteChange()

  useEffect(() => {
    if (session.status !== 'signed-in') return
    target.current ??= peekPendingNext() ?? DEFAULT_NEXT_PATH
    clearPendingNext()
    clearPendingSignIn()
    void navigate(target.current, { replace: true })
  }, [session.status, navigate])

  if (session.status !== 'signed-out') return null
  return (
    <FullScreenColumn>
      <Outlet />
    </FullScreenColumn>
  )
}
