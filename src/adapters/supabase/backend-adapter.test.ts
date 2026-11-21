import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import type { AuthErrorCode } from '@/domain/auth'
import type { BackendErrorCode } from '@/domain/error-codes'
import {
  givenNameOf,
  keysetFilter,
  supabaseBackendAdapter as adapter,
  toFeedItem,
  toFeedRows,
} from '@/adapters/supabase/backend-adapter'
import type { Tables } from '@/adapters/supabase/database.types'

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
}))

// A chainable stand-in for supabase.from(...).select(...).eq(...).maybeSingle().
const db = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    or: vi.fn(),
    limit: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.update.mockReturnValue(query)
  query.or.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.is.mockReturnValue(query)
  return { query, from: vi.fn(() => query), rpc: vi.fn() }
})

// supabase.storage.from(bucket).upload(path, body, options).
const storage = vi.hoisted(() => {
  const bucket = { upload: vi.fn(), createSignedUrls: vi.fn() }
  return { bucket, from: vi.fn(() => bucket) }
})

vi.mock('@/adapters/supabase/client', () => ({
  supabase: { auth, from: db.from, rpc: db.rpc, storage: { from: storage.from } },
  supabaseUrl: 'https://proj.supabase.co',
}))

const USER = { id: 'user-1', email: 'jo@example.com' }
const expired = () => new AuthApiError('Token has expired or is invalid', 403, 'otp_expired')

async function codeOf(promise: Promise<unknown>): Promise<AuthErrorCode> {
  try {
    await promise
  } catch (error) {
    return (error as { code: AuthErrorCode }).code
  }
  throw new Error('expected a rejection')
}

beforeEach(() => {
  auth.signInWithOtp.mockReset()
  auth.verifyOtp.mockReset()
  auth.getSession.mockReset()
  db.query.maybeSingle.mockReset()
  db.rpc.mockReset()
})

describe('supabaseBackendAdapter error mapping', () => {
  it('403 otp_expired → code_rejected for the code, link_rejected for the link', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: expired() })
    expect(await codeOf(adapter.verifyEmailCode('jo@example.com', '123456'))).toBe('code_rejected')
    expect(await codeOf(adapter.verifyEmailLink('hash'))).toBe('link_rejected')
  })

  it('429 and over_email_send_rate_limit → rate_limited', async () => {
    auth.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError('Too many requests', 429, undefined),
    })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'rate_limited',
    )
    auth.signInWithOtp.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError('Slow down', 400, 'over_email_send_rate_limit'),
    })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'rate_limited',
    )
  })

  it('a fetch that never got a response (status 0) → network', async () => {
    auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'network',
    )
    auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    expect(await codeOf(adapter.verifyEmailCode('jo@example.com', '123456'))).toBe('network')
  })

  it('a 403 on send is not a rejected token → unknown', async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: expired() })
    expect(await codeOf(adapter.sendEmailCode('jo@example.com', 'https://a.test/signin'))).toBe(
      'unknown',
    )
  })

  it('no user in a successful response → the rejected code', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null })
    expect(await codeOf(adapter.verifyEmailCode('jo@example.com', '123456'))).toBe('code_rejected')
    expect(await codeOf(adapter.verifyEmailLink('hash'))).toBe('link_rejected')
  })

  it('maps the user and passes the redirect through', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: USER, session: {} }, error: null })
    await expect(adapter.verifyEmailCode('jo@example.com', '123456')).resolves.toEqual(USER)
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'jo@example.com',
      token: '123456',
      type: 'email',
    })

    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null })
    await adapter.sendEmailCode('jo@example.com', 'https://a.test/signin?next=%2Ftoday')
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'jo@example.com',
      options: { emailRedirectTo: 'https://a.test/signin?next=%2Ftoday', shouldCreateUser: true },
    })
  })
})

describe('givenNameOf', () => {
  it('prefers given_name, then the first word of full_name or name', () => {
    expect(givenNameOf({ given_name: 'Josephine', full_name: 'Jo Cruz' })).toBe('Josephine')
    expect(givenNameOf({ full_name: '  Jo Cruz ' })).toBe('Jo')
    expect(givenNameOf({ name: 'Marco Polo' })).toBe('Marco')
    expect(givenNameOf({ given_name: '  ', name: 'Marco' })).toBe('Marco')
  })

  it('has none for email sign-ins', () => {
    expect(givenNameOf({})).toBeNull()
    expect(givenNameOf(undefined)).toBeNull()
    expect(givenNameOf({ given_name: 42 })).toBeNull()
  })

  it('puts it on the signed-in user', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: { ...USER, user_metadata: { given_name: 'Jo' } }, session: {} },
      error: null,
    })
    await expect(adapter.verifyEmailCode('jo@example.com', '123456')).resolves.toEqual({
      ...USER,
      givenName: 'Jo',
    })
  })
})

async function backendCodeOf(promise: Promise<unknown>): Promise<BackendErrorCode> {
  try {
    await promise
  } catch (error) {
    return (error as { code: BackendErrorCode }).code
  }
  throw new Error('expected a rejection')
}

const ROW = {
  id: 'user-1',
  display_name: 'Jo',
  avatar_path: null,
  time_zone: 'Asia/Manila',
  pending_time_zone: 'Europe/London',
  pending_week_start: '2026-11-23',
}
const PROFILE = {
  id: 'user-1',
  displayName: 'Jo',
  avatarPath: null,
  timeZone: 'Asia/Manila',
  pendingTimeZone: 'Europe/London',
  pendingWeekStart: '2026-11-23',
}
const pgError = (message: string) => ({ message, code: 'P0001', details: '', hint: '' })

describe('avatars (Story 3.6)', () => {
  it('uploads the avatar to the avatars bucket at its path, no upsert; a duplicate counts as done', async () => {
    const photo = new Blob(['x'], { type: 'image/webp' })
    storage.bucket.upload.mockReset()
    storage.from.mockClear()
    storage.bucket.upload.mockResolvedValueOnce({ data: { path: 'p' }, error: null })
    await adapter.uploadAvatar('user-1/v1.webp', photo)
    expect(storage.from).toHaveBeenCalledWith('avatars')
    expect(storage.bucket.upload).toHaveBeenCalledWith(
      'user-1/v1.webp',
      photo,
      expect.objectContaining({ contentType: 'image/webp', upsert: false }),
    )
    storage.bucket.upload.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('The resource already exists'), {
        __isStorageError: true,
        status: 409,
      }),
    })
    await expect(adapter.uploadAvatar('user-1/v1.webp', photo)).resolves.toBeUndefined()
    storage.bucket.upload.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await backendCodeOf(adapter.uploadAvatar('user-1/v1.webp', photo))).toBe('network')
  })

  it("sets the own row's avatar_path and returns the stored profile", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({
      data: { ...ROW, avatar_path: 'user-1/v1.webp' },
      error: null,
      status: 200,
    })
    await expect(adapter.setAvatarPath('user-1/v1.webp')).resolves.toEqual({
      ...PROFILE,
      avatarPath: 'user-1/v1.webp',
    })
    expect(db.from).toHaveBeenCalledWith('profiles')
    expect(db.query.update).toHaveBeenCalledWith({ avatar_path: 'user-1/v1.webp' })
    expect(db.query.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('signs avatar paths in the avatars bucket', async () => {
    storage.from.mockClear()
    storage.bucket.createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: 'u/v.webp', signedUrl: 'https://x/sign/avatars/u/v.webp?token=a', error: null },
      ],
      error: null,
    })
    await expect(adapter.signAvatarPhotos(['u/v.webp'])).resolves.toEqual({
      'u/v.webp': 'https://x/sign/avatars/u/v.webp?token=a',
    })
    expect(storage.from).toHaveBeenCalledWith('avatars')
  })
})

describe('profiles', () => {
  it('reads the own row by the session user id', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({ data: ROW, error: null, status: 200 })
    await expect(adapter.getMyProfile()).resolves.toEqual(PROFILE)
    expect(db.from).toHaveBeenCalledWith('profiles')
    expect(db.query.select).toHaveBeenCalledWith(
      'id, display_name, avatar_path, time_zone, pending_time_zone, pending_week_start',
    )
    expect(db.query.eq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('no row (before Setup) → null', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({ data: null, error: null, status: 200 })
    await expect(adapter.getMyProfile()).resolves.toBeNull()
  })

  it('no session → unknown, never null', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('unknown')
  })

  it('a getSession error → network when no response came back, else unknown', async () => {
    auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('network')
    auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('unknown')
    expect(db.query.maybeSingle).not.toHaveBeenCalled()
  })

  it('a read that never got a response → network', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.getMyProfile())).toBe('network')
  })

  it('save_profile passes name and zone and maps the returned row', async () => {
    db.rpc.mockResolvedValue({ data: ROW, error: null, status: 200 })
    await expect(adapter.saveProfile('Jo', 'Asia/Manila')).resolves.toEqual(PROFILE)
    expect(db.rpc).toHaveBeenCalledWith('save_profile', {
      p_display_name: 'Jo',
      p_time_zone: 'Asia/Manila',
    })
  })

  it('maps RPC error codes from the message; anything else is unknown', async () => {
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: pgError('invalid_display_name'),
      status: 400,
    })
    expect(await backendCodeOf(adapter.saveProfile(' ', 'UTC'))).toBe('invalid_display_name')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_time_zone'), status: 400 })
    expect(await backendCodeOf(adapter.saveProfile('Jo', 'Mars/Base'))).toBe('invalid_time_zone')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('boom'), status: 500 })
    expect(await backendCodeOf(adapter.saveProfile('Jo', 'UTC'))).toBe('unknown')
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.saveProfile('Jo', 'UTC'))).toBe('network')
  })
  it('set_time_zone sends the zone (and the group only when given) and maps the returned row', async () => {
    const row = {
      time_zone: 'Europe/London',
      pending_time_zone: 'America/New_York',
      pending_week_start: '2026-11-23',
    }
    const state = {
      timeZone: 'Europe/London',
      pendingTimeZone: 'America/New_York',
      pendingWeekStart: '2026-11-23',
    }
    db.rpc.mockResolvedValueOnce({ data: [row], error: null, status: 200 })
    await expect(adapter.setTimeZone('America/New_York')).resolves.toEqual(state)
    expect(db.rpc).toHaveBeenLastCalledWith('set_time_zone', { p_time_zone: 'America/New_York' })
    db.rpc.mockResolvedValueOnce({ data: [row], error: null, status: 200 })
    await expect(adapter.setTimeZone('America/New_York', 'g1')).resolves.toEqual(state)
    expect(db.rpc).toHaveBeenLastCalledWith('set_time_zone', {
      p_time_zone: 'America/New_York',
      p_group_id: 'g1',
    })
    db.rpc.mockResolvedValueOnce({
      data: [{ time_zone: 'Europe/London', pending_time_zone: null, pending_week_start: null }],
      error: null,
      status: 200,
    })
    await expect(adapter.setTimeZone('Europe/London')).resolves.toEqual({
      timeZone: 'Europe/London',
      pendingTimeZone: null,
      pendingWeekStart: null,
    })
  })

  it('set_time_zone maps its error codes, no response and an empty result', async () => {
    for (const code of ['invalid_time_zone', 'profile_required', 'not_member', 'not_admin']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.setTimeZone('Mars/Base', 'g1'))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.setTimeZone('UTC'))).toBe('network')
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.setTimeZone('UTC'))).toBe('unknown')
  })
})

