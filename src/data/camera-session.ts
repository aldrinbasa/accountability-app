import {
  CameraError,
  type CameraCapture,
  type CameraFacing,
  type CameraFailure,
  type CameraPort,
  type CameraStream,
} from '@/ports/camera-port'

export type { CameraCapture, CameraFacing }

/**
 * - `closed`: no overlay, no stream.
 * - `warming`: a request is pending (or the page is hidden while open): "Waking up the camera".
 * - `prompt`: the system permission prompt is likely up: dimmed frame and the helper sticky.
 * - `live`: a stream is attached (the overlay still waits for its first frame before the shutter).
 * - `denied` / `no_camera`: the Fix-it card or No camera.
 */
export type CameraStatus = 'closed' | 'warming' | 'prompt' | 'live' | CameraFailure

export interface CameraSnapshot {
  status: CameraStatus
  /** The live stream's media, only while `live`. */
  stream: MediaStream | null
  facing: CameraFacing
}

export interface CameraSession {
  /** Starts the camera facing `facing` (one attempt). */
  open(facing: CameraFacing): void
  /** Stops every track; a request still pending is stopped the moment it resolves. */
  close(): void
  /** Stops the current tracks, then asks for the other facing (one attempt). */
  flip(): void
  /** Try again from the Fix-it card or No camera (one attempt). */
  retry(): void
  /** Page hidden: stop every track. Visible again while open: restart (with one retry). */
  setVisible(visible: boolean): void
  /**
   * The live frame, center-cropped to `aspect` (width / height: 4:3 for check-ins, 1 for avatars),
   * with the device capture time.
   */
  capture(video: HTMLVideoElement, aspect: number): CameraCapture
  getSnapshot(): CameraSnapshot
  subscribe(listener: () => void): () => void
}

/** Where the Permissions API cannot say, a request still pending after this long counts as a prompt. */
export const PROMPT_FALLBACK_MS = 1000

const CLOSED: CameraSnapshot = { status: 'closed', stream: null, facing: 'environment' }

function failureOf(error: unknown): CameraFailure {
  return error instanceof CameraError ? error.failure : 'no_camera'
}

/**
 * The camera state machine (Story 3.1, AD-13). It owns the one stream: every new request first stops
 * the current one, and each request carries a generation number so a stream that arrives after a
 * close, a flip or the page going hidden is stopped at once instead of being shown.
 *
 * Retry once applies only to a lost stream (a track that ended while open and visible, or the restart
 * after the page comes back): Warming up, one more attempt, then the error. Open, flip and Try again
 * make one attempt.
 */
export function createCameraSession(port: CameraPort): CameraSession {
  let snapshot: CameraSnapshot = CLOSED
  let current: CameraStream | null = null
  let stopListening: (() => void) | null = null
  let generation = 0
  let visible = true
  let resumeOnVisible = false
  let promptTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  function set(next: Partial<CameraSnapshot>): void {
    snapshot = { ...snapshot, ...next }
    for (const listener of listeners) listener()
  }

  function clearPromptTimer(): void {
    if (promptTimer !== null) clearTimeout(promptTimer)
    promptTimer = null
  }

  /** Ends the current request and stream: a pending request's stream is dropped when it arrives. */
  function stopAll(): void {
    generation += 1
    clearPromptTimer()
    stopListening?.()
    stopListening = null
    current?.stop()
    current = null
  }

  function stillPending(gen: number): boolean {
    return gen === generation && snapshot.status === 'warming'
  }

  function watchPrompt(gen: number): void {
    const fallback = () => {
      if (!stillPending(gen)) return
      promptTimer = setTimeout(() => {
        promptTimer = null
        if (stillPending(gen)) set({ status: 'prompt' })
      }, PROMPT_FALLBACK_MS)
    }
    port.permissionState().then((state) => {
      if (!stillPending(gen)) return
      if (state === 'prompt') set({ status: 'prompt' })
      else if (state === 'unknown') fallback()
    }, fallback)
  }

  function attempt(retriesLeft: number): void {
    stopAll()
    const gen = generation
    set({ status: 'warming', stream: null })
    watchPrompt(gen)
    port.start(snapshot.facing).then(
      (stream) => {
        if (gen !== generation) {
          // Closed, flipped or hidden while the request was pending.
          stream.stop()
          return
        }
        clearPromptTimer()
        current = stream
        stopListening = stream.onEnded(() => onLost(gen))
        set({ status: 'live', stream: stream.media })
      },
      (error: unknown) => {
        if (gen !== generation) return
        clearPromptTimer()
        if (retriesLeft > 0) {
          attempt(retriesLeft - 1)
          return
        }
        set({ status: failureOf(error), stream: null })
      },
    )
  }

  function onLost(gen: number): void {
    if (gen !== generation || snapshot.status !== 'live' || !visible) return
    attempt(1)
  }

  return {
    open(facing) {
      visible = true
      resumeOnVisible = false
      set({ facing })
      attempt(0)
    },

    close() {
      stopAll()
      resumeOnVisible = false
      set({ status: 'closed', stream: null })
    },

    flip() {
      if (snapshot.status === 'closed') return
      set({ facing: snapshot.facing === 'environment' ? 'user' : 'environment' })
      if (!visible) {
        resumeOnVisible = true
        return
      }
      attempt(0)
    },

    retry() {
      if (snapshot.status === 'closed') return
      if (!visible) {
        resumeOnVisible = true
        return
      }
      attempt(0)
    },

    setVisible(next) {
      if (visible === next) return
      visible = next
      if (snapshot.status === 'closed') return
      if (!next) {
        const s = snapshot.status
        if (s === 'warming' || s === 'prompt' || s === 'live') {
          stopAll()
          resumeOnVisible = true
          set({ status: 'warming', stream: null })
        }
        return
      }
      if (resumeOnVisible) {
        resumeOnVisible = false
        attempt(1)
        return
      }
      // Back from Settings after the Fix-it steps: ask again once.
      if (snapshot.status === 'denied') attempt(0)
    },

    capture(video, aspect) {
      return port.capture(video, aspect)
    },

    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
