import { devices } from '@playwright/test'

/** The app under test: `vite preview` of the build (auth `site_url` allows this origin). */
export const BASE_URL = 'http://127.0.0.1:5173'

/** Mailpit, the local stack's mail catcher (`[local_smtp]` port in supabase/config.toml). */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

/**
 * The one device profile: Chromium as a Pixel 7. Service workers are blocked, so every test sees the
 * network as it is (no precache, no "Update ready" toast).
 */
export const PHONE = {
  ...devices['Pixel 7'],
  serviceWorkers: 'block' as const,
}