describe('groups', () => {
  const member = (
    user_id: string,
    role: string,
    ended_at: string | null = null,
    end_reason: string | null = ended_at ? 'left' : null,
    id = `m-${user_id}-${ended_at ?? 'current'}`,
  ) => ({
    id,
    user_id,
    role,
    joined_at: '2026-11-01T10:00:00+00:00',
    ended_at,
    end_reason,
  })

  it('lists current groups with role, join time and current member count, and ended ones', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.select.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            id: 'g1',
            name: 'Gym Rats',
            time_zone: 'Asia/Manila',
            pending_time_zone: 'Europe/London',
            pending_week_start: '2026-11-23',
            memberships: [
              member('user-1', 'admin'),
              member('user-2', 'member'),
              member('user-3', 'member', '2026-11-02T00:00:00+00:00'),
            ],
          },
          // Ended for the caller: RLS still shows the group and their own ended row.
          {
            id: 'g2',
            name: 'Old crew',
            time_zone: 'UTC',
            pending_time_zone: null,
            pending_week_start: null,
            memberships: [
              member('user-1', 'member', '2026-11-03T00:00:00+00:00', 'left', 'm-old'),
              member('user-1', 'member', '2026-11-05T00:00:00+00:00', 'removed', 'm-last'),
            ],
          },
          // Left once and back in: current, not ended.
          {
            id: 'g3',
            name: 'Back again',
            time_zone: 'UTC',
            pending_time_zone: null,
            pending_week_start: null,
            memberships: [
              member('user-1', 'member', '2026-11-03T00:00:00+00:00'),
              member('user-1', 'member'),
            ],
          },
        ],
        error: null,
        status: 200,
      }),
    )
    await expect(adapter.listMyGroups()).resolves.toEqual({
      groups: [
        {
          id: 'g1',
          name: 'Gym Rats',
          timeZone: 'Asia/Manila',
          pendingTimeZone: 'Europe/London',
          pendingWeekStart: '2026-11-23',
          role: 'admin',
          joinedAt: '2026-11-01T10:00:00+00:00',
          memberCount: 2,
        },
        {
          id: 'g3',
          name: 'Back again',
          timeZone: 'UTC',
          pendingTimeZone: null,
          pendingWeekStart: null,
          role: 'member',
          joinedAt: '2026-11-01T10:00:00+00:00',
          memberCount: 1,
        },
      ],
      ended: [
        {
          membershipId: 'm-last',
          groupId: 'g2',
          name: 'Old crew',
          endReason: 'removed',
          endedAt: '2026-11-05T00:00:00+00:00',
        },
      ],
    })
    expect(db.from).toHaveBeenCalledWith('groups')
  })

  it('a groups read that never got a response → network; no session → unknown', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.select.mockReturnValueOnce(
      Promise.resolve({
        data: null,
        error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
        status: 0,
      }),
    )
    expect(await backendCodeOf(adapter.listMyGroups())).toBe('network')
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await backendCodeOf(adapter.listMyGroups())).toBe('unknown')
  })

  it('create_group passes the name, returns the id and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: 'g9', error: null, status: 200 })
    await expect(adapter.createGroup('Gym Rats')).resolves.toBe('g9')
    expect(db.rpc).toHaveBeenCalledWith('create_group', { p_name: 'Gym Rats' })
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_group_name'), status: 400 })
    expect(await backendCodeOf(adapter.createGroup(' '))).toBe('invalid_group_name')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('profile_required'), status: 400 })
    expect(await backendCodeOf(adapter.createGroup('x'))).toBe('profile_required')
  })
})

describe('invites', () => {
  it('create_invite passes the group and fresh flag and maps the row', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [{ code: 'K7QX2M', expires_at: '2026-11-24T10:00:00+00:00' }],
      error: null,
      status: 200,
    })
    await expect(adapter.createInvite('g1', false)).resolves.toEqual({
      code: 'K7QX2M',
      expiresAt: '2026-11-24T10:00:00+00:00',
    })
    expect(db.rpc).toHaveBeenCalledWith('create_invite', { p_group_id: 'g1', p_new: false })

    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_admin'), status: 400 })
    expect(await backendCodeOf(adapter.createInvite('g1', true))).toBe('not_admin')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.createInvite('g1', true))).toBe('not_member')
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.createInvite('g1', true))).toBe('unknown')
  })

  it('get_invite maps the preview; an unknown code and an unknown status are errors', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          group_id: 'g9',
          group_name: 'Sunday Reset',
          admin_display_name: 'Sam',
          member_count: 3,
          status: 'valid',
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.getInvite('K7QX2M')).resolves.toEqual({
      groupId: 'g9',
      groupName: 'Sunday Reset',
      adminName: 'Sam',
      memberCount: 3,
      status: 'valid',
    })
    expect(db.rpc).toHaveBeenCalledWith('get_invite', { p_code: 'K7QX2M' })

    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('invite_not_found'), status: 400 })
    expect(await backendCodeOf(adapter.getInvite('ZZZZZZ'))).toBe('invite_not_found')
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          group_id: 'g9',
          group_name: 'x',
          admin_display_name: 'y',
          member_count: 1,
          status: 'odd',
        },
      ],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.getInvite('K7QX2M'))).toBe('unknown')
  })

  it('join_group returns the group id and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: 'g9', error: null, status: 200 })
    await expect(adapter.joinGroup('K7QX2M')).resolves.toBe('g9')
    expect(db.rpc).toHaveBeenCalledWith('join_group', { p_code: 'K7QX2M' })
    for (const code of ['invite_expired', 'group_full', 'invite_not_found', 'profile_required']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.joinGroup('K7QX2M'))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.joinGroup('K7QX2M'))).toBe('network')
  })
})

describe('members, leave and remove', () => {
  it("lists a group's current members with display names, in handover order", async () => {
    db.query.order.mockReturnValueOnce(db.query).mockResolvedValueOnce({
      data: [
        {
          id: 'm1',
          user_id: 'user-1',
          role: 'admin',
          joined_at: '2026-11-01T10:00:00+00:00',
          profiles: { display_name: 'Jo', avatar_path: 'user-1/v1.webp' },
        },
        {
          id: 'm2',
          user_id: 'user-2',
          role: 'member',
          joined_at: '2026-11-02T10:00:00+00:00',
          profiles: { display_name: 'Sam', avatar_path: null },
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.listMembers('g1')).resolves.toEqual([
      {
        membershipId: 'm1',
        userId: 'user-1',
        displayName: 'Jo',
        avatarPath: 'user-1/v1.webp',
        role: 'admin',
        joinedAt: '2026-11-01T10:00:00+00:00',
      },
      {
        membershipId: 'm2',
        userId: 'user-2',
        displayName: 'Sam',
        avatarPath: null,
        role: 'member',
        joinedAt: '2026-11-02T10:00:00+00:00',
      },
    ])
    expect(db.from).toHaveBeenCalledWith('memberships')
    expect(db.query.eq).toHaveBeenCalledWith('group_id', 'g1')
    expect(db.query.is).toHaveBeenCalledWith('ended_at', null)
    expect(db.query.order).toHaveBeenNthCalledWith(1, 'joined_at')
    expect(db.query.order).toHaveBeenNthCalledWith(2, 'id')
  })

  it('leave_group passes the group id and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await expect(adapter.leaveGroup('g1')).resolves.toBeUndefined()
    expect(db.rpc).toHaveBeenCalledWith('leave_group', { p_group_id: 'g1' })
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.leaveGroup('g1'))).toBe('not_member')
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.leaveGroup('g1'))).toBe('network')
  })

  it('remove_member passes the group and user ids and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await expect(adapter.removeMember('g1', 'user-2')).resolves.toBeUndefined()
    expect(db.rpc).toHaveBeenCalledWith('remove_member', { p_group_id: 'g1', p_user_id: 'user-2' })
    for (const code of ['not_admin', 'cannot_remove_self', 'not_member']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.removeMember('g1', 'user-2'))).toBe(code)
    }
  })
})

