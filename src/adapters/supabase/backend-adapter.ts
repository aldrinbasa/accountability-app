import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type PostgrestError,
  type Session,
  type User,
} from '@supabase/supabase-js'
import {
  isActivityCategory,
  isScheduleType,
  type GroupActivity,
  type PresetActivity,
} from '@/domain/activities'
import { AuthError, type AuthErrorCode, type AuthUser } from '@/domain/auth'
import type { Board, BoardRow, GroupWeek, PlanItem } from '@/domain/board'
import type {
  BadgeStatus,
  MemberProfile,
  ProfileBadge,
  ProfileStreak,
  Title,
} from '@/domain/badges'
import type { Streak } from '@/domain/streaks'
import {
  checkinPhotoPath,
  isWontCount,
  type CheckinTarget,
  type PostCheckinInput,
  type PostCheckinResult,
} from '@/domain/checkin'
import { BackendError, isRpcErrorCode } from '@/domain/error-codes'
import {
  isFeedEventKind,
  type FeedCheckin,
  type FeedCursor,
  type FeedItem,
  type FeedMiss,
  type FeedWinner,
  type FeedRows,
  type FeedRowsRequest,
} from '@/domain/feed'
import {
  isEndReason,
  isInviteStatus,
  type EndedMembership,
  type GroupMember,
  type GroupRole,
  type MyGroup,
  type MyGroupsSnapshot,
} from '@/domain/groups'
import {
  isCommitmentState,
  isMyPlanSection,
  isMyPlanState,
  type CommitmentDetails,
  type MyPlanItem,
  type UpdateCommitmentInput,
} from '@/domain/my-plan'
import type { AddCommitmentInput, AddTaskInput, PlanPreview, TaskDetails } from '@/domain/plan'
import type { Profile } from '@/domain/profile'
import type { TimeZoneState } from '@/domain/time-zones'
import { isTodaySection, type TodayItem, type TodaySummary } from '@/domain/today'
import type { WinnerPodiumMember, WinnerWeek } from '@/domain/winner'
import type { BackendPort } from '@/ports/backend-port'
import { supabase, supabaseUrl } from '@/adapters/supabase/client'
import type { Database, Tables } from '@/adapters/supabase/database.types'

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The provider's given name, for prefilling Setup: Google's `given_name`, else the first word of
 * `full_name` or `name`. Email sign-ins have none.
 */
export function givenNameOf(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata) return null
  const given = metadataString(metadata, 'given_name')
  if (given) return given
  const full = metadataString(metadata, 'full_name') ?? metadataString(metadata, 'name')
  return full ? (full.split(/\s+/)[0] ?? null) : null
}

function toAuthUser(user: User): AuthUser {
  const givenName = givenNameOf(user.user_metadata)
  return { id: user.id, email: user.email ?? null, ...(givenName ? { givenName } : {}) }
}

type ProfileRow = Pick<
  Tables<'profiles'>,
  'id' | 'display_name' | 'avatar_path' | 'time_zone' | 'pending_time_zone' | 'pending_week_start'
>

const PROFILE_COLUMNS =
  'id, display_name, avatar_path, time_zone, pending_time_zone, pending_week_start'

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    timeZone: row.time_zone,
    pendingTimeZone: row.pending_time_zone,
    pendingWeekStart: row.pending_week_start,
  }
}

type TimeZoneRow = Pick<
  Tables<'profiles'>,
  'time_zone' | 'pending_time_zone' | 'pending_week_start'
>

export function toTimeZoneState(row: TimeZoneRow): TimeZoneState {
  return {
    timeZone: row.time_zone,
    pendingTimeZone: row.pending_time_zone,
    pendingWeekStart: row.pending_week_start,
  }
}

type MembershipRow = Pick<
  Tables<'memberships'>,
  'id' | 'user_id' | 'role' | 'joined_at' | 'ended_at' | 'end_reason'
>
type GroupRow = Pick<
  Tables<'groups'>,
  'id' | 'name' | 'time_zone' | 'pending_time_zone' | 'pending_week_start'
> & {
  memberships: MembershipRow[]
}

/**
 * Groups with their memberships embedded. RLS returns every group the member was ever in, and for
 * each the member's own rows plus, while they are a current member, everyone's current rows.
 */
const GROUP_COLUMNS =
  'id, name, time_zone, pending_time_zone, pending_week_start, memberships(id, user_id, role, joined_at, ended_at, end_reason)'

function toRole(role: string): GroupRole {
  return role === 'admin' ? 'admin' : 'member'
}

/**
 * Splits the rows into the groups where `userId` has a current membership (with the count of current
 * members) and the groups they are no longer in (their latest ended membership of each).
 */
export function toMyGroups(rows: readonly GroupRow[], userId: string): MyGroupsSnapshot {
  const groups: MyGroup[] = []
  const ended: EndedMembership[] = []
  for (const row of rows) {
    const current = row.memberships.filter((m) => m.ended_at === null)
    const mine = current.find((m) => m.user_id === userId)
    if (!mine) {
      const last = row.memberships
        .filter((m) => m.user_id === userId && m.ended_at !== null)
        .sort((a, b) => Date.parse(b.ended_at ?? '') - Date.parse(a.ended_at ?? ''))[0]
      if (last?.ended_at && isEndReason(last.end_reason)) {
        ended.push({
          membershipId: last.id,
          groupId: row.id,
          name: row.name,
          endReason: last.end_reason,
          endedAt: last.ended_at,
        })
      }
      continue
    }
    groups.push({
      id: row.id,
      name: row.name,
      timeZone: row.time_zone,
      pendingTimeZone: row.pending_time_zone,
      pendingWeekStart: row.pending_week_start,
      role: toRole(mine.role),
      joinedAt: mine.joined_at,
      memberCount: current.length,
    })
  }
  return { groups, ended }
}

type MemberRow = Pick<Tables<'memberships'>, 'id' | 'user_id' | 'role' | 'joined_at'> & {
  profiles: Pick<Tables<'profiles'>, 'display_name' | 'avatar_path'> | null
}

