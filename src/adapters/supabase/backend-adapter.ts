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
import { BackendError, isRpcErrorCode } from '@/domain/error-codes'
import {
  isEndReason,
  isInviteStatus,
  type EndedMembership,
  type GroupMember,
  type GroupRole,
  type MyGroup,
  type MyGroupsSnapshot,
} from '@/domain/groups'
import type { Profile } from '@/domain/profile'
import type { BackendPort } from '@/ports/backend-port'
import { supabase } from '@/adapters/supabase/client'
import type { Tables } from '@/adapters/supabase/database.types'

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

type ProfileRow = Pick<Tables<'profiles'>, 'id' | 'display_name' | 'avatar_path' | 'time_zone'>

const PROFILE_COLUMNS = 'id, display_name, avatar_path, time_zone'

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    timeZone: row.time_zone,
  }
}

type MembershipRow = Pick<
  Tables<'memberships'>,
  'id' | 'user_id' | 'role' | 'joined_at' | 'ended_at' | 'end_reason'
>
type GroupRow = Pick<Tables<'groups'>, 'id' | 'name' | 'time_zone'> & {
  memberships: MembershipRow[]
}

/**
 * Groups with their memberships embedded. RLS returns every group the member was ever in, and for
 * each the member's own rows plus, while they are a current member, everyone's current rows.
 */
const GROUP_COLUMNS =
  'id, name, time_zone, memberships(id, user_id, role, joined_at, ended_at, end_reason)'

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
      role: toRole(mine.role),
      joinedAt: mine.joined_at,
      memberCount: current.length,
    })
  }
  return { groups, ended }
}

type MemberRow = Pick<Tables<'memberships'>, 'id' | 'user_id' | 'role' | 'joined_at'> & {
  profiles: Pick<Tables<'profiles'>, 'display_name'> | null
}

/** A group's current memberships with each member's display name. */
const MEMBER_COLUMNS = 'id, user_id, role, joined_at, profiles(display_name)'

export function toGroupMembers(rows: readonly MemberRow[]): GroupMember[] {
  return rows.map((row) => ({
    membershipId: row.id,
    userId: row.user_id,
    displayName: row.profiles?.display_name ?? '',
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

/**
 * Maps a PostgREST response error onto a `BackendError`. A request that never got a response comes
 * back with HTTP status 0 (supabase-js turns the fetch failure into an error); an RPC exception whose
 * message is a known AD-14 code becomes that code.
 */
function toBackendError(error: PostgrestError, status: number): BackendError {
  if (status === 0) return new BackendError('network', error.message)
  if (isRpcErrorCode(error.message)) return new BackendError(error.message)
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
 * Supabase implementation of `BackendPort`: auth (1.3), profiles (1.4), groups (1.6), invites (1.7),
 * members, leave and remove (1.8), activities (2.1).
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
}
