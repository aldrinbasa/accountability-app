import { createContext } from 'react'
import type { BackendPort } from '@/ports/backend-port'
import type { AuthSessionStore } from '@/data/auth-session'

export interface BackendContextValue {
  backend: BackendPort
  session: AuthSessionStore
}

/** Filled by `BackendProvider` (backend-context.tsx); kept apart so that file exports only components. */
export const BackendContext = createContext<BackendContextValue | null>(null)
