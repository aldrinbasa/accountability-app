import { eventLine, type FeedEvent } from '@/domain/feed'
import { StickyNote } from '@/ui/sticky-note'

/** A membership moment ("Priya joined.", "Jo left. Marco is admin now."): a small sticky whose line is its h2. */
export function EventSticky({
  item,
  viewerId,
  tilt,
}: {
  item: FeedEvent
  viewerId: string
  tilt: 'left' | 'right'
}) {
  return (
    <article className="px-[10px]" data-feed-item={item.id} data-kind={item.kind}>
      <StickyNote tilt={tilt} className="mx-auto w-fit max-w-full">
        <h2 className="type-hand-md">{eventLine(item, viewerId)}</h2>
      </StickyNote>
    </article>
  )
}
