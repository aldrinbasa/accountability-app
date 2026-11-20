import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CAMERA_COPY } from '@/domain/camera'
import { createCameraSession, type CameraCapture } from '@/data/camera-session'
import { showToast } from '@/ui/toast'
import { setCameraOpen } from '@/ui/update-guard'
import { CameraOverlay } from '@/features/camera/camera-overlay'
import {
  CameraLauncherContext,
  type CameraLauncher,
  type CameraRequest,
} from '@/features/camera/camera-launcher'
import { useCameraPort } from '@/app/camera-port-context'

interface Opened {
  request: CameraRequest
  openedAt: number
}

/**
 * Hosts the camera overlay for the signed-in shell (Story 3.1): owns the camera session, what the
 * camera is open for and the trigger to return focus to, and gives everything below it
 * `useCameraLauncher()`. The stream is requested in the tap itself, before the overlay renders, so it
 * warms up as early as possible. While open, the "Update ready" toast waits (`setCameraOpen`).
 */
export function CameraHost({ children }: { children: ReactNode }) {
  const port = useCameraPort()
  const [session] = useState(() => createCameraSession(port))
  const [opened, setOpened] = useState<Opened | null>(null)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)

  const openCamera = useCallback<CameraLauncher['openCamera']>(
    (request, from) => {
      if (session.getSnapshot().status !== 'closed') return
      trigger.current = from
      // Check-ins use the back camera (Story 3.6 opens avatars on the front one).
      session.open('environment')
      setOpened({ request, openedAt: performance.now() })
      setOpen(true)
    },
    [session],
  )

  const close = useCallback(() => {
    session.close()
    setOpen(false)
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

  function onCapture(_capture: CameraCapture) {
    // Story 3.2 replaces this with the picker (snap-first) and the preview.
    close()
    showToast(CAMERA_COPY.captureStub)
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
          onCapture={onCapture}
          returnFocusTo={() => trigger.current}
        />
      ) : null}
    </CameraLauncherContext.Provider>
  )
}
