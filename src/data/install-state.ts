import { useSyncExternalStore } from 'react'
import { detectPlatform, isInstalled, type InstallPlatform } from '@/domain/install'
import { readDevice, resetDeviceMemory, writeDevice } from '@/data/device-storage'

/**
 * Device-only install state (AD-12). Stored flags live in localStorage; every access tolerates a
 * blocked storage, falling back to memory so the guide and the Hint still work for the session.
 */
export const INSTALLED_KEY = 'proofy.installed'
export const GUIDE_DISMISSED_KEY = 'proofy.installGuideDismissed'
export const HINT_DISMISSED_AT_KEY = 'proofy.installHintDismissedAt'
const INSTALL_KEYS = [INSTALLED_KEY, GUIDE_DISMISSED_KEY, HINT_DISMISSED_AT_KEY]

/** The browser's `beforeinstallprompt` event, kept for later. Single-use: `prompt()` works once. */
export interface DeferredInstallPrompt {
  prompt(): Promise<unknown>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: DeferredInstallPrompt | null = null
let installedThisSession = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Keep the deferred install prompt (called from the early listener in src/app). The browser only
 * offers it when the app is not installed, so it also clears an earlier `appinstalled` (uninstall).
 */
export function captureInstallPrompt(event: DeferredInstallPrompt): void {
  deferredPrompt = event
  installedThisSession = false
  writeDevice(INSTALLED_KEY, null)
  notify()
}

/** `appinstalled` fired: remember it on this device and drop the prompt. */
export function markInstalled(): void {
  installedThisSession = true
  deferredPrompt = null
  writeDevice(INSTALLED_KEY, '1')
  notify()
}

/** "Continue without installing": the guide no longer shows right after sign-in on this device. */
export function dismissInstallGuide(): void {
  writeDevice(GUIDE_DISMISSED_KEY, '1')
  notify()
}

/** "Not now" on the Today Hint: hidden for a week from `now`. */
export function dismissInstallHint(now: Date = new Date()): void {
  writeDevice(HINT_DISMISSED_AT_KEY, now.toISOString())
  notify()
}

export type PromptOutcome = 'accepted' | 'dismissed' | 'unavailable'

/**
 * Show the browser install prompt. The event is single-use, so it is dropped before `prompt()`.
 * No prompt kept, or the browser refused to show it: `unavailable`.
 */
export async function promptInstall(): Promise<PromptOutcome> {
  const event = deferredPrompt
  if (!event) return 'unavailable'
  deferredPrompt = null
  notify()
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice.outcome
  } catch {
    return 'unavailable'
  }
}

export interface InstallState {
  platform: InstallPlatform
  installed: boolean
  /** A deferred browser install prompt is ready. */
  canPrompt: boolean
  guideDismissed: boolean
  hintDismissedAt: string | null
}

function matchesStandalone(): boolean {
  try {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches
    )
  } catch {
    return false
  }
}

function computeState(): InstallState {
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    platform: detectPlatform(nav.userAgent, nav.maxTouchPoints ?? 0),
    installed: isInstalled({
      standalone: matchesStandalone(),
      navigatorStandalone: nav.standalone === true,
      storedInstalled: installedThisSession || readDevice(INSTALLED_KEY) !== null,
    }),
    canPrompt: deferredPrompt !== null,
    guideDismissed: readDevice(GUIDE_DISMISSED_KEY) !== null,
    hintDismissedAt: readDevice(HINT_DISMISSED_AT_KEY),
  }
}

let cached: InstallState | null = null

/** The current install state. The same object is returned until a field changes. */
export function getInstallState(): InstallState {
  const next = computeState()
  if (
    cached &&
    cached.platform === next.platform &&
    cached.installed === next.installed &&
    cached.canPrompt === next.canPrompt &&
    cached.guideDismissed === next.guideDismissed &&
    cached.hintDismissedAt === next.hintDismissedAt
  ) {
    return cached
  }
  cached = next
  return next
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Install state for screens; re-renders when the prompt arrives, the app installs, or a dismissal. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getInstallState)
}

/** Tests only: forget the in-memory state (prompt, session install, storage fallback). */
export function resetInstallState(): void {
  deferredPrompt = null
  installedThisSession = false
  resetDeviceMemory((key) => INSTALL_KEYS.includes(key))
  cached = null
  notify()
}
