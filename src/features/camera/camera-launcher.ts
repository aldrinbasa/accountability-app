import { createContext, useContext } from 'react'
import type { CameraTarget } from '@/domain/camera'
import type { SavedAvatar } from '@/domain/profile'

/** A check-in shot (Story 3.1). */
export interface CheckinCameraRequest {
  mode: 'checkin'
  /** The pre-picked commitment or task (a due row's Check in); null = snap-first (Camera button). */
  target: CameraTarget | null
}

/** The profile photo (Story 3.6): front camera, square, no target chip. */
export interface AvatarCameraRequest {
  mode: 'avatar'
  /**
   * Settings: Use photo also points the profile's `avatar_path` at the upload. Setup (no profile
   * row yet): Use photo only uploads; Continue saves the path with the name.
   */
  saveToProfile: boolean
  /** The photo is in Storage (and, with `saveToProfile`, on the profile). The camera then closes. */
  onSaved: (saved: SavedAvatar) => void
}

export type CameraRequest = CheckinCameraRequest | AvatarCameraRequest

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
