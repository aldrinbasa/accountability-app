import { createContext, useContext } from 'react'
import type { BackendPort } from '@/ports/backend-port'
import type { AuthSessionStore } from '@/data/auth-session'

export interface BackendContextValue {
  backend: BackendPort
  session: AuthSessionStore
}

/** Filled by `BackendProvider` (backend-context.tsx); kept apart so that file exports only components. */
export const BackendContext = createContext<BackendContextValue | null>(null)

/** The backend and session from the nearest `BackendProvider`; `hook` names the caller in the error. */
export function useBackendContext(hook: string): BackendContextValue {
  const value = useContext(BackendContext)
  if (!value) throw new Error(`${hook} must be used inside <BackendProvider>`)
  return value
}
