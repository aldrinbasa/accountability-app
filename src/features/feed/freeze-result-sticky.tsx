import { Snowflake } from '@phosphor-icons/react'
import {
  FREEZE_VOTE_COPY,
  freezeOutcomeLine,
  freezeResultWho,
  reasonLabel,
  type FeedFreezeResult,
} from '@/domain/freeze-vote'
import { Icon } from '@/ui/icon'
import { StickyNote } from '@/ui/sticky-note'

/**
 * A closed freeze (Story 5.5): a yellow sticky whose kicker names it in words ("snowflake FREEZE"),
 * whose h2 is the outcome ("Freeze approved · Study on Sat is off the plan. Miss removed." /
 * "Freeze denied · Study on Sat still counts."), with the reason still visible (named "Reason: …")
 * and whose request it was. A denial has no overturn.
 */
export function FreezeResultSticky({
  item,
  viewerId,
  tilt,
}: {
  item: FeedFreezeResult
  viewerId: string
  tilt: 'left' | 'right'
}) {
  return (
    <article className="px-[10px]" data-feed-item={item.id} data-kind="freeze-result">
      <StickyNote tilt={tilt} className="mx-auto w-fit max-w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <Icon icon={Snowflake} size={20} />
          <span>{FREEZE_VOTE_COPY.resultKicker}</span>
        </p>
        <h2 className="type-hand-md">{freezeOutcomeLine(item, item.outcome, item.missRemoved)}</h2>
        <p className="mt-1 type-hand-md break-words">
          <span className="sr-only">{reasonLabel(item.reason)}</span>
          <span aria-hidden="true">“{item.reason}”</span>
        </p>
        <p className="mt-1 type-meta text-obj-muted">{freezeResultWho(item, viewerId)}</p>
      </StickyNote>
    </article>
  )
}
