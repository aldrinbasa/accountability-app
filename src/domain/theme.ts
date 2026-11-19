/**
 * Light / dark appearance. The member picks Auto (follow the phone), Light or Dark in Me > Settings;
 * the choice lives on this device only (AD-12). index.html applies it before the first paint with
 * the same rules, so keep THEME_STORAGE_KEY and THEME_COLORS in step with the inline script there.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

/** localStorage key, also read by the inline script in index.html. */
export const THEME_STORAGE_KEY = 'proofy.theme'

/** Browser chrome color per theme: the `paper` token (index.html repeats these). */
export const THEME_COLORS: Record<Theme, string> = { light: '#F6EEE3', dark: '#1C1230' }

/** Anything unknown or missing means Auto. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export const THEME_COPY = {
  heading: 'Appearance',
  options: { system: 'Auto', light: 'Light', dark: 'Dark' } satisfies Record<
    ThemePreference,
    string
  >,
  note: 'Auto follows your phone’s light or dark setting.',
} as const
