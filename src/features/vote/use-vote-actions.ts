import { useEffect, useRef, useState } from 'react'
import { backendErrorCode } from '@/domain/error-codes'
import {
  castFailure,
  UNDO_WINDOW_MS,
  undoFailure,
  VOTE_COPY,
  type AnyVoteChoice,
  type VoteKind,
} from '@/domain/vote'
import { isOffline } from '@/data/connectivity'
import { useCastVote, useRefetchFeed, useUndoVote } from '@/data/vote'
import { useInvalidateVoteOutcomeViews } from '@/data/vote-outcome'
import { showToast } from '@/ui/toast'

export interface VoteActionsOptions<C extends AnyVoteChoice> {
  groupId: string
  kind: VoteKind
  /** The challenge or freeze request id. */
  voteId: string
  /** The cast toast: "You said it counts" / "Voted Approve". */
  votedToast: (choice: C) => string
  /**
   * What the vote's outcome is now, as far as other views care (`fake`, `fake:overturned`,
   * `approved`, `cancelled:overturned`, ...); null while open or for a state that changes no view.
   * A change after mount to a non-null key refetches every view an outcome can change.
   */
  outcomeKey: string | null
  /** The line announced with that change (a ruling, a freeze outcome); null announces nothing. */
  outcome: string | null
}

export interface VoteActions<C extends AnyVoteChoice> {
  /** Casts at once; the toast offers Undo for 5 s. Offline says so and sends nothing. */
  sendVote: (choice: C) => void
  /** The choice whose send failed online (the card's Inline retry), else null. */
  failedChoice: C | null
  /** The choice being sent (its button is busy), else null. */
  busyChoice: C | null
  /** The card's polite status: "Vote undone." or an outcome that arrived on screen, once each. */
  announcement: string
}

/**
 * The cast / undo / outcome logic both Vote cards share (Epic 5 retro A2): one tap casts, the toast
 * offers Undo for the 5 s window, a refusal reads its copy and refetches the Feed, an online failure
 * shows the Inline retry. An outcome that arrives while the card is mounted is announced once and
 * refetches every view it changes (`useInvalidateVoteOutcomeViews`): Today, My plan, the board,
 * streaks, profiles and the goal, for a challenge ruling as for a freeze outcome.
 */
export function useVoteActions<C extends AnyVoteChoice>({
  groupId,
  kind,
  voteId,
  votedToast,
  outcomeKey,
  outcome,
}: VoteActionsOptions<C>): VoteActions<C> {
  const cast = useCastVote(groupId)
  const undo = useUndoVote(groupId, kind)
  const refetchFeed = useRefetchFeed(groupId)
  const invalidateOutcomeViews = useInvalidateVoteOutcomeViews(groupId)
  const [failedChoice, setFailedChoice] = useState<C | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const seenKey = useRef(outcomeKey)
  const toastId = `vote-${voteId}`

  const invalidateViews = useRef(invalidateOutcomeViews)
  useEffect(() => {
    invalidateViews.current = invalidateOutcomeViews
  })

  // An outcome that arrives while the card is mounted (a ruling, a freeze outcome, an overturn
  // seen by another member) refetches the views it changes and is read once. The Feed refetch this
  // triggers brings the same key, so nothing runs again.
  useEffect(() => {
    const before = seenKey.current
    seenKey.current = outcomeKey
    if (outcomeKey === before || outcomeKey === null) return
    invalidateViews.current()
    if (outcome !== null) setAnnouncement(outcome)
  }, [outcomeKey, outcome])

  function sendUndo(castAt: number) {
    if (isOffline()) {
      showToast(VOTE_COPY.undoOffline, { variant: 'error', id: toastId })
      return
    }
    // mutateAsync, not mutate's per-call callbacks: the toast's Undo can outlive the card (the
    // member left the Feed), and a failure must still say so.
    void (async () => {
      try {
        await undo.mutateAsync(voteId)
        setAnnouncement(VOTE_COPY.undone)
      } catch (error) {
        const failure = undoFailure(backendErrorCode(error), isOffline())
        if (failure.kind === 'refused') refetchFeed()
        const windowOpen = Date.now() < castAt + UNDO_WINDOW_MS
        showToast(failure.text, {
          variant: 'error',
          id: toastId,
          action:
            failure.kind === 'failed' && windowOpen
              ? { label: VOTE_COPY.retry, onClick: () => sendUndo(castAt) }
              : undefined,
        })
      }
    })()
  }

  function sendVote(choice: C) {
    if (cast.isPending) return
    setFailedChoice(null)
    if (isOffline()) {
      showToast(VOTE_COPY.offline, { variant: 'error', id: toastId })
      return
    }
    cast.mutate(
      { voteId, choice },
      {
        onSuccess: () => {
          setAnnouncement('')
          const castAt = Date.now()
          showToast(votedToast(choice), {
            id: toastId,
            action: { label: VOTE_COPY.undo, onClick: () => sendUndo(castAt) },
          })
        },
        onError: (error) => {
          const failure = castFailure(backendErrorCode(error), isOffline())
          if (failure.kind === 'offline') {
            showToast(VOTE_COPY.offline, { variant: 'error', id: toastId })
          } else if (failure.kind === 'failed') {
            setFailedChoice(choice)
          } else {
            showToast(failure.text, { variant: 'error', id: toastId })
            refetchFeed()
          }
        },
      },
    )
  }

  const busyChoice = cast.isPending ? ((cast.variables?.choice as C | undefined) ?? null) : null

  return { sendVote, failedChoice, busyChoice, announcement }
}
