import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera } from '@phosphor-icons/react'
import { errorCopy, isBackendError } from '@/domain/error-codes'
import {
  DISPLAY_NAME_MAX,
  FALLBACK_TIME_ZONE,
  PROFILE_COPY,
  prefillName,
  trimDisplayName,
  validateDisplayName,
} from '@/domain/profile'
import { useAuthSession } from '@/data/auth-session'
import { deviceTimeZone, useSaveProfile } from '@/data/profile'
import { Avatar } from '@/ui/avatar'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { TextField } from '@/ui/text-field'
import { dismissToast, showToast } from '@/ui/toast'

const SETUP_COPY = {
  heading: 'What do your friends call you?',
  nameLabel: 'Display name',
  continue: 'Continue',
  saving: 'Saving…',
  addPhoto: 'Add a photo',
  photoLater: 'add a photo later',
  photoSoon: 'Photos come with the camera. Soon.',
} as const

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * `/setup`: the display name friends see. Prefilled from the Google given name (cut to 24). Saves
 * through `save_profile` with the device time zone. Leaving the screen after a save (to the pending
 * `next` path, or /today) belongs to the profile gate in src/app, which sees the new profile.
 */
export function SetupScreen() {
  const session = useAuthSession()
  const user = session.user
  const saveProfile = useSaveProfile()

  const [name, setName] = useState(() => prefillName(user?.givenName))
  const [nameError, setNameError] = useState<string | null>(null)
  // Stays busy after success: the gate navigates away, and repeat taps must not save twice.
  const [busy, setBusy] = useState(false)
  // The guard itself: a Retry toast holds an older `save`, whose `busy` would be stale.
  const busyRef = useRef(false)
  const [focusTick, setFocusTick] = useState(0)
  const nameRef = useRef<HTMLInputElement>(null)
  // The "Couldn't save" toast with Retry: gone once a new save starts, on success and on unmount.
  const failureToast = useRef<string | number | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    if (focusTick > 0) nameRef.current?.focus()
  }, [focusTick])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      dismissFailureToast()
    }
  }, [])

  function dismissFailureToast() {
    if (failureToast.current === null) return
    dismissToast(failureToast.current)
    failureToast.current = null
  }

  function failName(message: string) {
    setNameError(message)
    setFocusTick((tick) => tick + 1)
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (busyRef.current || !mounted.current) return
    // Read from the field itself, so a Retry from the toast saves what is typed now.
    const value = trimDisplayName(nameRef.current?.value ?? name)
    const invalid = validateDisplayName(value)
    if (invalid) return failName(errorCopy(invalid))
    if (isOffline()) {
      showToast(PROFILE_COPY.offline, { variant: 'error' })
      return
    }

    busyRef.current = true
    setBusy(true)
    setNameError(null)
    dismissFailureToast()
    const zone = deviceTimeZone()
    try {
      try {
        await saveProfile.mutateAsync({ displayName: value, timeZone: zone })
      } catch (error) {
        // A zone the browser knows but Postgres does not would lock the member out: save with UTC
        // instead (Story 2.7 lets them pick a zone later).
        const badZone = isBackendError(error) && error.code === 'invalid_time_zone'
        if (!badZone || zone === FALLBACK_TIME_ZONE) throw error
        await saveProfile.mutateAsync({ displayName: value, timeZone: FALLBACK_TIME_ZONE })
      }
      dismissFailureToast()
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      const code = isBackendError(error) ? error.code : 'unknown'
      if (code === 'invalid_display_name') {
        failName(errorCopy(code))
      } else if (code === 'network') {
        showToast(PROFILE_COPY.offline, { variant: 'error' })
      } else if (code === 'invalid_time_zone') {
        showToast(errorCopy(code), { variant: 'error' })
      } else {
        failureToast.current = showToast(PROFILE_COPY.saveFailed, {
          variant: 'error',
          action: {
            label: PROFILE_COPY.retry,
            onClick: () => {
              if (mounted.current) void save()
            },
          },
        })
      }
    }
  }

  return (
    <div className="flex flex-col gap-6 pt-8">
      <h1 tabIndex={-1} className="type-headline">
        {SETUP_COPY.heading}
      </h1>

      <div className="flex flex-col items-center gap-3">
        <Avatar
          id={user?.id ?? ''}
          name={name}
          size={104}
          badge={
            <button
              type="button"
              aria-label={SETUP_COPY.addPhoto}
              onClick={() => showToast(SETUP_COPY.photoSoon)}
              className="on-object inline-flex size-target-min items-center justify-center rounded-full"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full border-[2.5px] border-obj-ink bg-pola text-obj-ink shadow-obj">
                <Icon icon={Camera} size={20} />
              </span>
            </button>
          }
        />
        <p className="type-hand-sm text-muted">{SETUP_COPY.photoLater}</p>
      </div>

      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        <TextField
          ref={nameRef}
          label={SETUP_COPY.nameLabel}
          name="nickname"
          autoComplete="nickname"
          maxLength={DISPLAY_NAME_MAX}
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setNameError(null)
          }}
          error={nameError ?? undefined}
        />
        <Button type="submit" variant="primary" fullWidth busy={busy} busyLabel={SETUP_COPY.saving}>
          {SETUP_COPY.continue}
        </Button>
      </form>
    </div>
  )
}
