import { useRef, useState } from 'react'
import { FEED_COPY, missDay, missLine, type FeedMiss, type FeedViewer } from '@/domain/feed'
import { FREEZE_COPY, freezeOptionKey, missOptions, type FreezeOption } from '@/domain/freeze'
import { Button } from '@/ui/button'
import { cn } from '@/ui/lib/utils'
import { MissChip } from '@/ui/miss-chip'
import { StickyNote } from '@/ui/sticky-note'
import { FreezeSheet } from '@/features/freeze/freeze-sheet'

/**
 * A miss (Story 3.5): a `sticky2` sticky with the Miss chip and the day as its kicker ("MISS · Thu")
 * and the line as its h2 ("Dev missed Paint. The couch wins this round."). No score, no judgment
 * words; the words carry the meaning without the color.
 *
 * Story 5.4: the reader's own miss offers a button-on-object "Request freeze" while the server lists
 * one of its sessions (or, times per week, its week) as freezable: never for a Fake-ruling miss or a
 * locked week. It opens the Freeze sheet with that session or week pre-picked.
 */
export function MissSticky({
  item,
  viewer,
  tilt,
  memberCount = 0,
  freezeOptions,
}: {
  item: FeedMiss
  viewer: FeedViewer
  tilt: 'left' | 'right'
  /** Current members of the group: 1 words the Freeze sheet's note as approved right away. */
  memberCount?: number
  /** `my_freeze_options`, read once by the wall (not per sticky); undefined while loading. */
  freezeOptions?: readonly FreezeOption[]
}) {
  const day = missDay(item.missedOn, viewer.zone, viewer.now)
  const own = item.actorId !== null && item.actorId === viewer.userId
  return (
    <article className="px-[10px]" data-feed-item={item.id} data-kind="miss">
      <StickyNote tilt={tilt} tone="miss" className="mx-auto w-fit max-w-full">
        <p className="mb-2 flex flex-wrap items-center gap-1.5 type-label text-obj-ink">
          <MissChip label={FEED_COPY.miss} />
          {day ? <span>{`· ${day}`}</span> : null}
        </p>
        <h2 className="type-hand-md">{missLine(item, viewer.userId)}</h2>
        {own ? (
          <OwnMissFreeze
            item={item}
            options={freezeOptions}
            now={viewer.now}
            tilt={tilt}
            solo={memberCount === 1}
          />
        ) : null}
      </StickyNote>
    </article>
  )
}

function OwnMissFreeze({
  item,
  options,
  now,
  tilt,
  solo,
}: {
  item: FeedMiss
  options: readonly FreezeOption[] | undefined
  now: Date
  tilt: 'left' | 'right'
  solo: boolean
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const matching = options ? missOptions(item, options, now) : []
  const first = matching[0]
  // The Sheet stays mounted while open even if a refetch drops the option (it closes itself).
  const [shown, setShown] = useState(matching)
  if (!first && !open) return null
  return (
    <>
      {first ? (
        // Counter-rotated so the button sits level on the tilted sticky.
        <div className={cn('mt-3', tilt === 'left' ? 'rotate-[1.5deg]' : '-rotate-[1.5deg]')}>
          <Button
            ref={buttonRef}
            variant="on-object"
            aria-haspopup="dialog"
            onClick={() => {
              setShown(matching)
              setOpen(true)
            }}
          >
            {FREEZE_COPY.requestFreeze}
          </Button>
        </div>
      ) : null}
      {shown.length > 0 ? (
        <FreezeSheet
          open={open}
          onOpenChange={setOpen}
          groupId={item.groupId}
          title={item.title}
          options={shown}
          initialKey={shown[0] ? freezeOptionKey(shown[0]) : null}
          solo={solo}
          // After a request the button is gone with its option: focus the Feed's h1 instead.
          returnFocusTo={() =>
            buttonRef.current?.isConnected
              ? buttonRef.current
              : document.querySelector<HTMLElement>('main h1')
          }
        />
      ) : null}
    </>
  )
}