/** A group's current memberships with each member's display name and avatar path. */
const MEMBER_COLUMNS = 'id, user_id, role, joined_at, profiles(display_name, avatar_path)'

export function toGroupMembers(rows: readonly MemberRow[]): GroupMember[] {
  return rows.map((row) => ({
    membershipId: row.id,
    userId: row.user_id,
    displayName: row.profiles?.display_name ?? '',
    avatarPath: row.profiles?.avatar_path ?? null,
    role: toRole(row.role),
    joinedAt: row.joined_at,
  }))
}

type PresetRow = Pick<Tables<'preset_activities'>, 'key' | 'name' | 'category' | 'sort'>

const PRESET_COLUMNS = 'key, name, category, sort'

/** Preset rows as domain presets. A row with an unknown category is a server bug: fail loudly. */
export function toPresetActivities(rows: readonly PresetRow[]): PresetActivity[] {
  return rows.map((row) => {
    if (!isActivityCategory(row.category)) {
      throw new BackendError('unknown', `preset ${row.key} has category ${row.category}`)
    }
    return { key: row.key, name: row.name, category: row.category, sort: row.sort }
  })
}

type GroupActivityRow = Pick<
  Tables<'group_activity_options'>,
  'id' | 'group_id' | 'preset_key' | 'custom_name' | 'created_by' | 'locked_schedule_type'
>

const GROUP_ACTIVITY_COLUMNS =
  'id, group_id, preset_key, custom_name, created_by, locked_schedule_type'

/** Group activity rows as domain rows. An unknown schedule type is a server bug: fail loudly. */
export function toGroupActivities(rows: readonly GroupActivityRow[]): GroupActivity[] {
  return rows.map((row) => {
    const locked = row.locked_schedule_type
    if (locked !== null && !isScheduleType(locked)) {
      throw new BackendError('unknown', `group activity ${row.id} has schedule type ${locked}`)
    }
    return {
      id: row.id,
      groupId: row.group_id,
      presetKey: row.preset_key,
      customName: row.custom_name,
      createdBy: row.created_by,
      lockedScheduleType: locked,
    }
  })
}

type PlanPreviewRow = Database['public']['Functions']['plan_preview']['Returns'][number]

/** The `plan_preview` row as a domain preview (dates stay `YYYY-MM-DD` strings). */
export function toPlanPreview(row: PlanPreviewRow): PlanPreview {
  return {
    memberToday: row.member_today,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    startsOn: row.starts_on,
    minEndDate: row.min_end_date,
    lastWeekTarget: row.last_week_target ?? null,
  }
}

/** `add_commitment` arguments: only the fields that apply are sent (the rest default to null). */
export function toAddCommitmentArgs(input: AddCommitmentInput) {
  const { activity } = input
  return {
    p_group_id: input.groupId,
    ...(activity.kind === 'preset' ? { p_preset_key: activity.presetKey } : {}),
    ...(activity.kind === 'group' ? { p_group_activity_id: activity.groupActivityId } : {}),
    ...(activity.kind === 'custom' ? { p_custom_name: activity.name } : {}),
    p_schedule_type: input.scheduleType,
    ...(input.days !== null ? { p_days: input.days } : {}),
    ...(input.target !== null ? { p_target: input.target } : {}),
    ...(input.endDate !== null ? { p_end_date: input.endDate } : {}),
  }
}

/** `add_task` arguments: the one activity field that applies, the name and the deadline. */
export function toAddTaskArgs(input: AddTaskInput) {
  const { activity } = input
  return {
    p_group_id: input.groupId,
    ...(activity.kind === 'preset' ? { p_preset_key: activity.presetKey } : {}),
    ...(activity.kind === 'group' ? { p_group_activity_id: activity.groupActivityId } : {}),
    ...(activity.kind === 'custom' ? { p_custom_name: activity.name } : {}),
    p_name: input.name,
    p_deadline: input.deadline,
  }
}

type TaskRow = Database['public']['Functions']['get_task']['Returns'][number]

/** The `get_task` row as domain task details (the generated type misses the nullable columns). */
export function toTaskDetails(row: TaskRow): TaskDetails {
  return {
    commitmentId: row.commitment_id,
    groupId: row.group_id,
    presetKey: row.preset_key ?? null,
    customName: row.custom_name ?? null,
    name: row.name,
    deadline: row.deadline,
    canDelete: row.can_delete,
    canRename: row.can_rename,
  }
}

type TodayItemRow = Database['public']['Functions']['get_today_items']['Returns'][number]

/**
 * `get_today_items` rows as domain items, in the server's order. The generated type misses the
 * nullable columns. An unknown section, kind or schedule type is a server bug: fail loudly.
 */
export function toTodayItems(rows: readonly TodayItemRow[]): TodayItem[] {
  return rows.map((row) => {
    const scheduleType = row.schedule_type ?? null
    if (!isTodaySection(row.section)) {
      throw new BackendError(
        'unknown',
        `today item ${row.commitment_id} has section ${row.section}`,
      )
    }
    if (row.kind !== 'commitment' && row.kind !== 'task') {
      throw new BackendError('unknown', `today item ${row.commitment_id} has kind ${row.kind}`)
    }
    if (scheduleType !== null && !isScheduleType(scheduleType)) {
      throw new BackendError(
        'unknown',
        `today item ${row.commitment_id} has schedule type ${scheduleType}`,
      )
    }
    return {
      commitmentId: row.commitment_id,
      kind: row.kind,
      section: row.section,
      presetKey: row.preset_key ?? null,
      customName: row.custom_name ?? null,
      activityName: row.activity_name ?? row.custom_name ?? row.preset_key ?? '',
      name: row.name ?? null,
      scheduleType,
      days: row.days ?? null,
      target: row.target ?? null,
      counted: row.counted ?? 0,
      deadline: row.deadline ?? null,
      startsOn: row.starts_on ?? null,
      canDelete: row.can_delete ?? false,
      countedToday: row.counted_today ?? false,
      targetMet: row.target_met ?? false,
    }
  })
}

type TodaySummaryRow = Database['public']['Functions']['get_today_summary']['Returns'][number]

