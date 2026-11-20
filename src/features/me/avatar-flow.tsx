import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { X } from '@phosphor-icons/react'
import { CAMERA_COPY } from '@/domain/camera'
import { AVATAR_COPY, type SavedAvatar } from '@/domain/profile'
import { useAuthSession } from '@/data/auth-session'
import type { CameraCapture } from '@/data/camera-session'
import { useSaveAvatar } from '@/data/profile'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { CameraControl } from '@/features/camera/camera-overlay'
import { CanvasPhoto } from '@/features/checkin/canvas-photo'

/** Where the avatar flow is: the preview, or "Discard this photo?" over it. */
export type AvatarStep = 'preview' | 'confirm'

export interface AvatarFlowProps {
  /** The shot: the square canvas. */
  photo: CameraCapture
  /** Settings: also set `avatar_path`. Setup: only upload. */
  saveToProfile: boolean
  /** Filled with the flow's back step, for Close camera, Esc and system back in the overlay. */
  backRef: RefObject<(() => void) | null>
  /** The step changed (the overlay renews its CloseWatcher). */
  onStepChange: (step: AvatarStep) => void
  /** Retake: back to the live viewfinder. */
  onRetake: () => void
  /** "Discard this photo?" → Discard: close the camera. */
  onDiscard: () => void
  /** The photo is saved; the host closes the camera. */
  onSaved: (saved: SavedAvatar) => void
}

/**
 * The profile photo preview (Story 3.6), drawn as a panel inside the camera overlay: the square shot
 * in a circle, Retake (ghost, unlimited) and Use photo (coral). Use photo reads "Saving…" and ignores
 * repeat taps; offline or on failure the preview stays with Inline retry. Close camera, Esc and
 * system back ask "Discard this photo?" (Keep / Discard); while saving back does nothing.
 */
export function AvatarFlow({
  photo,
  saveToProfile,
  backRef,
  onStepChange,
  onRetake,
  onDiscard,
  onSaved,
}: AvatarFlowProps) {
  const { user } = useAuthSession()
  const [confirming, setConfirming] = useState(false)
  const flow = useSaveAvatar({
    canvas: photo.canvas,
    userId: user?.id ?? '',
    saveToProfile,
    onSaved,
  })
  const busy = useRef(false)
  useEffect(() => {
    busy.current = flow.busy
  }, [flow.busy])
  const headingRef = useRef<HTMLHeadingElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()
  const step: AvatarStep = confirming ? 'confirm' : 'preview'

  const back = useCallback(() => {
    if (step === 'confirm') setConfirming(false)
    else if (!busy.current) setConfirming(true)
  }, [step])

  useEffect(() => {
    backRef.current = back
    return () => {
      backRef.current = null
    }
  }, [back, backRef])

  useEffect(() => {
    onStepChange(step)
  }, [step, onStepChange])

  // The panel replaces the viewfinder: start at its heading; the confirm starts on Keep.
  useEffect(() => {
    if (confirming) keepRef.current?.focus()
    else headingRef.current?.focus()
  }, [confirming])

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-content-max flex-col pt-[env(safe-area-inset-top)]"
      data-component="avatar-preview"
    >
      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="sr-only">
        {AVATAR_COPY.preview}
      </h2>
      <div className="flex items-center justify-between gap-2 px-gutter py-3">
        <CameraControl icon={X} label={CAMERA_COPY.close} onClick={back} />
        <span aria-hidden="true" className="size-target-min shrink-0" />
      </div>

      <div className="flex flex-1 items-center justify-center px-8 py-4">
        <div
          className="aspect-square w-full max-w-[280px] overflow-hidden rounded-full border-[2.5px] border-obj-ink shadow-obj"
          data-component="avatar-circle"
        >
          <CanvasPhoto canvas={photo.canvas} label={AVATAR_COPY.preview} />
        </div>
      </div>

      <section
        aria-labelledby={headingId}
        className="rounded-sheet border-[2.5px] border-b-0 border-line bg-card pt-4 pr-[max(var(--spacing-gutter),env(safe-area-inset-right))] pb-[calc(var(--spacing-4)+env(safe-area-inset-bottom))] pl-[max(var(--spacing-gutter),env(safe-area-inset-left))] text-ink"
        data-component="preview-controls"
      >
        {confirming ? (
          <div className="flex flex-col gap-4 py-2">
            <p className="type-title">{AVATAR_COPY.discardTitle}</p>
            <div className="flex flex-wrap gap-3">
              <Button
                ref={keepRef}
                variant="ghost"
                className="flex-1"
                onClick={() => setConfirming(false)}
              >
                {AVATAR_COPY.keep}
              </Button>
              <Button variant="primary" className="flex-1" onClick={onDiscard}>
                {AVATAR_COPY.discard}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {flow.failure ? (
              <InlineRetry onRetry={flow.retry} retryLabel={AVATAR_COPY.retry}>
                {flow.failure === 'offline' ? AVATAR_COPY.offline : AVATAR_COPY.failed}
              </InlineRetry>
            ) : null}
            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  // A save in flight keeps its photo.
                  if (!flow.busy) onRetake()
                }}
              >
                {AVATAR_COPY.retake}
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                busy={flow.busy}
                busyLabel={AVATAR_COPY.saving}
                onClick={flow.save}
              >
                {AVATAR_COPY.usePhoto}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
