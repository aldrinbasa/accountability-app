import { useEffect, useId, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { CAMERA_COPY, type CameraTarget } from '@/domain/camera'
import { CAPTION_MAX, captionCount, CHECKIN_COPY } from '@/domain/checkin'
import { usePostCheckin, type CheckinPhoto } from '@/data/checkin'
import type { FirstAttempt } from '@/data/checkin-outbox'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { Polaroid } from '@/ui/polaroid'
import { TextField } from '@/ui/text-field'
import { CameraControl, TargetChip } from '@/features/camera/camera-overlay'
import { CanvasPhoto } from '@/features/checkin/canvas-photo'

/**
 * The preview (Story 3.2): the photo as the Polaroid it will become, an optional Caption (visible
 * label, at most 80 characters, live "17/80" counter, previewed on the polaroid), Retake (ghost,
 * back to the live viewfinder) and Post (coral). Post reads "Posting…" and ignores repeat taps; the
 * id and caption freeze at the first Post (the caption turns read-only). Post hands the photo to the
 * outbox (Story 3.3), which sends it, retries it and reports a rejection on Today; only a failure to
 * encode or store it keeps the preview, with "Couldn't post your photo. Tap Retry." above Post.
 *
 * Close camera, Esc and system back ask "Discard this photo?" (Keep / Discard) through `confirming`,
 * owned by the flow.
 */
export function CheckinPreview({
  photo,
  target,
  confirming,
  onRetake,
  onRequestClose,
  onKeep,
  onDiscard,
  onDone,
  onBusyChange,
}: {
  photo: CheckinPhoto
  target: CameraTarget
  confirming: boolean
  onRetake: () => void
  /** Close camera: the flow asks "Discard this photo?". */
  onRequestClose: () => void
  onKeep: () => void
  onDiscard: () => void
  /** The photo is in the outbox: how its first send went (see `usePostCheckin`). */
  onDone: (outcome: FirstAttempt) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [caption, setCaption] = useState('')
  const flow = usePostCheckin({ target, photo, onDone })
  const headingRef = useRef<HTMLHeadingElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  useEffect(() => {
    onBusyChange(flow.busy)
  }, [flow.busy, onBusyChange])

  // The panel replaces the viewfinder: start at its heading; the confirm starts on Keep.
  useEffect(() => {
    if (confirming) keepRef.current?.focus()
    else headingRef.current?.focus()
  }, [confirming])

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-content-max flex-col pt-[env(safe-area-inset-top)]"
      data-component="checkin-preview"
    >
      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="sr-only">
        {CHECKIN_COPY.preview}
      </h2>
      <div className="flex items-center justify-between gap-2 px-gutter py-3">
        <CameraControl icon={X} label={CAMERA_COPY.close} onClick={onRequestClose} />
        <div className="flex min-w-0 flex-1 justify-center">
          <TargetChip target={target} />
        </div>
        <span aria-hidden="true" className="size-target-min shrink-0" />
      </div>

      <div className="flex flex-1 items-center justify-center px-8 py-4">
        <Polaroid
          className="w-full max-w-[340px]"
          photo={<CanvasPhoto canvas={photo.canvas} label={CHECKIN_COPY.preview} />}
          caption={caption}
        />
      </div>

      <section
        aria-labelledby={headingId}
        className="rounded-sheet border-[2.5px] border-b-0 border-line bg-card pt-4 pr-[max(var(--spacing-gutter),env(safe-area-inset-right))] pb-[calc(var(--spacing-4)+env(safe-area-inset-bottom))] pl-[max(var(--spacing-gutter),env(safe-area-inset-left))] text-ink"
        data-component="preview-controls"
      >
        {confirming ? (
          <div className="flex flex-col gap-4 py-2">
            <p className="type-title">{CHECKIN_COPY.discardTitle}</p>
            <div className="flex flex-wrap gap-3">
              <Button ref={keepRef} variant="ghost" className="flex-1" onClick={onKeep}>
                {CHECKIN_COPY.keep}
              </Button>
              <Button variant="primary" className="flex-1" onClick={onDiscard}>
                {CHECKIN_COPY.discard}
              </Button>
            </div>
          </div>
        ) : null}
        {/* Hidden, not unmounted, while confirming, so the caption survives Keep. */}
        <div hidden={confirming} className="flex flex-col gap-4">
          <TextField
            label={CHECKIN_COPY.caption}
            value={caption}
            maxLength={CAPTION_MAX}
            readOnly={flow.frozen}
            autoComplete="off"
            enterKeyHint="done"
            hint={captionCount(caption)}
            onChange={(event) => setCaption(event.target.value)}
          />
          {flow.failed ? (
            <InlineRetry onRetry={flow.retry}>{CHECKIN_COPY.postFailed}</InlineRetry>
          ) : null}
          <div className="flex gap-3">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => {
                // A post in flight keeps its photo.
                if (!flow.busy) onRetake()
              }}
            >
              {CHECKIN_COPY.retake}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              busy={flow.busy}
              busyLabel={CHECKIN_COPY.posting}
              onClick={() => flow.post(caption)}
            >
              {CHECKIN_COPY.post}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
