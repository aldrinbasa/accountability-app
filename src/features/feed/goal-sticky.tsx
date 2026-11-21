import { Target } from '@phosphor-icons/react'
import { GOAL_COPY, goalKickerSpan, goalStickyLine, type FeedGoal } from '@/domain/goal'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import { StickyNote } from '@/ui/sticky-note'

/**
 * A group goal result (Story 4.7): a yellow sticky when hit, a plain paper note when missed (no
 * celebration, nobody named). The kicker names it in words and the week or month ("target GROUP
 * GOAL · week of 9 Nov"), so color is not the only signal; the line is its h2 ("Goal missed by 4% ·
 * 85% this week. Next week, then.").
 */
export function GoalSticky({ item, tilt }: { item: FeedGoal; tilt: 'left' | 'right' }) {
  const span = goalKickerSpan(item)
  const content = (
    <>
      <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label">
        <Icon icon={Target} size={20} />
        <span>{GOAL_COPY.heading}</span>
        {span ? <span>{`· ${span}`}</span> : null}
      </p>
      <h2 className="type-hand-md">{goalStickyLine(item)}</h2>
    </>
  )
  return (
    <article
      className="px-[10px]"
      data-feed-item={item.id}
      data-kind="goal_result"
      data-goal-result={item.hit ? 'hit' : 'missed'}
    >
      {item.hit ? (
        <StickyNote tilt={tilt} className="mx-auto w-fit max-w-full text-obj-ink">
          {content}
        </StickyNote>
      ) : (
        <div
          className={cn(
            'card mx-auto w-fit max-w-full px-[14px] pt-3 pb-[14px] text-ink',
            tilt === 'left' ? '-rotate-[1.5deg]' : 'rotate-[1.5deg]',
          )}
        >
          {content}
        </div>
      )}
    </article>
  )
}
