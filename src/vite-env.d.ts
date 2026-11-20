/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/**
 * True in dev and Vercel Preview builds (false when `VERCEL_ENV` is `production`): logs the camera's
 * tap-to-first-frame time (Story 3.1). Set by `define` in vite.config.ts.
 */
declare const __PROOFY_LOG_CAMERA__: boolean
