import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CameraTarget } from '@/domain/camera'
import { createCameraSession, type CameraCapture } from '@/data/camera-session'
import type { PostedCheckin } from '@/data/checkin'
import { localPhotoUrl, setPostMoment } from '@/data/post-moment'
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
 * (picker for snap-first in the focused group, else the preview). Back steps through the flow. A
 * post records the post moment, closes the camera and goes to Today.
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
  const { group } = useFocusedGroup()
  const goToTab = useTabNavigation()

  const openCamera = useCallback<CameraLauncher['openCamera']>(
    (request, from) => {
      if (session.getSnapshot().status !== 'closed') return
      trigger.current = from
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
    if (shot !== null && flowBack.current) flowBack.current()
    else close()
  }

  const retake = useCallback(() => setShot(null), [])

  function onPosted({ input, result, fullPhoto }: PostedCheckin, target: CameraTarget) {
    setPostMoment({
      checkinId: result.checkinId,
      groupId: input.groupId,
      commitmentId: input.commitmentId,
      title: target.title,
      doneCount: result.doneCount,
      target: result.target,
      counted: result.counted,
      photoUrl: localPhotoUrl(fullPhoto),
      caption: input.caption,
      postedAt: Date.now(),
      played: false,
      announced: false,
    })
    close()
    goToTab(TODAY_PATH)
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
                onPosted={onPosted}
              />
            ) : null
          }
          onCapture={onCapture}
          returnFocusTo={() => trigger.current}
        />
      ) : null}
    </CameraLauncherContext.Provider>
  )
}
