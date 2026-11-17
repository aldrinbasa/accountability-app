import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowLeft, CaretRight, SignOut } from '@phosphor-icons/react'
import { AUTH_COPY } from '@/domain/auth-errors'
import { useAuthActions } from '@/data/auth-session'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { showToast } from '@/ui/toast'
import { cameFromMe } from '@/features/me/pushed-from-me'

/**
 * Me > Settings, a pushed screen with a back button (an installed iOS app has no browser back).
 * Story 1.3 brings only Sign out; toggles, reminders, time zone and delete account come later.
 * Sign-out ends the session; the app then clears the query cache and the gate opens /signin.
 */
export function SettingsScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const { signOut } = useAuthActions()
  const [signingOut, setSigningOut] = useState(false)

  function back() {
    if (cameFromMe(location.state)) void navigate(-1)
    else void navigate({ pathname: '/me', search: location.search }, { replace: true })
  }

  async function onSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      setSigningOut(false)
      showToast(AUTH_COPY.signOutFailed, { variant: 'error' })
    }
  }

  return (
    <div className="flex flex-col gap-stack pt-4">
      <div>
        <IconButton icon={ArrowLeft} label="Back" onClick={back} />
      </div>
      <h1 tabIndex={-1} className="type-headline">
        Settings
      </h1>
      <ul className="card flex flex-col p-0">
        <li>
          <button
            type="button"
            aria-busy={signingOut || undefined}
            onClick={() => void onSignOut()}
            className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-left text-ink type-body press-overlay"
          >
            <Icon icon={SignOut} size={24} />
            <span className="flex-1">{signingOut ? 'Signing out…' : 'Sign out'}</span>
            <Icon icon={CaretRight} size={20} />
          </button>
        </li>
      </ul>
    </div>
  )
}