describe('activities', () => {
  it('lists the presets ordered by sort', async () => {
    db.query.order.mockResolvedValueOnce({
      data: [
        { key: 'gym', name: 'Gym', category: 'fitness', sort: 1 },
        { key: 'study', name: 'Study', category: 'mind', sort: 6 },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.listPresetActivities()).resolves.toEqual([
      { key: 'gym', name: 'Gym', category: 'fitness', sort: 1 },
      { key: 'study', name: 'Study', category: 'mind', sort: 6 },
    ])
    expect(db.from).toHaveBeenCalledWith('preset_activities')
    expect(db.query.order).toHaveBeenCalledWith('sort')
  })

  it('a preset with an unknown category is an error; no response → network', async () => {
    db.query.order.mockResolvedValueOnce({
      data: [{ key: 'gym', name: 'Gym', category: 'cardio', sort: 1 }],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.listPresetActivities())).toBe('unknown')
    db.query.order.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.listPresetActivities())).toBe('network')
  })

  it("lists a group's activities from group_activity_options", async () => {
    db.query.eq.mockResolvedValueOnce({
      data: [
        {
          id: 'a1',
          group_id: 'g1',
          preset_key: 'gym',
          custom_name: null,
          created_by: 'user-1',
          locked_schedule_type: 'times_per_week',
        },
        {
          id: 'a2',
          group_id: 'g1',
          preset_key: null,
          custom_name: 'Pottery',
          created_by: 'user-2',
          locked_schedule_type: null,
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.listGroupActivities('g1')).resolves.toEqual([
      {
        id: 'a1',
        groupId: 'g1',
        presetKey: 'gym',
        customName: null,
        createdBy: 'user-1',
        lockedScheduleType: 'times_per_week',
      },
      {
        id: 'a2',
        groupId: 'g1',
        presetKey: null,
        customName: 'Pottery',
        createdBy: 'user-2',
        lockedScheduleType: null,
      },
    ])
    expect(db.from).toHaveBeenCalledWith('group_activity_options')
    expect(db.query.eq).toHaveBeenCalledWith('group_id', 'g1')
  })

  it('a group activity with an unknown schedule type is an error; no response → network', async () => {
    db.query.eq.mockResolvedValueOnce({
      data: [
        {
          id: 'a1',
          group_id: 'g1',
          preset_key: 'gym',
          custom_name: null,
          created_by: 'user-1',
          locked_schedule_type: 'daily',
        },
      ],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.listGroupActivities('g1'))).toBe('unknown')
    db.query.eq.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.listGroupActivities('g1'))).toBe('network')
  })
})

describe('plan', () => {
  const PREVIEW_ROW = {
    member_today: '2026-11-18',
    week_start: '2026-11-16',
    week_end: '2026-11-22',
    starts_on: '2026-11-23',
    min_end_date: '2026-11-29',
    last_week_target: 2,
  }

  it('plan_preview sends only the inputs it has and maps the row', async () => {
    db.rpc.mockResolvedValueOnce({ data: [PREVIEW_ROW], error: null, status: 200 })
    expect(await adapter.planPreview('g1', 3, '2026-12-04')).toEqual({
      memberToday: '2026-11-18',
      weekStart: '2026-11-16',
      weekEnd: '2026-11-22',
      startsOn: '2026-11-23',
      minEndDate: '2026-11-29',
      lastWeekTarget: 2,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('plan_preview', {
      p_group_id: 'g1',
      p_target: 3,
      p_end_date: '2026-12-04',
    })
    db.rpc.mockResolvedValueOnce({
      data: [{ ...PREVIEW_ROW, last_week_target: null }],
      error: null,
      status: 200,
    })
    expect((await adapter.planPreview('g1', null, null)).lastWeekTarget).toBeNull()
    expect(db.rpc).toHaveBeenLastCalledWith('plan_preview', { p_group_id: 'g1' })
  })

  it('plan_preview maps its error codes; no row is an error', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.planPreview('g1', null, null))).toBe('not_member')
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.planPreview('g1', null, null))).toBe('unknown')
  })

  it('add_commitment sends the activity and only the schedule fields of its type', async () => {
    db.rpc.mockResolvedValue({
      data: [{ commitment_id: 'c1', starts_on: '2026-11-23' }],
      error: null,
      status: 200,
    })
    expect(
      await adapter.addCommitment({
        groupId: 'g1',
        activity: { kind: 'preset', presetKey: 'gym' },
        scheduleType: 'times_per_week',
        days: null,
        target: 3,
        endDate: '2026-12-04',
      }),
    ).toEqual({ commitmentId: 'c1', startsOn: '2026-11-23' })
    expect(db.rpc).toHaveBeenLastCalledWith('add_commitment', {
      p_group_id: 'g1',
      p_preset_key: 'gym',
      p_schedule_type: 'times_per_week',
      p_target: 3,
      p_end_date: '2026-12-04',
    })
    await adapter.addCommitment({
      groupId: 'g1',
      activity: { kind: 'group', groupActivityId: 'ga-1' },
      scheduleType: 'fixed_days',
      days: [1, 3],
      target: null,
      endDate: null,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('add_commitment', {
      p_group_id: 'g1',
      p_group_activity_id: 'ga-1',
      p_schedule_type: 'fixed_days',
      p_days: [1, 3],
    })
    await adapter.addCommitment({
      groupId: 'g1',
      activity: { kind: 'custom', name: 'Pottery' },
      scheduleType: 'fixed_days',
      days: [7],
      target: null,
      endDate: null,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('add_commitment', {
      p_group_id: 'g1',
      p_custom_name: 'Pottery',
      p_schedule_type: 'fixed_days',
      p_days: [7],
    })
    db.rpc.mockReset()
  })

  it('add_commitment maps its error codes; no response → network', async () => {
    const input = {
      groupId: 'g1',
      activity: { kind: 'preset', presetKey: 'gym' } as const,
      scheduleType: 'fixed_days' as const,
      days: [1],
      target: null,
      endDate: null,
    }
    for (const code of [
      'not_member',
      'invalid_plan',
      'invalid_activity',
      'invalid_end_date',
      'schedule_type_locked',
    ]) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.addCommitment(input))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.addCommitment(input))).toBe('network')
  })
})

describe('tasks', () => {
  const TASK_ROW = {
    commitment_id: 't1',
    group_id: 'g1',
    preset_key: 'groceries',
    custom_name: null,
    name: 'Grocery run',
    deadline: '2026-11-22',
    can_delete: true,
    can_rename: true,
  }

  it('add_task sends the one activity field, the name and the deadline', async () => {
    db.rpc.mockResolvedValue({ data: [{ commitment_id: 't1' }], error: null, status: 200 })
    expect(
      await adapter.addTask({
        groupId: 'g1',
        activity: { kind: 'preset', presetKey: 'groceries' },
        name: 'Grocery run',
        deadline: '2026-11-22',
      }),
    ).toEqual({ commitmentId: 't1' })
    expect(db.rpc).toHaveBeenLastCalledWith('add_task', {
      p_group_id: 'g1',
      p_preset_key: 'groceries',
      p_name: 'Grocery run',
      p_deadline: '2026-11-22',
    })
    await adapter.addTask({
      groupId: 'g1',
      activity: { kind: 'group', groupActivityId: 'ga-1' },
      name: 'Leg day',
      deadline: '2026-11-20',
    })
    expect(db.rpc).toHaveBeenLastCalledWith('add_task', {
      p_group_id: 'g1',
      p_group_activity_id: 'ga-1',
      p_name: 'Leg day',
      p_deadline: '2026-11-20',
    })
    await adapter.addTask({
      groupId: 'g1',
      activity: { kind: 'custom', name: 'Errands' },
      name: 'Post office',
      deadline: '2026-11-21',
    })
    expect(db.rpc).toHaveBeenLastCalledWith('add_task', {
      p_group_id: 'g1',
      p_custom_name: 'Errands',
      p_name: 'Post office',
      p_deadline: '2026-11-21',
    })
    db.rpc.mockReset()
  })

  it('add_task maps its error codes; no row is an error', async () => {
    const input = {
      groupId: 'g1',
      activity: { kind: 'preset', presetKey: 'groceries' } as const,
      name: 'Grocery run',
      deadline: '2026-11-22',
    }
    for (const code of ['not_member', 'invalid_plan', 'invalid_deadline', 'invalid_activity']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.addTask(input))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.addTask(input))).toBe('unknown')
  })

  it('get_task maps the row (null activity fields stay null)', async () => {
    db.rpc.mockResolvedValueOnce({ data: [TASK_ROW], error: null, status: 200 })
    expect(await adapter.getTask('t1')).toEqual({
      commitmentId: 't1',
      groupId: 'g1',
      presetKey: 'groceries',
      customName: null,
      name: 'Grocery run',
      deadline: '2026-11-22',
      canDelete: true,
      canRename: true,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('get_task', { p_commitment_id: 't1' })
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_found'), status: 400 })
    expect(await backendCodeOf(adapter.getTask('t1'))).toBe('not_found')
  })

  it('rename_task and delete_task send the id and map task_locked and not_found', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await adapter.renameTask('t1', 'Big shop')
    expect(db.rpc).toHaveBeenLastCalledWith('rename_task', {
      p_commitment_id: 't1',
      p_name: 'Big shop',
    })
    db.rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await adapter.deleteTask('t1')
    expect(db.rpc).toHaveBeenLastCalledWith('delete_task', { p_commitment_id: 't1' })
    for (const code of ['task_locked', 'not_found']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.deleteTask('t1'))).toBe(code)
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.renameTask('t1', 'x'))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.deleteTask('t1'))).toBe('network')
  })
})

