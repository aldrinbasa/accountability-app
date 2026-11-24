import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import type { GroupActivity, PresetActivity } from '@/domain/activities'
import type { AuthUser } from '@/domain/auth'
import type { Board, BoardRow, GroupWeek } from '@/domain/board'
import type { MemberProfile, ProfileBadge, Title } from '@/domain/badges'
import type { Streak } from '@/domain/streaks'
import type {
  CheckinPhotoSize,
  CheckinTarget,
  PostCheckinInput,
  PostCheckinResult,
} from '@/domain/checkin'
import { BackendError } from '@/domain/error-codes'
import type { CreateChallengeResult, OverturnResult } from '@/domain/challenge'
import type {
  FreezeOption,
  FreezeRequest,
  RequestFreezeInput,
  RequestFreezeResult,
} from '@/domain/freeze'
import type { AnyVoteChoice, CastVoteResult, FeedVote, VoteKind, VoteTally } from '@/domain/vote'
import type { FeedFreezeVote } from '@/domain/freeze-vote'
import type { FeedCheckin, FeedCursor, FeedItem, FeedRowsRequest, FeedRuling } from '@/domain/feed'
import type { GoalPeriod, GroupGoal } from '@/domain/goal'
import type { EndedMembership, GroupMember, Invite, InvitePreview, MyGroup } from '@/domain/groups'
import type { CommitmentDetails, MyPlanItem, UpdateCommitmentInput } from '@/domain/my-plan'
import type { AddCommitmentInput, AddTaskInput, PlanPreview, TaskDetails } from '@/domain/plan'
import type { Profile } from '@/domain/profile'
import type { TimeZoneState } from '@/domain/time-zones'
import type { TodayItem, TodaySummary } from '@/domain/today'
import type { WinnerWeek } from '@/domain/winner'
import type { BackendPort } from '@/ports/backend-port'
import type { CameraPort } from '@/ports/camera-port'
import type { ImageEncodePort } from '@/ports/image-encode-port'
import { BackendProvider } from '@/data/backend-context'
import { ImageEncoderContext } from '@/data/image-encoder-context'
import { INSTALLED_KEY } from '@/data/install-state'
import { routes } from '@/app/router'
import { CameraPortContext } from '@/app/camera-port-context'
import { createFakeCamera } from '@/test/fake-camera'
import { createFakeEncoder } from '@/test/fake-image-encoder'
import { addDays, localStart, weekStartOf } from '@/test/zone-math'

export const TEST_USER: AuthUser = { id: 'user-1', email: 'jo@example.com' }

export const TEST_PROFILE: Profile = {
  id: TEST_USER.id,
  displayName: 'Jo',
  avatarPath: null,
  timeZone: 'Asia/Manila',
  pendingTimeZone: null,
  pendingWeekStart: null,
}

