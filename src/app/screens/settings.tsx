import { useEffect, useId, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowLeft, CaretRight, DeviceMobile, Moon, SignOut, Sun } from '@phosphor-icons/react'
import { AUTH_COPY } from '@/domain/auth-errors'
import { OUTBOX_COPY, signOutWarning } from '@/domain/outbox'
import { THEME_COPY, type ThemePreference } from '@/domain/theme'
import { TIME_ZONE_COPY } from '@/domain/time-zones'
import { useAuthActions } from '@/data/auth-session'
import { useCheckinOutbox, useOutboxSnapshot } from '@/data/checkin-outbox'
import { useMyProfile, useSetMyTimeZone } from '@/data/profile'
import { useThemePreference } from '@/data/theme'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { Sheet } from '@/ui/sheet'
import { SliderSwitch } from '@/ui/slider-switch'
import { showToast } from '@/ui/toast'
import { ProfilePhotoRow } from '@/features/me/profile-photo-row'
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
 * polish; Story 2.7 the Time zone row and picker (changes start next week, saved optimistically);
 * Story 3.6 the Profile photo row at the top (the camera in avatar mode).
 * Toggles, reminders and delete account come later.
 * Sign-out ends the session; the app then clears the query cache and the gate opens /signin. With
 * photos waiting in the outbox, Sign out first opens the "Sign out?" confirm Sheet ("1 photo is still
 * waiting to send. Signing out deletes it.", one coral Sign out); the outbox is cleared only after the
 * sign-out succeeded (Story 3.3).
 */
export function SettingsScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const { signOut } = useAuthActions()
  const outbox = useCheckinOutbox('SettingsScreen')
  const snapshot = useOutboxSnapshot()
  const [storeCount, setStoreCount] = useState(0)
  // Before the snapshot has loaded, the count read from the store at the tap.
  const waiting = snapshot.loaded
    ? snapshot.items.filter((item) => item.rejection === null).length
    : storeCount
  const [signingOut, setSigningOut] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  // A store count is in flight (a second tap meanwhile is ignored).
  const counting = useRef(false)

  // The last waiting photo was sent while the Sheet was open: nothing left to warn about.
  useEffect(() => {
    if (confirmingSignOut && !signingOut && snapshot.loaded && waiting === 0) {
      setConfirmingSignOut(false)
    }
  }, [confirmingSignOut, signingOut, snapshot.loaded, waiting])
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
      return
    }
    // Signed out: this account's held photos go with it (warned in the confirm Sheet).
    await outbox.clear().catch(() => {})
  }

  async function onSignOutTap() {
    if (signingOut || counting.current) return
    let count = waiting
    if (!snapshot.loaded) {
      // Not read yet: ask the store, so a tap this early never deletes photos unwarned. If the
      // store cannot be read, warn anyway.
      counting.current = true
      count = await outbox.countWaiting().catch(() => 1)
      counting.current = false
      setStoreCount(count)
    }
    if (count > 0) setConfirmingSignOut(true)
    else void onSignOut()
  }

  return (
    <div className="flex flex-col gap-stack pt-4">
      <div>
        <IconButton icon={ArrowLeft} label="Back" onClick={back} />
      </div>
      <h1 tabIndex={-1} className="type-headline">
        Settings
      </h1>
      {profile ? (
        <ul className="card flex flex-col p-0">
          <li>
            <ProfilePhotoRow profile={profile} />
          </li>
        </ul>
      ) : null}
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
            aria-busy={(signingOut && !confirmingSignOut) || undefined}
            onClick={() => void onSignOutTap()}
            className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-left text-ink type-body press-overlay"
          >
            <Icon icon={SignOut} size={24} />
            <span className="flex-1">
              {signingOut && !confirmingSignOut ? OUTBOX_COPY.signingOut : OUTBOX_COPY.signOut}
            </span>
            <Icon icon={CaretRight} size={20} />
          </button>
        </li>
      </ul>
      <Sheet
        open={confirmingSignOut}
        onOpenChange={(next) => {
          if (!next && signingOut) return
          setConfirmingSignOut(next)
        }}
        title={OUTBOX_COPY.signOutTitle}
      >
        <div className="flex flex-col gap-4">
          <p className="type-body">{signOutWarning(waiting)}</p>
          <Button
            variant="primary"
            fullWidth
            busy={signingOut}
            busyLabel={OUTBOX_COPY.signingOut}
            onClick={() => void onSignOut()}
          >
            {OUTBOX_COPY.signOut}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
