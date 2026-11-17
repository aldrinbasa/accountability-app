import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import type { AuthUser } from '@/domain/auth'
import type { MyGroup } from '@/domain/groups'
import type { Profile } from '@/domain/profile'
import type { BackendPort } from '@/ports/backend-port'
import { BackendProvider } from '@/data/backend-context'
import { INSTALLED_KEY } from '@/data/install-state'
import { routes } from '@/app/router'

export const TEST_USER: AuthUser = { id: 'user-1', email: 'jo@example.com' }

export const TEST_PROFILE: Profile = {
  id: TEST_USER.id,
  displayName: 'Jo',
  avatarPath: null,
  timeZone: 'Asia/Manila',
}

/** The default group: active (3 members), the test user is its admin. */
export const TEST_GROUP: MyGroup = {
  id: 'group-1',
  name: 'Gym Rats',
  timeZone: 'Asia/Manila',
  role: 'admin',
  joinedAt: '2026-11-01T10:00:00.000Z',
  memberCount: 3,
}

export interface FakeBackend extends BackendPort {
  /** Simulate a session change from outside (another tab, expiry). */
  emit(user: AuthUser | null): void
}

/**
 * An in-memory BackendPort. Every method is a vi.fn; override behaviour per test. The signed-in
 * member has a profile by default (so tests reach the shell); pass `profile: null` for a new member.
 * They are in one active group (`TEST_GROUP`) by default; pass `groups: []` for none.
 */
export function createFakeBackend(
  initialUser: AuthUser | null = TEST_USER,
  options: { profile?: Profile | null; groups?: MyGroup[] } = {},
): FakeBackend {
  const listeners = new Set<(user: AuthUser | null) => void>()
  let user = initialUser
  let profile: Profile | null = options.profile === undefined ? TEST_PROFILE : options.profile
  let groups: MyGroup[] = options.groups ?? [TEST_GROUP]
  let created = 0
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
    getMyProfile: vi.fn(async () => profile),
    saveProfile: vi.fn(async (displayName: string, timeZone: string) => {
      profile = {
        id: user?.id ?? TEST_USER.id,
        displayName,
        avatarPath: profile?.avatarPath ?? null,
        timeZone: profile?.timeZone ?? timeZone,
      }
      return profile
    }),
    listMyGroups: vi.fn(async () => groups),
    createGroup: vi.fn(async (name: string) => {
      created += 1
      const id = `group-new-${created}`
      groups = [
        ...groups,
        {
          id,
          name: name.trim(),
          timeZone: profile?.timeZone ?? 'UTC',
          role: 'admin',
          joinedAt: new Date().toISOString(),
          memberCount: 1,
        },
      ]
      return id
    }),
  }
}

/** A fresh query cache per render: no retries' worth of shared state between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

export function withBackend(
  backend: BackendPort,
  children: ReactNode,
  onSignedOut?: () => void,
  queryClient: QueryClient = createTestQueryClient(),
) {
  return (
    <QueryClientProvider client={queryClient}>
      <BackendProvider backend={backend} onSignedOut={onSignedOut}>
        {children}
      </BackendProvider>
    </QueryClientProvider>
  )
}

/** Renders the app routes in a memory router under a BackendProvider. */
export function renderRoutes(
  initialEntries: InitialEntry[],
  backend: BackendPort = createFakeBackend(),
  options: { initialIndex?: number; onSignedOut?: () => void; queryClient?: QueryClient } = {},
) {
  const router = createMemoryRouter(routes, { initialEntries, initialIndex: options.initialIndex })
  const queryClient = options.queryClient ?? createTestQueryClient()
  const utils = render(
    withBackend(backend, <RouterProvider router={router} />, options.onSignedOut, queryClient),
  )
  return { router, backend, queryClient, ...utils }
}

/**
 * Marks this device as installed, so a sign-in goes straight on instead of to the install guide.
 * localStorage is cleared after every test (src/test/setup.ts).
 */
export function stubInstalled(): void {
  localStorage.setItem(INSTALLED_KEY, '1')
}
