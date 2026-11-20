import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { cameraFacing } from '@/domain/camera'
import type { SavedAvatar } from '@/domain/profile'
import { createCameraSession, type CameraCapture } from '@/data/camera-session'
import type { FirstAttempt } from '@/data/checkin-outbox'
import { setCameraOpen } from '@/ui/update-guard'
import { CameraOverlay } from '@/features/camera/camera-overlay'
import {
  CameraLauncherContext,
  type CameraLauncher,
  type CameraRequest,
  type CheckinCameraRequest,
} from '@/features/camera/camera-launcher'
import { CheckinFlow } from '@/features/checkin/checkin-flow'
import { useFocusedGroup } from '@/features/group/use-focused-group'
import { AvatarFlow } from '@/features/me/avatar-flow'
import { useCameraPort } from '@/app/camera-port-context'
import { TODAY_PATH } from '@/app/shell/tabs'
import { useTabNavigation } from '@/app/shell/use-tab-navigation'

interface Opened {
  request: CameraRequest
  openedAt: number
}

/** One shutter press: the frame and a key, so each shot gets a fresh flow (new id, empty caption). */
interface Shot {
  key: number
  capture: CameraCapture
}

/** What every mode's panel gets from the host. */
interface PanelProps {
  shot: Shot
  backRef: RefObject<(() => void) | null>
  onStepChange: (step: string) => void
  onRetake: () => void
  onDiscard: () => void
}

/**
 * Hosts the camera overlay (Story 3.1) for the signed-in shell and for `/setup` (Story 3.6): owns
 * the camera session, what the camera is open for and the trigger to return focus to, and gives
 * everything below it `useCameraLauncher()`. The stream is requested in the tap itself, before the
 * overlay renders, so it warms up as early as possible: the back camera for a check-in, the front
 * one for an avatar. While open, the "Update ready" toast waits (`setCameraOpen`).
 *
 * A shot opens the mode's panel over the viewfinder: `CheckinPanel` for a check-in, `AvatarFlow` for
 * the profile photo. Back steps through the panel. An avatar saved closes the camera and focus
 * returns to the trigger.
 */
export function CameraHost({ children }: { children: ReactNode }) {
  const port = useCameraPort()
  const [session] = useState(() => createCameraSession(port))
  const [opened, setOpened] = useState<Opened | null>(null)
  const [open, setOpen] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const shots = useRef(0)
  const flowBack = useRef<(() => void) | null>(null)
  // This open ended in a post: focus goes to the post's mini in Friends today, not back to the trigger.
  const posted = useRef(false)

  const openCamera = useCallback<CameraLauncher['openCamera']>(
    (request, from) => {
      if (session.getSnapshot().status !== 'closed') return
      trigger.current = from
      posted.current = false
      session.open(cameraFacing(request.mode))
      setOpened({ request, openedAt: performance.now() })
      setShot(null)
      setOpen(true)
    },
    [session],
  )

  const close = useCallback(() => {
    session.close()
    setOpen(false)
    setShot(null)
  }, [session])

  useEffect(() => {
    setCameraOpen(open)
  }, [open])

  // Leaving the shell or Setup (sign-out, setup done) with the camera open: no stream outlives it.
  useEffect(
    () => () => {
      session.close()
      setCameraOpen(false)
    },
    [session],
  )

  function onCapture(capture: CameraCapture) {
    shots.current += 1
    setShot({ key: shots.current, capture })
  }

  function onBack() {
    // With a shot, back belongs to the flow (even before its handler is registered): never close.
    if (shot !== null) {
      flowBack.current?.()
      return
    }
    close()
  }

  const retake = useCallback(() => setShot(null), [])

  const onPosted = useCallback(() => {
    posted.current = true
    close()
  }, [close])

  /**
   * The trigger on a plain close. After a post focus goes to the post moment or the outbox Banner
   * instead (`CheckinPanel`, once Today has rendered): the trigger may be on another tab or about to
   * turn into the Done check.
   */
  function returnFocus(): HTMLElement | null {
    if (posted.current) return null
    return trigger.current?.isConnected ? trigger.current : null
  }

  const launcher = useMemo<CameraLauncher>(() => ({ openCamera }), [openCamera])

  let panel: ReactNode = null
  if (opened && shot) {
    const common: PanelProps = {
      shot,
      backRef: flowBack,
      onStepChange: setStep,
      onRetake: retake,
      onDiscard: close,
    }
    const request = opened.request
    panel =
      request.mode === 'checkin' ? (
        <CheckinPanel key={shot.key} {...common} request={request} onPosted={onPosted} />
      ) : (
        <AvatarFlow
          key={shot.key}
          photo={shot.capture}
          saveToProfile={request.saveToProfile}
          backRef={flowBack}
          onStepChange={setStep}
          onRetake={retake}
          onDiscard={close}
          onSaved={(saved: SavedAvatar) => {
            request.onSaved(saved)
            close()
          }}
        />
      )
  }

  return (
    <CameraLauncherContext.Provider value={launcher}>
      {children}
      {opened ? (
        <CameraOverlay
          open={open}
          mode={opened.request.mode}
          session={session}
          target={opened.request.mode === 'checkin' ? opened.request.target : null}
          openedAt={opened.openedAt}
          onClose={close}
          onBack={onBack}
          backKey={shot ? `${shot.key}:${step ?? ''}` : ''}
          panel={panel}
          onCapture={onCapture}
          returnFocusTo={returnFocus}
        />
      ) : null}
    </CameraLauncherContext.Provider>
  )
}

/**
 * The check-in handler (Story 3.2): a shot opens the check-in flow (picker for snap-first in the
 * focused group, else the preview). Post hands the photo to the outbox (Story 3.3); once its first
 * send settles (offline: at once) the camera closes and Today shows the post moment (sent; the
 * sender records it) or the outbox Banner (waiting or rejected), which takes focus. Mounted only for
 * a check-in shot, inside the shell.
 */
function CheckinPanel({
  shot,
  request,
  backRef,
  onStepChange,
  onRetake,
  onDiscard,
  onPosted,
}: PanelProps & { request: CheckinCameraRequest; onPosted: () => void }) {
  const { group } = useFocusedGroup()
  const goToTab = useTabNavigation()

  function onDone(outcome: FirstAttempt) {
    onPosted()
    goToTab(TODAY_PATH)
    // After the route commits and Today renders: focus the post's mini at the head of Friends today
    // (sent) or the outbox Banner (waiting, rejected), else the page heading.
    const selector =
      outcome === 'sent' ? '[data-component="post-moment"]' : '[data-component="outbox-banners"]'
    requestAnimationFrame(() => requestAnimationFrame(() => focusAfterPost(selector)))
  }

  return (
    <CheckinFlow
      photo={shot.capture}
      target={request.target}
      groupId={request.target?.groupId ?? group?.id ?? null}
      backRef={backRef}
      onStepChange={onStepChange}
      onRetake={onRetake}
      onDiscard={onDiscard}
      onDone={onDone}
    />
  )
}

function focusAfterPost(selector: string) {
  const landing = document.querySelector<HTMLElement>(selector)
  const target = landing ?? document.querySelector<HTMLElement>('main h1')
  if (!target) return
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1
  target.focus()
}
