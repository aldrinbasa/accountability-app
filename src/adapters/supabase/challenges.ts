import type { CreateChallengeResult } from '@/domain/challenge'
import { BackendError } from '@/domain/error-codes'
import type { BackendPort } from '@/ports/backend-port'
import { supabase } from '@/adapters/supabase/client'
import type { Database } from '@/adapters/supabase/database.types'
import { toBackendError } from '@/adapters/supabase/rpc-error'

/**
 * The challenge RPCs (Story 5.1), kept out of `backend-adapter.ts` (Epic 4 retro A9: split the
 * adapter by area). Spread into `supabaseBackendAdapter`.
 */

type CreateChallengeRow = Database['public']['Functions']['create_challenge']['Returns'][number]

/** `create_challenge`'s one row as a domain result; `unknown` for a malformed answer. */
export function toCreateChallengeResult(
  rows: readonly CreateChallengeRow[] | null,
): CreateChallengeResult {
  const row = rows?.[0]
  if (!row || (row.status !== 'open' && row.status !== 'fake')) {
    throw new BackendError('unknown', 'create_challenge returned no challenge')
  }
  return { challengeId: row.challenge_id, status: row.status, closesAt: row.closes_at }
}

export const challengeAdapter: Pick<BackendPort, 'createChallenge'> = {
  async createChallenge(checkinId) {
    const { data, error, status } = await supabase.rpc('create_challenge', {
      p_checkin_id: checkinId,
    })
    if (error) throw toBackendError(error, status)
    return toCreateChallengeResult(data)
  },
}
