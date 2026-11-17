import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import type { AuthUser } from '@/domain/auth'
import { BackendError } from '@/domain/error-codes'
import type { Invite, InvitePreview, MyGroup } from '@/domain/groups'
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

/** An invite of `TEST_GROUP`, far from expiry (tests that need expiry pass their own). */
export const TEST_INVITE: Invite = { code: 'K7QX2M', expiresAt: '2099-11-24T10:00:00.000Z' }

/** Another member's group the test user is invited to (`TEST_INVITE_PREVIEW.groupId`). */
export const TEST_INVITE_PREVIEW: InvitePreview = {
  groupId: 'group-9',
  groupName: 'Sunday Reset',
  adminName: 'Sam',
  memberCount: 3,
  status: 'valid',
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
  options: {
    profile?: Profile | null
    groups?: MyGroup[]
    /** Codes `getInvite` / `joinGroup` know; default `TEST_INVITE.code` → `TEST_INVITE_PREVIEW`. */
    invites?: Record<string, InvitePreview>
  } = {},
): FakeBackend {
  const listeners = new Set<(user: AuthUser | null) => void>()
  let user = initialUser
  let profile: Profile | null = options.profile === undefined ? TEST_PROFILE : options.profile
  let groups: MyGroup[] = options.groups ?? [TEST_GROUP]
  let created = 0
  let invitesMade = 0
  const invites: Record<string, InvitePreview> = options.invites ?? {
    [TEST_INVITE.code]: TEST_INVITE_PREVIEW,
  }
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
    createInvite: vi.fn(async (_groupId: string, fresh: boolean) => {
      if (!fresh) return TEST_INVITE
      invitesMade += 1
      return { code: `NEW${invitesMade}AB`.slice(0, 6), expiresAt: '2099-12-01T10:00:00.000Z' }
    }),
    getInvite: vi.fn(async (code: string) => {
      const invite = invites[code]
      if (!invite) throw new BackendError('invite_not_found')
      const member = groups.some((group) => group.id === invite.groupId)
      return member ? { ...invite, status: 'member' as const } : invite
    }),
    joinGroup: vi.fn(async (code: string) => {
      const invite = invites[code]
      if (!invite) throw new BackendError('invite_not_found')
      if (invite.status === 'expired') throw new BackendError('invite_expired')
      if (invite.status === 'full') throw new BackendError('group_full')
      if (!groups.some((group) => group.id === invite.groupId)) {
        groups = [
          ...groups,
          {
            id: invite.groupId,
            name: invite.groupName,
            timeZone: 'UTC',
            role: 'member',
            joinedAt: new Date().toISOString(),
            memberCount: invite.memberCount + 1,
          },
        ]
      }
      return invite.groupId
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
