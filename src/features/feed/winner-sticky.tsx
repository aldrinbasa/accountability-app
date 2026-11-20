import { Crown } from '@phosphor-icons/react'
import { winnerStickyLine, type FeedWinner } from '@/domain/feed'
import { WINNER_COPY, weekOfLabel } from '@/domain/winner'
import { Icon } from '@/ui/icon'
import { StickyNote } from '@/ui/sticky-note'

/**
 * A weekly winner (Story 4.5): a yellow sticky whose kicker names it in words and the week ("crown
 * WEEKLY WINNER · week of 9 Nov"), so color is not the only signal, and whose line is its h2 ("Last
 * week's winner · Marco · 94 · Bow down. Or just beat Marco.").
 */
export function WinnerSticky({
  item,
  viewerId,
  tilt,
}: {
  item: FeedWinner
  viewerId: string
  tilt: 'left' | 'right'
}) {
  const week = weekOfLabel(item.weekStart)
  return (
    <article className="px-[10px]" data-feed-item={item.id} data-kind="weekly_winner">
      <StickyNote tilt={tilt} className="mx-auto w-fit max-w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <Icon icon={Crown} size={20} />
          <span>{WINNER_COPY.kicker}</span>
          {week ? <span>{`· ${week}`}</span> : null}
        </p>
        <h2 className="type-hand-md">{winnerStickyLine(item, viewerId)}</h2>
      </StickyNote>
    </article>
  )
}
