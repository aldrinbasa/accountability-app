import { useEffect, useRef, useState } from 'react'
import { backendErrorCode } from '@/domain/error-codes'
import { endCommitmentTitle, MY_PLAN_COPY } from '@/domain/my-plan'
import { PLAN_COPY } from '@/domain/plan'
import { isOffline } from '@/data/connectivity'
import { useEndCommitment } from '@/data/plan'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { Sheet } from '@/ui/sheet'

/** The commitment the confirm is about: its id and activity name. */
export interface EndTarget {
  commitmentId: string
  name: string
}

/** Why an end did not go through. Only offline and a plain failure offer Retry. */
type EndFailure = 'offline' | 'failed' | 'ended'

function failureText(failure: EndFailure): string {
  switch (failure) {
    case 'offline':
      return PLAN_COPY.offline
    case 'failed':
      return PLAN_COPY.failed
    case 'ended':
      return MY_PLAN_COPY.wrappedUp
  }
}

export interface EndCommitmentSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  commitment: EndTarget
  /** Where focus goes on close (the Plan sheet's opener; this sheet replaced the Plan sheet). */
  returnFocusTo?: () => HTMLElement | null
}

/**
 * "End Gym?" confirm Sheet (Story 2.6): "It stops after this Sunday. Past check-ins stay in the
 * Feed." and one full-width coral "End" button; the close is cancel. `end_commitment` keeps this
 * week's sessions and creates none after (a commitment that has not started ends at once). Offline
 * and failure show the Plan sheet's Inline retry copy; an already ended or gone commitment shows
 * "That's already wrapped up." with no Retry, and the plan refetches.
 */
export function EndCommitmentSheet({
  open,
  onOpenChange,
  groupId,
  commitment,
  returnFocusTo,
}: EndCommitmentSheetProps) {
  const endCommitment = useEndCommitment(groupId)
  const [failure, setFailure] = useState<EndFailure | null>(null)
  const [busy, setBusy] = useState(false)
  // The guard itself: Retry and the button can race within one render.
  const busyRef = useRef(false)
  // Whether this confirm is still open; an end that settles after it closed is ignored.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])
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
      await endCommitment.mutateAsync(commitment.commitmentId)
      busyRef.current = false
      setBusy(false)
      // Closed meanwhile (maybe another sheet is open now): leave it alone.
      if (openRef.current) change(false)
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      if (!openRef.current) return
      const code = backendErrorCode(error)
      if (code === 'network') setFailure('offline')
      else if (code === 'commitment_ended' || code === 'not_found') setFailure('ended')
      else setFailure('failed')
    }
  }

  const canRetry = failure === 'offline' || failure === 'failed'

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      title={endCommitmentTitle(commitment.name)}
      returnFocusTo={returnFocusTo}
    >
      <div className="flex flex-col gap-4">
        <p className="type-body">{MY_PLAN_COPY.endBody}</p>
        {failure ? (
          <InlineRetry
            onRetry={canRetry ? () => void confirm() : undefined}
            retryLabel={PLAN_COPY.retry}
          >
            {failureText(failure)}
          </InlineRetry>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          busy={busy}
          busyLabel={MY_PLAN_COPY.ending}
          onClick={() => void confirm()}
        >
          {MY_PLAN_COPY.end}
        </Button>
      </div>
    </Sheet>
  )
}
