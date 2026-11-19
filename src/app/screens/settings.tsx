import { useId, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowLeft, CaretRight, DeviceMobile, Moon, SignOut, Sun } from '@phosphor-icons/react'
import { AUTH_COPY } from '@/domain/auth-errors'
import { THEME_COPY, type ThemePreference } from '@/domain/theme'
import { TIME_ZONE_COPY } from '@/domain/time-zones'
import { useAuthActions } from '@/data/auth-session'
import { useMyProfile, useSetMyTimeZone } from '@/data/profile'
import { useThemePreference } from '@/data/theme'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { SliderSwitch } from '@/ui/slider-switch'
import { showToast } from '@/ui/toast'
import { cameFromMe } from '@/features/me/pushed-from-me'
import { saveZone } from '@/features/me/save-zone'
import { TimeZoneRow, TimeZoneSheet } from '@/features/me/time-zone-sheet'

const APPEARANCE_OPTIONS = [
  { value: 'system', label: THEME_COPY.options.system, icon: DeviceMobile },
  { value: 'light', label: THEME_COPY.options.light, icon: Sun },
  { value: 'dark', label: THEME_COPY.options.dark, icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: typeof Sun }[]

/**
 * Me > Settings, a pushed screen with a back button (an installed iOS app has no browser back).
 * Story 1.3 brought Sign out; Appearance (Auto / Light / Dark, this device only) came with the Epic 1
 * polish; Story 2.7 the Time zone row and picker (changes start next week, saved optimistically).
 * Toggles, reminders and delete account come later.
 * Sign-out ends the session; the app then clears the query cache and the gate opens /signin.
 */
export function SettingsScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const { signOut } = useAuthActions()
  const [signingOut, setSigningOut] = useState(false)
  const [theme, setTheme] = useThemePreference()
  const appearanceId = useId()
  const profile = useMyProfile().data
  const setTimeZone = useSetMyTimeZone()
  const [pickingZone, setPickingZone] = useState(false)

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
      <section className="flex flex-col gap-[10px]">
        <h2 id={appearanceId} className="type-label text-muted">
          {THEME_COPY.heading}
        </h2>
        <SliderSwitch
          labelledBy={appearanceId}
          options={APPEARANCE_OPTIONS}
          value={theme}
          onChange={setTheme}
        />
        <p className="ml-[6px] -rotate-1 type-hand-md text-muted">{THEME_COPY.notes[theme]}</p>
      </section>
      {profile ? (
        <>
          <ul className="card flex flex-col p-0">
            <li>
              <TimeZoneRow
                label={TIME_ZONE_COPY.label}
                zones={profile}
                onOpen={() => setPickingZone(true)}
              />
            </li>
          </ul>
          <TimeZoneSheet
            open={pickingZone}
            onOpenChange={setPickingZone}
            title={TIME_ZONE_COPY.label}
            note={TIME_ZONE_COPY.memberNote}
            zones={profile}
            onChoose={(zone) => saveZone((z) => setTimeZone.mutateAsync(z), zone)}
          />
        </>
      ) : null}
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
