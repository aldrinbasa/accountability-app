/**
 * Shared guard for the "Update ready." service-worker toast. The toast must never interrupt the
 * camera overlay (Story 3.1) or a running upload (Story 3.2), so those stories flip these flags and
 * the update prompt re-checks when the guard clears.
 */
type Listener = () => void

let cameraOpen = false
let uploadRunning = false
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** True when nothing blocks the update toast. */
export function canShowUpdatePrompt(): boolean {
  return !cameraOpen && !uploadRunning
}

/** Story 3.1: true while the camera overlay is open. */
export function setCameraOpen(open: boolean): void {
  if (cameraOpen === open) return
  cameraOpen = open
  notify()
}

/** Story 3.2: true while a check-in upload runs. */
export function setUploadRunning(running: boolean): void {
  if (uploadRunning === running) return
  uploadRunning = running
  notify()
}

/** Called after every guard change. Returns the unsubscribe function. */
export function subscribeUpdateGuard(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
