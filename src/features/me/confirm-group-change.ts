import { useRef, useState } from 'react'
import {
  backendErrorCode,
  errorCopy,
  isRpcErrorCode,
  type RpcErrorCode,
} from '@/domain/error-codes'
import { LEAVE_COPY } from '@/domain/groups'
import { isOffline } from '@/data/connectivity'

/**
 * Why a leave or remove did not go through: offline (no signal), a known backend code (e.g.
 * `not_admin`, shown with its own copy), or any other failure.
 */
export type GroupChangeFailure = 'offline' | 'failed' | RpcErrorCode

/** The Inline retry copy for a failure: the offline line, the code's own copy, or the generic line. */
export function groupChangeFailureText(failure: GroupChangeFailure): string {
  if (failure === 'offline') return LEAVE_COPY.offline
  if (failure === 'failed') return LEAVE_COPY.failed
  return errorCopy(failure)
}

function failureOf(error: unknown): GroupChangeFailure {
  const code = backendErrorCode(error)
  if (code === 'network') return 'offline'
  return isRpcErrorCode(code) ? code : 'failed'
}

/**
 * Runs a leave or remove from its confirm Sheet: ignores repeat taps while busy, refuses at once when
 * the device is offline, and maps a failure to Inline retry copy. The Sheet stays open on failure.
 */
export function useGroupChange(run: () => Promise<void>, onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<GroupChangeFailure | null>(null)
  const busyRef = useRef(false)

  async function confirm() {
    if (busyRef.current) return
    if (isOffline()) {
      setFailure('offline')
      return
    }
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    try {
      await run()
      busyRef.current = false
      setBusy(false)
      onDone()
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      setFailure(failureOf(error))
    }
  }

  function reset() {
    setFailure(null)
  }

  return { busy, failure, confirm, reset }
}