describe('today', () => {
  const TASK_ROW = {
    commitment_id: 't1',
    kind: 'task',
    section: 'due_today',
    preset_key: 'groceries',
    custom_name: null,
    activity_name: 'Groceries',
    name: 'Grocery run',
    schedule_type: null,
    days: null,
    target: 1,
    counted: 0,
    deadline: '2026-11-20',
    starts_on: null,
    can_delete: false,
    done_count: 1,
    counted_today: true,
    target_met: true,
  }
  const RING_ROW = {
    commitment_id: 'c1',
    kind: 'commitment',
    section: 'this_week',
    preset_key: null,
    custom_name: 'Pottery',
    activity_name: 'Pottery',
    name: null,
    schedule_type: 'times_per_week',
    days: null,
    target: 3,
    counted: 0,
    deadline: null,
    starts_on: null,
    can_delete: false,
    done_count: 0,
    counted_today: false,
    target_met: false,
  }

  it('get_today_items maps the rows in the server order, nulls kept', async () => {
    db.rpc.mockResolvedValueOnce({ data: [TASK_ROW, RING_ROW], error: null, status: 200 })
    expect(await adapter.getTodayItems('g1')).toEqual([
      {
        commitmentId: 't1',
        kind: 'task',
        section: 'due_today',
        presetKey: 'groceries',
        customName: null,
        activityName: 'Groceries',
        name: 'Grocery run',
        scheduleType: null,
        days: null,
        target: 1,
        counted: 0,
        deadline: '2026-11-20',
        startsOn: null,
        canDelete: false,
        countedToday: true,
        targetMet: true,
      },
      {
        commitmentId: 'c1',
        kind: 'commitment',
        section: 'this_week',
        presetKey: null,
        customName: 'Pottery',
        activityName: 'Pottery',
        name: null,
        scheduleType: 'times_per_week',
        days: null,
        target: 3,
        counted: 0,
        deadline: null,
        startsOn: null,
        canDelete: false,
        countedToday: false,
        targetMet: false,
      },
    ])
    expect(db.rpc).toHaveBeenLastCalledWith('get_today_items', { p_group_id: 'g1' })
  })

  it('get_today_items fails loudly on an unknown section and maps not_member', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [{ ...TASK_ROW, section: 'later' }],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.getTodayItems('g1'))).toBe('unknown')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.getTodayItems('g1'))).toBe('not_member')
  })

  it('get_today_summary maps the row; no row is an error', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          member_today: '2026-11-20',
          week_start: '2026-11-16',
          week_number: 4,
          planned: 9,
          done: 0,
          left: 9,
          has_plan: true,
        },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.getTodaySummary('g1')).toEqual({
      memberToday: '2026-11-20',
      weekStart: '2026-11-16',
      weekNumber: 4,
      planned: 9,
      done: 0,
      left: 9,
      hasPlan: true,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('get_today_summary', { p_group_id: 'g1' })
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.getTodaySummary('g1'))).toBe('unknown')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.getTodaySummary('g1'))).toBe('not_member')
  })
})

describe('my plan', () => {
  const PENDING_ROW = {
    commitment_id: 'c1',
    kind: 'commitment',
    section: 'current',
    state: 'pending_change',
    preset_key: 'gym',
    custom_name: null,
    activity_name: 'Gym',
    name: null,
    schedule_type: 'times_per_week',
    days: null,
    target: 4,
    end_date: null,
    deadline: null,
    starts_on: '2026-11-23',
    ends_on: null,
    can_edit: true,
    can_delete: false,
  }
  const PAST_TASK_ROW = {
    ...PENDING_ROW,
    commitment_id: 't1',
    kind: 'task',
    section: 'past',
    state: 'past',
    preset_key: 'clean',
    activity_name: 'Clean',
    name: 'Garage',
    schedule_type: null,
    target: null,
    deadline: '2026-11-17',
    starts_on: null,
    can_edit: false,
  }
  const COMMITMENT_ROW = {
    commitment_id: 'c1',
    group_id: 'g1',
    preset_key: null,
    custom_name: 'Pottery',
    activity_name: 'Pottery',
    schedule_type: 'fixed_days',
    days: [1, 3],
    target: null,
    end_date: '2026-12-20',
    changes_from: '2026-11-23',
    min_end_date: '2026-11-29',
    state: 'active',
    can_edit: true,
  }

  it('get_my_plan maps the rows in the server order, nulls kept', async () => {
    db.rpc.mockResolvedValueOnce({ data: [PENDING_ROW, PAST_TASK_ROW], error: null, status: 200 })
    expect(await adapter.getMyPlan('g1')).toEqual([
      {
        commitmentId: 'c1',
        kind: 'commitment',
        section: 'current',
        state: 'pending_change',
        presetKey: 'gym',
        customName: null,
        activityName: 'Gym',
        name: null,
        scheduleType: 'times_per_week',
        days: null,
        target: 4,
        endDate: null,
        deadline: null,
        startsOn: '2026-11-23',
        endsOn: null,
        canEdit: true,
        canDelete: false,
      },
      {
        commitmentId: 't1',
        kind: 'task',
        section: 'past',
        state: 'past',
        presetKey: 'clean',
        customName: null,
        activityName: 'Clean',
        name: 'Garage',
        scheduleType: null,
        days: null,
        target: null,
        endDate: null,
        deadline: '2026-11-17',
        startsOn: null,
        endsOn: null,
        canEdit: false,
        canDelete: false,
      },
    ])
    expect(db.rpc).toHaveBeenLastCalledWith('get_my_plan', { p_group_id: 'g1' })
  })

  it('get_my_plan fails loudly on an unknown section or state and maps not_member', async () => {
    for (const bad of [{ section: 'later' }, { state: 'paused' }, { kind: 'habit' }]) {
      db.rpc.mockResolvedValueOnce({ data: [{ ...PENDING_ROW, ...bad }], error: null, status: 200 })
      expect(await backendCodeOf(adapter.getMyPlan('g1'))).toBe('unknown')
    }
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.getMyPlan('g1'))).toBe('not_member')
  })

  it('get_commitment maps the row and not_found; an unknown state is an error', async () => {
    db.rpc.mockResolvedValueOnce({ data: [COMMITMENT_ROW], error: null, status: 200 })
    expect(await adapter.getCommitment('c1')).toEqual({
      commitmentId: 'c1',
      groupId: 'g1',
      presetKey: null,
      customName: 'Pottery',
      activityName: 'Pottery',
      scheduleType: 'fixed_days',
      days: [1, 3],
      target: null,
      endDate: '2026-12-20',
      changesFrom: '2026-11-23',
      minEndDate: '2026-11-29',
      state: 'active',
      canEdit: true,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('get_commitment', { p_commitment_id: 'c1' })
    db.rpc.mockResolvedValueOnce({
      data: [{ ...COMMITMENT_ROW, state: 'paused' }],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.getCommitment('c1'))).toBe('unknown')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_found'), status: 400 })
    expect(await backendCodeOf(adapter.getCommitment('c1'))).toBe('not_found')
  })

  it('update_commitment sends only the fields of the type and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [{ changes_from: '2026-11-23' }],
      error: null,
      status: 200,
    })
    expect(
      await adapter.updateCommitment({
        commitmentId: 'c1',
        days: null,
        target: 4,
        endDate: null,
      }),
    ).toEqual({ changesFrom: '2026-11-23' })
    expect(db.rpc).toHaveBeenLastCalledWith('update_commitment', {
      p_commitment_id: 'c1',
      p_target: 4,
    })
    db.rpc.mockResolvedValueOnce({
      data: [{ changes_from: '2026-11-23' }],
      error: null,
      status: 200,
    })
    await adapter.updateCommitment({
      commitmentId: 'c1',
      days: [1, 3, 5],
      target: null,
      endDate: '2026-12-20',
    })
    expect(db.rpc).toHaveBeenLastCalledWith('update_commitment', {
      p_commitment_id: 'c1',
      p_days: [1, 3, 5],
      p_end_date: '2026-12-20',
    })
    const input = { commitmentId: 'c1', days: null, target: 4, endDate: null }
    for (const code of ['not_found', 'commitment_ended', 'invalid_plan', 'invalid_end_date']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.updateCommitment(input))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.updateCommitment(input))).toBe('unknown')
  })

  it('end_commitment sends the id, returns the last week and maps its error codes', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [{ ends_after_week_start: '2026-11-16' }],
      error: null,
      status: 200,
    })
    expect(await adapter.endCommitment('c1')).toEqual({ endsAfterWeekStart: '2026-11-16' })
    expect(db.rpc).toHaveBeenLastCalledWith('end_commitment', { p_commitment_id: 'c1' })
    for (const code of ['not_found', 'commitment_ended']) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.endCommitment('c1'))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' },
      status: 0,
    })
    expect(await backendCodeOf(adapter.endCommitment('c1'))).toBe('network')
  })
})

/** A storage-js error as the client returns it (marked with `__isStorageError`). */
function storageError(message: string, status?: number, statusCode?: string) {
  return Object.assign(new Error(message), {
    __isStorageError: true,
    ...(status === undefined ? {} : { status }),
    ...(statusCode === undefined ? {} : { statusCode }),
  })
}

