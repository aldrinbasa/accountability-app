import { useRef } from 'react'
import { DotsThree } from '@phosphor-icons/react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { CAMERA_COPY, checkInLabel } from '@/domain/camera'
import {
  itemTitle,
  overflowLabel,
  ringLabel,
  scheduleMeta,
  showsRing,
  type TodayItem,
} from '@/domain/today'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { ProgressRing } from '@/ui/progress-ring'

/**
 * A Today row (DESIGN.md `due-row`): a card with the 44px activity icon, the title in `title-sm`
 * (the task's name, else the activity's) and the schedule meta in `meta` muted, which wraps under the
 * title at large text. A times-per-week row shows the 60px Progress ring in the icon's place
 * (mockups/key-today.html). `onMore` adds the Overflow button ("More actions for Grocery run");
 * `onCheckIn` adds the coral Check in button after it ("Check in Grocery run", Story 3.1). Both are
 * called with their button so focus can return to it.
 */
export function DueRow({
  item,
  onMore,
  onCheckIn,
}: {
  item: TodayItem
  onMore?: (button: HTMLButtonElement) => void
  onCheckIn?: (button: HTMLButtonElement) => void
}) {
  const moreRef = useRef<HTMLButtonElement>(null)
  const checkInRef = useRef<HTMLButtonElement>(null)
  const title = itemTitle(item)
  const icon = item.presetKey !== null ? presetIcon(item.presetKey) : CUSTOM_ACTIVITY_ICON
  return (
    <li
      className="flex min-h-row-min items-center gap-2 rounded-wob border-[2.5px] border-line bg-card py-2 pr-2 pl-[10px]"
      data-component="due-row"
      data-commitment-id={item.commitmentId}
    >
      {showsRing(item) && item.target !== null ? (
        <ProgressRing
          value={item.counted}
          target={item.target}
          label={ringLabel(item.activityName, item.counted, item.target)}
        />
      ) : (
        <span className="grid size-icon-row shrink-0 place-items-center">
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
      {onCheckIn ? (
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
