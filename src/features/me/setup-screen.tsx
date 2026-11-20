import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Camera } from '@phosphor-icons/react'
import { backendErrorCode, errorCopy } from '@/domain/error-codes'
import {
  AVATAR_COPY,
  avatarPhotoLabel,
  DISPLAY_NAME_MAX,
  FALLBACK_TIME_ZONE,
  PROFILE_COPY,
  prefillName,
  trimDisplayName,
  validateDisplayName,
  type SavedAvatar,
} from '@/domain/profile'
import { useAuthSession } from '@/data/auth-session'
import { deviceTimeZone, useSaveProfile } from '@/data/profile'
import { isOffline } from '@/data/connectivity'
import { Avatar } from '@/ui/avatar'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { TextField } from '@/ui/text-field'
import { dismissToast, showToast } from '@/ui/toast'
import { useCameraLauncher } from '@/features/camera/camera-launcher'

const SETUP_COPY = {
  heading: 'What do your friends call you?',
  nameLabel: 'Display name',
  continue: 'Continue',
  saving: 'Saving…',
  photoLater: 'add a photo later',
} as const

/** Setup's photo: in Storage, shown from the encoded blob until Continue saves its path. */
interface SetupPhoto {
  saved: SavedAvatar
  url: string
}

/**
 * `/setup`: the display name friends see. Prefilled from the Google given name (cut to 24). Saves
 * through `save_profile` with the device time zone. "Add a photo" opens the camera in avatar mode
 * (Story 3.6): Use photo uploads it, Setup shows it from the local blob, and Continue saves the name
 * and then the photo's path (a failed path update keeps Setup with "Couldn't save. Try again.").
 * Skipping the photo saves the name only. Leaving the screen after a save (to the pending
 * `next` path, or /today) belongs to the profile gate in src/app, which sees the new profile.
 */
export function SetupScreen() {
  const session = useAuthSession()
  const user = session.user
  const saveProfile = useSaveProfile()
  const { openCamera } = useCameraLauncher()
  const [photo, setPhoto] = useState<SetupPhoto | null>(null)
  // The current object URL, revoked when replaced and on unmount.
  const photoUrl = useRef<string | null>(null)

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
      if (photoUrl.current !== null) URL.revokeObjectURL(photoUrl.current)
      photoUrl.current = null
    }
  }, [])

  function onPhotoSaved(saved: SavedAvatar) {
    if (!mounted.current) return
    if (photoUrl.current !== null) URL.revokeObjectURL(photoUrl.current)
    const url = URL.createObjectURL(saved.photo)
    photoUrl.current = url
    setPhoto({ saved, url })
  }

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
    const avatarPath = photo?.saved.path ?? null
    try {
      try {
        await saveProfile.mutateAsync({ displayName: value, timeZone: zone, avatarPath })
      } catch (error) {
        // A zone the browser knows but Postgres does not would lock the member out: save with UTC
        // instead (Story 2.7 lets them pick a zone later).
        const badZone = backendErrorCode(error) === 'invalid_time_zone'
        if (!badZone || zone === FALLBACK_TIME_ZONE) throw error
        await saveProfile.mutateAsync({
          displayName: value,
          timeZone: FALLBACK_TIME_ZONE,
          avatarPath,
        })
      }
      dismissFailureToast()
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      const code = backendErrorCode(error)
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
          src={photo?.url ?? null}
          label={photo ? avatarPhotoLabel(trimDisplayName(name) || name) : undefined}
          badge={
            <button
              type="button"
              aria-label={photo ? AVATAR_COPY.changePhoto : AVATAR_COPY.addPhoto}
              onClick={(event) =>
                openCamera(
                  { mode: 'avatar', saveToProfile: false, onSaved: onPhotoSaved },
                  event.currentTarget,
                )
              }
              className="on-object inline-flex size-target-min items-center justify-center rounded-full"
            >
              <span className="inline-flex size-9 items-center justify-center rounded-full border-[2.5px] border-obj-ink bg-pola text-obj-ink shadow-obj">
                <Icon icon={Camera} size={20} />
              </span>
            </button>
          }
        />
        {photo ? null : <p className="type-hand-sm text-muted">{SETUP_COPY.photoLater}</p>}
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