describe('check-ins', () => {
  beforeEach(() => {
    storage.bucket.upload.mockReset()
    storage.from.mockClear()
  })

  it('get_checkin_targets maps the rows in the server order with the reasons', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          commitment_id: 'c1',
          kind: 'commitment',
          preset_key: 'gym',
          custom_name: null,
          activity_name: 'Gym',
          name: null,
          schedule_type: 'fixed_days',
          due_today: true,
          member_today: '2026-11-20',
          deadline: null,
          target: 3,
          done_count: 1,
          wont_count: null,
        },
        {
          commitment_id: 't1',
          kind: 'task',
          preset_key: null,
          custom_name: 'Pottery',
          activity_name: 'Pottery',
          name: 'Glaze',
          schedule_type: null,
          due_today: false,
          member_today: '2026-11-20',
          deadline: '2026-11-22',
          target: 1,
          done_count: 1,
          wont_count: 'done',
        },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.getCheckinTargets('g1')).toEqual([
      {
        commitmentId: 'c1',
        kind: 'commitment',
        presetKey: 'gym',
        activityName: 'Gym',
        name: null,
        scheduleType: 'fixed_days',
        dueToday: true,
        memberToday: '2026-11-20',
        deadline: null,
        target: 3,
        doneCount: 1,
        wontCount: null,
      },
      {
        commitmentId: 't1',
        kind: 'task',
        presetKey: null,
        activityName: 'Pottery',
        name: 'Glaze',
        scheduleType: null,
        dueToday: false,
        memberToday: '2026-11-20',
        deadline: '2026-11-22',
        target: 1,
        doneCount: 1,
        wontCount: 'done',
      },
    ])
    expect(db.rpc).toHaveBeenLastCalledWith('get_checkin_targets', { p_group_id: 'g1' })
  })

  it('get_checkin_targets fails loudly on an unknown reason and maps not_member', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          commitment_id: 'c1',
          kind: 'commitment',
          preset_key: 'gym',
          custom_name: null,
          activity_name: 'Gym',
          name: null,
          schedule_type: 'fixed_days',
          due_today: true,
          member_today: '2026-11-20',
          deadline: null,
          target: 3,
          done_count: 0,
          wont_count: 'maybe',
        },
      ],
      error: null,
      status: 200,
    })
    expect(await backendCodeOf(adapter.getCheckinTargets('g1'))).toBe('unknown')
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.getCheckinTargets('g1'))).toBe('not_member')
  })

  it('uploads a rendition to {group}/{checkin}/{size}.webp in the private bucket, no upsert', async () => {
    const photo = new Blob(['x'], { type: 'image/webp' })
    storage.bucket.upload.mockResolvedValueOnce({ data: { path: 'p' }, error: null })
    await adapter.uploadCheckinPhoto('g1', 'k1', 1080, photo)
    expect(storage.from).toHaveBeenCalledWith('checkins')
    expect(storage.bucket.upload).toHaveBeenCalledWith(
      'g1/k1/1080.webp',
      photo,
      expect.objectContaining({ contentType: 'image/webp', upsert: false }),
    )
  })

  it('an object that already exists counts as uploaded', async () => {
    const photo = new Blob(['x'], { type: 'image/webp' })
    storage.bucket.upload.mockResolvedValueOnce({
      data: null,
      error: storageError('The resource already exists', 409, '409'),
    })
    await expect(adapter.uploadCheckinPhoto('g1', 'k1', 360, photo)).resolves.toBeUndefined()
    storage.bucket.upload.mockResolvedValueOnce({
      data: null,
      error: storageError('Duplicate', 400, '409'),
    })
    await expect(adapter.uploadCheckinPhoto('g1', 'k1', 360, photo)).resolves.toBeUndefined()
  })

  it('an upload with no response is network; a policy refusal (403) is not_member; else unknown', async () => {
    const photo = new Blob(['x'], { type: 'image/webp' })
    storage.bucket.upload.mockResolvedValueOnce({
      data: null,
      error: storageError('Failed to fetch'),
    })
    expect(await backendCodeOf(adapter.uploadCheckinPhoto('g1', 'k1', 1080, photo))).toBe('network')
    storage.bucket.upload.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await backendCodeOf(adapter.uploadCheckinPhoto('g1', 'k1', 1080, photo))).toBe('network')
    storage.bucket.upload.mockResolvedValueOnce({
      data: null,
      error: storageError('new row violates row-level security policy', 403, '403'),
    })
    expect(await backendCodeOf(adapter.uploadCheckinPhoto('g1', 'k1', 1080, photo))).toBe(
      'not_member',
    )
    storage.bucket.upload.mockResolvedValueOnce({
      data: null,
      error: storageError('jwt expired', 400, '403'),
    })
    // An auth failure is not a policy refusal: it stays retryable.
    expect(await backendCodeOf(adapter.uploadCheckinPhoto('g1', 'k1', 1080, photo))).toBe('unknown')
    storage.bucket.upload.mockResolvedValueOnce({
      data: null,
      error: storageError('Internal error', 500, '500'),
    })
    expect(await backendCodeOf(adapter.uploadCheckinPhoto('g1', 'k1', 1080, photo))).toBe('unknown')
  })

  it('post_checkin sends the payload (no caption when empty) and maps the result', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          checkin_id: 'k1',
          session_id: null,
          counted: false,
          is_late: false,
          done_count: 2,
          target: 3,
          weekly_points: 67,
          rank: 2,
          passed_user_ids: ['u2'],
        },
      ],
      error: null,
      status: 200,
    })
    const input = {
      id: 'k1',
      groupId: 'g1',
      commitmentId: 'c1',
      capturedAt: '2026-11-20T01:00:00.000Z',
      caption: null,
    }
    expect(await adapter.postCheckin(input)).toEqual({
      checkinId: 'k1',
      sessionId: null,
      counted: false,
      isLate: false,
      doneCount: 2,
      target: 3,
      weeklyPoints: 67,
      rank: 2,
      passedUserIds: ['u2'],
    })
    expect(db.rpc).toHaveBeenLastCalledWith('post_checkin', {
      p_id: 'k1',
      p_commitment_id: 'c1',
      p_captured_at: '2026-11-20T01:00:00.000Z',
    })
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          checkin_id: 'k1',
          session_id: 's1',
          counted: true,
          is_late: true,
          done_count: 3,
          target: 3,
        },
      ],
      error: null,
      status: 200,
    })
    await adapter.postCheckin({ ...input, caption: 'leg day' })
    expect(db.rpc).toHaveBeenLastCalledWith('post_checkin', {
      p_id: 'k1',
      p_commitment_id: 'c1',
      p_captured_at: '2026-11-20T01:00:00.000Z',
      p_caption: 'leg day',
    })
  })

  it('post_checkin maps every rejection code', async () => {
    const input = {
      id: 'k1',
      groupId: 'g1',
      commitmentId: 'c1',
      capturedAt: '2026-11-20T01:00:00.000Z',
      caption: null,
    }
    for (const code of [
      'bad_capture_time',
      'not_member',
      'commitment_ended',
      'week_locked',
      'photo_missing',
      'checkin_conflict',
      'invalid_caption',
    ]) {
      db.rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await backendCodeOf(adapter.postCheckin(input))).toBe(code)
    }
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.postCheckin(input))).toBe('unknown')
  })

  it("post_checkin keeps week_locked's detail (lock time and group zone)", async () => {
    const detail = '{"lock_at" : "2026-11-26T00:00:00+00:00", "time_zone" : "Europe/London"}'
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { ...pgError('week_locked'), details: detail },
      status: 400,
    })
    const error = await adapter
      .postCheckin({
        id: 'k1',
        groupId: 'g1',
        commitmentId: 'c1',
        capturedAt: '2026-11-20T01:00:00.000Z',
        caption: null,
      })
      .catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ code: 'week_locked', detail })
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await adapter.leaveGroup('g1').catch((thrown: unknown) => thrown)).toMatchObject({
      code: 'not_member',
      detail: null,
    })
  })
})

function feedRow(overrides: Partial<Tables<'feed_items'>> = {}): Tables<'feed_items'> {
  return {
    group_id: 'g-1',
    item_kind: 'checkin',
    item_id: 'c-1',
    sort_at: '2026-11-20T07:12:30.123456+00:00',
    actor_id: 'u-1',
    actor_name: 'Marco',
    actor_avatar_path: null,
    subject_id: null,
    subject_name: null,
    commitment_id: 'cm-1',
    commitment_kind: 'commitment',
    activity_name: 'Gym',
    preset_key: 'gym',
    task_name: null,
    captured_at: '2026-11-20T07:12:00+00:00',
    received_at: '2026-11-20T07:12:30.123456+00:00',
    is_late: false,
    is_extra: false,
    caption: 'leg day',
    full_pruned_at: null,
    counted_position: 2,
    target: 3,
    payload: null,
    miss_count: null,
    challenge_id: null,
    challenge_status: null,
    challenge_closes_at: null,
    challenge_until: '2026-11-21T07:12:30.123456+00:00',
    ...overrides,
  }
}