/** The `get_today_summary` row as a domain summary (dates stay `YYYY-MM-DD` strings). */
export function toTodaySummary(row: TodaySummaryRow): TodaySummary {
  return {
    memberToday: row.member_today,
    weekStart: row.week_start,
    weekNumber: row.week_number,
    planned: row.planned,
    done: row.done,
    left: row.left,
    hasPlan: row.has_plan,
  }
}

type MyPlanRow = Database['public']['Functions']['get_my_plan']['Returns'][number]

/**
 * `get_my_plan` rows as domain items, in the server's order. The generated type misses the
 * nullable columns. An unknown section, state, kind or schedule type is a server bug: fail loudly.
 */
export function toMyPlanItems(rows: readonly MyPlanRow[]): MyPlanItem[] {
  return rows.map((row) => {
    const scheduleType = row.schedule_type ?? null
    if (!isMyPlanSection(row.section)) {
      throw new BackendError('unknown', `plan item ${row.commitment_id} has section ${row.section}`)
    }
    if (!isMyPlanState(row.state)) {
      throw new BackendError('unknown', `plan item ${row.commitment_id} has state ${row.state}`)
    }
    if (row.kind !== 'commitment' && row.kind !== 'task') {
      throw new BackendError('unknown', `plan item ${row.commitment_id} has kind ${row.kind}`)
    }
    if (scheduleType !== null && !isScheduleType(scheduleType)) {
      throw new BackendError(
        'unknown',
        `plan item ${row.commitment_id} has schedule type ${scheduleType}`,
      )
    }
    return {
      commitmentId: row.commitment_id,
      kind: row.kind,
      section: row.section,
      state: row.state,
      presetKey: row.preset_key ?? null,
      customName: row.custom_name ?? null,
      activityName: row.activity_name ?? row.custom_name ?? row.preset_key ?? '',
      name: row.name ?? null,
      scheduleType,
      days: row.days ?? null,
      target: row.target ?? null,
      endDate: row.end_date ?? null,
      deadline: row.deadline ?? null,
      startsOn: row.starts_on ?? null,
      endsOn: row.ends_on ?? null,
      canEdit: row.can_edit ?? false,
      canDelete: row.can_delete ?? false,
    }
  })
}

type CommitmentRow = Database['public']['Functions']['get_commitment']['Returns'][number]

/** The `get_commitment` row as domain details. An unknown type or state is a server bug. */
export function toCommitmentDetails(row: CommitmentRow): CommitmentDetails {
  if (!isScheduleType(row.schedule_type)) {
    throw new BackendError(
      'unknown',
      `commitment ${row.commitment_id} has schedule type ${row.schedule_type}`,
    )
  }
  if (!isCommitmentState(row.state)) {
    throw new BackendError('unknown', `commitment ${row.commitment_id} has state ${row.state}`)
  }
  return {
    commitmentId: row.commitment_id,
    groupId: row.group_id,
    presetKey: row.preset_key ?? null,
    customName: row.custom_name ?? null,
    activityName: row.activity_name ?? row.custom_name ?? row.preset_key ?? '',
    scheduleType: row.schedule_type,
    days: row.days ?? null,
    target: row.target ?? null,
    endDate: row.end_date ?? null,
    changesFrom: row.changes_from,
    minEndDate: row.min_end_date,
    state: row.state,
    canEdit: row.can_edit,
  }
}

/** `update_commitment` arguments: only the fields that apply are sent (the rest default to null). */
export function toUpdateCommitmentArgs(input: UpdateCommitmentInput) {
  return {
    p_commitment_id: input.commitmentId,
    ...(input.days !== null ? { p_days: input.days } : {}),
    ...(input.target !== null ? { p_target: input.target } : {}),
    ...(input.endDate !== null ? { p_end_date: input.endDate } : {}),
  }
}

type CheckinTargetRow = Database['public']['Functions']['get_checkin_targets']['Returns'][number]

/**
 * `get_checkin_targets` rows as domain targets, in the server's order. The generated type misses the
 * nullable columns. An unknown kind, schedule type or reason is a server bug: fail loudly.
 */
export function toCheckinTargets(rows: readonly CheckinTargetRow[]): CheckinTarget[] {
  return rows.map((row) => {
    const scheduleType = row.schedule_type ?? null
    const wontCount = row.wont_count ?? null
    if (row.kind !== 'commitment' && row.kind !== 'task') {
      throw new BackendError('unknown', `checkin target ${row.commitment_id} has kind ${row.kind}`)
    }
    if (scheduleType !== null && !isScheduleType(scheduleType)) {
      throw new BackendError(
        'unknown',
        `checkin target ${row.commitment_id} has schedule type ${scheduleType}`,
      )
    }
    if (wontCount !== null && !isWontCount(wontCount)) {
      throw new BackendError(
        'unknown',
        `checkin target ${row.commitment_id} has wont_count ${wontCount}`,
      )
    }
    return {
      commitmentId: row.commitment_id,
      kind: row.kind,
      presetKey: row.preset_key ?? null,
      activityName: row.activity_name ?? row.custom_name ?? row.preset_key ?? '',
      name: row.name ?? null,
      scheduleType,
      dueToday: row.due_today ?? false,
      memberToday: row.member_today,
      deadline: row.deadline ?? null,
      target: row.target ?? 0,
      doneCount: row.done_count ?? 0,
      wontCount,
    }
  })
}

type PostCheckinRow = Database['public']['Functions']['post_checkin']['Returns'][number]

/** The `post_checkin` row as a domain result (`session_id` is null for an extra). */
export function toPostCheckinResult(row: PostCheckinRow): PostCheckinResult {
  return {
    checkinId: row.checkin_id,
    sessionId: row.session_id ?? null,
    counted: row.counted,
    isLate: row.is_late,
    doneCount: row.done_count,
    target: row.target,
    weeklyPoints: row.weekly_points ?? null,
    rank: row.rank ?? null,
    passedUserIds: row.passed_user_ids ?? [],
  }
}

type GroupWeekRow = Database['public']['Functions']['get_group_week']['Returns'][number]

/** The `get_group_week` row as the group's current week. */
export function toGroupWeek(row: GroupWeekRow): GroupWeek {
  return { weekStart: row.week_start, lockAt: row.lock_at }
}

