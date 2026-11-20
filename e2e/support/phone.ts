import { devices } from '@playwright/test'

/** The app under test: `vite preview` of the build (auth `site_url` allows this origin). */
export const BASE_URL = 'http://127.0.0.1:5173'

/** Mailpit, the local stack's mail catcher (`[local_smtp]` port in supabase/config.toml). */
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

/**
 * The one device profile: Chromium as a Pixel 7. Service workers are blocked, so every test sees the
 * network as it is (no precache, no "Update ready" toast). The camera is allowed; with
 * `CAMERA_LAUNCH_ARGS` Chromium serves its fake camera (a test pattern) to `getUserMedia`.
 */
export const PHONE = {
  ...devices['Pixel 7'],
  serviceWorkers: 'block' as const,
  permissions: ['camera'],
}

/** Chromium flags for a fake camera device with no permission prompt (Story 3.1). */
export const CAMERA_LAUNCH_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
]