describe('board (Stories 4.1 and 4.3)', () => {
  it('get_group_week maps the current week', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [{ week_start: '2026-11-16', lock_at: '2026-11-25T16:00:00+00:00' }],
      error: null,
      status: 200,
    })
    expect(await adapter.getGroupWeek('g1')).toEqual({
      weekStart: '2026-11-16',
      lockAt: '2026-11-25T16:00:00+00:00',
    })
    expect(db.rpc).toHaveBeenLastCalledWith('get_group_week', { p_group_id: 'g1' })
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await backendCodeOf(adapter.getGroupWeek('g1'))).toBe('unknown')
  })

  it('get_board maps the rows in the server order, waiting and the nullable columns', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          user_id: 'u1',
          display_name: 'Jo',
          avatar_path: 'u1/1.webp',
          weekly_points: 67,
          sessions_done: 4,
          sessions_planned: 6,
          sessions_frozen: 0,
          rank: 1,
          waiting: false,
          miss_count: 2,
          best_streak: 6,
          plan: [
            { activity_name: 'Gym', schedule_type: 'times_per_week', days: null, target: 3 },
            { activity_name: 'Study', schedule_type: 'fixed_days', days: [1, 3, 5], target: null },
            { activity_name: 'Broken', schedule_type: 'other', days: null, target: null },
            'junk',
          ],
          task_count: 1,
          lock_at: '2026-11-25T16:00:00+00:00',
          is_current_week: true,
          time_zone: 'Asia/Manila',
          locked: true,
          is_winner: true,
        },
        {
          user_id: 'u2',
          display_name: 'Sam',
          avatar_path: null,
          weekly_points: null,
          sessions_done: 0,
          sessions_planned: 0,
          sessions_frozen: 0,
          rank: null,
          waiting: false,
          miss_count: 0,
          best_streak: 0,
          plan: [],
          task_count: 0,
          lock_at: '2026-11-25T16:00:00+00:00',
          is_current_week: true,
          time_zone: 'Asia/Manila',
          locked: true,
        },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.getBoard('g1', '2026-11-16')).toEqual({
      waiting: false,
      lockAt: '2026-11-25T16:00:00+00:00',
      isCurrentWeek: true,
      timeZone: 'Asia/Manila',
      locked: true,
      rows: [
        {
          userId: 'u1',
          displayName: 'Jo',
          avatarPath: 'u1/1.webp',
          weeklyPoints: 67,
          sessionsDone: 4,
          sessionsPlanned: 6,
          sessionsFrozen: 0,
          rank: 1,
          missCount: 2,
          bestStreak: 6,
          // Malformed plan items are dropped.
          plan: [
            { activityName: 'Gym', scheduleType: 'times_per_week', days: null, target: 3 },
            { activityName: 'Study', scheduleType: 'fixed_days', days: [1, 3, 5], target: null },
          ],
          taskCount: 1,
          isWinner: true,
        },
        {
          userId: 'u2',
          displayName: 'Sam',
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
          // Missing from an older server: not a winner.
          isWinner: false,
        },
      ],
    })
    expect(db.rpc).toHaveBeenLastCalledWith('get_board', {
      p_group_id: 'g1',
      p_week_start: '2026-11-16',
    })
  })

  it('get_board with no rows counts as waiting', async () => {
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await adapter.getBoard('g1', '2026-11-16')).toEqual({
      waiting: true,
      rows: [],
      lockAt: null,
      isCurrentWeek: false,
      timeZone: null,
      locked: false,
    })
  })

  it('get_board maps not_member', async () => {
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: pgError('not_member'),
      status: 400,
    })
    expect(await backendCodeOf(adapter.getBoard('g1', '2026-11-16'))).toBe('not_member')
  })
})

describe('winner (Story 4.5)', () => {
  const weekColumns = {
    week_start: '2026-11-09',
    lock_at: '2026-11-18T16:00:00+00:00',
    scored: true,
    ranked: true,
    winner_user_ids: ['u1', 'u2'],
    badge_name: 'Weekly Winner',
    badge_line: 'Top of the board. Enjoy it while it lasts.',
  }

  it('get_winner_week maps the week and its podium, winners first', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          ...weekColumns,
          user_id: 'u1',
          display_name: 'Jo',
          avatar_path: 'u1/1.webp',
          weekly_points: 94,
          rank: 1,
          is_winner: true,
        },
        {
          ...weekColumns,
          user_id: 'u2',
          display_name: 'Marco',
          avatar_path: null,
          weekly_points: 94,
          rank: 2,
          is_winner: true,
        },
        {
          ...weekColumns,
          user_id: 'u3',
          display_name: 'Dev',
          avatar_path: null,
          weekly_points: 70,
          rank: 3,
          is_winner: false,
        },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.getWinnerWeek('g1', '2026-11-09')).toEqual({
      weekStart: '2026-11-09',
      lockAt: '2026-11-18T16:00:00+00:00',
      scored: true,
      ranked: true,
      winnerUserIds: ['u1', 'u2'],
      podium: [
        {
          userId: 'u1',
          displayName: 'Jo',
          avatarPath: 'u1/1.webp',
          weeklyPoints: 94,
          rank: 1,
          isWinner: true,
        },
        {
          userId: 'u2',
          displayName: 'Marco',
          avatarPath: null,
          weeklyPoints: 94,
          rank: 2,
          isWinner: true,
        },
        {
          userId: 'u3',
          displayName: 'Dev',
          avatarPath: null,
          weeklyPoints: 70,
          rank: 3,
          isWinner: false,
        },
      ],
      badgeName: 'Weekly Winner',
      badgeLine: 'Top of the board. Enjoy it while it lasts.',
    })
    expect(db.rpc).toHaveBeenLastCalledWith('get_winner_week', {
      p_group_id: 'g1',
      p_week_start: '2026-11-09',
    })
  })

  it('get_winner_week asks for the latest locked week with a null week, and maps no rows to null', async () => {
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await adapter.getWinnerWeek('g1', null)).toBeNull()
    expect(db.rpc).toHaveBeenLastCalledWith('get_winner_week', {
      p_group_id: 'g1',
      p_week_start: null,
    })
  })

  it('a locked week with nobody on its podium keeps the week columns and an empty podium', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          ...weekColumns,
          ranked: false,
          winner_user_ids: [],
          user_id: null,
          display_name: null,
          avatar_path: null,
          weekly_points: null,
          rank: null,
          is_winner: null,
        },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.getWinnerWeek('g1', '2026-11-09')).toMatchObject({
      ranked: false,
      winnerUserIds: [],
      podium: [],
    })
  })

  it('get_winner_week maps not_member', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.getWinnerWeek('g1', null))).toBe('not_member')
  })
})

describe('streaks (Story 4.2)', () => {
  it('get_streaks maps the rows, a task keeping its null streak', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        { commitment_id: 'c1', user_id: 'u1', current_streak: 6, back_to_zero: false },
        { commitment_id: 'c2', user_id: 'u1', current_streak: 0, back_to_zero: true },
        { commitment_id: 't1', user_id: 'u2', current_streak: null, back_to_zero: false },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.getStreaks('g1')).toEqual([
      { commitmentId: 'c1', userId: 'u1', currentStreak: 6, backToZero: false },
      { commitmentId: 'c2', userId: 'u1', currentStreak: 0, backToZero: true },
      { commitmentId: 't1', userId: 'u2', currentStreak: null, backToZero: false },
    ])
    expect(db.rpc).toHaveBeenLastCalledWith('get_streaks', { p_group_id: 'g1' })
  })

  it('get_streaks maps not_member', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await backendCodeOf(adapter.getStreaks('g1'))).toBe('not_member')
  })
})

