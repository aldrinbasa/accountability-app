import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import type { GroupActivity, PresetActivity } from '@/domain/activities'
import type { AuthUser } from '@/domain/auth'
import { BackendError } from '@/domain/error-codes'
import type { EndedMembership, GroupMember, Invite, InvitePreview, MyGroup } from '@/domain/groups'
import type { AddCommitmentInput, AddTaskInput, PlanPreview, TaskDetails } from '@/domain/plan'
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

/** `TEST_GROUP`'s members: the test user (admin), then Priya and Sam. */
export const TEST_MEMBERS: GroupMember[] = [
  {
    membershipId: 'm-1',
    userId: TEST_USER.id,
    displayName: 'Jo',
    role: 'admin',
    joinedAt: '2026-11-01T10:00:00.000Z',
  },
  {
    membershipId: 'm-2',
    userId: 'user-2',
    displayName: 'Priya',
    role: 'member',
    joinedAt: '2026-11-02T10:00:00.000Z',
  },
  {
    membershipId: 'm-3',
    userId: 'user-3',
    displayName: 'Sam',
    role: 'member',
    joinedAt: '2026-11-03T10:00:00.000Z',
  },
]

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

const PRESET_ROWS: [string, string, PresetActivity['category']][] = [
  ['gym', 'Gym', 'fitness'],
  ['run', 'Run', 'fitness'],
  ['walk', 'Walk', 'fitness'],
  ['yoga', 'Yoga', 'fitness'],
  ['sports', 'Sports', 'fitness'],
  ['study', 'Study', 'mind'],
  ['read', 'Read', 'mind'],
  ['meditate', 'Meditate', 'mind'],
  ['journal', 'Journal', 'mind'],
  ['language_practice', 'Language practice', 'mind'],
  ['paint', 'Paint', 'creative'],
  ['draw', 'Draw', 'creative'],
  ['music_practice', 'Music practice', 'creative'],
  ['write', 'Write', 'creative'],
  ['photography', 'Photography', 'creative'],
  ['side_business', 'Side business', 'life_work'],
  ['cook_at_home', 'Cook at home', 'life_work'],
  ['clean', 'Clean', 'life_work'],
  ['groceries', 'Groceries', 'life_work'],
  ['sleep_early', 'Sleep early', 'life_work'],
]

/** The 20 seeded presets, as `preset_activities` holds them (migration 20261119200000). */
export const TEST_PRESETS: PresetActivity[] = PRESET_ROWS.map(([key, name, category], index) => ({
  key,
  name,
  category,
  sort: index + 1,
}))

/**
 * The default `plan_preview`: a Wednesday in the week of Mon 16 Nov 2026, so a new commitment starts
 * Mon 23 Nov and the earliest end date is Sun 29 Nov.
 */
export const TEST_PLAN_PREVIEW: PlanPreview = {
  memberToday: '2026-11-18',
  weekStart: '2026-11-16',
  weekEnd: '2026-11-22',
  startsOn: '2026-11-23',
  minEndDate: '2026-11-29',
  lastWeekTarget: null,
}

/**
 * The fake's pro-rated last week: ISO weekday of the end date (Monday = 1) as the days of that week.
 * Test-only stand-in for the server's rule.
 */
