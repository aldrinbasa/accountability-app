import type { GroupActivity, PresetActivity } from '@/domain/activities'
import type { AuthUser } from '@/domain/auth'
import type { GroupMember, Invite, InvitePreview, MyGroupsSnapshot } from '@/domain/groups'
import type { AddCommitmentInput, AddCommitmentResult, PlanPreview } from '@/domain/plan'
import type { Profile } from '@/domain/profile'

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
}
