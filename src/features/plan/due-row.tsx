import { useRef } from 'react'
import { Check, DotsThree, Snowflake } from '@phosphor-icons/react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { CAMERA_COPY, checkInLabel } from '@/domain/camera'
import { frozenMeta } from '@/domain/freeze'
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
 *
 * `streak` (Story 4.2) closes the meta line: "Fixed days · Mon Wed Fri · streak 6", "… · Done ·
 * streak 7", "… · back to 0". It is plain text inside the meta, so it is read with the row;
 * `streakPop` plays the milestone pop on it once (3, 10 or 25).
 *
 * Story 5.4: `freezeMeta` adds the pending freeze line under the meta ("Freeze vote · 21 h left",
 * Check in stays). `frozenReason` marks an approved day freeze: the snowflake in the icon's place,
 * "Frozen · flu, in bed" as the meta in `muted`, and no Check in.
 *
 * Story 5.5: `weekFrozen` (times per week) is how many sessions of the week an approved freeze took
 * off: the ring keeps the server's lowered target ("1/2") and names them ("Gym, 1 of 2 this week,
 * 1 frozen"), a snowflake leads the meta, which reads "2 times this week · 1 frozen".
 */
export function DueRow({
  item,
  onMore,
  onCheckIn,
  bump = false,
  streak = null,
  streakPop = false,
  freezeMeta = null,
  frozenReason = null,
  weekFrozen = 0,
}: {
  item: TodayItem
  onMore?: (button: HTMLButtonElement) => void
  onCheckIn?: (button: HTMLButtonElement) => void
  bump?: boolean
  /** The streak part of the meta ("streak 6", "back to 0"), or null for none. */
  streak?: string | null
  streakPop?: boolean
  /** A pending freeze's line ("Freeze vote · 21 h left"), or null. */
  freezeMeta?: string | null
  /** An approved day freeze's reason: the row reads frozen. Null when not frozen. */
  frozenReason?: string | null
  /** Times per week: sessions of this week taken off by approved freezes. */
  weekFrozen?: number
}) {
  const moreRef = useRef<HTMLButtonElement>(null)
  const checkInRef = useRef<HTMLButtonElement>(null)
  const title = itemTitle(item)
  const icon = item.presetKey !== null ? presetIcon(item.presetKey) : CUSTOM_ACTIVITY_ICON
  const frozen = frozenReason !== null
  const done = !frozen && rowDone(item)
  return (
    <li
      className={cn(
        'flex min-h-row-min items-center gap-2 rounded-wob border-[2.5px] border-line py-2 pr-2 pl-[10px]',
        done ? 'border-dashed bg-transparent' : 'bg-card',
      )}
      data-component="due-row"
      data-commitment-id={item.commitmentId}
      data-done={done ? '' : undefined}
      data-frozen={frozen ? '' : undefined}
    >
      {frozen ? (
        <span className="grid size-icon-row shrink-0 place-items-center text-muted">
          <Icon icon={Snowflake} size={44} />
        </span>
      ) : showsRing(item) && item.target !== null ? (
        <ProgressRing
          value={item.counted}
          target={item.target}
          label={ringLabel(item.activityName, item.counted, item.target, weekFrozen)}
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
        <p className="break-words type-meta text-muted">
          {weekFrozen > 0 && !frozen ? (
            <Snowflake
              size={16}
              weight="bold"
              aria-hidden="true"
              focusable="false"
              className="mr-1 inline-block align-[-2px]"
              data-icon="week-frozen"
            />
          ) : null}
          {frozen ? frozenMeta(frozenReason) : scheduleMeta(item, weekFrozen)}
          {streak && !frozen ? (
            <>
              {' · '}
              <span
                data-streak=""
                className={cn('inline-block', streakPop && 'animate-streak-pop')}
              >
                {streak}
              </span>
            </>
          ) : null}
        </p>
        {freezeMeta && !frozen ? (
          <p className="break-words type-meta text-muted" data-freeze-meta="">
            {freezeMeta}
          </p>
        ) : null}
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
      ) : onCheckIn && !frozen ? (
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
