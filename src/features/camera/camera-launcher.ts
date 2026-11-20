import { createContext, useContext } from 'react'
import type { CameraMode, CameraTarget } from '@/domain/camera'

export interface CameraRequest {
  mode: CameraMode
  /** The pre-picked commitment or task (a due row's Check in); null = snap-first (Camera button). */
  target: CameraTarget | null
}

export interface CameraLauncher {
  /**
   * Opens the camera overlay without any route, history or hash change. `trigger` gets focus back
   * when the camera closes.
   */
  openCamera(request: CameraRequest, trigger: HTMLElement | null): void
}

/** Filled by `CameraHost` (src/app/camera-host.tsx). */
export const CameraLauncherContext = createContext<CameraLauncher | null>(null)

export function useCameraLauncher(): CameraLauncher {
  const launcher = useContext(CameraLauncherContext)
  if (!launcher) throw new Error('useCameraLauncher must be used inside <CameraHost>')
  return launcher
}
