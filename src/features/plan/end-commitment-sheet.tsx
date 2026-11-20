import { endCommitmentTitle, MY_PLAN_COPY } from '@/domain/my-plan'
import { useEndCommitment } from '@/data/plan'
import { ConfirmSheet } from '@/features/plan/confirm-sheet'

/** The commitment the confirm is about: its id and activity name. */
export interface EndTarget {
  commitmentId: string
  name: string
}

/** Why an end did not go through, besides offline and a plain failure (no Retry for this). */
type EndFailure = 'ended'

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
  return (
    <ConfirmSheet<EndFailure>
      open={open}
      onOpenChange={onOpenChange}
      title={endCommitmentTitle(commitment.name)}
      body={MY_PLAN_COPY.endBody}
      actionLabel={MY_PLAN_COPY.end}
      busyLabel={MY_PLAN_COPY.ending}
      run={() => endCommitment.mutateAsync(commitment.commitmentId)}
      onError={(code) => (code === 'commitment_ended' || code === 'not_found' ? 'ended' : 'failed')}
      failureText={() => MY_PLAN_COPY.wrappedUp}
      returnFocusTo={returnFocusTo}
    />
  )
}