type BoardRpcRow = Database['public']['Functions']['get_board']['Returns'][number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `get_board`'s `plan` jsonb as plan items; anything malformed is dropped. */
export function toPlanItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): PlanItem[] => {
    if (!isRecord(item) || typeof item.activity_name !== 'string') return []
    const scheduleType = item.schedule_type
    if (scheduleType !== 'fixed_days' && scheduleType !== 'times_per_week') return []
    const days = Array.isArray(item.days)
      ? item.days.filter((day): day is number => typeof day === 'number')
      : null
    const target = typeof item.target === 'number' ? item.target : null
    return [{ activityName: item.activity_name, scheduleType, days, target }]
  })
}

/**
 * `get_board` rows as a board, in the server's order. `waiting`, `lock_at`, `is_current_week` and
 * `time_zone` repeat on every row; a board with no rows (never for a member) counts as waiting. The
 * generated type misses the nullable columns.
 */
export function toBoard(rows: readonly BoardRpcRow[]): Board {
  const first = rows[0]
  return {
    waiting: first?.waiting ?? true,
    lockAt: first?.lock_at ?? null,
    isCurrentWeek: first?.is_current_week ?? false,
    timeZone: first?.time_zone ?? null,
    locked: first?.locked ?? false,
    rows: rows.map((row): BoardRow => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarPath: row.avatar_path ?? null,
      weeklyPoints: row.weekly_points ?? null,
      sessionsDone: row.sessions_done,
      sessionsPlanned: row.sessions_planned,
      sessionsFrozen: row.sessions_frozen,
      rank: row.rank ?? null,
      missCount: row.miss_count ?? 0,
      bestStreak: row.best_streak ?? 0,
      plan: toPlanItems(row.plan),
      taskCount: row.task_count ?? 0,
      isWinner: row.is_winner ?? false,
    })),
  }
}

type WinnerRpcRow = Database['public']['Functions']['get_winner_week']['Returns'][number]

/**
 * `get_winner_week` rows as the locked week, or null when there are none (an unknown or unlocked
 * week, or no locked week yet). The week columns repeat on every row; a row without a member (a
 * locked week with nobody on its podium) only carries them. The generated type misses the nullable
 * columns.
 */
export function toWinnerWeek(rows: readonly WinnerRpcRow[]): WinnerWeek | null {
  const first = rows[0]
  if (!first) return null
  return {
    weekStart: first.week_start,
    lockAt: first.lock_at,
    scored: first.scored ?? false,
    ranked: first.ranked ?? false,
    winnerUserIds: first.winner_user_ids ?? [],
    podium: rows.flatMap((row): WinnerPodiumMember[] =>
      row.user_id === null || row.rank === null
        ? []
        : [
            {
              userId: row.user_id,
              displayName: row.display_name ?? '',
              avatarPath: row.avatar_path ?? null,
              weeklyPoints: row.weekly_points ?? 0,
              rank: row.rank,
              isWinner: row.is_winner ?? false,
            },
          ],
    ),
    badgeName: first.badge_name ?? '',
    badgeLine: first.badge_line ?? '',
  }
}

type MemberProfileRow = Database['public']['Functions']['get_member_profile']['Returns'][number]

function isBadgeStatus(value: unknown): value is BadgeStatus {
  return value === 'earned' || value === 'pending' || value === 'locked'
}

/** `get_member_profile`'s `badges` jsonb in catalog order; malformed entries are dropped. */
export function toProfileBadges(value: unknown): ProfileBadge[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ProfileBadge[] => {
    if (!isRecord(item) || typeof item.key !== 'string' || typeof item.name !== 'string') return []
    return [
      {
        key: item.key,
        name: item.name,
        howEarned: typeof item.how_earned === 'string' ? item.how_earned : '',
        line: typeof item.line === 'string' ? item.line : '',
        icon: typeof item.icon === 'string' ? item.icon : '',
        status: isBadgeStatus(item.status) ? item.status : 'locked',
        awardedAt: typeof item.awarded_at === 'string' ? item.awarded_at : null,
        pendingLockAt: typeof item.pending_lock_at === 'string' ? item.pending_lock_at : null,
      },
    ]
  })
}

/** `get_member_profile`'s `streaks` jsonb; malformed entries are dropped. */
export function toProfileStreaks(value: unknown): ProfileStreak[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ProfileStreak[] =>
    isRecord(item) && typeof item.commitment_id === 'string'
      ? [
          {
            commitmentId: item.commitment_id,
            activityName: typeof item.activity_name === 'string' ? item.activity_name : '',
            currentStreak: typeof item.current_streak === 'number' ? item.current_streak : 0,
            backToZero: item.back_to_zero === true,
          },
        ]
      : [],
  )
}

/**
 * The `get_member_profile` row as a profile, or null without a row (someone never in the group).
 * The generated type misses the nullable columns.
 */
export function toMemberProfile(rows: readonly MemberProfileRow[]): MemberProfile | null {
  const row = rows[0]
  if (!row) return null
  return {
    displayName: row.display_name ?? '',
    avatarPath: row.avatar_path ?? null,
    isCurrentMember: row.is_current_member ?? false,
    allTimePoints: row.all_time_points ?? 0,
    titleKey: row.title_key ?? null,
    timeZone: row.time_zone ?? null,
    badges: toProfileBadges(row.badges),
    streaks: toProfileStreaks(row.streaks),
    plan: toPlanItems(row.plan),
    taskCount: row.task_count ?? 0,
  }
}

type StreakRpcRow = Database['public']['Functions']['get_streaks']['Returns'][number]

/** `get_streaks` rows as streaks. The generated type misses the nullable streak (null for a task). */
export function toStreaks(rows: readonly StreakRpcRow[]): Streak[] {
  return rows.map((row): Streak => ({
    commitmentId: row.commitment_id,
    userId: row.user_id,
    currentStreak: row.current_streak ?? null,
    backToZero: row.back_to_zero ?? false,
  }))
}

