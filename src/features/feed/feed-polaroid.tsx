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
import { challengeChip } from '@/domain/challenge'
import { LateLabel } from '@/ui/late-label'
import { Polaroid } from '@/ui/polaroid'
import { VoteChip } from '@/ui/vote-chip'
import { ChallengeActions } from '@/features/challenge/challenge-actions'
import { CheckinPhoto } from '@/features/feed/checkin-photo'

/**
 * "Marco · Gym · 3/3 · 07:12" with the name in bold, plus the Late label of a late check-in and the
 * Vote chip of an open challenge ("QUESTIONED · 18 H LEFT").
 */
export function CheckinMeta({ item, viewer }: { item: FeedCheckin; viewer: FeedViewer }) {
  const late = checkinLateLabel(item)
  const chip = challengeChip(item, viewer.now)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        <span className="font-extrabold text-obj-ink">{authorLabel(item, viewer)}</span>
        {` · ${checkinMetaRest(item, viewer)}`}
      </span>
      {late ? <LateLabel text={late.text} spoken={late.spoken} /> : null}
      {chip ? <VoteChip text={chip.text} spoken={chip.spoken} /> : null}
    </span>
  )
}

export interface FeedPolaroidProps {
  item: FeedCheckin
  viewer: FeedViewer
  /** Current members of the group (Challenge needs 2 or more). */
  memberCount?: number
  tilt: 'left' | 'right'
  eager: boolean
  onOpen: (item: FeedCheckin, opener: HTMLButtonElement) => void
  /** The deep-linked item's article (scrolled to and focused). */
  articleRef?: Ref<HTMLElement>
}

/**
 * A check-in on the wall: an `article` with an `h2` ("Marco · Gym · 07:12"), the taped Polaroid
 * inset from the column so its tilted corners never scroll sideways, the caption in `hand-lg` and
 * the meta line. Tapping the photo opens the Photo viewer. While the viewer may challenge it, the
 * Overflow sits right of the caption (Story 5.1).
 */
export function FeedPolaroid({
  item,
  viewer,
  memberCount = 0,
  tilt,
  eager,
  onOpen,
  articleRef,
}: FeedPolaroidProps) {
  return (
    <article
      ref={articleRef}
      tabIndex={-1}
      className="outline-none"
      data-feed-item={item.id}
      data-challenge-host=""
    >
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
        captionAction={<ChallengeActions item={item} viewer={viewer} memberCount={memberCount} />}
        meta={<CheckinMeta item={item} viewer={viewer} />}
      />
    </article>
  )
}
