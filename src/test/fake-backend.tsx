import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import type { AuthUser } from '@/domain/auth'
import type { BackendPort } from '@/ports/backend-port'
import { BackendProvider } from '@/data/backend-context'
import { routes } from '@/app/router'

export const TEST_USER: AuthUser = { id: 'user-1', email: 'jo@example.com' }

export interface FakeBackend extends BackendPort {
  /** Simulate a session change from outside (another tab, expiry). */
  emit(user: AuthUser | null): void
}

/** An in-memory BackendPort. Every method is a vi.fn; override behaviour per test. */
export function createFakeBackend(initialUser: AuthUser | null = TEST_USER): FakeBackend {
  const listeners = new Set<(user: AuthUser | null) => void>()
  let user = initialUser
  const emit = (next: AuthUser | null) => {
    user = next
    for (const listener of listeners) listener(next)
  }
  return {
    emit,
    getSession: vi.fn(async () => user),
    onAuthChange: vi.fn((callback: (u: AuthUser | null) => void) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    }),
    sendEmailCode: vi.fn(async () => {}),
    verifyEmailCode: vi.fn(async () => TEST_USER),
    verifyEmailLink: vi.fn(async () => TEST_USER),
    exchangeOAuthCode: vi.fn(async () => TEST_USER),
    signInWithGoogle: vi.fn(async () => {}),
    signOut: vi.fn(async () => {
      user = null
    }),
  }
}

export function withBackend(backend: BackendPort, children: ReactNode, onSignedOut?: () => void) {
  return (
    <BackendProvider backend={backend} onSignedOut={onSignedOut}>
      {children}
    </BackendProvider>
  )
}

/** Renders the app routes in a memory router under a BackendProvider. */
export function renderRoutes(
  initialEntries: InitialEntry[],
  backend: BackendPort = createFakeBackend(),
  options: { initialIndex?: number; onSignedOut?: () => void } = {},
) {
  const router = createMemoryRouter(routes, { initialEntries, initialIndex: options.initialIndex })
  const utils = render(
    withBackend(backend, <RouterProvider router={router} />, options.onSignedOut),
  )
  return { router, backend, ...utils }
}
