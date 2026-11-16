import { createClient } from '@supabase/supabase-js'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL
const configuredKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if ((!configuredUrl || !configuredKey) && import.meta.env.PROD) {
  // A production build without these would silently talk to 127.0.0.1. Fail loudly instead.
  throw new Error(
    '[proofy] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set for a production build (Vercel env settings for the Preview/Production scope).',
  )
}

if (!configuredUrl || !configuredKey) {
  // Dev/test only, non-fatal: the app still boots so the UI can be inspected, but backend calls fail until
  // VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (.env.local, or Vercel env settings).
  console.warn(
    '[proofy] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Backend calls will fail until they are configured.',
  )
}

// createClient rejects empty strings, so fall back to harmless placeholders.
const url = configuredUrl || 'http://127.0.0.1:54321'
const anonKey = configuredKey || 'anon-placeholder-key'

/** The single Supabase client (anon key + user session; all access enforced by RLS). */
export const supabase = createClient(url, anonKey, {
  auth: {
    // PKCE for Google: the code verifier stays in this browser, and the redirect brings back `?code=`.
    flowType: 'pkce',
    // The session survives app restarts (localStorage).
    persistSession: true,
    autoRefreshToken: true,
    // The sign-in screen reads `?code=` / `?token_hash=` itself and verifies them exactly once.
    detectSessionInUrl: false,
  },
})
