import { DEFAULT_NEXT_PATH, sanitizeNext } from '@/domain/next-path'

/** Where the full-screen install guide lives. */
export const INSTALL_PATH = '/install'

/** The Today Hint comes back at most once a week after "Not now". */
export const HINT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * What the install guide can do on this device:
 * - `ios-safari`: Safari on iPhone or iPad, the only iOS browser that can add to the home screen.
 * - `ios-other`: any other iOS browser or in-app browser (Chrome, Firefox, Edge, Opera, DuckDuckGo,
 *   the Google app, Facebook, Instagram, Line), which cannot install.
 * - `other`: everything else (Android, desktop); the browser prompt or its menu.
 */
export type InstallPlatform = 'ios-safari' | 'ios-other' | 'other'

const IOS_DEVICE = /iPhone|iPad|iPod/
const IOS_OTHER_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|FBAN|FBAV|Instagram|Line\//

/**
 * Reads the platform from the user agent. iPadOS Safari reports a Mac user agent by default, so a
 * `Macintosh` agent with more than one touch point counts as iOS.
 */
export function detectPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  const ios = IOS_DEVICE.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  if (!ios) return 'other'
  // Only real Safari carries `Safari/` without another browser's or app's token.
  const safari = /Safari\//.test(userAgent) && !IOS_OTHER_BROWSER.test(userAgent)
  return safari ? 'ios-safari' : 'ios-other'
}

export interface InstalledSignals {
  /** `(display-mode: standalone)` matches. */
  standalone: boolean
  /** iOS Safari's `navigator.standalone`. */
  navigatorStandalone: boolean
  /** `appinstalled` fired on this device earlier (stored device-only). */
  storedInstalled: boolean
}

/** Installed means running as the home-screen app, or the browser told us it installed it here. */
export function isInstalled(signals: InstalledSignals): boolean {
  return signals.standalone || signals.navigatorStandalone || signals.storedInstalled
}

/**
 * The weekly Hint rule: shown when never dismissed, when the stored time is unreadable or in the
 * future (a clock change must not hide it for good), or when 7 days have passed since "Not now".
 */
export function shouldShowHint(dismissedAt: string | null, now: Date): boolean {
  if (dismissedAt === null) return true
  const dismissed = Date.parse(dismissedAt)
  if (Number.isNaN(dismissed)) return true
  const elapsed = now.getTime() - dismissed
  if (elapsed < 0) return true
  return elapsed >= HINT_INTERVAL_MS
}

/**
 * Where the install guide forwards to: the pending `next` path, unless it is missing, unsafe, or the
 * guide itself, in which case /today.
 */
export function installGuideTarget(next: string | null): string {
  const safe = sanitizeNext(next)
  if (!safe) return DEFAULT_NEXT_PATH
  return isInstallPath(safe.split(/[?#]/, 1)[0] ?? '') ? DEFAULT_NEXT_PATH : safe
}

/** Whether a pathname is the guide, matched like the router: any case, trailing slashes ignored. */
export function isInstallPath(pathname: string): boolean {
  return pathname.toLowerCase().replace(/\/+$/, '') === INSTALL_PATH
}

/** What Today shows about installing: a Banner, a Hint, or nothing. */
export type InstallNotice = 'banner' | 'hint' | null

/**
 * Today's install notice. An iOS Safari tab gets the persistent Banner (reminders need the app).
 * Every other platform that is not installed gets the Hint, at most once a week after "Not now",
 * whether or not the guide was dismissed. Installed: nothing.
 */
export function installNotice(
  state: { platform: InstallPlatform; installed: boolean; hintDismissedAt: string | null },
  now: Date,
): InstallNotice {
  if (state.installed) return null
  if (state.platform === 'ios-safari') return 'banner'
  return shouldShowHint(state.hintDismissedAt, now) ? 'hint' : null
}

/** The guide shows right after sign-in only when the app is not installed and was not dismissed. */
export function installGuideApplies(state: {
  installed: boolean
  guideDismissed: boolean
}): boolean {
  return !state.installed && !state.guideDismissed
}
