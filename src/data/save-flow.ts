import { useCallback, useEffect, useRef, useState } from 'react'
import { backendErrorCode, type BackendErrorCode } from '@/domain/error-codes'
import { isOffline } from '@/data/connectivity'

/** Why a save did not go through: offline, a plain failure, or a caller's own reason. */
export type SaveFailure<F extends string = never> = 'offline' | 'failed' | F

/** Only offline and a plain failure offer Retry; a caller's own reasons don't. */
export function canRetry(failure: string | null): boolean {
  return failure === 'offline' || failure === 'failed'
}

export interface SaveFlowOptions<I, R, F extends string = never> {
  /** The request itself (usually a mutation's `mutateAsync`). */
  run: (input: I) => Promise<R>
  /**
   * The save went through. Called even when the caller unmounted or `active` went false meanwhile
   * (a toast should still show); `live` says whether the caller should still act on screen.
   */
  onSaved: (result: R, input: I, live: boolean) => void
  /**
   * A rejected save that was not `network` (always `offline`). Returns the failure to show, or
   * null when the caller handled it (a field error): no inline failure, and Retry has nothing to
   * resend. Without it every such code is `failed`. Not called once the caller is not live.
   */
  onError?: (code: BackendErrorCode, input: I) => SaveFailure<F> | null
  /** Stay busy after a save (the sheet is closing), so nothing can send twice. */
  holdBusyOnSaved?: boolean
  /** Whether results still matter (a confirm Sheet: while it is open). Default true. */
  active?: boolean
}

export interface SaveFlow<I, F extends string = never> {
  failure: SaveFailure<F> | null
  /** For the Button's busy look. */
  busy: boolean
  /** The guard itself (Retry and Save can race within one render). */
  isBusy: () => boolean
  /** Saves `input`: offline and busy checks, the request, then saved or a failure. */
  send: (input: I) => Promise<void>
  /** Resends the last input; false when there is none (nothing was sent, or an edit reset it). */
  retry: () => boolean
  /** An edit made the failed request stale: no failure, and Retry must not resend it. */
  reset: () => void
  setFailure: (failure: SaveFailure<F> | null) => void
}

/**
 * The client save flow shared by the Plan sheet's forms and confirm Sheets (Epic 2 retro D2): a
 * busy guard, the offline check before sending, the request, `offline` for `network` and the
 * caller's mapping (else `failed`) for anything else, and Retry with the last input.
 */
export function useSaveFlow<I, R, F extends string = never>({
  run,
  onSaved,
  onError,
  holdBusyOnSaved = false,
  active = true,
}: SaveFlowOptions<I, R, F>): SaveFlow<I, F> {
  const [failure, setFailure] = useState<SaveFailure<F> | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const lastInput = useRef<{ input: I } | null>(null)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  // The latest callbacks, so a save that settles late uses what the caller renders now.
  const callbacks = useRef({ run, onSaved, onError })

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    callbacks.current = { run, onSaved, onError }
  })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const send = useCallback(
    async (input: I) => {
      if (busyRef.current) return
      lastInput.current = { input }
      if (isOffline()) {
        setFailure('offline')
        return
      }
      busyRef.current = true
      setBusy(true)
      setFailure(null)
      let result: R
      try {
        result = await callbacks.current.run(input)
      } catch (error) {
        busyRef.current = false
        if (mounted.current) setBusy(false)
        if (!mounted.current || !activeRef.current) return
        const code = backendErrorCode(error)
        if (code === 'network') {
          setFailure('offline')
          return
        }
        const handler = callbacks.current.onError
        const next = handler ? handler(code, input) : 'failed'
        if (next === null) lastInput.current = null
        setFailure(next)
        return
      }
      if (!holdBusyOnSaved) {
        busyRef.current = false
        if (mounted.current) setBusy(false)
      }
      callbacks.current.onSaved(result, input, mounted.current && activeRef.current)
    },
    [holdBusyOnSaved],
  )

  const retry = useCallback(() => {
    const last = lastInput.current
    if (last === null) return false
    void send(last.input)
    return true
  }, [send])

  const reset = useCallback(() => {
    setFailure(null)
    lastInput.current = null
  }, [])

  const isBusy = useCallback(() => busyRef.current, [])

  return { failure, busy, isBusy, send, retry, reset, setFailure }
}
