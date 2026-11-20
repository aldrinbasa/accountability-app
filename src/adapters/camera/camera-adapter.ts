import { centerCrop } from '@/domain/camera'
import {
  CameraError,
  type CameraCapture,
  type CameraFacing,
  type CameraFailure,
  type CameraPermission,
  type CameraPort,
  type CameraStream,
} from '@/ports/camera-port'

/** Permission errors; everything else (no device, busy, overconstrained, aborted) is No camera. */
const DENIED_ERRORS = new Set(['NotAllowedError', 'SecurityError'])

export function classifyCameraError(error: unknown): CameraFailure {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  return DENIED_ERRORS.has(name) ? 'denied' : 'no_camera'
}

function wrapStream(media: MediaStream): CameraStream {
  let stopped = false
  return {
    media,
    stop() {
      if (stopped) return
      stopped = true
      for (const track of media.getTracks()) track.stop()
    },
    onEnded(callback) {
      // `track.stop()` never fires `ended`, so this only hears tracks the system took away.
      const tracks = media.getVideoTracks()
      for (const track of tracks) track.addEventListener('ended', callback)
      return () => {
        for (const track of tracks) track.removeEventListener('ended', callback)
      }
    },
  }
}

/**
 * The only `getUserMedia` caller in the app (AD-13). Video only, the asked facing as `ideal` and a
 * 4:3 size hint, so a laptop or a one-camera phone still opens.
 */
export const cameraAdapter: CameraPort = {
  async start(facing: CameraFacing): Promise<CameraStream> {
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
    if (!devices || typeof devices.getUserMedia !== 'function') throw new CameraError('no_camera')
    let media: MediaStream
    try {
      media = await devices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
      })
    } catch (error) {
      throw new CameraError(classifyCameraError(error), { cause: error })
    }
    return wrapStream(media)
  },

  async permissionState(): Promise<CameraPermission> {
    try {
      const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
      if (!permissions || typeof permissions.query !== 'function') return 'unknown'
      const status = await permissions.query({ name: 'camera' as PermissionName })
      const state = status.state
      return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown'
    } catch {
      return 'unknown'
    }
  },

  capture(video: HTMLVideoElement, aspect: number): CameraCapture {
    const capturedAt = new Date()
    const { sx, sy, sw, sh } = centerCrop(video.videoWidth, video.videoHeight, aspect)
    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
    return { canvas, capturedAt }
  },
}
