import { useEffect, useRef, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { DEFAULT_NEXT_PATH } from '@/domain/next-path'
import {
  INSTALL_PATH,
  installGuideApplies,
  installGuideTarget,
  isInstallPath,
} from '@/domain/install'
import { useAuthSession } from '@/data/auth-session'
import { getInstallState } from '@/data/install-state'
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
 * member is the likely case) and the query refetches on focus. /install is never redirected: a new
 * member sees the install guide before Setup.
 */
function ProfileGate() {
  const profile = useMyProfile()
  const location = useLocation()
  const navigate = useNavigate()
  const onSetup = location.pathname === SETUP_PATH
  const onInstall = isInstallPath(location.pathname)
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
    if (onInstall) return
    if (state === 'none' && !onSetup) {
      savePendingNext(`${location.pathname}${location.search}`)
      void navigate(SETUP_PATH, { replace: true })
    } else if (state === 'has' && onSetup) {
      target.current ??= peekPendingNext() ?? DEFAULT_NEXT_PATH
      clearPendingNext()
      void navigate(target.current, { replace: true })
    }
    // Reacts to the profile state and to entering or leaving /setup or /install; the location is
    // read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onSetup, onInstall])

  if (onInstall) return <Outlet />
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

/** Layout for /install: the same full-screen column as /setup, inside the auth gate. */
export function InstallLayout() {
  useFocusHeadingOnRouteChange()
  return (
    <FullScreenColumn>
      <Outlet />
    </FullScreenColumn>
  )
}

/**
 * Layout for /signin and /signin/code: a phone-width column with no nav. Signed in, it goes to the
 * pending `next` path, clearing it, else /today. Right after a sign-in on this screen (a code, link
 * or Google return verifies while it shows), a device that is not installed and has not dismissed
 * the guide goes to /install first, and `next` is kept for the guide to forward to. Opening /signin
 * while already signed in never shows the guide.
 */
export function SignInLayout() {
  const session = useAuthSession()
  const navigate = useNavigate()
  // Picked once, so StrictMode's second effect run cannot fall back to /today after the clear.
  const target = useRef<string | null>(null)
  // Whether this layout showed the signed-out screens, i.e. the member signed in just now.
  const sawSignedOut = useRef(false)

  useFocusHeadingOnRouteChange()

  useEffect(() => {
    if (session.status === 'signed-out') sawSignedOut.current = true
    if (session.status !== 'signed-in') return
    clearPendingSignIn()
    if (target.current === null) {
      const showGuide = sawSignedOut.current && installGuideApplies(getInstallState())
      target.current = showGuide ? INSTALL_PATH : installGuideTarget(peekPendingNext())
    }
    if (target.current !== INSTALL_PATH) clearPendingNext()
    void navigate(target.current, { replace: true })
  }, [session.status, navigate])

  if (session.status !== 'signed-out') return null
  return (
    <FullScreenColumn>
      <Outlet />
    </FullScreenColumn>
  )
}
