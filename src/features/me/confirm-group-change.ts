import { useRef, useState } from 'react'
import { isBackendError } from '@/domain/error-codes'

/** Why a leave or remove did not go through: offline (no signal) or any other failure. */
export type GroupChangeFailure = 'offline' | 'failed'

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
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
      setFailure(isBackendError(error) && error.code === 'network' ? 'offline' : 'failed')
    }
  }

  function reset() {
    setFailure(null)
  }

  return { busy, failure, confirm, reset }
}
