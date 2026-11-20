import { useState } from 'react'
import type { BackendErrorCode } from '@/domain/error-codes'
import { PLAN_COPY } from '@/domain/plan'
import { canRetry, useSaveFlow, type SaveFailure } from '@/data/save-flow'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { Sheet } from '@/ui/sheet'

export interface ConfirmSheetProps<F extends string> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  /** The one full-width coral button, and its busy label. */
  actionLabel: string
  busyLabel: string
  /** The request the button sends. */
  run: () => Promise<unknown>
  /** A rejected request that was not `network`: the failure to show (only offline and failed retry). */
  onError: (code: BackendErrorCode) => SaveFailure<F>
  /** The copy of the caller's own failures (offline and failed use the Plan sheet's copy). */
  failureText: (failure: F) => string
  /** Where focus goes on close. */
  returnFocusTo?: () => HTMLElement | null
  /** The request went through (called before the sheet closes, so focus can go elsewhere). */
  onDone?: () => void
}

/**
 * A confirm Sheet (Story 2.4 delete task, Story 2.6 end commitment): a title, one body line and one
 * full-width coral button; the close is cancel. Offline and failure show the Plan sheet's Inline
 * retry copy with Retry; the caller's own failures show its copy with no Retry. A request that
 * settles after the sheet closed is ignored (the done callback still runs), and every open starts
 * without the last open's failure.
 */
export function ConfirmSheet<F extends string>({
  open,
  onOpenChange,
  title,
  body,
  actionLabel,
  busyLabel,
  run,
  onError,
  failureText,
  returnFocusTo,
  onDone,
}: ConfirmSheetProps<F>) {
  const flow = useSaveFlow<void, unknown, F>({
    run: () => run(),
    onSaved: (_result, _input, live) => {
      onDone?.()
      // Closed meanwhile (maybe another sheet is open now): leave it alone.
      if (live) change(false)
    },
    onError: (code) => onError(code),
    active: open,
  })
  const { failure, setFailure } = flow

  // Every open starts without the last open's failure.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setFailure(null)
  }

  function change(next: boolean) {
    if (!next) setFailure(null)
    onOpenChange(next)
  }

  function text(value: SaveFailure<F>): string {
    if (value === 'offline') return PLAN_COPY.offline
    if (value === 'failed') return PLAN_COPY.failed
    return failureText(value as F)
  }

  return (
    <Sheet open={open} onOpenChange={change} title={title} returnFocusTo={returnFocusTo}>
      <div className="flex flex-col gap-4">
        <p className="type-body">{body}</p>
        {failure ? (
          <InlineRetry
            onRetry={canRetry(failure) ? () => void flow.send() : undefined}
            retryLabel={PLAN_COPY.retry}
          >
            {text(failure)}
          </InlineRetry>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          busy={flow.busy}
          busyLabel={busyLabel}
          onClick={() => void flow.send()}
        >
          {actionLabel}
        </Button>
      </div>
    </Sheet>
  )
}
