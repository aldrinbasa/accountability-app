import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react'
import { Dialog } from 'radix-ui'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { CameraRotate, X } from '@phosphor-icons/react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { CAMERA_COPY, type CameraMode, type CameraTarget } from '@/domain/camera'
import type { CameraCapture, CameraSession } from '@/data/camera-session'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import { FixItCard } from '@/features/camera/fix-it-card'

export interface CameraOverlayProps {
  open: boolean
  mode: CameraMode
  session: CameraSession
  /** The pre-picked target shown in the Target chip; null = snap-first (no chip). */
  target: CameraTarget | null
  /** `performance.now()` at the tap that opened the camera, for the first-frame timing. */
  openedAt: number | null
  /** Closes the camera (No camera's Close). */
  onClose: () => void
  /**
   * Close camera, Esc and system back. Without a panel this closes the camera; with one, the host
   * steps back (picker → viewfinder, preview → "Discard this photo?", confirm → Keep).
   */
  onBack: () => void
  /**
   * The check-in flow's current step (picker or preview), drawn over the whole overlay. The
   * viewfinder stays mounted (the stream keeps running, so Retake is instant) but hidden and inert.
   */
  panel?: ReactNode
  /** Changes with every flow step, so system back gets a fresh `CloseWatcher` per step. */
  backKey?: string
  /** The mode's capture handler: the 4:3 canvas and the device capture time. */
  onCapture: (capture: CameraCapture) => void
  /** Where focus returns on close (the Camera button or the row's Check in). */
  returnFocusTo: () => HTMLElement | null
}

interface CloseWatcherLike {
  onclose: (() => void) | null
  destroy(): void
}

type CloseWatcherConstructor = new () => CloseWatcherLike

function closeWatcherClass(): CloseWatcherConstructor | undefined {
  return (window as unknown as { CloseWatcher?: CloseWatcherConstructor }).CloseWatcher
}

/** Dev and Vercel Preview builds only: the tap-to-first-frame time (Story 3.1, 2 s budget). */
function logFirstFrame(video: HTMLVideoElement, ms: number): void {
  if (!__PROOFY_LOG_CAMERA__) return
  const rounded = Math.round(ms)
  video.dataset.firstFrameMs = String(rounded)
  console.info(`[proofy] camera first frame ${rounded} ms after the tap`)
}

/** DESIGN.md `camera-control`: 44px circle, translucent backing, camera-ink outline and icon. */
export function CameraControl({
  icon,
  label,
  onClick,
  buttonRef,
}: {
  icon: PhosphorIcon
  label: string
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-target-min shrink-0 items-center justify-center rounded-full border-[1.5px] border-camera-ink bg-camera-control text-camera-ink active:opacity-80"
    >
      <Icon icon={icon} size={24} />
    </button>
  )
}

/** DESIGN.md `target-chip`: coral pill, camera-ink outline, activity icon + name in `title-sm`. */
export function TargetChip({ target, id }: { target: CameraTarget; id?: string }) {
  const icon = target.presetKey !== null ? presetIcon(target.presetKey) : CUSTOM_ACTIVITY_ICON
  return (
    <p
      id={id}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-wob-sm border-[2.5px] border-camera-ink bg-primary px-3 py-1.5 type-title-sm text-on-primary landscape:max-w-[9rem]"
      data-component="target-chip"
    >
      <Icon icon={icon} size={20} />
      <span className="min-w-0 truncate">{target.title}</span>
    </p>
  )
}

/** DESIGN.md `shutter`: 76px camera-ink ring around a 60px coral blob, labeled "Take photo". */
function Shutter({
  onClick,
  buttonRef,
}: {
  onClick: () => void
  buttonRef: Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={CAMERA_COPY.takePhoto}
      onClick={onClick}
      className="grid size-[76px] place-items-center rounded-full border-4 border-camera-ink active:opacity-80"
      data-component="shutter"
    >
      <span aria-hidden="true" className="size-[60px] rounded-blob bg-primary" />
    </button>
  )
}

const BRACKET = 'pointer-events-none absolute size-[26px] border-camera-ink'