/** The default group: active (3 members), the test user is its admin. */
export const TEST_GROUP: MyGroup = {
  id: 'group-1',
  name: 'Gym Rats',
  timeZone: 'Asia/Manila',
  pendingTimeZone: null,
  pendingWeekStart: null,
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
    avatarPath: null,
    role: 'admin',
    joinedAt: '2026-11-01T10:00:00.000Z',
  },
  {
    membershipId: 'm-2',
    userId: 'user-2',
    displayName: 'Priya',
    avatarPath: null,
    role: 'member',
    joinedAt: '2026-11-02T10:00:00.000Z',
  },
  {
    membershipId: 'm-3',
    userId: 'user-3',
    displayName: 'Sam',
    avatarPath: null,
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

/** The group's current week the fake answers by default (the week of `TEST_PLAN_PREVIEW`). */
export const TEST_GROUP_WEEK: GroupWeek = {
  weekStart: '2026-11-16',
  lockAt: '2026-11-25T16:00:00.000Z',
}

/** A `get_board` row with defaults for the Board-only fields (no misses, streak, plan or tasks). */
export function boardRow(
  row: Partial<BoardRow> & Pick<BoardRow, 'userId' | 'displayName'>,
): BoardRow {
  return {
    avatarPath: null,
    weeklyPoints: null,
    sessionsDone: 0,
    sessionsPlanned: 0,
    sessionsFrozen: 0,
    rank: null,
    missCount: 0,
    bestStreak: 0,
    plan: [],
    taskCount: 0,
    isWinner: false,
    ...row,
  }
}

/** A board of `TEST_GROUP_WEEK` in the test group's zone (current week, not waiting). */
export function testBoard(board: Partial<Board> = {}): Board {
  return {
    waiting: false,
    rows: [],
    lockAt: TEST_GROUP_WEEK.lockAt,
    isCurrentWeek: true,
    timeZone: TEST_GROUP.timeZone,
    locked: false,
    ...board,
  }
}

/** The 15 catalog badges (key, name, icon) in display order, as the migration seeds them. */
const CATALOG: readonly [string, string, string][] = [
  ['first_proof', 'First Proof', 'camera'],
  ['hat_trick', 'Hat Trick', 'fire'],
  ['on_a_roll', 'On a Roll', 'fire-simple'],
  ['unbreakable', 'Unbreakable', 'shield-check'],
  ['clean_sheet', 'Clean Sheet', 'check-circle'],
  ['back_to_back', 'Back-to-Back', 'checks'],
  ['monthly_machine', 'Monthly Machine', 'calendar-check'],
  ['comeback', 'Comeback', 'arrow-fat-up'],
  ['weekly_winner', 'Weekly Winner', 'trophy'],
  ['dynasty', 'Dynasty', 'crown'],
  ['team_player', 'Team Player', 'users-three'],
  ['fair_judge', 'Fair Judge', 'gavel'],
  ['early_bird', 'Early Bird', 'sun-horizon'],
  ['night_owl', 'Night Owl', 'moon-stars'],
  ['task_slayer', 'Task Slayer', 'list-checks'],
]

/**
 * The 15 badges, all locked, with test copy ("How {name} is earned", "{name} line"); `overrides`
 * per key set status, dates or copy.
 */
export function testBadges(overrides: Record<string, Partial<ProfileBadge>> = {}): ProfileBadge[] {
  return CATALOG.map(([key, name, icon]) => ({
    key,
    name,
    howEarned: `How ${name} is earned`,
    line: `${name} line`,
    icon,
    status: 'locked',
    awardedAt: null,
    pendingLockAt: null,
    awardCount: 0,
    ...overrides[key],
  }))
}

/** A current member's profile: no points (Couch Potato), all badges locked, no streaks or plan. */
export function testMemberProfile(profile: Partial<MemberProfile> = {}): MemberProfile {
  return {
    displayName: TEST_PROFILE.displayName,
    avatarPath: null,
    isCurrentMember: true,
    allTimePoints: 0,
    titleKey: 'couch_potato',
    timeZone: TEST_GROUP.timeZone,
    badges: testBadges(),
    streaks: [],
    plan: [],
    taskCount: 0,
    ...profile,
  }
}

/** The title ladder the migration seeds. */
export const TEST_TITLES: Title[] = [
  { key: 'couch_potato', name: 'Couch Potato', minPoints: 0 },
  { key: 'warming_up', name: 'Warming Up', minPoints: 300 },
  { key: 'regular', name: 'Regular', minPoints: 1000 },
  { key: 'grinder', name: 'Grinder', minPoints: 2500 },
  { key: 'machine', name: 'Machine', minPoints: 5000 },
  { key: 'legend', name: 'Legend', minPoints: 10000 },
]

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

/** The default `get_today_summary`: Friday 20 Nov 2026, week 3, nothing planned. */
export const TEST_TODAY_SUMMARY: TodaySummary = {
  memberToday: '2026-11-20',
  weekStart: '2026-11-16',
  weekNumber: 3,
  planned: 0,
  done: 0,
  left: 0,
  hasPlan: false,
}

/**
 * A commitment of the test user's for edit mode: Gym 3 times per week in `TEST_GROUP`, started, no
 * end date; an edit takes effect Mon 23 Nov (earliest end date Sun 29 Nov).
 */
export const TEST_COMMITMENT: CommitmentDetails = {
  commitmentId: 'c-gym',
  groupId: TEST_GROUP.id,
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
  endDate: null,
  changesFrom: '2026-11-23',
  minEndDate: '2026-11-29',
  state: 'active',
  canEdit: true,
}

/** A group goal read: no goal, nobody scored, the default group's three members (override any field). */
export function testGroupGoal(goal: Partial<GroupGoal> = {}): GroupGoal {
  return {
    weekStart: TEST_GROUP_WEEK.weekStart,
    memberCount: 3,
    target: null,
    period: null,
    liveAverage: null,
    monthWeeks: [],
    monthAverage: null,
    monthValueNow: null,
    contributions: TEST_MEMBERS.map((m) => ({
      userId: m.userId,
      name: m.displayName,
      weeklyPoints: null,
    })),
    lastResult: null,
    ...goal,
  }
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
    /** Today's rows and summary per group id (default: no rows, `TEST_TODAY_SUMMARY`). */
    today?: Record<string, { items: TodayItem[]; summary?: TodaySummary }>
    /** My plan rows per group id (default: none). */
    myPlan?: Record<string, MyPlanItem[]>
    /** The member's own commitments that `getCommitment` knows (default none). */
    commitments?: CommitmentDetails[]
    /** The camera picker's rows per group id (default none). */
    checkinTargets?: Record<string, CheckinTarget[]>
    /**
     * `post_checkin`'s answer (default: counted, on time, `doneCount` 1 of `target` 1). Overridden
     * per test for failures.
     */
    postCheckin?: (input: PostCheckinInput) => PostCheckinResult
    /** Feed items per group id, any order (the fake sorts newest first). Default none. */
    feed?: Record<string, FeedItem[]>
    /** Friends today per group id, newest first as given. Default none. */
    friendsToday?: Record<string, FeedCheckin[]>
    /**
     * `vote_tallies` per group id (default: every open vote item of the feed, 1 of the group's
     * member count minus the owner, plus 1 for the reader's own ballot).
     */
    voteTallies?: Record<string, VoteTally[]>
    /**
     * `get_board` per group id, for any week (default: no rows, `waiting` from the group's member
     * count). `boards` keyed `{groupId}:{weekStart}` wins for that week.
     */
    board?: Record<string, Board>
    boards?: Record<string, Board>
    /** `get_streaks` per group id (default none). */
    streaks?: Record<string, Streak[]>
    /** `get_group_week` per group id (default `TEST_GROUP_WEEK`). */
    groupWeeks?: Record<string, GroupWeek>
    /**
     * `get_winner_week` per `{groupId}:{weekStart}` (locked weeks). The latest (no week asked) is the
     * one with the greatest Monday of that group. Default none.
     */
    winnerWeeks?: Record<string, WinnerWeek>
    /**
     * `get_member_profile` per `{groupId}:{userId}` (default: the signed-in member of a group they
     * are in gets `testMemberProfile()`; anyone else null).
     */
    memberProfiles?: Record<string, MemberProfile | null>
    /**
     * `get_group_goal` per group id (default `testGroupGoal` with the group's member count);
     * `setGroupGoal` writes the target and period into it.
     */
    goals?: Record<string, GroupGoal>
    /**
     * The server clock for `setTimeZone` (ISO instant). Default `2026-11-18T12:00:00Z`, the day of
     * `TEST_PLAN_PREVIEW`; never the real clock, so results don't depend on the test run's date.
     */
    now?: string
    /** `my_freeze_options` per group id (default none); a request removes its option. */
    freezeOptions?: Record<string, FreezeOption[]>
    /** `my_freeze_requests` per group id (default none); a request adds to it. */
    freezeRequests?: Record<string, FreezeRequest[]>
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
  const serverNow = options.now ?? '2026-11-18T12:00:00Z'
  let created = 0
  let invitesMade = 0
  let commitmentsMade = 0
  const tasks = new Map<string, TaskDetails>((options.tasks ?? []).map((t) => [t.commitmentId, t]))
  const today = options.today ?? {}
  const myPlan = options.myPlan ?? {}
  const commitments = new Map<string, CommitmentDetails>(
    (options.commitments ?? []).map((c) => [c.commitmentId, c]),
  )
  const checkinTargets = options.checkinTargets ?? {}
  const postResult =
    options.postCheckin ??
    ((input: PostCheckinInput): PostCheckinResult => ({
      checkinId: input.id,
      sessionId: `session-${input.commitmentId}`,
      counted: true,
      isLate: false,
      doneCount: 1,
      target: 1,
      weeklyPoints: null,
      rank: null,
      passedUserIds: [],
    }))
  const feed = options.feed ?? {}
  const friendsToday: Record<string, FeedCheckin[]> = { ...options.friendsToday }
  const voteTallies: Record<string, VoteTally[]> | undefined = options.voteTallies
    ? { ...options.voteTallies }
    : undefined
  const findVote = (id: string): FeedVote | FeedFreezeVote | undefined => {
    for (const items of Object.values(feed)) {
      const found = items.find(
        (item): item is FeedVote | FeedFreezeVote =>
          (item.type === 'vote' || item.type === 'freezeVote') && item.id === id,
      )
      if (found) return found
    }
    return undefined
  }
  const patchVote = (id: string, patch: Partial<FeedVote> | Partial<FeedFreezeVote>) => {
    for (const [groupId, items] of Object.entries(feed)) {
      feed[groupId] = items.map((item) =>
        (item.type === 'vote' || item.type === 'freezeVote') && item.id === id
          ? ({ ...item, ...patch } as FeedItem)
          : item,
      )
    }
  }
  const shiftTally = (vote: { groupId: string; id: string }, by: number) => {
    if (!voteTallies) return
    voteTallies[vote.groupId] = (voteTallies[vote.groupId] ?? []).map((tally) =>
      tally.targetId === vote.id ? { ...tally, votedCount: tally.votedCount + by } : tally,
    )
  }
  const board: Record<string, Board> = { ...options.board }
  const boards: Record<string, Board> = { ...options.boards }
  const groupWeeks: Record<string, GroupWeek> = { ...options.groupWeeks }
  const streaks: Record<string, Streak[]> = { ...options.streaks }
  const winnerWeeks: Record<string, WinnerWeek> = { ...options.winnerWeeks }
  const memberProfiles: Record<string, MemberProfile | null> = { ...options.memberProfiles }
  const goals: Record<string, GroupGoal> = { ...options.goals }
  const freezeOptions: Record<string, FreezeOption[]> = { ...options.freezeOptions }
  const freezeRequests: Record<string, FreezeRequest[]> = { ...options.freezeRequests }
  let freezesMade = 0
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
        pendingTimeZone: profile?.pendingTimeZone ?? null,
        pendingWeekStart: profile?.pendingWeekStart ?? null,
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
          pendingTimeZone: null,
          pendingWeekStart: null,
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
            pendingTimeZone: null,
            pendingWeekStart: null,
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
    getTodayItems: vi.fn(async (groupId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return today[groupId]?.items ?? []
    }),
    getTodaySummary: vi.fn(async (groupId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return today[groupId]?.summary ?? TEST_TODAY_SUMMARY
    }),
    getMyPlan: vi.fn(async (groupId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return myPlan[groupId] ?? []
    }),
    getCommitment: vi.fn(async (commitmentId: string) => {
      const commitment = commitments.get(commitmentId)
      if (!commitment) throw new BackendError('not_found')
      return commitment
    }),
    // Enforces ownership, the end, the schedule type's own field and the end date.
    updateCommitment: vi.fn(async (input: UpdateCommitmentInput) => {
      const commitment = commitments.get(input.commitmentId)
      if (!commitment) throw new BackendError('not_found')
      if (!commitment.canEdit) throw new BackendError('commitment_ended')
      const fixed = commitment.scheduleType === 'fixed_days'
      if (
        fixed
          ? input.target !== null || input.days === null || input.days.length === 0
          : input.days !== null || input.target === null || input.target < 1 || input.target > 7
      ) {
        throw new BackendError('invalid_plan')
      }
      if (input.endDate !== null && input.endDate < commitment.minEndDate) {
        throw new BackendError('invalid_end_date')
      }
      commitments.set(input.commitmentId, {
        ...commitment,
        days: input.days,
        target: input.target,
        endDate: input.endDate,
        state: commitment.state === 'starts_next_week' ? 'starts_next_week' : 'pending_change',
      })
      return { changesFrom: commitment.changesFrom }
    }),
    endCommitment: vi.fn(async (commitmentId: string) => {
      const commitment = commitments.get(commitmentId)
      if (!commitment) throw new BackendError('not_found')
      if (!commitment.canEdit) throw new BackendError('commitment_ended')
      const started = commitment.state !== 'starts_next_week'
      commitments.set(commitmentId, {
        ...commitment,
        state: started ? 'ending' : 'ended',
        canEdit: false,
      })
      return { endsAfterWeekStart: started ? planPreview.weekStart : '2026-11-09' }
    }),
    setTimeZone: vi.fn(async (timeZone: string, groupId?: string) => {
      // The server's rule (set_time_zone, 20261128000000): a waiting change whose Monday has come
      // in its zone counts as applied; the change starts at the waiting change's Monday, else the
      // next Monday in the current zone, pushed a week at a time while that Monday 00:00 in the
      // new zone has passed. The current zone clears a waiting change; the waiting zone keeps it.
      const now = Date.parse(serverNow)
      const next = <T extends TimeZoneState>(row: T): T => {
        let current = row.timeZone
        let pendingZone = row.pendingTimeZone
        let pendingWeek = row.pendingWeekStart
        if (
          pendingZone !== null &&
          pendingWeek !== null &&
          now >= Date.parse(localStart(pendingWeek, pendingZone))
        ) {
          current = pendingZone
          pendingZone = null
          pendingWeek = null
        }
        let week = pendingWeek ?? addDays(weekStartOf(serverNow, current), 7)
        while (Date.parse(localStart(week, timeZone)) <= now) week = addDays(week, 7)
        if (timeZone === current) {
          pendingZone = null
          pendingWeek = null
        } else if (timeZone !== pendingZone) {
          pendingZone = timeZone
          pendingWeek = week
        }
        return {
          ...row,
          timeZone: current,
          pendingTimeZone: pendingZone,
          pendingWeekStart: pendingWeek,
        }
      }
      const state = (row: TimeZoneState): TimeZoneState => ({
        timeZone: row.timeZone,
        pendingTimeZone: row.pendingTimeZone,
        pendingWeekStart: row.pendingWeekStart,
      })
      if (groupId === undefined) {
        if (!profile) throw new BackendError('profile_required')
        profile = next(profile)
        return state(profile)
      }
      const group = groups.find((g) => g.id === groupId)
      if (!group) throw new BackendError('not_member')
      if (group.role !== 'admin') throw new BackendError('not_admin')
      const updated = next(group)
      groups = groups.map((g) => (g.id === groupId ? updated : g))
      return state(updated)
    }),
    getCheckinTargets: vi.fn(async (groupId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return checkinTargets[groupId] ?? []
    }),
    uploadCheckinPhoto: vi.fn(
      async (_groupId: string, _checkinId: string, _size: CheckinPhotoSize, _photo: Blob) => {},
    ),
    postCheckin: vi.fn(async (input: PostCheckinInput) => {
      if (!groups.some((group) => group.id === input.groupId)) throw new BackendError('not_member')
      const result = postResult(input)
      // A post lands at the head of the group's Friends today, like the server's list.
      const target = (checkinTargets[input.groupId] ?? []).find(
        (t) => t.commitmentId === input.commitmentId,
      )
      const at = new Date().toISOString()
      friendsToday[input.groupId] = [
        {
          type: 'checkin',
          id: input.id,
          groupId: input.groupId,
          sortAt: at,
          authorId: user?.id ?? TEST_USER.id,
          authorName: profile?.displayName ?? '',
          authorAvatarPath: null,
          commitmentId: input.commitmentId,
          commitmentKind: target?.kind ?? 'commitment',
          activityName: target?.activityName ?? '',
          presetKey: target?.presetKey ?? null,
          taskName: target?.name ?? null,
          capturedAt: input.capturedAt,
          receivedAt: at,
          isLate: result.isLate,
          isExtra: !result.counted,
          caption: input.caption,
          fullPrunedAt: null,
          countedPosition: result.counted ? result.doneCount : null,
          target: result.counted ? result.target : null,
          challengeId: null,
          challengeStatus: null,
          challengeClosesAt: null,
          challengeUntil: new Date(Date.parse(at) + 86_400_000).toISOString(),
        },
        ...(friendsToday[input.groupId] ?? []).filter((item) => item.id !== input.id),
      ]
      return result
    }),
    getGroupWeek: vi.fn(async (groupId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return groupWeeks[groupId] ?? TEST_GROUP_WEEK
    }),
    getBoard: vi.fn(async (groupId: string, weekStart: string) => {
      const group = groups.find((g) => g.id === groupId)
      if (!group) throw new BackendError('not_member')
      return (
        boards[`${groupId}:${weekStart}`] ??
        board[groupId] ??
        testBoard({ waiting: group.memberCount < 2, rows: [] })
      )
    }),
    getStreaks: vi.fn(async (groupId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return streaks[groupId] ?? []
    }),
    getWinnerWeek: vi.fn(async (groupId: string, weekStart: string | null) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      if (weekStart !== null) return winnerWeeks[`${groupId}:${weekStart}`] ?? null
      const latest = Object.entries(winnerWeeks)
        .filter(([key]) => key.startsWith(`${groupId}:`))
        .sort(([a], [b]) => (a < b ? 1 : -1))[0]
      return latest ? latest[1] : null
    }),
    getMemberProfile: vi.fn(async (groupId: string, userId: string) => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      const key = `${groupId}:${userId}`
      if (key in memberProfiles) return memberProfiles[key] ?? null
      return userId === user?.id
        ? testMemberProfile({ displayName: profile?.displayName ?? '' })
        : null
    }),
    listTitles: vi.fn(async () => [...TEST_TITLES]),
    getGroupGoal: vi.fn(async (groupId: string) => {
      const group = groups.find((g) => g.id === groupId)
      if (!group) throw new BackendError('not_member')
      return goals[groupId] ?? testGroupGoal({ memberCount: group.memberCount })
    }),
    setGroupGoal: vi.fn(async (groupId: string, target: number, period: GoalPeriod) => {
      const group = groups.find((g) => g.id === groupId)
      if (!group) throw new BackendError('not_member')
      if (group.role !== 'admin') throw new BackendError('not_admin')
      if (target < 50 || target > 100 || target % 5 !== 0) throw new BackendError('invalid_goal')
      goals[groupId] = {
        ...(goals[groupId] ?? testGroupGoal({ memberCount: group.memberCount })),
        target,
        period,
      }
    }),
    // The member's check-ins in the fake feed, newest first.
    listMemberCheckins: vi.fn(async (groupId: string, userId: string, limit: number) =>
      groups.some((group) => group.id === groupId)
        ? (feed[groupId] ?? [])
            .filter(
              (item): item is FeedCheckin => item.type === 'checkin' && item.authorId === userId,
            )
            .sort((a, b) => -compareFeed(cursorOf(a), cursorOf(b)))
            .slice(0, limit)
        : [],
    ),
    // RLS: a non-member reads an empty wall. Keyset on (sortAt, id), newest first.
    listFeed: vi.fn(async (groupId: string, request: FeedRowsRequest) => {
      const all = groups.some((group) => group.id === groupId)
        ? [...(feed[groupId] ?? [])].sort((a, b) => -compareFeed(cursorOf(a), cursorOf(b)))
        : []
      let rows: FeedItem[]
      if (request.before) {
        const before = request.before
        rows = all.filter((item) => compareFeed(cursorOf(item), before) < 0).slice(0, request.limit)
      } else if (request.after) {
        const after = request.after
        rows = all.filter((item) => compareFeed(cursorOf(item), after) > 0).slice(-request.limit)
      } else {
        rows = all.slice(0, request.limit)
      }
      return {
        items: rows,
        rowCount: rows.length,
        newest: rows[0] ? cursorOf(rows[0]) : null,
        oldest: rows.length > 0 ? cursorOf(rows[rows.length - 1] as FeedItem) : null,
      }
    }),
    getFeedCheckin: vi.fn(async (groupId: string, checkinId: string) => {
      if (!groups.some((group) => group.id === groupId)) return null
      return (
        (feed[groupId] ?? []).find((item) => item.type === 'checkin' && item.id === checkinId) ??
        null
      )
    }),
    getFeedVote: vi.fn(async (groupId: string, voteId: string) => {
      if (!groups.some((group) => group.id === groupId)) return null
      return (
        (feed[groupId] ?? []).find(
          (item) => (item.type === 'vote' || item.type === 'freezeVote') && item.id === voteId,
        ) ?? null
      )
    }),
    // Open challenges and pending freeze requests of the wall; a non-member reads none.
    listOpenVotes: vi.fn(async (groupId: string) =>
      groups.some((group) => group.id === groupId)
        ? (feed[groupId] ?? []).filter(
            (item) =>
              (item.type === 'vote' && item.status === 'open') ||
              (item.type === 'freezeVote' && item.status === 'pending'),
          )
        : [],
    ),
    // RLS: a non-member gets nothing.
    listFriendsToday: vi.fn(async (groupId: string) =>
      groups.some((group) => group.id === groupId) ? [...(friendsToday[groupId] ?? [])] : [],
    ),
    signCheckinPhotos: vi.fn(async (paths: readonly string[]) =>
      Object.fromEntries(paths.map((path) => [path, `${FAKE_PHOTO_ORIGIN}/sign/${path}?token=t`])),
    ),
    checkinPhotoCacheUrl: vi.fn((path: string) => `${FAKE_PHOTO_ORIGIN}/sign/${path}`),
    uploadAvatar: vi.fn(async (_path: string, _photo: Blob) => {}),
    setAvatarPath: vi.fn(async (path: string) => {
      if (!profile) throw new BackendError('unknown', 'no profile row')
      profile = { ...profile, avatarPath: path }
      return profile
    }),
    signAvatarPhotos: vi.fn(async (paths: readonly string[]) =>
      Object.fromEntries(
        paths.map((path) => [path, `${FAKE_PHOTO_ORIGIN}/avatars/${path}?token=t`]),
      ),
    ),
    // The server's rules in short: a group of two rules Fake at once (the check-in leaves the feed
    // and Friends today, a ruling sticky arrives); 3+ opens a 24 h challenge on the check-in.
    createChallenge: vi.fn(async (checkinId: string): Promise<CreateChallengeResult> => {
      const groupId = Object.keys(feed).find((id) =>
        (feed[id] ?? []).some((item) => item.type === 'checkin' && item.id === checkinId),
      )
      const group = groups.find((g) => g.id === groupId)
      const item = (feed[groupId ?? ''] ?? []).find(
        (entry): entry is FeedCheckin => entry.type === 'checkin' && entry.id === checkinId,
      )
      if (!groupId || !group || !item) throw new BackendError('not_member')
      if (group.memberCount < 2) throw new BackendError('group_waiting')
      if (item.authorId === user?.id) throw new BackendError('own_checkin')
      if (item.challengeId !== null) throw new BackendError('already_challenged')
      const challengeId = `challenge-${checkinId}`
      const closesAt = new Date(Date.now() + 86_400_000).toISOString()
      if (group.memberCount === 2) {
        const at = new Date().toISOString()
        feed[groupId] = [
          ...(feed[groupId] ?? []).filter((entry) => entry.id !== checkinId),
          {
            type: 'ruling',
            id: `ruling-${checkinId}`,
            groupId,
            sortAt: at,
            challengeId,
            checkinId,
            challengerId: user?.id ?? null,
            challengerName: profile?.displayName ?? '',
            ownerId: item.authorId,
            ownerName: item.authorName,
            title: item.taskName ?? item.activityName,
            outcome: 'fake',
            fakeCount: 1,
            realCount: 0,
            variant: 'two_person',
            // The fake's week lock: three days on. The challenger is the caller, so an admin
            // caller may overturn (the owner is someone else).
            overturnUntil: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            canOverturn: group.role === 'admin',
            overturnedById: null,
            overturnedByName: null,
            overturnedAt: null,
          },
        ]
        friendsToday[groupId] = (friendsToday[groupId] ?? []).filter((e) => e.id !== checkinId)
        return { challengeId, status: 'fake', closesAt }
      }
      const challenged = (entry: FeedCheckin): FeedCheckin =>
        entry.id === checkinId
          ? { ...entry, challengeId, challengeStatus: 'open', challengeClosesAt: closesAt }
          : entry
      feed[groupId] = (feed[groupId] ?? []).map((entry) =>
        entry.type === 'checkin' ? challenged(entry) : entry,
      )
      friendsToday[groupId] = (friendsToday[groupId] ?? []).map(challenged)
      feed[groupId] = [
        ...(feed[groupId] ?? []),
        {
          type: 'vote',
          id: challengeId,
          groupId,
          sortAt: new Date().toISOString(),
          checkinId,
          challengerId: user?.id ?? null,
          challengerName: profile?.displayName ?? '',
          ownerId: item.authorId,
          ownerName: item.authorName,
          commitmentId: item.commitmentId,
          commitmentKind: item.commitmentKind,
          activityName: item.activityName,
          presetKey: item.presetKey,
          taskName: item.taskName,
          capturedAt: item.capturedAt,
          receivedAt: item.receivedAt,
          fullPrunedAt: item.fullPrunedAt,
          status: 'open',
          closesAt,
          fakeCount: null,
          realCount: null,
          variant: null,
          cancelReason: null,
          cancelledById: null,
          photoVisible: true,
          myChoice: null,
          myCastAt: null,
          canVote: false,
          overturnedById: null,
          overturnedByName: null,
        },
      ]
      return { challengeId, status: 'open', closesAt }
    }),
    // The server's rules in short: the current admin, a Fake ruling not yet overturned, not their
    // own check-in, before the ruling's `overturnUntil`. The ruling sticky and its Vote card name
    // the admin; the check-in itself is not restored on the fake wall.
    overturnRuling: vi.fn(async (challengeId: string): Promise<OverturnResult> => {
      const ruling = Object.values(feed)
        .flat()
        .find(
          (item): item is FeedRuling => item.type === 'ruling' && item.challengeId === challengeId,
        )
      const group = groups.find((g) => g.id === ruling?.groupId)
      if (!ruling || !group) throw new BackendError('not_member')
      if (group.role !== 'admin') throw new BackendError('not_admin')
      if (ruling.outcome !== 'fake') throw new BackendError('not_fake_ruling')
      if (ruling.overturnedAt !== null) throw new BackendError('already_overturned')
      if (ruling.ownerId === user?.id) throw new BackendError('own_checkin')
      if (ruling.overturnUntil === null || Date.now() >= Date.parse(ruling.overturnUntil)) {
        throw new BackendError('week_locked')
      }
      const createdAt = new Date().toISOString()
      const by = { overturnedById: user?.id ?? null, overturnedByName: profile?.displayName ?? '' }
      feed[group.id] = (feed[group.id] ?? []).map((item) =>
        item.type === 'ruling' && item.challengeId === challengeId
          ? { ...item, ...by, overturnedAt: createdAt, canOverturn: false }
          : item,
      )
      patchVote(challengeId, by)
      return { overturnId: `overturn-${challengeId}`, createdAt }
    }),
    // The server's rules in short (no 6 s window: undo always succeeds unless the vote closed).
    castVote: vi.fn(
      async (_kind: VoteKind, id: string, choice: AnyVoteChoice): Promise<CastVoteResult> => {
        const vote = findVote(id)
        if (!vote || !groups.some((group) => group.id === vote.groupId)) {
          throw new BackendError('not_member')
        }
        const open = vote.type === 'vote' ? vote.status === 'open' : vote.status === 'pending'
        if (!open || Date.now() >= Date.parse(vote.closesAt)) {
          throw new BackendError('vote_closed')
        }
        const locked =
          vote.type === 'vote'
            ? vote.challengerId === user?.id || vote.ownerId === user?.id
            : vote.requesterId === user?.id
        if (!vote.canVote || locked) throw new BackendError('not_eligible')
        if (vote.myChoice !== null) throw new BackendError('already_voted')
        const castAt = new Date().toISOString()
        patchVote(id, { myChoice: choice, myCastAt: castAt } as Partial<FeedVote>)
        shiftTally(vote, 1)
        return { voteId: `vote-${id}`, castAt }
      },
    ),
    undoVote: vi.fn(async (_kind: VoteKind, id: string) => {
      const vote = findVote(id)
      if (!vote || !groups.some((group) => group.id === vote.groupId)) {
        throw new BackendError('not_member')
      }
      const open = vote.type === 'vote' ? vote.status === 'open' : vote.status === 'pending'
      if (!open) throw new BackendError('vote_closed')
      if (vote.myChoice === null) return
      patchVote(id, { myChoice: null, myCastAt: null })
      shiftTally(vote, -1)
    }),
    listVoteTallies: vi.fn(async (groupId: string): Promise<VoteTally[]> => {
      const group = groups.find((g) => g.id === groupId)
      if (!group) throw new BackendError('not_member')
      if (voteTallies) return [...(voteTallies[groupId] ?? [])]
      return (feed[groupId] ?? []).flatMap((item): VoteTally[] => {
        if (item.type === 'vote' && item.status === 'open') {
          return [
            {
              targetKind: 'challenge',
              targetId: item.id,
              votedCount: 1 + (item.myChoice !== null ? 1 : 0),
              eligibleCount: Math.max(1, group.memberCount - 1),
            },
          ]
        }
        if (item.type === 'freezeVote' && item.status === 'pending') {
          return [
            {
              targetKind: 'freeze',
              targetId: item.id,
              votedCount: item.myChoice !== null ? 1 : 0,
              eligibleCount: Math.max(1, group.memberCount - 1),
            },
          ]
        }
        return []
      })
    }),
    listFreezeOptions: vi.fn(async (groupId: string): Promise<FreezeOption[]> => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return [...(freezeOptions[groupId] ?? [])]
    }),
    listMyFreezeRequests: vi.fn(async (groupId: string): Promise<FreezeRequest[]> => {
      if (!groups.some((group) => group.id === groupId)) throw new BackendError('not_member')
      return [...(freezeRequests[groupId] ?? [])]
    }),
    // The server's rules in short: the reason, an option it listed (else the window closed), and a
    // group of one approves at once.
    requestFreeze: vi.fn(async (input: RequestFreezeInput): Promise<RequestFreezeResult> => {
      const entry = Object.entries(freezeOptions).find(([, list]) =>
        list.some((o) => o.commitmentId === input.commitmentId),
      )
      const trimmed = input.reason.trim()
      if (trimmed.length === 0 || trimmed.length > 80) throw new BackendError('reason_required')
      if (!entry) throw new BackendError('freeze_window_closed')
      const [groupId, list] = entry
      const group = groups.find((g) => g.id === groupId)
      if (!group) throw new BackendError('not_member')
      const option = list.find((o) =>
        input.sessionId !== null
          ? o.kind === 'day' && o.sessionId === input.sessionId
          : o.kind === 'week' &&
            o.weekStart === input.weekStart &&
            o.commitmentId === input.commitmentId,
      )
      if (!option) throw new BackendError('freeze_window_closed')
      freezesMade += 1
      const id = `freeze-${freezesMade}`
      const sessionId = option.sessionId ?? `session-${option.commitmentId}-${option.weekStart}`
      const status = group.memberCount <= 1 ? 'approved' : 'pending'
      const closesAt = new Date(Date.now() + 86_400_000).toISOString()
      freezeOptions[groupId] = list.filter((o) => o !== option)
      freezeRequests[groupId] = [
        ...(freezeRequests[groupId] ?? []),
        {
          id,
          commitmentId: option.commitmentId,
          sessionId,
          kind: option.kind,
          weekStart: option.weekStart,
          status,
          reason: trimmed,
          closesAt,
          startsAt: option.startsAt,
          targetAfter: option.kind === 'week' ? option.targetAfter : null,
        },
      ]
      return { freezeRequestId: id, status, closesAt, sessionId }
    }),
  }
}

