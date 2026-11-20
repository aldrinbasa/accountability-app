import { FEED_COPY, missDay, missLine, type FeedMiss, type FeedViewer } from '@/domain/feed'
import { MissChip } from '@/ui/miss-chip'
import { StickyNote } from '@/ui/sticky-note'

/**
 * A miss (Story 3.5): a `sticky2` sticky with the Miss chip and the day as its kicker ("MISS · Thu")
 * and the line as its h2 ("Dev missed Paint. The couch wins this round."). No score, no judgment
 * words; the words carry the meaning without the color.
 */
export function MissSticky({
  item,
  viewer,
  tilt,
}: {
  item: FeedMiss
  viewer: FeedViewer
  tilt: 'left' | 'right'
}) {
  const day = missDay(item.missedOn, viewer.zone, viewer.now)
  return (
    <article className="px-[10px]" data-feed-item={item.id} data-kind="miss">
      <StickyNote tilt={tilt} tone="miss" className="mx-auto w-fit max-w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <MissChip label={FEED_COPY.miss} />
          {day ? <span>{`· ${day}`}</span> : null}
        </p>
        <h2 className="type-hand-md">{missLine(item, viewer.userId)}</h2>
      </StickyNote>
    </article>
  )
}
