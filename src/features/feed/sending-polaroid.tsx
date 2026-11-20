import { checkinAlt } from '@/domain/checkin'
import { FEED_COPY } from '@/domain/feed'
import type { OutboxItem } from '@/domain/outbox'
import { useOutboxPhoto } from '@/data/outbox-photo'
import { Polaroid } from '@/ui/polaroid'

/**
 * The member's own check-in still in the outbox: a Polaroid at the top of the wall with the photo
 * read from the device and the meta "sending…". Not tappable until the server has it.
 */
export function SendingPolaroid({ item, tilt }: { item: OutboxItem; tilt: 'left' | 'right' }) {
  const url = useOutboxPhoto(item.id)
  return (
    <article data-feed-item={item.id} data-sending="">
      <h2 className="sr-only">{`${FEED_COPY.you} · ${item.title} · ${FEED_COPY.sending}`}</h2>
      <Polaroid
        tilt={tilt}
        className="mx-auto w-[calc(100%-16px)]"
        photo={
          url ? (
            <img
              src={url}
              alt={checkinAlt(item.title, item.caption)}
              draggable={false}
              className="size-full object-cover select-none [-webkit-touch-callout:none]"
            />
          ) : null
        }
        caption={item.caption}
        meta={FEED_COPY.sending}
      />
    </article>
  )
}
