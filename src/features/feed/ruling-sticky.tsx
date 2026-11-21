import { Gavel } from '@phosphor-icons/react'
import { CHALLENGE_COPY, rulingLine } from '@/domain/challenge'
import type { FeedRuling } from '@/domain/feed'
import { Icon } from '@/ui/icon'
import { StickyNote } from '@/ui/sticky-note'

/**
 * A ruling (Story 5.1): a lavender `sticky-note-vote` whose kicker names it in words ("gavel
 * RULING"), so color is not the only signal, and whose line is its h2 ("Ruled Fake · Lena
 * challenged · Dev's Study removed.").
 */
export function RulingSticky({
  item,
  viewerId,
  tilt,
}: {
  item: FeedRuling
  viewerId: string
  tilt: 'left' | 'right'
}) {
  return (
    <article className="px-[10px]" data-feed-item={item.id} data-kind="ruling">
      <StickyNote tilt={tilt} tone="vote" className="mx-auto w-fit max-w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <Icon icon={Gavel} size={20} />
          <span>{CHALLENGE_COPY.rulingKicker}</span>
        </p>
        <h2 className="type-hand-md">{rulingLine(item, viewerId)}</h2>
      </StickyNote>
    </article>
  )
}