describe('feed mapping', () => {
  it('maps check-ins and stickies, drops kinds the app does not render, keeps the raw cursors', () => {
    const rows = [
      feedRow(),
      feedRow({
        item_kind: 'admin_handover',
        item_id: 'e-1',
        sort_at: '2026-11-20T07:00:00+00:00',
        actor_name: 'Jo',
        subject_id: 'u-2',
        subject_name: 'Marco',
        commitment_id: null,
      }),
      feedRow({ item_kind: 'miss', item_id: 'e-2', sort_at: '2026-11-19T23:00:00+00:00' }),
    ]
    const page = toFeedRows(rows)
    expect(page.rowCount).toBe(3)
    expect(page.newest).toEqual({ sortAt: '2026-11-20T07:12:30.123456+00:00', itemId: 'c-1' })
    expect(page.oldest).toEqual({ sortAt: '2026-11-19T23:00:00+00:00', itemId: 'e-2' })
    expect(page.items.map((item) => item.id)).toEqual(['c-1', 'e-1'])
    expect(page.items[0]).toMatchObject({
      type: 'checkin',
      authorName: 'Marco',
      activityName: 'Gym',
      countedPosition: 2,
      target: 3,
      isExtra: false,
      caption: 'leg day',
    })
    expect(page.items[1]).toMatchObject({
      type: 'event',
      kind: 'admin_handover',
      actorName: 'Jo',
      subjectName: 'Marco',
    })
  })

  it("maps a miss from the live title and count and the payload's tease, day and schedule", () => {
    const miss = feedRow({
      item_kind: 'miss',
      item_id: 'm-1',
      actor_id: 'u-4',
      actor_name: 'Dev',
      commitment_id: 'cm-2',
      activity_name: 'Gym',
      task_name: null,
      captured_at: null,
      received_at: null,
      is_late: null,
      is_extra: null,
      caption: null,
      counted_position: null,
      target: null,
      miss_count: 2,
      payload: {
        schedule_type: 'times_per_week',
        tease: 'couch_wins',
        missed_on: '2026-11-22',
        count: 3,
        activity_name: 'Old name',
      },
    })
    expect(toFeedItem(miss)).toEqual({
      type: 'miss',
      id: 'm-1',
      groupId: 'g-1',
      sortAt: '2026-11-20T07:12:30.123456+00:00',
      actorId: 'u-4',
      actorName: 'Dev',
      commitmentId: 'cm-2',
      title: 'Gym',
      scheduleType: 'times_per_week',
      missCount: 2,
      tease: 'couch_wins',
      missedOn: '2026-11-22',
    })
    expect(toFeedItem({ ...miss, task_name: 'Tax forms' })).toMatchObject({ title: 'Tax forms' })
    expect(
      toFeedItem({
        ...miss,
        activity_name: null,
        payload: { schedule_type: 'fixed_days', activity_name: 'Paint' },
      }),
    ).toMatchObject({ title: 'Paint', scheduleType: 'fixed_days', tease: null, missedOn: null })
    // Nothing left missed: not rendered.
    expect(toFeedItem({ ...miss, miss_count: 0 })).toBeNull()
  })

  it('maps a weekly winner from its payload; a malformed one is dropped', () => {
    const winner = feedRow({
      item_kind: 'weekly_winner',
      item_id: 'w-1',
      sort_at: '2026-11-19T00:00:30+00:00',
      actor_id: null,
      actor_name: null,
      commitment_id: null,
      payload: {
        week_start: '2026-11-09',
        weekly_points: 94,
        winner_user_ids: ['u-1', 'u-2'],
        winners: [{ user_id: 'u-1', name: 'Jo' }, { user_id: 'u-2', name: 'Marco' }, 'junk'],
      },
    })
    expect(toFeedItem(winner)).toEqual({
      type: 'winner',
      id: 'w-1',
      groupId: winner.group_id,
      sortAt: '2026-11-19T00:00:30+00:00',
      weekStart: '2026-11-09',
      weeklyPoints: 94,
      winners: [
        { userId: 'u-1', name: 'Jo' },
        { userId: 'u-2', name: 'Marco' },
      ],
    })
    expect(
      toFeedItem({
        ...winner,
        payload: { week_start: '2026-11-09', weekly_points: 94, winners: [] },
      }),
    ).toBeNull()
    expect(toFeedItem({ ...winner, payload: null })).toBeNull()
  })

  it("maps a check-in's challenge columns (Story 5.1); an unknown status reads as none", () => {
    expect(toFeedItem(feedRow())).toMatchObject({
      challengeId: null,
      challengeStatus: null,
      challengeClosesAt: null,
      challengeUntil: '2026-11-21T07:12:30.123456+00:00',
    })
    const open = feedRow({
      challenge_id: 'ch-1',
      challenge_status: 'open',
      challenge_closes_at: '2026-11-21T07:00:00+00:00',
    })
    expect(toFeedItem(open)).toMatchObject({
      challengeId: 'ch-1',
      challengeStatus: 'open',
      challengeClosesAt: '2026-11-21T07:00:00+00:00',
    })
    expect(toFeedItem({ ...open, challenge_status: 'weird' })).toMatchObject({
      challengeStatus: null,
    })
  })

  it('maps a ruling from the live names and title and its payload; a malformed one is dropped', () => {
    const ruling = feedRow({
      item_kind: 'ruling',
      item_id: 'r-1',
      sort_at: '2026-11-20T09:00:00+00:00',
      actor_id: 'u-3',
      actor_name: 'Lena',
      subject_id: 'u-4',
      subject_name: 'Dev',
      commitment_id: 'cm-2',
      activity_name: 'Study',
      task_name: null,
      captured_at: null,
      received_at: null,
      is_late: null,
      is_extra: null,
      caption: null,
      counted_position: null,
      target: null,
      challenge_until: null,
      payload: {
        challenge_id: 'ch-1',
        checkin_id: 'c-9',
        outcome: 'fake',
        fake_count: 1,
        real_count: 0,
        variant: 'two_person',
        actor_name: 'Lena',
        subject_name: 'Dev',
      },
    })
    expect(toFeedItem(ruling)).toEqual({
      type: 'ruling',
      id: 'r-1',
      groupId: 'g-1',
      sortAt: '2026-11-20T09:00:00+00:00',
      challengeId: 'ch-1',
      checkinId: 'c-9',
      challengerId: 'u-3',
      challengerName: 'Lena',
      ownerId: 'u-4',
      ownerName: 'Dev',
      title: 'Study',
      outcome: 'fake',
      fakeCount: 1,
      realCount: 0,
      variant: 'two_person',
    })
    expect(toFeedItem({ ...ruling, task_name: 'Tax forms' })).toMatchObject({ title: 'Tax forms' })
    expect(
      toFeedItem({ ...ruling, payload: { ...(ruling.payload as object), outcome: 'maybe' } }),
    ).toBeNull()
    expect(
      toFeedItem({ ...ruling, payload: { ...(ruling.payload as object), variant: 'other' } }),
    ).toBeNull()
    expect(toFeedItem({ ...ruling, payload: null })).toBeNull()
  })

  it('quotes the timestamp in the keyset filter', () => {
    expect(keysetFilter({ sortAt: '2026-11-20T07:12:30.123456+00:00', itemId: 'c-1' }, 'lt')).toBe(
      'sort_at.lt."2026-11-20T07:12:30.123456+00:00",and(sort_at.eq."2026-11-20T07:12:30.123456+00:00",item_id.lt.c-1)',
    )
  })

  it('signs every path in one call and maps refused paths to null', async () => {
    storage.bucket.createSignedUrls.mockResolvedValue({
      data: [
        {
          path: 'g/c1/360.webp',
          signedUrl: 'https://x/sign/checkins/g/c1/360.webp?token=a',
          error: null,
        },
        { path: 'g/c2/360.webp', signedUrl: '', error: 'Either the object does not exist' },
      ],
      error: null,
    })
    const urls = await adapter.signCheckinPhotos(['g/c1/360.webp', 'g/c2/360.webp'])
    expect(storage.bucket.createSignedUrls).toHaveBeenCalledWith(
      ['g/c1/360.webp', 'g/c2/360.webp'],
      600,
    )
    expect(urls).toEqual({
      'g/c1/360.webp': 'https://x/sign/checkins/g/c1/360.webp?token=a',
      'g/c2/360.webp': null,
    })
  })

  it('builds the token-less cache URL of a photo', () => {
    expect(adapter.checkinPhotoCacheUrl('g/c1/1080.webp')).toBe(
      'https://proj.supabase.co/storage/v1/object/sign/checkins/g/c1/1080.webp',
    )
  })
})

describe('member profile (Story 4.6)', () => {
  it('get_member_profile maps the profile, its badges, streaks and plan; malformed entries dropped', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          display_name: 'Ada',
          avatar_path: null,
          is_current_member: true,
          all_time_points: 1284,
          title_key: 'regular',
          time_zone: 'Asia/Manila',
          badges: [
            {
              key: 'first_proof',
              name: 'First Proof',
              how_earned: 'Your first check-in',
              line: 'Pics or it did not happen.',
              icon: 'camera',
              status: 'earned',
              awarded_at: '2026-11-12T00:00:01+00:00',
              pending_lock_at: null,
              award_count: 1,
            },
            {
              key: 'team_player',
              name: 'Team Player',
              how_earned: 'Each time the group hits its goal (everyone gets it)',
              line: 'Nobody let the group down.',
              icon: 'users-three',
              status: 'earned',
              awarded_at: '2026-11-19T00:00:01+00:00',
              pending_lock_at: null,
              award_count: 3,
            },
            {
              key: 'clean_sheet',
              name: 'Clean Sheet',
              how_earned: 'A perfect week',
              line: 'Every session.',
              icon: 'check-circle',
              status: 'pending',
              awarded_at: null,
              pending_lock_at: '2026-11-25T16:00:00+00:00',
              award_count: 0,
            },
            { key: 'broken' },
            {
              key: 'dynasty',
              name: 'Dynasty',
              how_earned: 'Weekly winner 3 times',
              line: 'Three crowns.',
              icon: 'crown',
              status: 'weird',
              award_count: 1.5,
            },
          ],
          streaks: [
            { commitment_id: 'c1', activity_name: 'Gym', current_streak: 0, back_to_zero: true },
            { activity_name: 'no id' },
          ],
          plan: [{ activity_name: 'Gym', schedule_type: 'times_per_week', days: null, target: 3 }],
          task_count: 1,
        },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.getMemberProfile('g1', 'u1')).toEqual({
      displayName: 'Ada',
      avatarPath: null,
      isCurrentMember: true,
      allTimePoints: 1284,
      titleKey: 'regular',
      timeZone: 'Asia/Manila',
      badges: [
        {
          key: 'first_proof',
          name: 'First Proof',
          howEarned: 'Your first check-in',
          line: 'Pics or it did not happen.',
          icon: 'camera',
          status: 'earned',
          awardedAt: '2026-11-12T00:00:01+00:00',
          pendingLockAt: null,
          awardCount: 1,
        },
        {
          key: 'team_player',
          name: 'Team Player',
          howEarned: 'Each time the group hits its goal (everyone gets it)',
          line: 'Nobody let the group down.',
          icon: 'users-three',
          status: 'earned',
          awardedAt: '2026-11-19T00:00:01+00:00',
          pendingLockAt: null,
          awardCount: 3,
        },
        {
          key: 'clean_sheet',
          name: 'Clean Sheet',
          howEarned: 'A perfect week',
          line: 'Every session.',
          icon: 'check-circle',
          status: 'pending',
          awardedAt: null,
          pendingLockAt: '2026-11-25T16:00:00+00:00',
          awardCount: 0,
        },
        {
          key: 'dynasty',
          name: 'Dynasty',
          howEarned: 'Weekly winner 3 times',
          line: 'Three crowns.',
          icon: 'crown',
          status: 'locked',
          awardedAt: null,
          pendingLockAt: null,
          // Not a whole number: dropped to 0.
          awardCount: 0,
        },
      ],
      streaks: [{ commitmentId: 'c1', activityName: 'Gym', currentStreak: 0, backToZero: true }],
      plan: [{ activityName: 'Gym', scheduleType: 'times_per_week', days: null, target: 3 }],
      taskCount: 1,
    })
    expect(db.rpc).toHaveBeenLastCalledWith('get_member_profile', {
      p_group_id: 'g1',
      p_user_id: 'u1',
    })
  })

  it('get_member_profile with no row (never in the group) is null; not_member rejects', async () => {
    db.rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await adapter.getMemberProfile('g1', 'nobody')).toBeNull()
    db.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'not_member', details: '', hint: '' },
      status: 400,
    })
    await expect(adapter.getMemberProfile('g1', 'u1')).rejects.toMatchObject({ code: 'not_member' })
  })

  it('listTitles reads the ladder lowest first', async () => {
    db.query.order.mockResolvedValueOnce({
      data: [
        { key: 'couch_potato', name: 'Couch Potato', min_points: 0 },
        { key: 'warming_up', name: 'Warming Up', min_points: 300 },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.listTitles()).toEqual([
      { key: 'couch_potato', name: 'Couch Potato', minPoints: 0 },
      { key: 'warming_up', name: 'Warming Up', minPoints: 300 },
    ])
    expect(db.from).toHaveBeenCalledWith('titles')
    expect(db.query.order).toHaveBeenLastCalledWith('min_points', { ascending: true })
  })
})

