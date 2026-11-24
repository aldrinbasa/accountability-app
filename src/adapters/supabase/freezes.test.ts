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

describe('freeze RPCs (Story 5.4)', () => {
  beforeEach(() => rpc.mockReset())

  it('maps my_freeze_options rows (day and week) and drops unknown kinds', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          option_kind: 'day',
          commitment_id: 'c-1',
          session_id: 's-1',
          starts_at: '2026-11-20T16:00:00+00:00',
          ends_at: '2026-11-21T16:00:00+00:00',
          window_ends_at: '2026-11-21T16:00:00+00:00',
          missed: false,
          week_start: '2026-11-16',
          which: 'this',
          target: null,
          frozen: null,
          target_after: null,
          time_zone: 'Asia/Manila',
        },
        {
          option_kind: 'week',
          commitment_id: 'c-2',
          session_id: null,
          starts_at: '2026-11-08T16:00:00+00:00',
          ends_at: '2026-11-15T16:00:00+00:00',
          window_ends_at: '2026-11-17T16:00:00+00:00',
          missed: true,
          week_start: '2026-11-09',
          which: 'last',
          target: 3,
          frozen: 1,
          target_after: 2,
          time_zone: 'Asia/Manila',
        },
        { option_kind: 'month', which: 'this' },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.listFreezeOptions('g-1')).toEqual([
      {
        kind: 'day',
        commitmentId: 'c-1',
        sessionId: 's-1',
        startsAt: '2026-11-20T16:00:00+00:00',
        endsAt: '2026-11-21T16:00:00+00:00',
        windowEndsAt: '2026-11-21T16:00:00+00:00',
        missed: false,
        weekStart: '2026-11-16',
        which: 'this',
        target: null,
        frozen: null,
        targetAfter: null,
        timeZone: 'Asia/Manila',
      },
      {
        kind: 'week',
        commitmentId: 'c-2',
        sessionId: null,
        startsAt: '2026-11-08T16:00:00+00:00',
        endsAt: '2026-11-15T16:00:00+00:00',
        windowEndsAt: '2026-11-17T16:00:00+00:00',
        missed: true,
        weekStart: '2026-11-09',
        which: 'last',
        target: 3,
        frozen: 1,
        targetAfter: 2,
        timeZone: 'Asia/Manila',
      },
    ])
    expect(rpc).toHaveBeenLastCalledWith('my_freeze_options', { p_group_id: 'g-1' })
  })

  it('maps my_freeze_requests rows and drops statuses the app does not show', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'f-1',
          commitment_id: 'c-2',
          session_id: 's-9',
          option_kind: 'week',
          week_start: '2026-11-16',
          status: 'pending',
          reason: 'knee',
          closes_at: '2026-11-22T02:00:00+00:00',
          starts_at: '2026-11-15T16:00:00+00:00',
          target_after: 2,
        },
        {
          id: 'f-2',
          commitment_id: 'c-1',
          session_id: 's-1',
          option_kind: 'day',
          week_start: '2026-11-16',
          status: 'withdrawn',
          reason: 'x',
          closes_at: '2026-11-22T02:00:00+00:00',
          starts_at: '2026-11-20T16:00:00+00:00',
          target_after: null,
        },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.listMyFreezeRequests('g-1')).toEqual([
      {
        id: 'f-1',
        commitmentId: 'c-2',
        sessionId: 's-9',
        kind: 'week',
        weekStart: '2026-11-16',
        status: 'pending',
        reason: 'knee',
        closesAt: '2026-11-22T02:00:00+00:00',
        startsAt: '2026-11-15T16:00:00+00:00',
        targetAfter: 2,
      },
    ])
    expect(rpc).toHaveBeenLastCalledWith('my_freeze_requests', { p_group_id: 'g-1' })
  })

  it('sends a day request with the session and a week request with the week', async () => {
    const row = {
      freeze_request_id: 'f-1',
      status: 'pending',
      closes_at: '2026-11-22T02:00:00+00:00',
      session_id: 's-1',
    }
    rpc.mockResolvedValueOnce({ data: [row], error: null, status: 200 })
    expect(
      await adapter.requestFreeze({
        commitmentId: 'c-1',
        reason: 'flu',
        sessionId: 's-1',
        weekStart: null,
      }),
    ).toEqual({
      freezeRequestId: 'f-1',
      status: 'pending',
      closesAt: '2026-11-22T02:00:00+00:00',
      sessionId: 's-1',
    })
    expect(rpc).toHaveBeenLastCalledWith('request_freeze', {
      p_commitment_id: 'c-1',
      p_reason: 'flu',
      p_session_id: 's-1',
    })

    rpc.mockResolvedValueOnce({ data: [{ ...row, status: 'approved' }], error: null, status: 200 })
    expect(
      await adapter.requestFreeze({
        commitmentId: 'c-2',
        reason: 'knee',
        sessionId: null,
        weekStart: '2026-11-16',
      }),
    ).toMatchObject({ status: 'approved' })
    expect(rpc).toHaveBeenLastCalledWith('request_freeze', {
      p_commitment_id: 'c-2',
      p_reason: 'knee',
      p_week_start: '2026-11-16',
    })
  })

  it('maps every refusal code, no response as network, and a malformed answer as unknown', async () => {
    const input = { commitmentId: 'c-1', reason: 'flu', sessionId: 's-1', weekStart: null }
    for (const code of [
      'not_member',
      'reason_required',
      'invalid_freeze',
      'week_locked',
      'session_done',
      'session_frozen',
      'freeze_pending',
      'fake_ruling_miss',
      'freeze_window_closed',
      'target_met',
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await codeOf(adapter.requestFreeze(input))).toBe(code)
    }
    rpc.mockResolvedValueOnce({ data: null, error: pgError('Failed to fetch'), status: 0 })
    expect(await codeOf(adapter.requestFreeze(input))).toBe('network')
    rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await codeOf(adapter.requestFreeze(input))).toBe('unknown')
    rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await codeOf(adapter.listFreezeOptions('g-1'))).toBe('not_member')
    rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await codeOf(adapter.listMyFreezeRequests('g-1'))).toBe('not_member')
  })
})