/**
 * The full-screen check-in camera (Story 3.1): a modal Radix Dialog on `camera-surface` above
 * everything (`--z-camera`), `100dvh`, the 480px column centered, safe areas padded. It never touches
 * the URL, history or hash. Top row: Close camera, Target chip, Switch camera (in landscape the
 * controls move to the right edge). The 4:3 Viewfinder frame shows exactly the capture crop; the
 * bottom row holds the "Live only" note (the dialog's description, read once on open), the Shutter
 * once the first frame is in, and an empty right slot. No gallery or file control anywhere.
 *
 * States from the session: warming ("Waking up the camera"), prompt (dimmed frame and the iPhone
 * helper sticky), live, denied (Fix-it card) and no camera.
 *
 * Close camera, Esc and Android back all call `onBack` (back through `CloseWatcher` where it
 * exists, one per flow step, else a `popstate` while open): without a panel the host closes the
 * camera, with one it steps back through the check-in flow (Story 3.2). The flow's `panel` covers the
 * overlay while the viewfinder stays mounted but hidden and inert. The page going hidden stops the
 * camera and coming back restarts it.
 */
export function CameraOverlay({
  open,
  mode,
  session,
  target,
  openedAt,
  onClose,
  onBack,
  panel = null,
  backKey = '',
  onCapture,
  returnFocusTo,
}: CameraOverlayProps) {
  const { status, stream, facing } = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const noteId = useId()
  const chipId = useId()
  // One capture per open: a fast double tap on the shutter hands over one shot.
  const shot = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const shutterRef = useRef<HTMLButtonElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const timedOpen = useRef<number | null>(null)
  const [frameStream, setFrameStream] = useState<MediaStream | null>(null)

  const failed = status === 'denied' || status === 'no_camera'
  const ready = status === 'live' && stream !== null && frameStream === stream
  const hasPanel = panel !== null && panel !== undefined && panel !== false

  const requestBack = useEffectEvent(() => onBack())
  const recordFirstFrame = useEffectEvent((video: HTMLVideoElement) => {
    if (openedAt === null || timedOpen.current === openedAt) return
    timedOpen.current = openedAt
    logFirstFrame(video, performance.now() - openedAt)
  })

  // Page hidden: stop every track; visible again: restart. System back closes the camera.
  useEffect(() => {
    if (!open) return
    const onVisibility = () => session.setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibility)

    let stopBack: () => void
    const Watcher = closeWatcherClass()
    let watcher: CloseWatcherLike | null = null
    if (Watcher) {
      try {
        watcher = new Watcher()
      } catch {
        watcher = null
      }
    }
    if (watcher) {
      const active = watcher
      active.onclose = () => requestBack()
      stopBack = () => {
        active.onclose = null
        active.destroy()
      }
    } else {
      // No CloseWatcher: back moves the route underneath too (accepted), and the camera steps back.
      const onPopState = () => requestBack()
      window.addEventListener('popstate', onPopState)
      stopBack = () => window.removeEventListener('popstate', onPopState)
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stopBack()
    }
    // A CloseWatcher is spent once it fires: each flow step (backKey) gets a fresh one.
  }, [open, session, backKey])

  // Attach the stream; the shutter waits for its first frame (requestVideoFrameCallback, else playing).
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    if (!stream) return
    let done = false
    const onFrame = () => {
      if (done) return
      done = true
      setFrameStream(stream)
      recordFirstFrame(video)
    }
    let frameId: number | null = null
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameId = video.requestVideoFrameCallback(onFrame)
    } else {
      video.addEventListener('playing', onFrame)
    }
    const played = video.play() as Promise<void> | undefined
    played?.catch(() => {
      // Autoplay of a muted inline stream is allowed; a refusal just leaves the frame warming.
    })
    return () => {
      done = true
      if (frameId !== null) video.cancelVideoFrameCallback?.(frameId)
      video.removeEventListener('playing', onFrame)
    }
  }, [stream])

  // Focus starts on the dialog (its name and the "Live only" note are read), then moves to the
  // shutter once live, or to the Fix-it action, unless the member already moved it to a control.
  // Back from a panel (picker closed, Retake) lands on the shutter again.
  useEffect(() => {
    if (!open || hasPanel) return
    const next = ready ? shutterRef.current : failed ? actionRef.current : null
    if (!next) return
    const active = document.activeElement
    if (active === null || active === document.body || active === contentRef.current) next.focus()
  }, [open, ready, failed, hasPanel])

  // The shutter guard re-arms on open, on a new stream and when the flow returns to the viewfinder.
  useEffect(() => {
    if (open && !hasPanel) shot.current = false
  }, [open, stream, hasPanel])

  function shoot() {
    const video = videoRef.current
    if (!video || !ready || shot.current || hasPanel) return
    shot.current = true
    try {
      onCapture(session.capture(video))
    } catch (error) {
      // A failed capture must not leave the shutter dead.
      shot.current = false
      throw error
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          ref={contentRef}
          // The "Live only" note, plus the pre-picked target, so screen readers hear what it's for.
          aria-describedby={target ? `${noteId} ${chipId}` : noteId}
          // Esc steps back like system back; preventDefault keeps Chrome's CloseWatcher out of it.
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            onBack()
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            contentRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const trigger = returnFocusTo()
            if (trigger?.isConnected) trigger.focus()
          }}
          // Full screen: there is no outside to tap.
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed inset-0 z-(--z-camera) h-dvh bg-camera-surface text-camera-ink outline-none"
          data-component="camera-overlay"
          data-mode={mode}
          data-status={status}
        >
          <Dialog.Title className="sr-only">{CAMERA_COPY.title}</Dialog.Title>
          <div
            inert={hasPanel}
            aria-hidden={hasPanel || undefined}
            className={cn(
              'mx-auto flex h-full w-full max-w-content-max flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] landscape:flex-row',
              hasPanel && 'invisible',
            )}
          >
            {/* Top control row; the right edge in landscape. */}
            <div className="flex items-center justify-between gap-2 px-gutter py-3 landscape:order-3 landscape:flex-col landscape:px-2 landscape:py-gutter">
              <CameraControl icon={X} label={CAMERA_COPY.close} onClick={onBack} />
              <div className="flex min-w-0 flex-1 justify-center landscape:flex-none">
                {target ? <TargetChip target={target} id={chipId} /> : null}
              </div>
              <CameraControl icon={CameraRotate} label={CAMERA_COPY.flip} onClick={session.flip} />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-4 px-gutter landscape:order-1 landscape:py-gutter">
              {failed ? (
                <FixItCard
                  variant={status}
                  onTryAgain={session.retry}
                  onClose={onClose}
                  actionRef={actionRef}
                />
              ) : (
                <>
                  <div
                    className={cn(
                      'relative aspect-[4/3] max-h-full w-full overflow-hidden rounded-frame landscape:h-full landscape:w-auto landscape:max-w-full',
                      status === 'prompt' && 'opacity-40',
                    )}
                    data-component="viewfinder"
                  >
                    <video
                      ref={videoRef}
                      autoPlay
                      muted
                      playsInline
                      disablePictureInPicture
                      aria-hidden="true"
                      // The front camera preview is mirrored, like a mirror; the capture is not.
                      className={cn(
                        'absolute inset-0 size-full object-cover',
                        facing === 'user' && '-scale-x-100',
                      )}
                    />
                    {!ready && status !== 'prompt' ? (
                      <p className="absolute inset-0 grid place-items-center px-4 text-center type-meta">
                        {CAMERA_COPY.warming}
                      </p>
                    ) : null}
                    <span
                      className={cn(BRACKET, 'top-2.5 left-2.5 border-t-[3px] border-l-[3px]')}
                    />
                    <span
                      className={cn(BRACKET, 'top-2.5 right-2.5 border-t-[3px] border-r-[3px]')}
                    />
                    <span
                      className={cn(BRACKET, 'bottom-2.5 left-2.5 border-b-[3px] border-l-[3px]')}
                    />
                    <span
                      className={cn(BRACKET, 'right-2.5 bottom-2.5 border-r-[3px] border-b-[3px]')}
                    />
                  </div>
                  {status === 'prompt' ? (
                    <p
                      role="status"
                      className="on-object max-w-[340px] -rotate-1 rounded-sticky bg-sticky px-4 py-3 type-body-sm text-obj-ink shadow-sticky"
                      data-component="permission-helper"
                    >
                      {CAMERA_COPY.promptHelper}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            {/* Shutter row: "Live only" in the gallery slot, the shutter, an empty right slot. */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-gutter py-4 landscape:order-2 landscape:grid-cols-1 landscape:grid-rows-[1fr_auto_1fr] landscape:px-2">
              {/* A plain element, not Dialog.Description: Radix would add its own (unused) id to
                  aria-describedby, which already names this note and the target chip. */}
              <p
                id={noteId}
                className="justify-self-start type-hand-sm landscape:justify-self-center landscape:self-start"
              >
                {CAMERA_COPY.liveOnly}
              </p>
              <div className="grid size-[76px] place-items-center">
                {ready ? <Shutter onClick={shoot} buttonRef={shutterRef} /> : null}
              </div>
              <span aria-hidden="true" />
            </div>
          </div>
          {hasPanel ? (
            <div className="absolute inset-0 overflow-y-auto" data-component="camera-panel">
              {panel}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
