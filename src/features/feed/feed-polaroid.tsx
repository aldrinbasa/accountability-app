import type { MouseEvent, Ref } from 'react'
import {
  authorLabel,
  checkinAlt,
  checkinHeading,
  checkinLateLabel,
  checkinMetaRest,
  type FeedCheckin,
  type FeedViewer,
} from '@/domain/feed'
import { LateLabel } from '@/ui/late-label'
import { Polaroid } from '@/ui/polaroid'
import { CheckinPhoto } from '@/features/feed/checkin-photo'

/** "Marco · Gym · 3/3 · 07:12" with the name in bold, plus the Late label of a late check-in. */
export function CheckinMeta({ item, viewer }: { item: FeedCheckin; viewer: FeedViewer }) {
  const late = checkinLateLabel(item)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        <span className="font-extrabold text-obj-ink">{authorLabel(item, viewer)}</span>
        {` · ${checkinMetaRest(item, viewer)}`}
      </span>
      {late ? <LateLabel text={late.text} spoken={late.spoken} /> : null}
    </span>
  )
}

export interface FeedPolaroidProps {
  item: FeedCheckin
  viewer: FeedViewer
  tilt: 'left' | 'right'
  eager: boolean
  onOpen: (item: FeedCheckin, opener: HTMLButtonElement) => void
  /** The deep-linked item's article (scrolled to and focused). */
  articleRef?: Ref<HTMLElement>
}

/**
 * A check-in on the wall: an `article` with an `h2` ("Marco · Gym · 07:12"), the taped Polaroid
 * inset from the column so its tilted corners never scroll sideways, the caption in `hand-lg` and
 * the meta line. Tapping the photo opens the Photo viewer.
 */
export function FeedPolaroid({ item, viewer, tilt, eager, onOpen, articleRef }: FeedPolaroidProps) {
  return (
    <article ref={articleRef} tabIndex={-1} className="outline-none" data-feed-item={item.id}>
      <h2 className="sr-only">{checkinHeading(item, viewer)}</h2>
      <Polaroid
        tilt={tilt}
        className="mx-auto w-[calc(100%-16px)]"
        photo={
          <CheckinPhoto
            item={item}
            alt={checkinAlt(item, viewer)}
            variant="polaroid"
            eager={eager}
            onOpen={(event: MouseEvent<HTMLButtonElement>) => onOpen(item, event.currentTarget)}
          />
        }
        caption={item.caption}
        meta={<CheckinMeta item={item} viewer={viewer} />}
      />
    </article>
  )
}
