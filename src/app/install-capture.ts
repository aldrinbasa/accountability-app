import {
  captureInstallPrompt,
  markInstalled,
  type DeferredInstallPrompt,
} from '@/data/install-state'

/**
 * Registered before the first render, so a `beforeinstallprompt` that fires during startup is not
 * missed. The browser's own mini-infobar is suppressed (`preventDefault`) and the event is kept for
 * the install guide's button. `appinstalled` marks this device as installed.
 */
export function startInstallCapture(target: Window = window): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault()
    captureInstallPrompt(event as unknown as DeferredInstallPrompt)
  }
  const onInstalled = () => markInstalled()
  target.addEventListener('beforeinstallprompt', onPrompt)
  target.addEventListener('appinstalled', onInstalled)
  return () => {
    target.removeEventListener('beforeinstallprompt', onPrompt)
    target.removeEventListener('appinstalled', onInstalled)
  }
}