function fakeLastWeekTarget(target: number | null, endDate: string | null, minEndDate: string) {
  if (target === null || endDate === null || endDate < minEndDate) return null
  const day = new Date(`${endDate}T00:00:00Z`).getUTCDay()
  const days = day === 0 ? 7 : day
  return days === 7 ? null : Math.max(1, Math.floor((target * days) / 7))
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
    /** Groups the user is no longer in (default none). */
    ended?: EndedMembership[]
    /** Current members per group id; default `TEST_MEMBERS` for `TEST_GROUP`. */
    members?: Record<string, GroupMember[]>
    /** Activities per group id (default none). */
    groupActivities?: Record<string, GroupActivity[]>
    /** The `plan_preview` dates (default `TEST_PLAN_PREVIEW`). */
    planPreview?: Omit<PlanPreview, 'lastWeekTarget'>
    /** The member's own tasks that `getTask` knows (default none; `addTask` adds to them). */
    tasks?: TaskDetails[]
  } = {},
): FakeBackend {
  const listeners = new Set<(user: AuthUser | null) => void>()
  let user = initialUser
  let profile: Profile | null = options.profile === undefined ? TEST_PROFILE : options.profile
  let groups: MyGroup[] = options.groups ?? [TEST_GROUP]
  let ended: EndedMembership[] = options.ended ?? []
  const members: Record<string, GroupMember[]> = options.members ?? {
    [TEST_GROUP.id]: TEST_MEMBERS,
  }
  const groupActivities: Record<string, GroupActivity[]> = options.groupActivities ?? {}
  const planPreview = options.planPreview ?? TEST_PLAN_PREVIEW
  let created = 0
  let invitesMade = 0
  let commitmentsMade = 0
  const tasks = new Map<string, TaskDetails>((options.tasks ?? []).map((t) => [t.commitmentId, t]))
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
    listMyGroups: vi.fn(async () => ({ groups, ended })),
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
    listMembers: vi.fn(async (groupId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return members[groupId] ?? []
    }),
    leaveGroup: vi.fn(async (groupId: string) => {
      const group = groups.find((g) => g.id === groupId)
      if (!group) throw new BackendError('not_member')
      groups = groups.filter((g) => g.id !== groupId)
      // The last member's leave deletes the group, so nothing is left to read.
      if (group.memberCount > 1) {
        ended = [
          ...ended,
          {
            membershipId: `m-${groupId}-left`,
            groupId,
            name: group.name,
            endReason: 'left',
            endedAt: new Date().toISOString(),
          },
        ]
      }
    }),
    removeMember: vi.fn(async (groupId: string, userId: string) => {
      const group = groups.find((g) => g.id === groupId)
      if (!group || group.role !== 'admin') throw new BackendError('not_admin')
      if (userId === (user?.id ?? TEST_USER.id)) throw new BackendError('cannot_remove_self')
      const current = members[groupId] ?? []
      if (!current.some((member) => member.userId === userId)) throw new BackendError('not_member')
      members[groupId] = current.filter((member) => member.userId !== userId)
      groups = groups.map((g) => (g.id === groupId ? { ...g, memberCount: g.memberCount - 1 } : g))
    }),
    listPresetActivities: vi.fn(async () => TEST_PRESETS),
    // RLS: a non-member reads an empty list, not an error.
    listGroupActivities: vi.fn(async (groupId: string) =>
      groups.some((group) => group.id === groupId) ? (groupActivities[groupId] ?? []) : [],
    ),
    planPreview: vi.fn(async (groupId: string, target: number | null, endDate: string | null) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return {
        ...planPreview,
        lastWeekTarget: fakeLastWeekTarget(target, endDate, planPreview.minEndDate),
      }
    }),
    // Enforces membership, the end date and the schedule-type lock of the group's activities.
    addCommitment: vi.fn(async (input: AddCommitmentInput) => {
      if (!groups.some((group) => group.id === input.groupId)) throw new BackendError('not_member')
      if (input.endDate !== null && input.endDate < planPreview.minEndDate) {
        throw new BackendError('invalid_end_date')
      }
      const { activity } = input
      const row = (groupActivities[input.groupId] ?? []).find((r) =>
        activity.kind === 'preset'
          ? r.presetKey === activity.presetKey
          : activity.kind === 'group' && r.id === activity.groupActivityId,
      )
      if (row?.lockedScheduleType && row.lockedScheduleType !== input.scheduleType) {
        throw new BackendError('schedule_type_locked')
      }
      commitmentsMade += 1
      return { commitmentId: `commitment-${commitmentsMade}`, startsOn: planPreview.startsOn }
    }),
    // Enforces membership, the name and the deadline window of the preview's week.
    addTask: vi.fn(async (input: AddTaskInput) => {
      if (!groups.some((group) => group.id === input.groupId)) throw new BackendError('not_member')
      const name = input.name.trim()
      if (name.length === 0 || name.length > 40) throw new BackendError('invalid_plan')
      if (input.deadline < planPreview.memberToday || input.deadline > planPreview.weekEnd) {
        throw new BackendError('invalid_deadline')
      }
      commitmentsMade += 1
      const commitmentId = `commitment-${commitmentsMade}`
      const { activity } = input
      const row =
        activity.kind === 'group'
          ? (groupActivities[input.groupId] ?? []).find((r) => r.id === activity.groupActivityId)
          : undefined
      tasks.set(commitmentId, {
        commitmentId,
        groupId: input.groupId,
        presetKey: activity.kind === 'preset' ? activity.presetKey : (row?.presetKey ?? null),
        customName: activity.kind === 'custom' ? activity.name.trim() : (row?.customName ?? null),
        name,
        deadline: input.deadline,
        canDelete: input.deadline > planPreview.memberToday,
        canRename: true,
      })
      return { commitmentId }
    }),
    getTask: vi.fn(async (commitmentId: string) => {
      const task = tasks.get(commitmentId)
      if (!task) throw new BackendError('not_found')
      return task
    }),
    renameTask: vi.fn(async (commitmentId: string, name: string) => {
      const task = tasks.get(commitmentId)
      if (!task) throw new BackendError('not_found')
      const trimmed = name.trim()
      if (trimmed.length === 0 || trimmed.length > 40) throw new BackendError('invalid_plan')
      if (!task.canRename) throw new BackendError('task_locked')
      tasks.set(commitmentId, { ...task, name: trimmed })
    }),
    deleteTask: vi.fn(async (commitmentId: string) => {
      const task = tasks.get(commitmentId)
      if (!task) throw new BackendError('not_found')
      if (!task.canDelete) throw new BackendError('task_locked')
      tasks.delete(commitmentId)
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
