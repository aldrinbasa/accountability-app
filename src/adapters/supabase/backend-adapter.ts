import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type PostgrestError,
  type Session,
  type User,
} from '@supabase/supabase-js'
import { AuthError, type AuthErrorCode, type AuthUser } from '@/domain/auth'
import { BackendError, isRpcErrorCode } from '@/domain/error-codes'
import type { GroupRole, MyGroup } from '@/domain/groups'
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

type MembershipRow = Pick<Tables<'memberships'>, 'user_id' | 'role' | 'joined_at' | 'ended_at'>
type GroupRow = Pick<Tables<'groups'>, 'id' | 'name' | 'time_zone'> & {
  memberships: MembershipRow[]
}

/**
 * Groups with their memberships embedded. RLS returns every group the member was ever in, and for
 * each the member's own rows plus, while they are a current member, everyone's current rows.
 */
const GROUP_COLUMNS = 'id, name, time_zone, memberships(user_id, role, joined_at, ended_at)'

/** Keeps the groups where `userId` has a current membership, with the count of current members. */
export function toMyGroups(rows: readonly GroupRow[], userId: string): MyGroup[] {
  const groups: MyGroup[] = []
  for (const row of rows) {
    const current = row.memberships.filter((m) => m.ended_at === null)
    const mine = current.find((m) => m.user_id === userId)
    if (!mine) continue
    const role: GroupRole = mine.role === 'admin' ? 'admin' : 'member'
    groups.push({
      id: row.id,
      name: row.name,
      timeZone: row.time_zone,
      role,
      joinedAt: mine.joined_at,
      memberCount: current.length,
    })
  }
  return groups
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

/** Supabase implementation of `BackendPort`: auth (1.3), profiles (1.4), groups (1.6). */
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
}
