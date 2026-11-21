import type { PostgrestError } from '@supabase/supabase-js'
import { BackendError, isRpcErrorCode } from '@/domain/error-codes'

/**
 * Maps a PostgREST response error onto a `BackendError`. A request that never got a response comes
 * back with HTTP status 0 (supabase-js turns the fetch failure into an error); an RPC exception whose
 * message is a known AD-14 code becomes that code, keeping the exception's DETAIL (`details`).
 */
export function toBackendError(error: PostgrestError, status: number): BackendError {
  if (status === 0) return new BackendError('network', error.message)
  if (isRpcErrorCode(error.message)) {
    return new BackendError(error.message, error.message, error.details || null)
  }
  return new BackendError('unknown', error.message)
}
