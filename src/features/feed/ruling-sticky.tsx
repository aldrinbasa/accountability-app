import { useState } from 'react'
import { SealQuestion } from '@phosphor-icons/react'
import {
  canShowOverturn,
  CHALLENGE_COPY,
  overturnButtonLabel,
  overturnFailure,
  overturnLine,
  rulingLine,
} from '@/domain/challenge'
import { backendErrorCode } from '@/domain/error-codes'
import type { FeedRuling, FeedViewer } from '@/domain/feed'
import { useOverturnRuling } from '@/data/challenge'
import { isOffline } from '@/data/connectivity'
import { useRefetchFeed } from '@/data/vote'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { cn } from '@/ui/lib/utils'
import { StickyNote } from '@/ui/sticky-note'
import { showToast } from '@/ui/toast'

/**
 * A ruling (Story 5.1): a lavender `sticky-note-vote` whose kicker names it in words ("question seal
 * RESULT"), so color is not the only signal, and whose line is its h2 ("Didn't count · Dev's
 * Study · Lena questioned it.").
 *
 * Story 5.3: on a Fake ruling the server lets the reader overturn (`canOverturn`, the group's admin)
 * and before `overturnUntil`, a button-on-object "Overturn (admin) until Wed 23:59" (the lock in the
 * group's zone). Success turns the line into "Overturned by you · Dev's Study is back." at once and
 * reads it once in the sticky's polite status; the group's views refetch. Offline and refusals are
 * error toasts; any other failure an on-object Inline retry.
 */
export function RulingSticky({
  item,
  viewer,
  groupZone,
  tilt,
}: {
  item: FeedRuling
  viewer: FeedViewer
  /** The group's IANA zone: the button names the lock time in it. */
  groupZone: string
  tilt: 'left' | 'right'
}) {
  const overturn = useOverturnRuling(item.groupId)
  const refetchFeed = useRefetchFeed(item.groupId)
  const [failed, setFailed] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // Shown at once on success, before the refetched row arrives.
  const [overturnedHere, setOverturnedHere] = useState(false)

  // The ruling as overturned by the viewer: what the sticky shows the moment the RPC succeeds.
  const mine: FeedRuling = {
    ...item,
    overturnedById: viewer.userId,
    overturnedByName: '',
    canOverturn: false,
  }
  const shown = overturnedHere && item.overturnedAt === null ? mine : item
  const overturned = overturnLine(shown, item.title, viewer.userId)
  const line = overturned ?? rulingLine(item, viewer.userId)
  const showButton = canShowOverturn(shown, viewer.now)
  const toastId = `overturn-${item.challengeId}`

  function send() {
    if (overturn.isPending) return
    setFailed(false)
    if (isOffline()) {
      showToast(CHALLENGE_COPY.overturnOffline, { variant: 'error', id: toastId })
      return
    }
    // mutateAsync, not mutate's per-call callbacks: the member may leave the Feed mid-request, and
    // a refusal must still say so.
    void (async () => {
      try {
        await overturn.mutateAsync(item.challengeId)
        setOverturnedHere(true)
        setAnnouncement(overturnLine(mine, item.title, viewer.userId) ?? '')
      } catch (error) {
        const failure = overturnFailure(backendErrorCode(error), isOffline())
        if (failure.kind === 'failed') {
          setFailed(true)
        } else {
          showToast(failure.text, { variant: 'error', id: toastId })
          if (failure.kind === 'refused') refetchFeed()
        }
      }
    })()
  }

  return (
    <article className="px-[10px]" data-feed-item={item.id} data-kind="ruling">
      <StickyNote tilt={tilt} tone="vote" className="mx-auto w-fit max-w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <Icon icon={SealQuestion} size={20} />
          <span>{CHALLENGE_COPY.rulingKicker}</span>
        </p>
        <h2 className="type-hand-md">{line}</h2>
        {showButton && item.overturnUntil !== null ? (
          // Counter-rotated so the button sits level on the tilted sticky.
          <div
            className={cn(
              'mt-3 flex flex-col gap-2',
              tilt === 'left' ? 'rotate-[1.5deg]' : '-rotate-[1.5deg]',
            )}
          >
            <Button variant="on-object" busy={overturn.isPending} onClick={send}>
              {overturnButtonLabel(item.overturnUntil, groupZone, viewer.zone)}
            </Button>
            {failed ? (
              <InlineRetry onObject retryLabel={CHALLENGE_COPY.retry} onRetry={send}>
                {CHALLENGE_COPY.overturnFailed}
              </InlineRetry>
            ) : null}
          </div>
        ) : null}
        {/* Mounted with the sticky, then filled on success, so the change is read once. */}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </StickyNote>
    </article>
  )
}
