import { useEffect, useRef, useState, type Ref } from 'react'
import { Check, Snowflake } from '@phosphor-icons/react'
import { backendErrorCode } from '@/domain/error-codes'
import type { FeedViewer } from '@/domain/feed'
import {
  FREEZE_VOTE_COPY,
  freezeCancelledLine,
  freezeChoiceButtonLabel,
  freezeChoiceLabel,
  freezeOutcomeLine,
  freezeRequestLine,
  freezeRuleLine,
  freezeVoteCardState,
  freezeVotedLine,
  freezeVotedToast,
  freezeVoteHeading,
  freezeVoteKicker,
  reasonLabel,
  type FeedFreezeVote,
} from '@/domain/freeze-vote'
import {
  castFailure,
  tallyLine,
  UNDO_WINDOW_MS,
  undoFailure,
  VOTE_COPY,
  type FreezeChoice,
} from '@/domain/vote'
import { isOffline } from '@/data/connectivity'
import { useInvalidateFreezeViews } from '@/data/freeze'
import { useCastVote, useRefetchFeed, useUndoVote, useVoteTallies } from '@/data/vote'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { cn } from '@/ui/lib/utils'
import { StickyNote } from '@/ui/sticky-note'
import { showToast } from '@/ui/toast'

const CHOICES: readonly FreezeChoice[] = ['approve', 'deny']

export interface FreezeVoteCardProps {
  item: FeedFreezeVote
  viewer: FeedViewer
  tilt: 'left' | 'right'
  /** The deep-linked card's article (scrolled to and focused). */
  articleRef?: Ref<HTMLElement>
}

/**
 * The freeze Vote card (Story 5.5, DESIGN.md `vote-card-freeze`): the challenge card's anatomy on a
 * yellow sticky. Kicker "FREEZE REQUEST · 21 H LEFT", the request line ("Dev wants Study on Sat
 * frozen."), the reason in `hand-md` (named "Reason: flu, in bed"), Approve | Deny on a level row,
 * the rule line ("No votes means approved.", 2 members "Just you deciding. No vote means
 * approved.") and "N of M voted". A tap casts at once; the toast "Voted Approve" offers Undo for
 * 5 s. The requester sees "Your request · waiting on the group" instead of buttons; a closed card
 * shows the outcome line, a cancelled one a struck kicker. The card's polite status announces
 * "Vote undone." and an outcome that arrives while it is on screen, once each.
 */
