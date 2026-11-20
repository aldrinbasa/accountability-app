/**
 * The app's one camera contract (AD-13). Implemented in src/adapters/camera, the only code that opens
 * or stops a camera stream; wired only in src/app/composition.ts. The session in
 * src/data/camera-session.ts drives it and makes sure at most one stream exists.
 */

/** `environment` = back camera (check-ins), `user` = front camera (Story 3.6 avatars, flip). */
export type CameraFacing = 'environment' | 'user'

/**
 * Why the camera could not start: `denied` (`NotAllowedError`, `SecurityError`) shows the Fix-it
 * card; `no_camera` (no device, none can be opened, no `navigator.mediaDevices`) shows No camera.
 */
export type CameraFailure = 'denied' | 'no_camera'

/** What `start` rejects with. */
export class CameraError extends Error {
  readonly failure: CameraFailure

  constructor(failure: CameraFailure, options?: { cause?: unknown }) {
    super(failure, options)
    this.name = 'CameraError'
    this.failure = failure
  }
}

/** The Permissions API's answer for `camera`; `unknown` where the API is missing or throws. */
export type CameraPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

/** One open camera stream. */
export interface CameraStream {
  /** For the viewfinder's `<video>.srcObject`. */
  readonly media: MediaStream
  /** Stops every track. Safe to call more than once. */
  stop(): void
  /** Runs when a track ends on its own (another app took the camera, the device went away). */
  onEnded(callback: () => void): () => void
}

/** One captured frame: a canvas already center-cropped to the asked aspect, and when it was taken. */
export interface CameraCapture {
  canvas: HTMLCanvasElement
  /** The device clock at the shutter press. */
  capturedAt: Date
}

export interface CameraPort {
  /** Opens the camera facing `facing` (asked as `ideal`, so a one-camera device still opens). */
  start(facing: CameraFacing): Promise<CameraStream>
  /** The camera permission right now, without asking. Never rejects. */
  permissionState(): Promise<CameraPermission>
  /** Draws the video's current frame, center-cropped to `aspect` (width / height). */
  capture(video: HTMLVideoElement, aspect: number): CameraCapture
}
