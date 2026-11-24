import { BackendError } from '@/domain/error-codes'
import type { CastVoteResult, VoteTally } from '@/domain/vote'
import type { BackendPort } from '@/ports/backend-port'
import { supabase } from '@/adapters/supabase/client'
import type { Database } from '@/adapters/supabase/database.types'
import { toBackendError } from '@/adapters/supabase/rpc-error'

/**
 * The vote RPCs (Stories 5.2, 5.5: challenges and freeze requests), in their own module (Epic 4 retro A9: split the adapter by area).
 * Spread into `supabaseBackendAdapter`.
 */

type CastVoteRow = Database['public']['Functions']['cast_vote']['Returns'][number]
type VoteTallyRow = Database['public']['Functions']['vote_tallies']['Returns'][number]

/** `cast_vote`'s one row; `unknown` for a malformed answer. */
export function toCastVoteResult(rows: readonly CastVoteRow[] | null): CastVoteResult {
  const row = rows?.[0]
  if (!row?.vote_id || !row.cast_at) {
    throw new BackendError('unknown', 'cast_vote returned no ballot')
  }
  return { voteId: row.vote_id, castAt: row.cast_at }
}

/** `vote_tallies` rows as tallies; kinds the app does not know are dropped. */
export function toVoteTallies(rows: readonly VoteTallyRow[] | null): VoteTally[] {
  return (rows ?? []).flatMap((row): VoteTally[] =>
    row.target_kind === 'challenge' || row.target_kind === 'freeze'
      ? [
          {
            targetKind: row.target_kind,
            targetId: row.target_id,
            votedCount: row.voted_count,
            eligibleCount: row.eligible_count,
          },
        ]
      : [],
  )
}

export const voteAdapter: Pick<BackendPort, 'castVote' | 'undoVote' | 'listVoteTallies'> = {
  async castVote(kind, id, choice) {
    const { data, error, status } = await supabase.rpc('cast_vote', {
      p_kind: kind,
      p_id: id,
      p_choice: choice,
    })
    if (error) throw toBackendError(error, status)
    return toCastVoteResult(data)
  },

  async undoVote(kind, id) {
    const { error, status } = await supabase.rpc('undo_vote', { p_kind: kind, p_id: id })
    if (error) throw toBackendError(error, status)
  },

  async listVoteTallies(groupId) {
    const { data, error, status } = await supabase.rpc('vote_tallies', { p_group_id: groupId })
    if (error) throw toBackendError(error, status)
    return toVoteTallies(data)
  },
}
