import { useRef } from 'react'
import { Check, DotsThree } from '@phosphor-icons/react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { CAMERA_COPY, checkInLabel } from '@/domain/camera'
import {
  itemTitle,
  overflowLabel,
  ringLabel,
  rowDone,
  scheduleMeta,
  showsRing,
  TODAY_COPY,
  type TodayItem,
} from '@/domain/today'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import { ProgressRing } from '@/ui/progress-ring'

/**
 * A Today row (DESIGN.md `due-row`): a card with the 44px activity icon, the title in `title-sm`
 * (the task's name, else the activity's) and the schedule meta in `meta` muted, which wraps under the
 * title at large text. A times-per-week row shows the 60px Progress ring in the icon's place
 * (mockups/key-today.html). `onMore` adds the Overflow button ("More actions for Grocery run");
 * `onCheckIn` adds the coral Check in button after it ("Check in Grocery run", Story 3.1). Both are
 * called with their button so focus can return to it.
 *
 * Done (Story 3.2: fixed days counted today, a task checked in): dashed outline, transparent fill and
 * the "Done" check doodle in place of Check in. Times per week keeps Check in; its meta says
 * "counted today" or "target met" and the ring fills. `bump` plays the post moment's count bump.
 */
export function DueRow({
  item,
  onMore,
  onCheckIn,
  bump = false,
}: {
  item: TodayItem
  onMore?: (button: HTMLButtonElement) => void
  onCheckIn?: (button: HTMLButtonElement) => void
  bump?: boolean
}) {
  const moreRef = useRef<HTMLButtonElement>(null)
  const checkInRef = useRef<HTMLButtonElement>(null)
  const title = itemTitle(item)
  const icon = item.presetKey !== null ? presetIcon(item.presetKey) : CUSTOM_ACTIVITY_ICON
  const done = rowDone(item)
  return (
    <li
      className={cn(
        'flex min-h-row-min items-center gap-2 rounded-wob border-[2.5px] border-line py-2 pr-2 pl-[10px]',
        done ? 'border-dashed bg-transparent' : 'bg-card',
      )}
      data-component="due-row"
      data-commitment-id={item.commitmentId}
      data-done={done ? '' : undefined}
    >
      {showsRing(item) && item.target !== null ? (
        <ProgressRing
          value={item.counted}
          target={item.target}
          label={ringLabel(item.activityName, item.counted, item.target)}
          className={bump ? 'animate-count-bump' : undefined}
        />
      ) : (
        <span
          className={cn(
            'grid size-icon-row shrink-0 place-items-center',
            bump && 'animate-count-bump',
          )}
        >
          <Icon icon={icon} size={44} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="break-words type-title-sm">{title}</h3>
        <p className="break-words type-meta text-muted">{scheduleMeta(item)}</p>
      </div>
      {onMore ? (
        <button
          ref={moreRef}
          type="button"
          aria-label={overflowLabel(title)}
          aria-haspopup="dialog"
          className="inline-flex size-target-min shrink-0 items-center justify-center rounded-full text-ink press-overlay"
          onClick={() => {
            if (moreRef.current) onMore(moreRef.current)
          }}
        >
          <DotsThree weight="bold" size={24} aria-hidden="true" focusable="false" />
        </button>
      ) : null}
      {done && onCheckIn ? (
        <span
          role="img"
          aria-label={TODAY_COPY.done}
          className="grid size-target-min shrink-0 place-items-center text-success"
          data-component="done-check"
        >
          <Check weight="bold" size={32} aria-hidden="true" focusable="false" />
        </span>
      ) : onCheckIn ? (
        <Button
          ref={checkInRef}
          variant="primary"
          aria-label={checkInLabel(title)}
          aria-haspopup="dialog"
          className="shrink-0 px-[14px] whitespace-nowrap"
          onClick={() => {
            if (checkInRef.current) onCheckIn(checkInRef.current)
          }}
        >
          {CAMERA_COPY.checkIn}
        </Button>
      ) : null}
    </li>
  )
}
