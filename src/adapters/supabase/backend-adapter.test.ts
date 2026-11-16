import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import type { AuthErrorCode } from '@/domain/auth'
import { supabaseBackendAdapter as adapter } from '@/adapters/supabase/backend-adapter'

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock('@/adapters/supabase/client', () => ({ supabase: { auth } }))

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
