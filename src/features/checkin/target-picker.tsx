import { useEffect, useId, useRef, type ReactNode } from 'react'
import { ListChecks, X } from '@phosphor-icons/react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { CHECKIN_COPY, pickerStatus, targetTitle, type CheckinTarget } from '@/domain/checkin'
import { TODAY_COPY } from '@/domain/today'
import { useCheckinTargets } from '@/data/checkin'
import { EmptyState } from '@/ui/empty-state'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { InlineRetry } from '@/ui/inline-retry'
import { Skeleton, SkeletonBlock, SkeletonBar } from '@/ui/skeleton'
import { CanvasPhoto } from '@/features/checkin/canvas-photo'

/** DESIGN.md `picker-row`: 52px `paper` row, 2px outline, icon + name + status. One tap picks. */
function PickerRow({
  target,
  onPick,
}: {
  target: CheckinTarget
  onPick: (target: CheckinTarget) => void
}) {
  const title = targetTitle(target)
  const status = pickerStatus(target)
  const icon = target.presetKey !== null ? presetIcon(target.presetKey) : CUSTOM_ACTIVITY_ICON
  return (
    <li>
      <button
        type="button"
        aria-label={`${title}, ${status}`}
        onClick={() => onPick(target)}
        className="flex min-h-row-min w-full items-center gap-3 rounded-wob-sm border-2 border-line bg-paper px-3 py-2 text-left text-ink press-overlay"
        data-component="picker-row"
        data-wont-count={target.wontCount ?? undefined}
      >
        <Icon icon={icon} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block break-words type-button">{title}</span>
          <span className="block break-words type-meta text-muted">{status}</span>
        </span>
      </button>
    </li>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="type-label text-muted">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

/**
 * The snap-first picker (Story 3.2): the frozen photo, with a sheet-styled panel below it, "What's
 * this check-in for?", listing the member's targets in the focused group from
 * `get_checkin_targets`: Due today first, then the rest of this week. Each row shows the server's
 * status or won't-count note; a won't-count pick still posts (as an extra). Close (and Esc, system
 * back) discards the frame and returns to the live viewfinder. With no group or nothing to pick:
 * "Nothing to check in for here yet." and only Close.
 *
 * A panel inside the camera dialog, not a `Sheet`: a Sheet's history entry and Esc would also reach
 * the camera and close it.
 */
export function TargetPicker({
  canvas,
  groupId,
  onPick,
  onClose,
}: {
  canvas: HTMLCanvasElement
  groupId: string | null
  onPick: (target: CheckinTarget) => void
  onClose: () => void
}) {
  const query = useCheckinTargets(groupId)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const titleId = useId()

  // The panel replaces the viewfinder: start reading at its title.
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const targets = groupId === null ? [] : query.data
  const due = targets?.filter((target) => target.dueToday) ?? []
  const rest = targets?.filter((target) => !target.dueToday) ?? []

  let body: ReactNode
  if (targets === undefined) {
    body = query.isError ? (
      <InlineRetry onRetry={() => void query.refetch()}>{CHECKIN_COPY.loadFailed}</InlineRetry>
    ) : (
      <Skeleton>
        <SkeletonBlock>
          <SkeletonBar />
        </SkeletonBlock>
        <SkeletonBlock>
          <SkeletonBar />
        </SkeletonBlock>
      </Skeleton>
    )
  } else if (targets.length === 0) {
    body = (
      <EmptyState
        icon={ListChecks}
        line={CHECKIN_COPY.nothingLine}
        body={CHECKIN_COPY.nothingBody}
      />
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        {due.length > 0 ? (
          <Group title={TODAY_COPY.dueToday}>
            {due.map((target) => (
              <PickerRow key={target.commitmentId} target={target} onPick={onPick} />
            ))}
          </Group>
        ) : null}
        {rest.length > 0 ? (
          <Group title={TODAY_COPY.thisWeek}>
            {rest.map((target) => (
              <PickerRow key={target.commitmentId} target={target} onPick={onPick} />
            ))}
          </Group>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className="mx-auto flex min-h-full w-full max-w-content-max flex-col pt-[env(safe-area-inset-top)]"
      data-component="target-picker"
    >
      {/* The frozen photo, where the viewfinder was. */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-gutter py-4">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-frame">
          <CanvasPhoto canvas={canvas} label={CHECKIN_COPY.preview} />
        </div>
      </div>
      <section
        aria-labelledby={titleId}
        className="rounded-sheet border-[2.5px] border-b-0 border-line bg-card pr-[max(var(--spacing-gutter),env(safe-area-inset-right))] pb-[calc(var(--spacing-4)+env(safe-area-inset-bottom))] pl-[max(var(--spacing-gutter),env(safe-area-inset-left))] text-ink"
        data-component="picker-sheet"
      >
        <div className="mt-3 mb-3 flex items-center justify-between gap-3">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="min-w-0 flex-1 type-headline">
            {CHECKIN_COPY.pickerTitle}
          </h2>
          <IconButton icon={X} label={CHECKIN_COPY.close} onClick={onClose} />
        </div>
        {body}
      </section>
    </div>
  )
}
