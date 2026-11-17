import { useSyncExternalStore } from 'react'
import { detectPlatform, isInstalled, type InstallPlatform } from '@/domain/install'

/**
 * Device-only install state (AD-12). Stored flags live in localStorage; every access tolerates a
 * blocked storage, falling back to memory so the guide and the Hint still work for the session.
 */
export const INSTALLED_KEY = 'proofy.installed'
export const GUIDE_DISMISSED_KEY = 'proofy.installGuideDismissed'
export const HINT_DISMISSED_AT_KEY = 'proofy.installHintDismissedAt'

/** Values written while localStorage refused them. Read before localStorage. */
const memory = new Map<string, string>()

function read(key: string): string | null {
  const held = memory.get(key)
  if (held !== undefined) return held
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remove(key: string): void {
  memory.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    // Storage blocked: the memory copy is gone, which is all this session can do.
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
    memory.delete(key)
  } catch {
    // Storage blocked (private mode, quota): keep it for this session only.
    memory.set(key, value)
  }
}

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
  remove(INSTALLED_KEY)
  notify()
}

/** `appinstalled` fired: remember it on this device and drop the prompt. */
export function markInstalled(): void {
  installedThisSession = true
  deferredPrompt = null
  write(INSTALLED_KEY, '1')
  notify()
}

/** "Continue without installing": the guide no longer shows right after sign-in on this device. */
export function dismissInstallGuide(): void {
  write(GUIDE_DISMISSED_KEY, '1')
  notify()
}

/** "Not now" on the Today Hint: hidden for a week from `now`. */
export function dismissInstallHint(now: Date = new Date()): void {
  write(HINT_DISMISSED_AT_KEY, now.toISOString())
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
      storedInstalled: installedThisSession || read(INSTALLED_KEY) !== null,
    }),
    canPrompt: deferredPrompt !== null,
    guideDismissed: read(GUIDE_DISMISSED_KEY) !== null,
    hintDismissedAt: read(HINT_DISMISSED_AT_KEY),
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
  memory.clear()
  cached = null
  notify()
}
