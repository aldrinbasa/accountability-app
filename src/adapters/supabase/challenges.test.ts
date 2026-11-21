import type { BackendErrorCode } from '@/domain/error-codes'
import { supabaseBackendAdapter as adapter } from '@/adapters/supabase/backend-adapter'
import { toCreateChallengeResult } from '@/adapters/supabase/challenges'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('@/adapters/supabase/client', () => ({
  supabase: { rpc },
  supabaseUrl: 'https://proj.supabase.co',
}))

function pgError(message: string) {
  return { message, details: '', hint: '', code: 'P0001', name: 'PostgrestError' }
}

async function codeOf(promise: Promise<unknown>): Promise<BackendErrorCode> {
  try {
    await promise
  } catch (error) {
    return (error as { code: BackendErrorCode }).code
  }
  throw new Error('expected a rejection')
}

describe('create_challenge (Story 5.1)', () => {
  beforeEach(() => rpc.mockReset())

  it('sends the check-in id and maps the one row', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ challenge_id: 'ch-1', status: 'open', closes_at: '2026-11-21T07:00:00+00:00' }],
      error: null,
      status: 200,
    })
    expect(await adapter.createChallenge('c-1')).toEqual({
      challengeId: 'ch-1',
      status: 'open',
      closesAt: '2026-11-21T07:00:00+00:00',
    })
    expect(rpc).toHaveBeenLastCalledWith('create_challenge', { p_checkin_id: 'c-1' })
  })

  it('maps a group of two ruling Fake at once', () => {
    expect(
      toCreateChallengeResult([
        { challenge_id: 'ch-2', status: 'fake', closes_at: '2026-11-21T07:00:00+00:00' },
      ]),
    ).toMatchObject({ status: 'fake' })
  })

  it('maps every refusal code, no response as network, and a malformed answer as unknown', async () => {
    for (const code of [
      'not_member',
      'group_waiting',
      'own_checkin',
      'already_challenged',
      'challenge_expired',
      'week_locked',
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await codeOf(adapter.createChallenge('c-1'))).toBe(code)
    }
    rpc.mockResolvedValueOnce({ data: null, error: pgError('Failed to fetch'), status: 0 })
    expect(await codeOf(adapter.createChallenge('c-1'))).toBe('network')
    rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await codeOf(adapter.createChallenge('c-1'))).toBe('unknown')
    rpc.mockResolvedValueOnce({
      data: [{ challenge_id: 'ch-3', status: 'real', closes_at: '2026-11-21T07:00:00+00:00' }],
      error: null,
      status: 200,
    })
    expect(await codeOf(adapter.createChallenge('c-1'))).toBe('unknown')
  })
})