describe('group goal (Story 4.7)', () => {
  it('get_group_goal maps the goal, month weeks, contributions and last result; malformed entries dropped', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          week_start: '2026-11-16',
          member_count: 3,
          target_pct: 80,
          period: 'monthly',
          live_average: 72.5,
          month_weeks: [{ week_start: '2026-11-02', goal_average: 70 }, { week_start: 'x' }],
          month_average: 70,
          month_value_now: 71.3,
          contributions: [
            { user_id: 'u-1', name: 'Jo', weekly_points: 81 },
            { user_id: 'u-2', name: 'Priya', weekly_points: null },
            'junk',
          ],
          last_result: {
            week_start: '2026-11-09',
            period: 'weekly',
            target: 85,
            average: 84.5,
            hit: false,
          },
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.getGroupGoal('g1')).resolves.toEqual({
      weekStart: '2026-11-16',
      memberCount: 3,
      target: 80,
      period: 'monthly',
      liveAverage: 72.5,
      monthWeeks: [{ weekStart: '2026-11-02', average: 70 }],
      monthAverage: 70,
      monthValueNow: 71.3,
      contributions: [
        { userId: 'u-1', name: 'Jo', weeklyPoints: 81 },
        { userId: 'u-2', name: 'Priya', weeklyPoints: null },
      ],
      lastResult: {
        weekStart: '2026-11-09',
        period: 'weekly',
        target: 85,
        average: 84.5,
        hit: false,
      },
    })
    expect(db.rpc).toHaveBeenCalledWith('get_group_goal', { p_group_id: 'g1' })
  })

  it('get_group_goal without a goal: nulls, empty lists, no result', async () => {
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          week_start: '2026-11-16',
          member_count: 1,
          target_pct: null,
          period: null,
          live_average: null,
          month_weeks: [],
          month_average: null,
          contributions: [],
          last_result: null,
          month_value_now: null,
        },
      ],
      error: null,
      status: 200,
    })
    await expect(adapter.getGroupGoal('g1')).resolves.toMatchObject({
      memberCount: 1,
      target: null,
      period: null,
      liveAverage: null,
      monthValueNow: null,
      lastResult: null,
    })
  })

  it('set_group_goal sends the target and period; a refusal maps to its code', async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await adapter.setGroupGoal('g1', 85, 'weekly')
    expect(db.rpc).toHaveBeenCalledWith('set_group_goal', {
      p_group_id: 'g1',
      p_target_pct: 85,
      p_period: 'weekly',
    })
    db.rpc.mockResolvedValueOnce({ data: null, error: pgError('invalid_goal'), status: 400 })
    expect(await backendCodeOf(adapter.setGroupGoal('g1', 47, 'weekly'))).toBe('invalid_goal')
  })

  it('maps a goal_result feed row; a malformed payload is dropped', () => {
    const goal = feedRow({
      item_kind: 'goal_result',
      item_id: 'e-9',
      sort_at: '2026-11-19T00:00:01+00:00',
      actor_id: null,
      actor_name: null,
      commitment_id: null,
      payload: { week_start: '2026-11-09', period: 'weekly', target: 85, average: 85, hit: true },
    })
    expect(toFeedItem(goal)).toEqual({
      type: 'goal',
      id: 'e-9',
      groupId: goal.group_id,
      sortAt: '2026-11-19T00:00:01+00:00',
      weekStart: '2026-11-09',
      period: 'weekly',
      target: 85,
      average: 85,
      hit: true,
    })
    expect(toFeedItem({ ...goal, payload: { week_start: '2026-11-09', hit: true } })).toBeNull()
    expect(toFeedItem({ ...goal, payload: null })).toBeNull()
  })
})

describe('feed reads', () => {
  const NEWER = feedRow({ item_id: 'c-new', sort_at: '2026-11-20T08:00:00+00:00' })
  const OLDER = feedRow({ item_id: 'c-old', sort_at: '2026-11-20T07:00:00+00:00' })
  const CURSOR = { sortAt: '2026-11-20T07:30:00.5+00:00', itemId: 'c-mid' }

  beforeEach(() => {
    for (const fn of [
      db.from,
      db.query.select,
      db.query.eq,
      db.query.or,
      db.query.order,
      db.query.limit,
    ]) {
      fn.mockClear()
    }
  })

  function answer(rows: Tables<'feed_items'>[]) {
    db.query.order.mockReturnValueOnce(db.query).mockReturnValueOnce(db.query)
    db.query.limit.mockResolvedValueOnce({ data: rows, error: null, status: 200 })
  }

  it('reads the newest page of a group, newest first', async () => {
    answer([NEWER, OLDER])
    const page = await adapter.listFeed('g-1', { limit: 20 })
    expect(db.from).toHaveBeenCalledWith('feed_items')
    expect(db.query.eq).toHaveBeenCalledWith('group_id', 'g-1')
    expect(db.query.or).not.toHaveBeenCalled()
    expect(db.query.order).toHaveBeenNthCalledWith(1, 'sort_at', { ascending: false })
    expect(db.query.order).toHaveBeenNthCalledWith(2, 'item_id', { ascending: false })
    expect(db.query.limit).toHaveBeenCalledWith(20)
    expect(page.items.map((item) => item.id)).toEqual(['c-new', 'c-old'])
  })

  it("reads a member's latest check-ins (Story 4.6)", async () => {
    answer([NEWER, OLDER])
    const items = await adapter.listMemberCheckins('g-1', 'user-1', 12)
    expect(db.from).toHaveBeenCalledWith('feed_items')
    expect(db.query.eq).toHaveBeenCalledWith('group_id', 'g-1')
    expect(db.query.eq).toHaveBeenCalledWith('item_kind', 'checkin')
    expect(db.query.eq).toHaveBeenCalledWith('actor_id', 'user-1')
    expect(db.query.limit).toHaveBeenCalledWith(12)
    expect(items.map((item) => item.id)).toEqual(['c-new', 'c-old'])
  })

  it('reads older than a cursor', async () => {
    answer([OLDER])
    await adapter.listFeed('g-1', { before: CURSOR, limit: 20 })
    expect(db.query.or).toHaveBeenCalledWith(keysetFilter(CURSOR, 'lt'))
    expect(db.query.order).toHaveBeenNthCalledWith(1, 'sort_at', { ascending: false })
  })

  it('reads newer than a cursor oldest first, and hands them back newest first', async () => {
    answer([OLDER, NEWER])
    const page = await adapter.listFeed('g-1', { after: CURSOR, limit: 10 })
    expect(db.query.or).toHaveBeenCalledWith(keysetFilter(CURSOR, 'gt'))
    expect(db.query.order).toHaveBeenNthCalledWith(1, 'sort_at', { ascending: true })
    expect(db.query.order).toHaveBeenNthCalledWith(2, 'item_id', { ascending: true })
    expect(db.query.limit).toHaveBeenCalledWith(10)
    expect(page.items.map((item) => item.id)).toEqual(['c-new', 'c-old'])
    expect(page.newest?.itemId).toBe('c-new')
  })

  it('reads Friends today through get_friends_today, check-ins only', async () => {
    const select = vi.fn().mockResolvedValue({
      data: [NEWER, feedRow({ item_kind: 'member_joined', item_id: 'e-1' }), OLDER],
      error: null,
      status: 200,
    })
    db.rpc.mockReturnValueOnce({ select })
    const items = await adapter.listFriendsToday('g-1')
    expect(db.rpc).toHaveBeenCalledWith('get_friends_today', { p_group_id: 'g-1' })
    expect(select).toHaveBeenCalledWith(expect.stringContaining('miss_count'))
    expect(items.map((item) => item.id)).toEqual(['c-new', 'c-old'])

    db.rpc.mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ data: null, error: pgError('boom'), status: 500 }),
    })
    expect(await backendCodeOf(adapter.listFriendsToday('g-1'))).toBe('unknown')
  })

  it('reads one check-in of the group, or null', async () => {
    db.query.maybeSingle.mockResolvedValueOnce({ data: NEWER, error: null, status: 200 })
    expect(await adapter.getFeedCheckin('g-1', 'c-new')).toMatchObject({ id: 'c-new' })
    expect(db.query.eq).toHaveBeenCalledWith('group_id', 'g-1')
    expect(db.query.eq).toHaveBeenCalledWith('item_kind', 'checkin')
    expect(db.query.eq).toHaveBeenCalledWith('item_id', 'c-new')

    db.query.maybeSingle.mockResolvedValueOnce({ data: null, error: null, status: 200 })
    expect(await adapter.getFeedCheckin('g-1', 'c-gone')).toBeNull()
  })
})
