import type { GroupActivity, PresetActivity } from '@/domain/activities'
import type { AuthUser } from '@/domain/auth'
import type {
  CheckinPhotoSize,
  CheckinTarget,
  PostCheckinInput,
  PostCheckinResult,
} from '@/domain/checkin'
import type { FeedItem, FeedRows, FeedRowsRequest } from '@/domain/feed'
import type { GroupMember, Invite, InvitePreview, MyGroupsSnapshot } from '@/domain/groups'
import type {
  CommitmentDetails,
  MyPlanItem,
  UpdateCommitmentInput,
  UpdateCommitmentResult,
} from '@/domain/my-plan'
import type {
  AddCommitmentInput,
  AddCommitmentResult,
  AddTaskInput,
  AddTaskResult,
  PlanPreview,
  TaskDetails,
} from '@/domain/plan'
import type { Profile } from '@/domain/profile'
import type { TimeZoneState } from '@/domain/time-zones'
import type { TodayItem, TodaySummary } from '@/domain/today'

/**
 * The app's one backend contract (AD-1). Story 1.3 adds the auth surface; later stories add reads,
 * RPCs and uploads. Implemented in src/adapters/supabase, wired only in src/app/composition.ts.
 *
 * Every auth method rejects with `AuthError` (src/domain/auth.ts) carrying an `AuthErrorCode`.
 * Every data and RPC method rejects with `BackendError` (src/domain/error-codes.ts): an RPC error
 * code from the AD-14 table, `network`, or `unknown`.
 */
export interface BackendPort {
  /** The stored session's user (survives app restarts), or null when signed out. */
  getSession(): Promise<AuthUser | null>
  /** Subscribe to session changes (sign-in, sign-out, other tabs). Returns an unsubscribe function. */
  onAuthChange(callback: (user: AuthUser | null) => void): () => void
  /** Email a 6-digit code (the email is code-only; `redirectTo` is kept for a future link). */
  sendEmailCode(email: string, redirectTo: string): Promise<void>
  /** Verify the 6-digit code from the email. Creates the session in this browser context. */
  verifyEmailCode(email: string, code: string): Promise<AuthUser>
  /** Verify the `token_hash` from the email link. */
  verifyEmailLink(tokenHash: string): Promise<AuthUser>
  /** Finish a Google sign-in: exchange the `code` the OAuth redirect brought back (PKCE). */
  exchangeOAuthCode(code: string): Promise<AuthUser>
  /** Start Google sign-in. Navigates away; Google returns to `redirectTo`. */
  signInWithGoogle(redirectTo: string): Promise<void>
  /** End this device's session. */
  signOut(): Promise<void>

  /** The signed-in member's own profile, or null before Setup. */
  getMyProfile(): Promise<Profile | null>
  /**
   * `save_profile`: creates the caller's profile, or on an existing one changes only the display
   * name (the zone is kept). Resolves with the stored profile.
   */
  saveProfile(displayName: string, timeZone: string): Promise<Profile>
  /**
   * `set_time_zone`: the caller's zone (no `groupId`) or a group's zone (admin only), from the next
   * Monday; the current zone clears a waiting change. Resolves with the row's zones after the change.
   * Rejects with `invalid_time_zone`, `profile_required`, `not_member` or `not_admin`.
   */
  setTimeZone(timeZone: string, groupId?: string): Promise<TimeZoneState>

  /**
   * The signed-in member's current groups, each with its member count, plus the groups they are no
   * longer in (latest ended membership each, for the stale-link Empty state and the removed notice).
   */
  listMyGroups(): Promise<MyGroupsSnapshot>
  /** `create_group`: a new group with the caller as admin and their profile zone. Resolves with its id. */
  createGroup(name: string): Promise<string>

  /**
   * `create_invite` (admin only): the group's newest unexpired invite, or a new one when `fresh` is
   * true or none is left. Rejects with `not_admin` / `not_member`.
   */
  createInvite(groupId: string, fresh: boolean): Promise<Invite>
  /** `get_invite`: what a code leads to. Rejects with `invite_not_found` for an unknown code. */
  getInvite(code: string): Promise<InvitePreview>
  /**
   * `join_group`: joins with a code and resolves with the group id (unchanged for a current
   * member). Rejects with `invite_expired`, `group_full`, `invite_not_found` or `profile_required`.
   */
  joinGroup(code: string): Promise<string>

  /** A group's current members with display names, in handover order (earliest joined first). */
  listMembers(groupId: string): Promise<GroupMember[]>
  /** `leave_group`: ends the caller's membership. Rejects with `not_member`. */
  leaveGroup(groupId: string): Promise<void>
  /**
   * `remove_member` (admin only): ends another member's membership. Rejects with `not_admin`,
   * `cannot_remove_self` or `not_member`.
   */
  removeMember(groupId: string, userId: string): Promise<void>

  /** The 20 global preset activities, in display order (`preset_activities` by `sort`). */
  listPresetActivities(): Promise<PresetActivity[]>
  /**
   * A group's activities (`group_activity_options`): its preset rows and its members' custom
   * activities. Current members only (RLS); anyone else reads an empty list.
   */
  listGroupActivities(groupId: string): Promise<GroupActivity[]>

