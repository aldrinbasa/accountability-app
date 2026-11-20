/**
 * Camera rules and copy (Story 3.1). The camera itself lives behind `CameraPort`; this file only holds
 * the pure parts: the capture crop, the overlay copy and the Fix-it steps per platform.
 */

/** Every check-in photo is 4:3 landscape (DESIGN.md `photo-aspect`), whatever the phone orientation. */
export const PHOTO_ASPECT = 4 / 3

/** What the camera is open for. Story 3.6 adds `avatar`. */
export type CameraMode = 'checkin'

/** The pre-picked commitment or task a due row's Check in opens the camera for. */
export interface CameraTarget {
  commitmentId: string
  kind: 'commitment' | 'task'
  /** The row's title: the task's name, else the activity's. */
  title: string
  /** For the chip's activity icon; null for a custom activity. */
  presetKey: string | null
}

export interface CropRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

/**
 * The largest centered rectangle of `aspect` (width / height) inside a `srcW` x `srcH` frame, in whole
 * pixels. A portrait frame gives a landscape slice from its middle; a wider frame loses its sides.
 */
export function centerCrop(srcW: number, srcH: number, aspect: number): CropRect {
  if (srcW <= 0 || srcH <= 0 || aspect <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 }
  if (srcW / srcH > aspect) {
    const sw = Math.round(srcH * aspect)
    return { sx: Math.floor((srcW - sw) / 2), sy: 0, sw, sh: srcH }
  }
  const sh = Math.round(srcW / aspect)
  return { sx: 0, sy: Math.floor((srcH - sh) / 2), sw: srcW, sh }
}

/** Copy for the camera overlay and the Check in button (Story 3.1 ACs, EXPERIENCE.md). */
export const CAMERA_COPY = {
  /** The dialog's accessible name (visually hidden). */
  title: 'Camera',
  warming: 'Waking up the camera',
  liveOnly: 'Live only',
  takePhoto: 'Take photo',
  close: 'Close camera',
  flip: 'Switch camera',
  promptHelper:
    "iPhone asks again sometimes. That's iOS, not us. Tap Allow and you're back to checking in. We only use the camera while this screen is open.",
  deniedHeading: "Camera's blocked",
  tryAgain: 'Try again',
  noCameraHeading: 'No camera found.',
  noCameraBody: 'Check-ins need a camera. Try on your phone.',
  closeAction: 'Close',
  checkIn: 'Check in',
  /** Temporary until Story 3.2 adds the picker and preview. */
  captureStub: 'Photo taken. Posting comes in the next update.',
} as const

/** The due row's Check in button name: "Check in Grocery run". */
export function checkInLabel(title: string): string {
  return `${CAMERA_COPY.checkIn} ${title}`
}

export type CameraPlatform = 'ios' | 'android' | 'other'

/** The platform whose camera settings the Fix-it card explains. iPadOS desktop mode reads as Mac. */
export function cameraPlatform(userAgent: string): CameraPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'other'
}

/** The Fix-it card's numbered steps to allow the camera again. */
export function fixItSteps(platform: CameraPlatform): readonly string[] {
  switch (platform) {
    case 'ios':
      return [
        'Open Settings, then Proofy (or Safari if you use Proofy in Safari).',
        'Tap Camera.',
        'Choose Allow, then come back and tap Try again.',
      ]
    case 'android':
      return [
        'Tap the lock icon next to the address, or open App info for Proofy.',
        'Go to Permissions, then Camera.',
        'Choose Allow, then come back and tap Try again.',
      ]
    case 'other':
      return [
        'Click the lock or camera icon next to the address.',
        'Set Camera to Allow.',
        'Come back and click Try again.',
      ]
  }
}
