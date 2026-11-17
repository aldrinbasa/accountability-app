import { defineConfig } from '@playwright/test'
import { loadEnv } from 'vite'
import { BASE_URL, PHONE } from './e2e/support/phone'

/**
 * Browser end-to-end tests (Story 1.9). They drive the built app (`vite preview`) against the LOCAL
 * Supabase stack only: real auth, real database, Mailpit for sign-in codes. Never proofy-dev or prod.
 *
 * CI (`e2e` job in .github/workflows/ci.yml) starts Supabase, builds with the local API URL and anon
 * key, then runs `npm run test:e2e`. Locally (needs Docker): `npm run db:start`, put the local URL and
 * anon key in .env.local, then `npm run test:e2e` (it builds first outside CI).
 */

// Guard: the build must point at the local stack. Read the way `vite build` does (process env, then
// .env.production.local, .env.production, .env.local, .env), so a hosted URL never gets tested.
const supabaseUrl = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL ?? ''
let supabaseHost = ''
try {
  supabaseHost = new URL(supabaseUrl).hostname
} catch {
  // Missing or malformed: refused below.
}
if (supabaseHost !== '127.0.0.1' && supabaseHost !== 'localhost') {
  throw new Error(
    `e2e runs only against the local Supabase stack, but VITE_SUPABASE_URL is "${supabaseUrl}". ` +
      'Set it to the local API URL (npm run db:start prints it) in the environment or .env.local.',
  )
}

// Port 5173 because supabase/config.toml's auth `site_url` and redirect list allow
// http://127.0.0.1:5173 for the local stack.
const preview = 'npm run preview -- --port 5173 --strictPort'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  // One project: Chromium with a phone profile. iOS-only behaviour is checked by hand.
  projects: [{ name: 'chromium-phone', use: { ...PHONE } }],
  webServer: {
    command: process.env.CI ? preview : `npm run build && ${preview}`,
    url: BASE_URL,
    // Never reuse whatever already listens on 5173 (e.g. `npm run dev` against a hosted project).
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
