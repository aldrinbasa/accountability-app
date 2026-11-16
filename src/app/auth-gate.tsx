import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { DEFAULT_NEXT_PATH } from '@/domain/next-path'
import { useAuthSession } from '@/data/auth-session'
import {
  clearPendingNext,
  clearPendingSignIn,
  peekPendingNext,
  savePendingNext,
} from '@/data/pending-signin'
import { useFocusHeadingOnRouteChange } from '@/app/shell/use-shell-history'

export const SIGN_IN_PATH = '/signin'

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
  return <Outlet />
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
    <div className="mx-auto flex min-h-dvh w-full max-w-content-max flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <main className="flex flex-1 flex-col px-gutter pb-8">
        <Outlet />
      </main>
    </div>
  )
}
