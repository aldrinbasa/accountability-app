import {
  CHALLENGE_COPY,
  challengeActionLabel,
  challengeFailure,
  challengeFailureText,
  challengeSheetBody,
  challengeSheetMeta,
  challengeSheetTitle,
  type ChallengeFailure,
} from '@/domain/challenge'
import type { FeedCheckin } from '@/domain/feed'
import { useCreateChallenge, useInvalidateChallengeViews } from '@/data/challenge'
import { ConfirmSheet } from '@/features/plan/confirm-sheet'

export interface ChallengeSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: FeedCheckin
  /** Current members of the group: 2 → the at-once ruling copy, 3+ → the vote copy. */
  memberCount: number
  /** Where focus goes on close. */
  returnFocusTo?: () => HTMLElement | null
  /**
   * The challenge went through (called before the sheet closes); `ruledFake` is the server's answer
   * (a group of two at the server rules it Fake at once, whatever the cached member count said).
   */
  onDone?: (ruledFake: boolean) => void
}

/**
 * The challenge confirm Sheet (Story 5.1): "Challenge Dev's Study?" with the vote rules, the ritual
 * meta line and one coral "Challenge" (3+ members), or the at-once ruling and "Rule it Fake" (2
 * members); the close is cancel. Offline and a plain failure show the challenge's own Inline retry
 * copy with Retry (the same request again). Already challenged, past its window or a locked week
 * read "That check-in can't be challenged anymore." with no Retry; every refusal refetches the
 * group's views so the Overflow goes away. Success refetches them too (`useCreateChallenge`).
 */
export function ChallengeSheet({
  open,
  onOpenChange,
  item,
  memberCount,
  returnFocusTo,
  onDone,
}: ChallengeSheetProps) {
  const create = useCreateChallenge(item.groupId)
  const refetch = useInvalidateChallengeViews(item.groupId)
  return (
    <ConfirmSheet<ChallengeFailure>
      open={open}
      onOpenChange={onOpenChange}
      title={challengeSheetTitle(item)}
      body={challengeSheetBody(memberCount)}
      meta={challengeSheetMeta(memberCount)}
      actionLabel={challengeActionLabel(memberCount)}
      busyLabel={CHALLENGE_COPY.sending}
      run={async () => {
        const result = await create.mutateAsync(item.id)
        onDone?.(result.status === 'fake')
        return result
      }}
      onError={(code) => {
        const failure = challengeFailure(code)
        if (failure !== 'failed') refetch()
        return failure
      }}
      failureText={challengeFailureText}
      offlineText={CHALLENGE_COPY.offline}
      failedText={CHALLENGE_COPY.failed}
      returnFocusTo={returnFocusTo}
    />
  )
}