/** `post_checkin` arguments (the caption only when there is one). */
export function toPostCheckinArgs(input: PostCheckinInput) {
  return {
    p_id: input.id,
    p_commitment_id: input.commitmentId,
    p_captured_at: input.capturedAt,
    ...(input.caption !== null ? { p_caption: input.caption } : {}),
  }
}

type FeedItemRow = Tables<'feed_items'>

/** The view's columns, in its order. */
const FEED_COLUMNS =
  'group_id, item_kind, item_id, sort_at, actor_id, actor_name, actor_avatar_path, subject_id, subject_name, commitment_id, commitment_kind, activity_name, preset_key, task_name, captured_at, received_at, is_late, is_extra, caption, full_pruned_at, counted_position, target, payload, miss_count'

/** A string field of an event's `payload`, else null. */
function payloadString(payload: FeedItemRow['payload'], key: string): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

/**
 * A weekly winner row (Story 4.5): the payload's week, points and winners (names at the lock); null
 * when the payload is malformed or names nobody.
 */
function toFeedWinner(
  row: FeedItemRow,
  id: string,
  groupId: string,
  sortAt: string,
): FeedWinner | null {
  const payload = row.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null
  const weekStart = payloadString(payload, 'week_start')
  const points = payload.weekly_points
  const list = payload.winners
  if (weekStart === null || typeof points !== 'number' || !Array.isArray(list)) return null
  const winners = list.flatMap((entry) =>
    isRecord(entry) && typeof entry.user_id === 'string' && typeof entry.name === 'string'
      ? [{ userId: entry.user_id, name: entry.name }]
      : [],
  )
  if (winners.length === 0) return null
  return { type: 'winner', id, groupId, sortAt, weekStart, weeklyPoints: points, winners }
}

/** A miss row (Story 3.5): the live title and count, the payload's tease, day and schedule type. */
function toFeedMiss(
  row: FeedItemRow,
  id: string,
  groupId: string,
  sortAt: string,
): FeedMiss | null {
  const missCount = row.miss_count ?? 0
  if (missCount <= 0) return null
  const scheduleType = payloadString(row.payload, 'schedule_type')
  return {
    type: 'miss',
    id,
    groupId,
    sortAt,
    actorId: row.actor_id,
    actorName: row.actor_name ?? '',
    commitmentId: row.commitment_id,
    title: row.task_name ?? row.activity_name ?? payloadString(row.payload, 'activity_name') ?? '',
    scheduleType:
      scheduleType === 'fixed_days' || scheduleType === 'times_per_week' ? scheduleType : null,
    missCount,
    tease: payloadString(row.payload, 'tease'),
    missedOn: payloadString(row.payload, 'missed_on'),
  }
}

/**
 * One `feed_items` row as a domain item, or null for a kind the app does not render or a row
 * missing what every item needs.
 */
export function toFeedItem(row: FeedItemRow): FeedItem | null {
  const { item_id: id, group_id: groupId, sort_at: sortAt, item_kind: kind } = row
  if (!id || !groupId || !sortAt || !kind) return null
  if (kind === 'checkin') {
    if (!row.actor_id || !row.commitment_id || !row.captured_at || !row.received_at) return null
    return {
      type: 'checkin',
      id,
      groupId,
      sortAt,
      authorId: row.actor_id,
      authorName: row.actor_name ?? '',
      authorAvatarPath: row.actor_avatar_path,
      commitmentId: row.commitment_id,
      commitmentKind: row.commitment_kind === 'task' ? 'task' : 'commitment',
      activityName: row.activity_name ?? row.preset_key ?? '',
      presetKey: row.preset_key,
      taskName: row.task_name,
      capturedAt: row.captured_at,
      receivedAt: row.received_at,
      isLate: row.is_late ?? false,
      isExtra: row.is_extra ?? false,
      caption: row.caption,
      fullPrunedAt: row.full_pruned_at,
      countedPosition: row.counted_position,
      target: row.target,
    }
  }
  if (kind === 'miss') return toFeedMiss(row, id, groupId, sortAt)
  if (kind === 'weekly_winner') return toFeedWinner(row, id, groupId, sortAt)
  if (!isFeedEventKind(kind)) return null
  return {
    type: 'event',
    kind,
    id,
    groupId,
    sortAt,
    actorId: row.actor_id,
    actorName: row.actor_name ?? '',
    subjectId: row.subject_id,
    subjectName: row.subject_name,
  }
}

function rowCursor(row: FeedItemRow | undefined): FeedCursor | null {
  return row?.sort_at && row.item_id ? { sortAt: row.sort_at, itemId: row.item_id } : null
}

/**
 * Raw `feed_items` rows (newest first) as a page: the mapped items plus the raw count and cursors.
 */
export function toFeedRows(rows: readonly FeedItemRow[]): FeedRows {
  const items: FeedItem[] = []
  for (const row of rows) {
    const item = toFeedItem(row)
    if (item) items.push(item)
  }
  return {
    items,
    rowCount: rows.length,
    newest: rowCursor(rows[0]),
    oldest: rowCursor(rows[rows.length - 1]),
  }
}

/**
 * The PostgREST `or` filter for rows after a cursor in one direction: `lt` for older, `gt` for
 * newer. The timestamp is quoted (it holds `:` and `+`); ids are UUIDs.
 */
export function keysetFilter(cursor: FeedCursor, direction: 'lt' | 'gt'): string {
  const at = `"${cursor.sortAt}"`
  return `sort_at.${direction}.${at},and(sort_at.eq.${at},item_id.${direction}.${cursor.itemId})`
}

/** Signed check-in photo URLs live 10 minutes (AD-9). */
const PHOTO_URL_TTL_S = 600

interface StorageErrorLike {
  message: string
  /** HTTP status; undefined when the request got no response (the fetch threw). */
  status?: number
  statusCode?: string
  code?: string
  error?: string
}

/** storage-js marks its errors with `__isStorageError` (its own `isStorageError` check). */
function isStorageError(error: unknown): error is StorageErrorLike {
  return typeof error === 'object' && error !== null && '__isStorageError' in error
}

/** The private bucket for check-in photos (`{group_id}/{checkin_id}/{1080|360}.webp`). */
const CHECKINS_BUCKET = 'checkins'

