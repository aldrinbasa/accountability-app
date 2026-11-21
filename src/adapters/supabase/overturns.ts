import type { OverturnResult } from '@/domain/challenge'
import { BackendError } from '@/domain/error-codes'
import type { BackendPort } from '@/ports/backend-port'
import { supabase } from '@/adapters/supabase/client'
import type { Database } from '@/adapters/supabase/database.types'
import { toBackendError } from '@/adapters/supabase/rpc-error'

/**
 * The admin overturn RPC (Story 5.3), its own module per the adapter split (Epic 4 retro A9).
 * Spread into `supabaseBackendAdapter`.
 */

type OverturnRow = Database['public']['Functions']['overturn_ruling']['Returns'][number]

/** `overturn_ruling`'s one row as a domain result; `unknown` for a malformed answer. */
export function toOverturnResult(rows: readonly OverturnRow[] | null): OverturnResult {
  const row = rows?.[0]
  if (!row) throw new BackendError('unknown', 'overturn_ruling returned no overturn')
  return { overturnId: row.overturn_id, createdAt: row.created_at }
}

export const overturnAdapter: Pick<BackendPort, 'overturnRuling'> = {
  async overturnRuling(challengeId) {
    const { data, error, status } = await supabase.rpc('overturn_ruling', {
      p_challenge_id: challengeId,
    })
    if (error) throw toBackendError(error, status)
    return toOverturnResult(data)
  },
}
