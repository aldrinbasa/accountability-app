import type { BackendErrorCode } from '@/domain/error-codes'
import { supabaseBackendAdapter as adapter } from '@/adapters/supabase/backend-adapter'

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

describe('overturn_ruling (Story 5.3)', () => {
  beforeEach(() => rpc.mockReset())

  it('sends the challenge id and maps the one row', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ overturn_id: 'ov-1', created_at: '2026-11-21T07:00:00+00:00' }],
      error: null,
      status: 200,
    })
    expect(await adapter.overturnRuling('ch-1')).toEqual({
      overturnId: 'ov-1',
      createdAt: '2026-11-21T07:00:00+00:00',
    })
    expect(rpc).toHaveBeenLastCalledWith('overturn_ruling', { p_challenge_id: 'ch-1' })
  })

  it('maps every refusal code, no response as network, and a malformed answer as unknown', async () => {
    for (const code of [
      'not_member',
      'not_admin',
      'not_fake_ruling',
      'already_overturned',
      'own_checkin',
      'week_locked',
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await codeOf(adapter.overturnRuling('ch-1'))).toBe(code)
    }
    rpc.mockResolvedValueOnce({ data: null, error: pgError('Failed to fetch'), status: 0 })
    expect(await codeOf(adapter.overturnRuling('ch-1'))).toBe('network')
    rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await codeOf(adapter.overturnRuling('ch-1'))).toBe('unknown')
  })
})