/** The private bucket for profile photos (`{user_id}/{version}.webp`, Story 3.6). */
const AVATARS_BUCKET = 'avatars'

/**
 * Whether a Storage upload error means the object is already there (a retried upload whose first
 * response was lost): HTTP 409, or Storage's `Duplicate` / `ResourceAlreadyExists` code.
 */
export function isAlreadyUploaded(error: unknown): boolean {
  if (!isStorageError(error)) return false
  return (
    error.status === 409 ||
    error.statusCode === '409' ||
    error.code === 'ResourceAlreadyExists' ||
    error.error === 'Duplicate' ||
    /already exists/i.test(error.message)
  )
}

/**
 * Maps a Storage upload error onto a `BackendError`: no response at all (the fetch threw, so there
 * is no HTTP status) is `network`; a 403 from the INSERT policy (row-level security: no longer a current member) is
 * `not_member`, which is final; anything else `unknown`.
 */
export function toStorageBackendError(error: unknown): BackendError {
  const message = error instanceof Error ? error.message : String(error)
  const status = isStorageError(error) ? error.status : undefined
  const statusCode = isStorageError(error) ? error.statusCode : undefined
  // Only the INSERT policy's refusal; an auth failure (e.g. an expired token) can also carry 403.
  if ((status === 403 || statusCode === '403') && /row-level security/i.test(message)) {
    return new BackendError('not_member', message)
  }
  if (status === undefined || status === 0) return new BackendError('network', message)
  return new BackendError('unknown', message)
}

/**
 * Maps a PostgREST response error onto a `BackendError`. A request that never got a response comes
 * back with HTTP status 0 (supabase-js turns the fetch failure into an error); an RPC exception whose
 * message is a known AD-14 code becomes that code, keeping the exception's DETAIL (`details`).
 */
function toBackendError(error: PostgrestError, status: number): BackendError {
  if (status === 0) return new BackendError('network', error.message)
  if (isRpcErrorCode(error.message)) {
    return new BackendError(error.message, error.message, error.details || null)
  }
  return new BackendError('unknown', error.message)
}

/** The session's user id for a data read, or a `BackendError` (never a silent empty result). */
async function sessionUserId(read: string): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    const offline = isAuthRetryableFetchError(error) && error.status === 0
    throw new BackendError(offline ? 'network' : 'unknown', error.message)
  }
  const userId = data.session?.user.id
  if (!userId) throw new BackendError('unknown', `No session for the ${read} read`)
  return userId
}

function sessionUser(session: Session | null): AuthUser | null {
  return session?.user ? toAuthUser(session.user) : null
}

/**
 * Maps a supabase-js error onto an `AuthErrorCode`. `rejected` is the code for "the token was
 * refused" in the calling context: Supabase returns one error (`otp_expired`, 403) for a wrong and
 * an expired code, and the app tells them apart by time (src/domain/auth-errors.ts).
 */
