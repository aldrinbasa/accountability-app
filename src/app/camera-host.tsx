import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createCameraSession, type CameraCapture } from '@/data/camera-session'
import type { FirstAttempt } from '@/data/checkin-outbox'
import { setCameraOpen } from '@/ui/update-guard'
import { CameraOverlay } from '@/features/camera/camera-overlay'
import {
  CameraLauncherContext,
  type CameraLauncher,
  type CameraRequest,
} from '@/features/camera/camera-launcher'
import { CheckinFlow, type CheckinStep } from '@/features/checkin/checkin-flow'
import { useFocusedGroup } from '@/features/group/use-focused-group'
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

/**
 * Hosts the camera overlay for the signed-in shell (Story 3.1): owns the camera session, what the
 * camera is open for and the trigger to return focus to, and gives everything below it
 * `useCameraLauncher()`. The stream is requested in the tap itself, before the overlay renders, so it
 * warms up as early as possible. While open, the "Update ready" toast waits (`setCameraOpen`).
 *
 * The check-in handler (Story 3.2): a shot opens the check-in flow as a panel over the viewfinder
 * (picker for snap-first in the focused group, else the preview). Back steps through the flow. Post
 * hands the photo to the outbox (Story 3.3); once its first send settles (offline: at once) the
 * camera closes and Today shows the post moment (sent; the sender records it) or the outbox Banner
 * (waiting or rejected), which takes focus.
 */
export function CameraHost({ children }: { children: ReactNode }) {
  const port = useCameraPort()
  const [session] = useState(() => createCameraSession(port))
  const [opened, setOpened] = useState<Opened | null>(null)
  const [open, setOpen] = useState(false)
  const [shot, setShot] = useState<Shot | null>(null)
  const [step, setStep] = useState<CheckinStep | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const shots = useRef(0)
  const flowBack = useRef<(() => void) | null>(null)
  // This open ended in a post: focus goes to the post moment, not back to the trigger.
  const posted = useRef(false)
  const { group } = useFocusedGroup()
  const goToTab = useTabNavigation()

  const openCamera = useCallback<CameraLauncher['openCamera']>(
    (request, from) => {
      if (session.getSnapshot().status !== 'closed') return
      trigger.current = from
      posted.current = false
      // Check-ins use the back camera (Story 3.6 opens avatars on the front one).
      session.open('environment')
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

  // Leaving the shell (sign-out) with the camera open: no stream outlives it.
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

  function onDone(outcome: FirstAttempt) {
    posted.current = true
    close()
    goToTab(TODAY_PATH)
    // After the route commits and Today renders: focus the polaroid (sent) or the outbox Banner
    // (waiting, rejected), else the page heading.
    const selector =
      outcome === 'sent' ? '[data-component="post-moment"]' : '[data-component="outbox-banners"]'
    requestAnimationFrame(() => requestAnimationFrame(() => focusAfterPost(selector)))
  }

  function focusAfterPost(selector: string) {
    const landing = document.querySelector<HTMLElement>(selector)
    const target = landing ?? document.querySelector<HTMLElement>('main h1')
    if (!target) return
    if (!target.hasAttribute('tabindex')) target.tabIndex = -1
    target.focus()
  }

  /**
   * The trigger on a plain close. After a post focus goes to the post moment or the outbox Banner
   * instead (`focusAfterPost`, once Today has rendered): the trigger may be on another tab or about to turn into the Done check.
   */
  function returnFocus(): HTMLElement | null {
    if (posted.current) return null
    return trigger.current?.isConnected ? trigger.current : null
  }

  const launcher = useMemo<CameraLauncher>(() => ({ openCamera }), [openCamera])

  return (
    <CameraLauncherContext.Provider value={launcher}>
      {children}
      {opened ? (
        <CameraOverlay
          open={open}
          mode={opened.request.mode}
          session={session}
          target={opened.request.target}
          openedAt={opened.openedAt}
          onClose={close}
          onBack={onBack}
          backKey={shot ? `${shot.key}:${step ?? ''}` : ''}
          panel={
            shot ? (
              <CheckinFlow
                key={shot.key}
                photo={shot.capture}
                target={opened.request.target}
                groupId={opened.request.target?.groupId ?? group?.id ?? null}
                backRef={flowBack}
                onStepChange={setStep}
                onRetake={retake}
                onDiscard={close}
                onDone={onDone}
              />
            ) : null
          }
          onCapture={onCapture}
          returnFocusTo={returnFocus}
        />
      ) : null}
    </CameraLauncherContext.Provider>
  )
}
