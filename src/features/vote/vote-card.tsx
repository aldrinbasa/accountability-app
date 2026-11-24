import { useEffect, useRef, useState, type Ref } from 'react'
import { Check, Gavel } from '@phosphor-icons/react'
import { backendErrorCode } from '@/domain/error-codes'
import type { FeedCheckin, FeedViewer } from '@/domain/feed'
import {
  castFailure,
  choiceButtonLabel,
  choiceLabel,
  tallyLine,
  UNDO_WINDOW_MS,
  undoFailure,
  VOTE_COPY,
  voteCardState,
  voteCheckin,
  votedLine,
  votedToast,
  voteHeading,
  voteKicker,
  voteOverturnLine,
  voteRulingLine,
  voteShowsThumbnail,
  voteThumbnailLabel,
  voteWhoLine,
  type FeedVote,
  type VoteChoice,
} from '@/domain/vote'
import { isOffline } from '@/data/connectivity'
import { useCastVote, useRefetchFeed, useUndoVote, useVoteTallies } from '@/data/vote'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { cn } from '@/ui/lib/utils'
import { StickyNote } from '@/ui/sticky-note'
import { showToast } from '@/ui/toast'
import { CheckinPhoto } from '@/features/feed/checkin-photo'

const CHOICES: readonly VoteChoice[] = ['fake', 'real']

export interface VoteCardProps {
  item: FeedVote
  viewer: FeedViewer
  tilt: 'left' | 'right'
  /** The deep-linked card's article (scrolled to and focused). */
  articleRef?: Ref<HTMLElement>
  /** The thumbnail opens the Photo viewer on the challenged check-in. */
  onOpenPhoto?: (checkin: FeedCheckin, opener: HTMLButtonElement) => void
}

/**
 * The challenge Vote card (Story 5.2): a lavender sticky with the kicker "QUESTION · 18 H LEFT", a
 * 52px thumbnail of the check-in (opens the Photo viewer), "Lena questioned Dev's Study check-in.",
 * "Does this count?", the rule line, Doesn't count | Counts on a level row, and "N of M voted" from
 * `vote_tallies`. A tap casts at once; the toast "You said it doesn't count" offers Undo for 5 s. Locked states
 * (challenger, owner, joined later, past the deadline) show a status line instead of buttons; a
 * closed card shows the ruling line (the overturned line once an admin overturned a Fake ruling,
 * with its thumbnail back), a cancelled one a struck kicker. The card's own polite status
 * announces "Vote undone." and a ruling that arrives while it is on screen, once each.
 */
export function VoteCard({ item, viewer, tilt, articleRef, onOpenPhoto }: VoteCardProps) {
  const cast = useCastVote(item.groupId)
  const undo = useUndoVote(item.groupId)
  const refetchFeed = useRefetchFeed(item.groupId)
  const tallies = useVoteTallies(item.groupId)
  const tally = tallies.data?.find((entry) => entry.targetId === item.id) ?? null
  const [failedChoice, setFailedChoice] = useState<VoteChoice | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const seenStatus = useRef(item.status)

  const state = voteCardState(item, viewer)
  const kicker = voteKicker(item, viewer.now)
  const ruling = voteRulingLine(item, viewer.userId)
  // Story 5.3: an overturned Fake ruling reads "Overturned by Jo · Dev's Study is back." instead.
  const closedLine = voteOverturnLine(item, viewer.userId) ?? ruling
  const toastId = `vote-${item.id}`

  // A ruling that arrives while the card is mounted is read once.
  useEffect(() => {
    const before = seenStatus.current
    seenStatus.current = item.status
    if (before !== 'open' || (item.status !== 'fake' && item.status !== 'real')) return
    if (ruling) setAnnouncement(ruling)
  }, [item.status, ruling])

  function sendUndo(castAt: number) {
    if (isOffline()) {
      showToast(VOTE_COPY.undoOffline, { variant: 'error', id: toastId })
      return
    }
    // mutateAsync, not mutate's per-call callbacks: the toast's Undo can outlive the card (the
    // member left the Feed), and a failure must still say so.
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

  function sendVote(choice: VoteChoice) {
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

  const showQuestion =
    state.kind === 'open' ||
    state.kind === 'voted' ||
    state.kind === 'challenger' ||
    state.kind === 'joinedLater'
  const statusLine =
    state.kind === 'challenger'
      ? VOTE_COPY.challenger
      : state.kind === 'joinedLater'
        ? VOTE_COPY.joinedLater
        : state.kind === 'closing'
          ? VOTE_COPY.closing
          : null
  const footer =
    state.kind === 'voted'
      ? votedLine(state.choice, tally)
      : state.kind === 'closed' || state.kind === 'cancelled' || !tally
        ? null
        : tallyLine(tally)
  const thumbnail = voteShowsThumbnail(item)
  const checkin = voteCheckin(item)

  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      className="px-[10px] outline-none"
      data-feed-item={item.id}
      data-kind="vote"
      data-vote-state={state.kind}
    >
      <h2 className="sr-only">{voteHeading(item, viewer.userId)}</h2>
      <StickyNote tilt={tilt} tone="vote" className="mx-auto w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <Icon icon={Gavel} size={20} />
          <span aria-hidden="true" className={cn(state.kind === 'cancelled' && 'line-through')}>
            {kicker.text}
          </span>
          <span className="sr-only">
            {state.kind === 'cancelled' ? `${kicker.spoken}, cancelled` : kicker.spoken}
          </span>
        </p>
        <div className="flex items-start gap-3">
          {thumbnail ? (
            <button
              type="button"
              aria-label={voteThumbnailLabel(item, viewer.userId)}
              onClick={(event) => onOpenPhoto?.(checkin, event.currentTarget)}
              onContextMenu={(event) => event.preventDefault()}
              className="on-object relative block size-[52px] shrink-0 overflow-hidden rounded-thumb border-2 border-obj-ink bg-linear-to-br from-ph1 to-ph2 press-overlay"
              data-component="flat-thumbnail"
            >
              <CheckinPhoto item={checkin} alt="" variant="mini" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="type-body-sm break-words text-obj-ink">
              {voteWhoLine(item, viewer.userId)}
            </p>
            {showQuestion ? <h3 className="type-title-sm">{VOTE_COPY.question}</h3> : null}
          </div>
        </div>
        {showQuestion ? <p className="mt-2 type-meta text-obj-muted">{VOTE_COPY.rule}</p> : null}
        {state.kind === 'closed' && closedLine ? (
          <p className="mt-2 type-hand-md">{closedLine}</p>
        ) : null}
        {state.kind === 'cancelled' ? (
          <p className="mt-2 type-hand-md">{VOTE_COPY.cancelled}</p>
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
                    aria-label={choiceButtonLabel(choice)}
                    aria-disabled={state.kind === 'voted' || undefined}
                    busy={cast.isPending && cast.variables?.choice === choice}
                    onClick={() => {
                      if (state.kind === 'open') sendVote(choice)
                    }}
                  >
                    {selected ? (
                      <Check weight="bold" size={20} aria-hidden="true" focusable="false" />
                    ) : null}
                    {choiceLabel(choice)}
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
        {/* Mounted with the card, then filled on an undo or a ruling, so the change is read. */}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </StickyNote>
    </article>
  )
}
