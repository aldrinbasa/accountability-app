import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import type { AuthErrorCode } from '@/domain/auth'
import type { BackendErrorCode } from '@/domain/error-codes'
import { givenNameOf, supabaseBackendAdapter as adapter } from '@/adapters/supabase/backend-adapter'

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
    maybeSingle: vi.fn(),
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  return { query, from: vi.fn(() => query), rpc: vi.fn() }
})

vi.mock('@/adapters/supabase/client', () => ({
  supabase: { auth, from: db.from, rpc: db.rpc },
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

const ROW = { id: 'user-1', display_name: 'Jo', avatar_path: null, time_zone: 'Asia/Manila' }
const PROFILE = { id: 'user-1', displayName: 'Jo', avatarPath: null, timeZone: 'Asia/Manila' }
const pgError = (message: string) => ({ message, code: 'P0001', details: '', hint: '' })

describe('profiles', () => {
  it('reads the own row by the session user id', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.maybeSingle.mockResolvedValue({ data: ROW, error: null, status: 200 })
    await expect(adapter.getMyProfile()).resolves.toEqual(PROFILE)
    expect(db.from).toHaveBeenCalledWith('profiles')
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
})

describe('groups', () => {
  const member = (user_id: string, role: string, ended_at: string | null = null) => ({
    user_id,
    role,
    joined_at: '2026-11-01T10:00:00+00:00',
    ended_at,
  })

  it('lists current groups with role, join time and current member count', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: USER } }, error: null })
    db.query.select.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            id: 'g1',
            name: 'Gym Rats',
            time_zone: 'Asia/Manila',
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
            memberships: [member('user-1', 'member', '2026-11-03T00:00:00+00:00')],
          },
        ],
        error: null,
        status: 200,
      }),
    )
    await expect(adapter.listMyGroups()).resolves.toEqual([
      {
        id: 'g1',
        name: 'Gym Rats',
        timeZone: 'Asia/Manila',
        role: 'admin',
        joinedAt: '2026-11-01T10:00:00+00:00',
        memberCount: 2,
      },
    ])
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
