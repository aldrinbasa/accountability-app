import { useEffect, useRef, useState, type Ref } from 'react'
import {
  FEED_EAGER_PHOTOS,
  FEED_VIRTUALIZE_FROM,
  type FeedCheckin,
  type FeedItem,
  type FeedViewer,
} from '@/domain/feed'
import { FEED_COPY } from '@/domain/feed'
import { useFreezeOptions } from '@/data/freeze'
import { InlineRetry } from '@/ui/inline-retry'
import { cn } from '@/ui/lib/utils'
import { EventSticky } from '@/features/feed/event-sticky'
import { FeedPolaroid } from '@/features/feed/feed-polaroid'
import { MissSticky } from '@/features/feed/miss-sticky'
import { NextPagePlaceholder } from '@/features/feed/feed-skeleton'
import { PhotoViewer } from '@/features/feed/photo-viewer'
import { WinnerSticky } from '@/features/feed/winner-sticky'
import { GoalSticky } from '@/features/feed/goal-sticky'
import { RulingSticky } from '@/features/feed/ruling-sticky'
import { VoteCard } from '@/features/vote/vote-card'

/** The next page starts loading this far before the end of the wall comes into view. */
const LOAD_AHEAD = '600px'

/** Calls `onNearEnd` when the returned sentinel comes within `LOAD_AHEAD` of the viewport. */
function useNearEnd(enabled: boolean, onNearEnd: () => void) {
  const sentinel = useRef<HTMLDivElement>(null)
  const latest = useRef(onNearEnd)
  useEffect(() => {
    latest.current = onNearEnd
  })
  useEffect(() => {
    const node = sentinel.current
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current()
      },
      { rootMargin: `0px 0px ${LOAD_AHEAD} 0px` },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled])
  return sentinel
}

export interface FeedWallProps {
  items: readonly FeedItem[]
  viewer: FeedViewer
  /** Current members of the group: 2 or more offers Challenge on others' check-ins (Story 5.1). */
  memberCount?: number
  /** The group's IANA zone: a ruling's Overturn button names the lock time in it (Story 5.3). */
  groupZone?: string
  /** Older pages remain. */
  hasMore: boolean
  /** An older page is loading (one polaroid placeholder at the end). */
  loadingMore: boolean
  /** Some fetch of the wall is in flight (a refetch too): auto-load waits for it. */
  fetching?: boolean
  /** The last older page failed: no auto-loading until Retry. */
  loadMoreFailed?: boolean
  onLoadMore: () => void
  /** The deep-linked check-in or Vote card, whose article gets `anchorRef`. */
  anchorId?: string | null
  anchorRef?: Ref<HTMLElement>
}

/**
 * The scrapbook wall, newest first: one Polaroid per row (alternating -2.2 / 2 deg) with event,
 * miss, winner, goal and ruling stickies and Vote cards (±1.5 deg, alternating across both) between them, 22px apart. The first 2 photos load eagerly. From item 50 on,
 * items skip layout and paint while off screen (`content-visibility: auto`). Nearing the end loads the
 * next page. Tapping a photo opens the Photo viewer; closing it returns focus to that photo.
 */
export function FeedWall({
  items,
  viewer,
  memberCount = 0,
  groupZone,
  hasMore,
  loadingMore,
  fetching = false,
  loadMoreFailed = false,
  onLoadMore,
  anchorId,
  anchorRef,
}: FeedWallProps) {
  const [open, setOpen] = useState<FeedCheckin | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const sentinel = useNearEnd(hasMore && !loadingMore && !fetching && !loadMoreFailed, onLoadMore)
  // Story 5.4: one `my_freeze_options` read per wall (only with an own miss on it), shared by every
  // own miss sticky, so scrolling stickies in and out never refetches it.
  const ownMissGroup = items.find(
    (item) => item.type === 'miss' && item.actorId !== null && item.actorId === viewer.userId,
  )?.groupId
  const freezeOptions = useFreezeOptions(ownMissGroup ?? '', ownMissGroup !== undefined).data

  let polaroids = 0
  let stickies = 0

  return (
    <>
      <ol className="flex flex-col gap-feed-gap" data-component="feed-wall">
        {items.map((item, index) => {
          const far = index >= FEED_VIRTUALIZE_FROM
          const className = cn(
            far && '[contain-intrinsic-size:auto_26rem] [content-visibility:auto]',
          )
          if (item.type === 'checkin') {
            const tilt = polaroids % 2 === 0 ? 'left' : 'right'
            const eager = polaroids < FEED_EAGER_PHOTOS
            polaroids += 1
            return (
              <li key={item.id} className={className}>
                <FeedPolaroid
                  item={item}
                  viewer={viewer}
                  memberCount={memberCount}
                  tilt={tilt}
                  eager={eager}
                  articleRef={item.id === anchorId ? anchorRef : undefined}
                  onOpen={(checkin, button) => {
                    opener.current = button
                    setOpen(checkin)
                  }}
                />
              </li>
            )
          }
          const tilt = stickies % 2 === 0 ? 'right' : 'left'
          stickies += 1
          if (item.type === 'vote') {
            return (
              <li key={item.id} className={className}>
                <VoteCard
                  item={item}
                  viewer={viewer}
                  tilt={tilt}
                  articleRef={item.id === anchorId ? anchorRef : undefined}
                  onOpenPhoto={(checkin, button) => {
                    opener.current = button
                    setOpen(checkin)
                  }}
                />
              </li>
            )
          }
          return (
            <li key={item.id} className={className}>
              {item.type === 'miss' ? (
                <MissSticky
                  item={item}
                  viewer={viewer}
                  tilt={tilt}
                  memberCount={memberCount}
                  freezeOptions={freezeOptions}
                />
              ) : item.type === 'winner' ? (
                <WinnerSticky item={item} viewerId={viewer.userId} tilt={tilt} />
              ) : item.type === 'goal' ? (
                <GoalSticky item={item} tilt={tilt} />
              ) : item.type === 'ruling' ? (
                <RulingSticky
                  item={item}
                  viewer={viewer}
                  groupZone={groupZone ?? viewer.zone}
                  tilt={tilt}
                />
              ) : (
                <EventSticky item={item} viewerId={viewer.userId} tilt={tilt} />
              )}
            </li>
          )
        })}
      </ol>
      {loadingMore ? <NextPagePlaceholder /> : null}
      {loadMoreFailed && !loadingMore ? (
        <InlineRetry className="mt-feed-gap" retryLabel={FEED_COPY.retry} onRetry={onLoadMore}>
          {FEED_COPY.olderFailed}
        </InlineRetry>
      ) : null}
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      <PhotoViewer
        item={open}
        viewer={viewer}
        onClose={() => setOpen(null)}
        returnFocusTo={() => opener.current}
      />
    </>
  )
}
