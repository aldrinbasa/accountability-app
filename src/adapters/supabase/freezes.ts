import { BackendError } from '@/domain/error-codes'
import type { FreezeOption, FreezeRequest, RequestFreezeResult } from '@/domain/freeze'
import type { BackendPort } from '@/ports/backend-port'
import { supabase } from '@/adapters/supabase/client'
import type { Database } from '@/adapters/supabase/database.types'
import { toBackendError } from '@/adapters/supabase/rpc-error'

/**
 * The freeze RPCs (Story 5.4), their own module per the adapter split (Epic 4 retro A9). Spread
 * into `supabaseBackendAdapter`.
 */

type Functions = Database['public']['Functions']
type OptionRow = Functions['my_freeze_options']['Returns'][number]
type RequestRow = Functions['my_freeze_requests']['Returns'][number]
type RequestFreezeRow = Functions['request_freeze']['Returns'][number]

function oneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value)
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/** One `my_freeze_options` row, or null for an unknown kind (dropped). */
export function toFreezeOption(row: OptionRow): FreezeOption | null {
  const kind = row.option_kind
  const which = row.which
  if (!oneOf(kind, ['day', 'week'] as const) || !oneOf(which, ['this', 'last'] as const)) {
    return null
  }
  return {
    kind,
    commitmentId: row.commitment_id,
    // Nullable in SQL for week rows (the generated type says string).
    sessionId: (row.session_id as string | null) ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    windowEndsAt: row.window_ends_at,
    missed: row.missed === true,
    weekStart: row.week_start,
    which,
    target: nullableNumber(row.target),
    frozen: nullableNumber(row.frozen),
    targetAfter: nullableNumber(row.target_after),
    timeZone: row.time_zone,
  }
}

/** One `my_freeze_requests` row, or null for a status or kind the app does not show (dropped). */
export function toFreezeRequest(row: RequestRow): FreezeRequest | null {
  const status = row.status
  const kind = row.option_kind
  if (!oneOf(status, ['pending', 'approved'] as const) || !oneOf(kind, ['day', 'week'] as const)) {
    return null
  }
  return {
    id: row.id,
    commitmentId: row.commitment_id,
    sessionId: row.session_id,
    kind,
    weekStart: row.week_start,
    status,
    reason: row.reason,
    closesAt: row.closes_at,
    startsAt: row.starts_at,
    targetAfter: nullableNumber(row.target_after),
  }
}

/** `request_freeze`'s one row as a domain result; `unknown` for a malformed answer. */
export function toRequestFreezeResult(
  rows: readonly RequestFreezeRow[] | null,
): RequestFreezeResult {
  const row = rows?.[0]
  if (!row) throw new BackendError('unknown', 'request_freeze returned no request')
  const status = row.status
  if (!oneOf(status, ['pending', 'approved', 'denied'] as const)) {
    throw new BackendError('unknown', `request_freeze returned status ${status}`)
  }
  return {
    freezeRequestId: row.freeze_request_id,
    status,
    closesAt: row.closes_at,
    sessionId: row.session_id,
  }
}

export const freezeAdapter: Pick<
  BackendPort,
  'listFreezeOptions' | 'listMyFreezeRequests' | 'requestFreeze'
> = {
  async listFreezeOptions(groupId) {
    const { data, error, status } = await supabase.rpc('my_freeze_options', {
      p_group_id: groupId,
    })
    if (error) throw toBackendError(error, status)
    return (data ?? []).flatMap((row) => {
      const option = toFreezeOption(row)
      return option ? [option] : []
    })
  },

  async listMyFreezeRequests(groupId) {
    const { data, error, status } = await supabase.rpc('my_freeze_requests', {
      p_group_id: groupId,
    })
    if (error) throw toBackendError(error, status)
    return (data ?? []).flatMap((row) => {
      const request = toFreezeRequest(row)
      return request ? [request] : []
    })
  },

  async requestFreeze(input) {
    const { data, error, status } = await supabase.rpc('request_freeze', {
      p_commitment_id: input.commitmentId,
      p_reason: input.reason,
      ...(input.sessionId !== null ? { p_session_id: input.sessionId } : {}),
      ...(input.weekStart !== null ? { p_week_start: input.weekStart } : {}),
    })
    if (error) throw toBackendError(error, status)
    return toRequestFreezeResult(data)
  },
}