export function FreezeVoteCard({ item, viewer, tilt, articleRef }: FreezeVoteCardProps) {
  const cast = useCastVote(item.groupId)
  const undo = useUndoVote(item.groupId, 'freeze')
  const refetchFeed = useRefetchFeed(item.groupId)
  const invalidateFreezeViews = useInvalidateFreezeViews(item.groupId)
  const tallies = useVoteTallies(item.groupId)
  const tally = tallies.data?.find((entry) => entry.targetId === item.id) ?? null
  const [failedChoice, setFailedChoice] = useState<FreezeChoice | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const seenStatus = useRef(item.status)

  const state = freezeVoteCardState(item, viewer)
  const kicker = freezeVoteKicker(item, viewer.now)
  const outcome = state.kind === 'closed' ? freezeOutcomeLine(item, state.outcome) : null
  const toastId = `vote-${item.id}`

  const invalidateViews = useRef(invalidateFreezeViews)
  useEffect(() => {
    invalidateViews.current = invalidateFreezeViews
  })

  // An outcome that arrives while the card is mounted is read once, and the views it changes
  // (Today's frozen row or lowered ring, My plan, the board, streaks) refetch.
  useEffect(() => {
    const before = seenStatus.current
    seenStatus.current = item.status
    if (before !== 'pending' || (item.status !== 'approved' && item.status !== 'denied')) return
    setAnnouncement(freezeOutcomeLine(item, item.status))
    invalidateViews.current()
  }, [item])

  function sendUndo(castAt: number) {
    if (isOffline()) {
      showToast(VOTE_COPY.undoOffline, { variant: 'error', id: toastId })
      return
    }
    // mutateAsync: the toast's Undo can outlive the card, and a failure must still say so.
    void (async () => {
      try {
        await undo.mutateAsync(item.id)
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

  function sendVote(choice: FreezeChoice) {
    if (cast.isPending) return
    setFailedChoice(null)
    if (isOffline()) {
      showToast(VOTE_COPY.offline, { variant: 'error', id: toastId })
      return
    }
    cast.mutate(
      { voteId: item.id, choice },
      {
        onSuccess: () => {
          setAnnouncement('')
          const castAt = Date.now()
          showToast(freezeVotedToast(choice), {
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

  const showRule = state.kind === 'open' || state.kind === 'voted' || state.kind === 'joinedLater'
  const statusLine =
    state.kind === 'requester'
      ? FREEZE_VOTE_COPY.requester
      : state.kind === 'joinedLater'
        ? VOTE_COPY.joinedLater
        : state.kind === 'closing'
          ? VOTE_COPY.closing
          : null
  const footer =
    state.kind === 'voted'
      ? freezeVotedLine(state.choice, tally)
      : state.kind === 'closed' || state.kind === 'cancelled' || !tally
        ? null
        : tallyLine(tally)

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      className="px-[10px] outline-none"
      data-feed-item={item.id}
      data-kind="freeze-vote"
      data-vote-state={state.kind}
    >
      <h2 className="sr-only">{freezeVoteHeading(item, viewer.userId)}</h2>
      <StickyNote tilt={tilt} className="mx-auto w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <Icon icon={Snowflake} size={20} />
          <span aria-hidden="true" className={cn(state.kind === 'cancelled' && 'line-through')}>
            {kicker.text}
          </span>
          <span className="sr-only">
            {state.kind === 'cancelled' ? `${kicker.spoken}, cancelled` : kicker.spoken}
          </span>
        </p>
        <p className="type-body-sm break-words text-obj-ink">
          {freezeRequestLine(item, viewer.userId)}
        </p>
        <p className="mt-1 type-hand-md break-words">
          <span className="sr-only">{reasonLabel(item.reason)}</span>
          <span aria-hidden="true">{item.reason}</span>
        </p>
        {showRule ? <p className="mt-2 type-meta text-obj-muted">{freezeRuleLine(item)}</p> : null}
        {outcome ? <p className="mt-2 type-hand-md">{outcome}</p> : null}
        {state.kind === 'cancelled' ? (
          <p className="mt-2 type-hand-md">{freezeCancelledLine(item)}</p>
        ) : null}
        {/* Counter-rotated so the buttons and their tally sit level on the tilted card. */}
        <div
          className={cn(
            'mt-3 flex flex-col gap-2',
            tilt === 'left' ? 'rotate-[1.5deg]' : '-rotate-[1.5deg]',
          )}
        >
          {state.kind === 'open' || state.kind === 'voted' ? (
            <div className="flex gap-vote-gap" data-component="vote-buttons">
              {CHOICES.map((choice) => {
                const selected = state.kind === 'voted' && state.choice === choice
                return (
                  <Button
                    key={choice}
                    variant="on-object"
                    className="min-w-0 flex-1"
                    selected={selected}
                    aria-label={freezeChoiceButtonLabel(choice)}
                    aria-disabled={state.kind === 'voted' || undefined}
                    busy={cast.isPending && cast.variables?.choice === choice}
                    onClick={() => {
                      if (state.kind === 'open') sendVote(choice)
                    }}
                  >
                    {selected ? (
                      <Check weight="bold" size={20} aria-hidden="true" focusable="false" />
                    ) : null}
                    {freezeChoiceLabel(choice)}
                  </Button>
                )
              })}
            </div>
          ) : null}
          {failedChoice !== null && state.kind === 'open' ? (
            <InlineRetry
              onObject
              retryLabel={VOTE_COPY.retry}
              onRetry={() => sendVote(failedChoice)}
            >
              {VOTE_COPY.failed}
            </InlineRetry>
          ) : null}
          {statusLine ? <p className="type-body-sm font-extrabold">{statusLine}</p> : null}
          {footer ? <p className="type-meta tabular-nums">{footer}</p> : null}
        </div>
        {/* Mounted with the card, then filled on an undo or an outcome, so the change is read. */}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </StickyNote>
    </article>
  )
}