  /**
   * `plan_preview`: the member's today, current week, a new commitment's first Monday, the earliest
   * end date and, for a times-per-week `target` with an `endDate` that cuts the last week short, its
   * pro-rated target. Rejects with `not_member` or `invalid_plan`.
   */
  planPreview(groupId: string, target: number | null, endDate: string | null): Promise<PlanPreview>
  /**
   * `add_commitment`: starts next Monday in the member's zone. Rejects with `not_member`,
   * `invalid_plan`, `invalid_activity`, `invalid_end_date` or `schedule_type_locked`.
   */
  addCommitment(input: AddCommitmentInput): Promise<AddCommitmentResult>

  /**
   * `add_task`: a one-off task that counts this week at once (its single session is written now).
   * Rejects with `not_member`, `invalid_plan` (name), `invalid_deadline` or `invalid_activity`.
   */
  addTask(input: AddTaskInput): Promise<AddTaskResult>
  /** `get_task`: one of the caller's own tasks for edit mode. Rejects with `not_found`. */
  getTask(commitmentId: string): Promise<TaskDetails>
  /**
   * `rename_task`: until the task's session ends. Rejects with `not_found`, `invalid_plan` or
   * `task_locked`.
   */
  renameTask(commitmentId: string, name: string): Promise<void>
  /** `delete_task`: before the deadline day starts. Rejects with `not_found` or `task_locked`. */
  deleteTask(commitmentId: string): Promise<void>

  /**
   * `get_today_items`: the member's Today rows in a group, each placed by the server in
   * `due_today`, `this_week` or `starts_next_week`, in display order. Rejects with `not_member`.
   */
  getTodayItems(groupId: string): Promise<TodayItem[]>
  /**
   * `get_today_summary`: the member-local today and week, the week number and this week's planned,
   * done and left counts. Rejects with `not_member`.
   */
  getTodaySummary(groupId: string): Promise<TodaySummary>

  /**
   * `get_my_plan`: the member's commitments and tasks in a group, each with the server's section
   * (`current` / `past`), state and dates, in display order. Rejects with `not_member`.
   */
  getMyPlan(groupId: string): Promise<MyPlanItem[]>
  /** `get_commitment`: one of the caller's own commitments for edit mode. Rejects with `not_found`. */
  getCommitment(commitmentId: string): Promise<CommitmentDetails>
  /**
   * `update_commitment`: a new version from the member's next Monday (replacing a pending one).
   * Rejects with `not_found`, `commitment_ended`, `invalid_plan` or `invalid_end_date`.
   */
  updateCommitment(input: UpdateCommitmentInput): Promise<UpdateCommitmentResult>
  /**
   * `end_commitment`: sessions continue through this Sunday (a commitment that has not started
   * ends at once). Resolves with the last week that has sessions' Monday. Rejects with `not_found`
   * or `commitment_ended`.
   */
  endCommitment(commitmentId: string): Promise<{ endsAfterWeekStart: string }>

  /**
   * `get_checkin_targets`: what the camera's picker lists for the member in a group, due today first,
   * each with the server's won't-count reason. Rejects with `not_member`.
   */
  getCheckinTargets(groupId: string): Promise<CheckinTarget[]>
  /**
   * Uploads one WebP rendition to `checkins/{groupId}/{checkinId}/{size}.webp` (no upsert). An object
   * that already exists counts as uploaded. Rejects with `network` or `unknown`.
   */
  uploadCheckinPhoto(
    groupId: string,
    checkinId: string,
    size: CheckinPhotoSize,
    photo: Blob,
  ): Promise<void>
  /**
   * `post_checkin`: the server sets the timing, matches a session (or stores an extra) and returns
   * the week's counts. The same id and payload again return the stored result. Rejects with
   * `bad_capture_time`, `not_member`, `commitment_ended`, `week_locked`, `photo_missing`,
   * `checkin_conflict` or `invalid_caption`.
   */
  postCheckin(input: PostCheckinInput): Promise<PostCheckinResult>

  /**
   * `feed_items` of a group (check-ins the caller may see and membership events), keyset paged on
   * (`sort_at`, `item_id`), returned newest first: older than `before` or newer than `after`. Items
   * of kinds the app does not render yet are dropped (the cursors still cover them).
   */
  listFeed(groupId: string, request: FeedRowsRequest): Promise<FeedRows>
  /** One check-in of the group's feed, or null when it is gone, hidden or in another group. */
  getFeedCheckin(groupId: string, checkinId: string): Promise<FeedItem | null>
  /**
   * 10-minute signed URLs for check-in photo object paths (one request for all). A path the caller
   * may not read maps to null.
   */
  signCheckinPhotos(paths: readonly string[]): Promise<Record<string, string | null>>
  /**
   * The token-less URL of a check-in photo object: the service worker's photo cache key. Only that
   * cache can answer it (used offline).
   */
  checkinPhotoCacheUrl(path: string): string
}