function toAuthError(error: unknown, rejected: AuthErrorCode = 'unknown'): AuthError {
  // A fetch that never got a response (offline, DNS, CORS) surfaces as a retryable error, status 0.
  if (isAuthRetryableFetchError(error) && error.status === 0) {
    return new AuthError('network', error.message)
  }
  if (isAuthApiError(error)) {
    if (error.status === 429 || error.code?.startsWith('over_')) {
      return new AuthError('rate_limited', error.message)
    }
    if (
      rejected !== 'unknown' &&
      (error.code === 'otp_expired' || error.status === 403 || error.status === 401)
    ) {
      return new AuthError(rejected, error.message)
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return new AuthError('unknown', message)
}

function requireUser(user: User | null | undefined, rejected: AuthErrorCode): AuthUser {
  if (!user) throw new AuthError(rejected, 'No user in the auth response')
  return toAuthUser(user)
}

/**
 * Uploads one WebP object (no upsert, a year of cache). An object that already exists counts as
 * uploaded (a retry whose first response was lost).
 */
async function uploadWebp(bucket: string, path: string, photo: Blob): Promise<void> {
  let error: unknown
  try {
    const result = await supabase.storage.from(bucket).upload(path, photo, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: '31536000',
    })
    error = result.error
  } catch (thrown) {
    error = thrown
  }
  if (!error || isAlreadyUploaded(error)) return
  throw toStorageBackendError(error)
}

/** 10-minute signed URLs for `paths` in `bucket`, one request; unreadable paths map to null. */
async function signPaths(
  bucket: string,
  paths: readonly string[],
): Promise<Record<string, string | null>> {
  if (paths.length === 0) return {}
  const result = await supabase.storage
    .from(bucket)
    .createSignedUrls([...paths], PHOTO_URL_TTL_S)
    .catch((thrown: unknown) => {
      throw toStorageBackendError(thrown)
    })
  if (result.error) throw toStorageBackendError(result.error)
  const urls: Record<string, string | null> = {}
  for (const path of paths) urls[path] = null
  for (const entry of result.data) {
    if (entry.path && !entry.error && entry.signedUrl) urls[entry.path] = entry.signedUrl
  }
  return urls
}

/**
 * Supabase implementation of `BackendPort`: auth (1.3), profiles (1.4), groups (1.6), invites (1.7),
 * members, leave and remove (1.8), activities (2.1), plan preview and add commitment (2.2), tasks
 * (2.4), Today (2.5), My plan (2.6), check-ins (3.2), avatars (3.6).
 */
export const supabaseBackendAdapter: BackendPort = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw toAuthError(error)
    return sessionUser(data.session)
  },

  onAuthChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(sessionUser(session))
    })
    return () => data.subscription.unsubscribe()
  },

  async sendEmailCode(email, redirectTo) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    })
    if (error) throw toAuthError(error)
  },

  async verifyEmailCode(email, code) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (error) throw toAuthError(error, 'code_rejected')
    return requireUser(data.user, 'code_rejected')
  },

  async verifyEmailLink(tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
    if (error) throw toAuthError(error, 'link_rejected')
    return requireUser(data.user, 'link_rejected')
  },

  async exchangeOAuthCode(code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) throw toAuthError(error)
    return requireUser(data.user, 'unknown')
  },

  async signInWithGoogle(redirectTo) {
    // Plain OAuth redirect (PKCE: the code verifier waits in storage until exchangeOAuthCode).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) throw toAuthError(error)
  },

  async signOut() {
    // This device only: the Safari tab and the installed iOS app hold separate sessions, and signing
    // out of one should not end the other.
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw toAuthError(error)
  },

  async getMyProfile() {
    // Never "no profile" without a session: that would send a member with a profile to /setup.
    const userId = await sessionUserId('profile')
    // Filtered by id even though RLS shows only the own row today: Story 1.6 widens profile reads.
    const { data, error, status } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle()
    if (error) throw toBackendError(error, status)
    return data ? toProfile(data) : null
  },

  async saveProfile(displayName, timeZone) {
    const { data, error, status } = await supabase.rpc('save_profile', {
      p_display_name: displayName,
      p_time_zone: timeZone,
    })
    if (error) throw toBackendError(error, status)
    if (!data) throw new BackendError('unknown', 'save_profile returned no row')
    return toProfile(data)
  },

  async uploadAvatar(path, photo) {
    await uploadWebp(AVATARS_BUCKET, path, photo)
  },

  async setAvatarPath(path) {
    const userId = await sessionUserId('avatar')
    // Own row only (RLS and the Story 1.4 column grant).
    const { data, error, status } = await supabase
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', userId)
      .select(PROFILE_COLUMNS)
      .maybeSingle()
    if (error) throw toBackendError(error, status)
    if (!data) throw new BackendError('unknown', 'avatar_path update returned no row')
    return toProfile(data)
  },

  signAvatarPhotos(paths) {
    return signPaths(AVATARS_BUCKET, paths)
  },

  async setTimeZone(timeZone, groupId) {
    const { data, error, status } = await supabase.rpc('set_time_zone', {
      p_time_zone: timeZone,
      ...(groupId === undefined ? {} : { p_group_id: groupId }),
    })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'set_time_zone returned no row')
    return toTimeZoneState(row)
  },

  async listMyGroups() {
    const userId = await sessionUserId('groups')
    const { data, error, status } = await supabase.from('groups').select(GROUP_COLUMNS)
    if (error) throw toBackendError(error, status)
    return toMyGroups(data ?? [], userId)
  },

  async createGroup(name) {
    const { data, error, status } = await supabase.rpc('create_group', { p_name: name })
    if (error) throw toBackendError(error, status)
    if (!data) throw new BackendError('unknown', 'create_group returned no id')
    return data
  },

  async createInvite(groupId, fresh) {
    const { data, error, status } = await supabase.rpc('create_invite', {
      p_group_id: groupId,
      p_new: fresh,
    })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'create_invite returned no row')
    return { code: row.code, expiresAt: row.expires_at }
  },

  async getInvite(code) {
    const { data, error, status } = await supabase.rpc('get_invite', { p_code: code })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'get_invite returned no row')
    if (!isInviteStatus(row.status)) {
      throw new BackendError('unknown', `get_invite returned status ${row.status}`)
    }
    return {
      groupId: row.group_id,
      groupName: row.group_name,
      adminName: row.admin_display_name,
      memberCount: row.member_count,
      status: row.status,
    }
  },

  async joinGroup(code) {
    const { data, error, status } = await supabase.rpc('join_group', { p_code: code })
    if (error) throw toBackendError(error, status)
    if (!data) throw new BackendError('unknown', 'join_group returned no id')
    return data
  },

  async listMembers(groupId) {
    const { data, error, status } = await supabase
      .from('memberships')
      .select(MEMBER_COLUMNS)
      .eq('group_id', groupId)
      .is('ended_at', null)
      .order('joined_at')
      .order('id')
    if (error) throw toBackendError(error, status)
    return toGroupMembers(data ?? [])
  },

  async leaveGroup(groupId) {
    const { error, status } = await supabase.rpc('leave_group', { p_group_id: groupId })
    if (error) throw toBackendError(error, status)
  },

  async removeMember(groupId, userId) {
    const { error, status } = await supabase.rpc('remove_member', {
      p_group_id: groupId,
      p_user_id: userId,
    })
    if (error) throw toBackendError(error, status)
  },

  async listPresetActivities() {
    const { data, error, status } = await supabase
      .from('preset_activities')
      .select(PRESET_COLUMNS)
      .order('sort')
    if (error) throw toBackendError(error, status)
    return toPresetActivities(data ?? [])
  },

  async listGroupActivities(groupId) {
    const { data, error, status } = await supabase
      .from('group_activity_options')
      .select(GROUP_ACTIVITY_COLUMNS)
      .eq('group_id', groupId)
    if (error) throw toBackendError(error, status)
    return toGroupActivities(data ?? [])
  },

  async planPreview(groupId, target, endDate) {
    const { data, error, status } = await supabase.rpc('plan_preview', {
      p_group_id: groupId,
      ...(target !== null ? { p_target: target } : {}),
      ...(endDate !== null ? { p_end_date: endDate } : {}),
    })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'plan_preview returned no row')
    return toPlanPreview(row)
  },

  async addCommitment(input) {
    const { data, error, status } = await supabase.rpc('add_commitment', toAddCommitmentArgs(input))
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'add_commitment returned no row')
    return { commitmentId: row.commitment_id, startsOn: row.starts_on }
  },

  async addTask(input) {
    const { data, error, status } = await supabase.rpc('add_task', toAddTaskArgs(input))
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'add_task returned no row')
    return { commitmentId: row.commitment_id }
  },

  async getTask(commitmentId) {
    const { data, error, status } = await supabase.rpc('get_task', {
      p_commitment_id: commitmentId,
    })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'get_task returned no row')
    return toTaskDetails(row)
  },

  async renameTask(commitmentId, name) {
    const { error, status } = await supabase.rpc('rename_task', {
      p_commitment_id: commitmentId,
      p_name: name,
    })
    if (error) throw toBackendError(error, status)
  },

  async deleteTask(commitmentId) {
    const { error, status } = await supabase.rpc('delete_task', { p_commitment_id: commitmentId })
    if (error) throw toBackendError(error, status)
  },

  async getTodayItems(groupId) {
    const { data, error, status } = await supabase.rpc('get_today_items', { p_group_id: groupId })
    if (error) throw toBackendError(error, status)
    return toTodayItems(data ?? [])
  },

  async getTodaySummary(groupId) {
    const { data, error, status } = await supabase.rpc('get_today_summary', { p_group_id: groupId })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'get_today_summary returned no row')
    return toTodaySummary(row)
  },

  async getMyPlan(groupId) {
    const { data, error, status } = await supabase.rpc('get_my_plan', { p_group_id: groupId })
    if (error) throw toBackendError(error, status)
    return toMyPlanItems(data ?? [])
  },

  async getCommitment(commitmentId) {
    const { data, error, status } = await supabase.rpc('get_commitment', {
      p_commitment_id: commitmentId,
    })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'get_commitment returned no row')
    return toCommitmentDetails(row)
  },

  async updateCommitment(input) {
    const { data, error, status } = await supabase.rpc(
      'update_commitment',
      toUpdateCommitmentArgs(input),
    )
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'update_commitment returned no row')
    return { changesFrom: row.changes_from }
  },

  async endCommitment(commitmentId) {
    const { data, error, status } = await supabase.rpc('end_commitment', {
      p_commitment_id: commitmentId,
    })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'end_commitment returned no row')
    return { endsAfterWeekStart: row.ends_after_week_start }
  },

  async getCheckinTargets(groupId) {
    const { data, error, status } = await supabase.rpc('get_checkin_targets', {
      p_group_id: groupId,
    })
    if (error) throw toBackendError(error, status)
    return toCheckinTargets(data ?? [])
  },

  async uploadCheckinPhoto(groupId, checkinId, size, photo) {
    await uploadWebp(CHECKINS_BUCKET, checkinPhotoPath(groupId, checkinId, size), photo)
  },

  async postCheckin(input) {
    const { data, error, status } = await supabase.rpc('post_checkin', toPostCheckinArgs(input))
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'post_checkin returned no row')
    return toPostCheckinResult(row)
  },

  async getGroupWeek(groupId) {
    const { data, error, status } = await supabase.rpc('get_group_week', { p_group_id: groupId })
    if (error) throw toBackendError(error, status)
    const row = data?.[0]
    if (!row) throw new BackendError('unknown', 'get_group_week returned no row')
    return toGroupWeek(row)
  },

  async getBoard(groupId, weekStart) {
    const { data, error, status } = await supabase.rpc('get_board', {
      p_group_id: groupId,
      p_week_start: weekStart,
    })
    if (error) throw toBackendError(error, status)
    return toBoard(data ?? [])
  },

  async getWinnerWeek(groupId, weekStart) {
    const { data, error, status } = await supabase.rpc('get_winner_week', {
      p_group_id: groupId,
      // SQL null reads the group's most recent locked week; the generated type misses that.
      p_week_start: weekStart as string,
    })
    if (error) throw toBackendError(error, status)
    return toWinnerWeek(data ?? [])
  },

  async getMemberProfile(groupId, userId) {
    const { data, error, status } = await supabase.rpc('get_member_profile', {
      p_group_id: groupId,
      p_user_id: userId,
    })
    if (error) throw toBackendError(error, status)
    return toMemberProfile(data ?? [])
  },

  async listTitles() {
    const { data, error, status } = await supabase
      .from('titles')
      .select('key, name, min_points')
      .order('min_points', { ascending: true })
    if (error) throw toBackendError(error, status)
    return (data ?? []).map((row): Title => ({
      key: row.key,
      name: row.name,
      minPoints: row.min_points,
    }))
  },

  async listMemberCheckins(groupId, userId, limit) {
    const { data, error, status } = await supabase
      .from('feed_items')
      .select(FEED_COLUMNS)
      .eq('group_id', groupId)
      .eq('item_kind', 'checkin')
      .eq('actor_id', userId)
      .order('sort_at', { ascending: false })
      .order('item_id', { ascending: false })
      .limit(limit)
    if (error) throw toBackendError(error, status)
    return (data ?? []).flatMap((row): FeedCheckin[] => {
      const item = toFeedItem(row)
      return item?.type === 'checkin' ? [item] : []
    })
  },

  async getStreaks(groupId) {
    const { data, error, status } = await supabase.rpc('get_streaks', { p_group_id: groupId })
    if (error) throw toBackendError(error, status)
    return toStreaks(data ?? [])
  },

  async listFeed(groupId, request: FeedRowsRequest) {
    let query = supabase.from('feed_items').select(FEED_COLUMNS).eq('group_id', groupId)
    const newer = request.after !== undefined
    if (request.before) query = query.or(keysetFilter(request.before, 'lt'))
    if (request.after) query = query.or(keysetFilter(request.after, 'gt'))
    const { data, error, status } = await query
      .order('sort_at', { ascending: newer })
      .order('item_id', { ascending: newer })
      .limit(request.limit)
    if (error) throw toBackendError(error, status)
    const rows = data ?? []
    return toFeedRows(newer ? [...rows].reverse() : rows)
  },

  async getFeedCheckin(groupId, checkinId) {
    const { data, error, status } = await supabase
      .from('feed_items')
      .select(FEED_COLUMNS)
      .eq('group_id', groupId)
      .eq('item_kind', 'checkin')
      .eq('item_id', checkinId)
      .maybeSingle()
    if (error) throw toBackendError(error, status)
    return data ? toFeedItem(data) : null
  },

  async listFriendsToday(groupId) {
    const { data, error, status } = await supabase
      .rpc('get_friends_today', { p_group_id: groupId })
      .select(FEED_COLUMNS)
    if (error) throw toBackendError(error, status)
    const items: FeedCheckin[] = []
    for (const row of data ?? []) {
      const item = toFeedItem(row)
      if (item?.type === 'checkin') items.push(item)
    }
    return items
  },

  signCheckinPhotos(paths) {
    return signPaths(CHECKINS_BUCKET, paths)
  },

  checkinPhotoCacheUrl(path) {
    return `${supabaseUrl}/storage/v1/object/sign/${CHECKINS_BUCKET}/${path}`
  },
}