/** Where the fake's signed photo URLs point. */
export const FAKE_PHOTO_ORIGIN = 'https://photos.test'

function cursorOf(item: FeedItem): FeedCursor {
  return { sortAt: item.sortAt, itemId: item.id }
}

function compareFeed(a: FeedCursor, b: FeedCursor): number {
  if (a.sortAt !== b.sortAt) return a.sortAt < b.sortAt ? -1 : 1
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0
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
  camera: CameraPort = createFakeCamera(),
  encoder: ImageEncodePort = createFakeEncoder(),
) {
  return (
    <QueryClientProvider client={queryClient}>
      <BackendProvider backend={backend} onSignedOut={onSignedOut}>
        <ImageEncoderContext.Provider value={encoder}>
          <CameraPortContext.Provider value={camera}>{children}</CameraPortContext.Provider>
        </ImageEncoderContext.Provider>
      </BackendProvider>
    </QueryClientProvider>
  )
}

/** Renders the app routes in a memory router under a BackendProvider. */
export function renderRoutes(
  initialEntries: InitialEntry[],
  backend: BackendPort = createFakeBackend(),
  options: {
    initialIndex?: number
    onSignedOut?: () => void
    queryClient?: QueryClient
    camera?: CameraPort
    encoder?: ImageEncodePort
  } = {},
) {
  const router = createMemoryRouter(routes, { initialEntries, initialIndex: options.initialIndex })
  const queryClient = options.queryClient ?? createTestQueryClient()
  const utils = render(
    withBackend(
      backend,
      <RouterProvider router={router} />,
      options.onSignedOut,
      queryClient,
      options.camera,
      options.encoder,
    ),
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
