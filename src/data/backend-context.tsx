import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BackendPort } from '@/ports/backend-port'
import { createAuthSessionStore } from '@/data/auth-session'
import { BackendContext, type BackendContextValue } from '@/data/backend-context-value'

export interface BackendProviderProps {
  /** The concrete backend, wired in src/app/composition.ts (a fake in tests). */
  backend: BackendPort
  /** Runs whenever a signed-in session ends (sign-out here or in another tab, expiry). */
  onSignedOut?: () => void
  children: ReactNode
}

/** Gives features and data hooks the backend and the one shared auth session. */
export function BackendProvider({ backend, onSignedOut, children }: BackendProviderProps) {
  const onSignedOutRef = useRef(onSignedOut)
  useEffect(() => {
    onSignedOutRef.current = onSignedOut
  })

  const [value] = useState<BackendContextValue>(() => ({
    backend,
    session: createAuthSessionStore(backend, { onSignedOut: () => onSignedOutRef.current?.() }),
  }))

  useEffect(() => value.session.start(), [value])

  return <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
}
