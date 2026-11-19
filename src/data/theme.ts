import { useSyncExternalStore } from 'react'
import {
  parseThemePreference,
  resolveTheme,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemePreference,
} from '@/domain/theme'

/**
 * The appearance preference, stored on this device only (AD-12), and its effect on the page:
 * `data-theme` on <html> (tokens.css switches every color on it) and the browser chrome color.
 * Every storage access tolerates a blocked storage, falling back to memory for the session.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

let memory: { value: ThemePreference } | null = null
const listeners = new Set<() => void>()

export function getThemePreference(): ThemePreference {
  if (memory) return memory.value
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

/** Put a theme on the page: tokens, form controls and the browser chrome follow it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

function applyPreference(preference: ThemePreference): void {
  applyTheme(resolveTheme(preference, systemPrefersDark()))
}

/** Store and apply a preference at once; 'system' forgets the stored choice. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
    memory = null
  } catch {
    memory = { value: preference }
  }
  applyPreference(preference)
  listeners.forEach((listener) => listener())
}

/**
 * Apply the stored preference and, while it is Auto, follow the phone switching live.
 * Returns a stop function (tests).
 */
export function startThemeSync(): () => void {
  applyPreference(getThemePreference())
  let query: MediaQueryList | null = null
  try {
    query = window.matchMedia(DARK_QUERY)
  } catch {
    return () => {}
  }
  const onChange = () => {
    if (getThemePreference() === 'system') applyPreference('system')
  }
  query.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current preference and a setter, for the Settings switch. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribe, getThemePreference, getThemePreference)
  return [preference, setThemePreference]
}

/** Tests only: forget the in-memory fallback. */
export function resetThemeMemory(): void {
  memory = null
}
