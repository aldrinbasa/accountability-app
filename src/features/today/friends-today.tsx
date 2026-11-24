import { useId, useRef, useState, type MouseEvent } from 'react'
import { Images } from '@phosphor-icons/react'
import { checkinAlt as momentAlt } from '@/domain/checkin'
import {
  checkinAlt,
  FEED_COPY,
  miniCaption,
  postedCount,
  type FeedCheckin,
  type FeedViewer,
} from '@/domain/feed'
import { canChallenge, challengeChip } from '@/domain/challenge'
import { useAuthSession } from '@/data/auth-session'
import { useFriendsToday } from '@/data/feed'
import { usePostMoment, type PostMoment } from '@/data/post-moment'
import { useMemberTimeZone } from '@/data/profile'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import { VoteChip } from '@/ui/vote-chip'
import { ChallengeActions } from '@/features/challenge/challenge-actions'
import { CheckinPhoto } from '@/features/feed/checkin-photo'
import { PhotoViewer } from '@/features/feed/photo-viewer'
import { useMinuteClock } from '@/ui/use-minute-clock'

/** DESIGN.md `mini-polaroid`: -3 / 2.5 / -1.5 deg, repeating. */
const MINI_TILTS = ['-rotate-3', 'rotate-[2.5deg]', '-rotate-[1.5deg]'] as const

const MINI_FRAME =
  'on-object relative block w-[104px] border-2 border-obj-ink bg-pola px-1.5 pt-1.5 text-left text-obj-ink shadow-paper-sm'
/** The mini's photo button inside the frame: the photo and the caption. */
const MINI_BUTTON = 'block w-full text-left'
const MINI_PHOTO =
  'relative block aspect-[4/3] w-full overflow-hidden rounded-photo bg-linear-to-br from-ph1 to-ph2'
const MINI_CAPTION = 'block truncate px-px pt-[5px] pb-[7px] type-hand-sm'

/** A mini: the server's check-in, or the just-posted one from the moment's own photo. */
type MiniEntry =
  | { key: string; item: FeedCheckin }
  | { key: string; item?: undefined; label: string; caption: string; photoUrl: string | null }

function localEntry(moment: PostMoment): MiniEntry {
  return {
    key: moment.checkinId,
    label: momentAlt(moment.title, moment.caption),
    caption: `${FEED_COPY.you} · ${moment.title}`,
    photoUrl: moment.photoUrl,
  }
}

/**
 * A mini's challenge parts (Story 5.1): the Overflow centered on the caption row while the viewer may
 * challenge it (a sibling of the photo button, since buttons cannot nest; its 44px target may
 * overhang the frame), and the Vote chip wrapped under the caption while a challenge is open.
 */
function MiniChallenge({
  item,
  viewer,
  memberCount,
}: {
  item: FeedCheckin
  viewer: FeedViewer
  memberCount: number
}) {
  const chip = challengeChip(item, viewer.now)
  return (
    <>
      <ChallengeActions
        item={item}
        viewer={viewer}
        memberCount={memberCount}
        className="absolute right-[-4px] bottom-[-7px]"
      />
      {chip ? (
        <span className="block pb-1.5">
          <VoteChip text={chip.text} spoken={chip.spoken} />
        </span>
      ) : null}
    </>
  )
}

export interface FriendsTodayProps {
  groupId: string
  /** The Feed tab's URL (the See all card's `href`). */
  seeAllHref: string
  /** Opens the Feed tab (a plain click on the See all card). */
  onSeeAll: () => void
  /** Current members of the group: 2 or more offers Challenge on others' check-ins (Story 5.1). */
  memberCount?: number
}

/**
 * Friends today (Story 3.5): the group's check-ins posted on the member's local day, newest first,
 * as 104px mini polaroids (360 rendition, `hand-sm` caption, tilts -3 / 2.5 / -1.5 deg) in a
 * sideways scroll-snap strip that shows part of the next card, ending with the See all card. A tap
 * opens the Photo viewer (focus returns to the mini). Others' check-ins carry the challenge
 * Overflow and the Vote chip (Story 5.1). The member's just-posted check-in leads the
 * strip as a local, non-tappable mini until the server list has it; its mini carries
 * `data-component="post-moment"` (focus lands there after a post). Hidden with no check-ins today, and while the list loads or
 * after it failed (unless there is a just-posted check-in to show).
 */
export function FriendsToday({
  groupId,
  seeAllHref,
  onSeeAll,
  memberCount = 0,
}: FriendsTodayProps) {
  const headingId = useId()
  const query = useFriendsToday(groupId)
  const moment = usePostMoment(groupId)
  const session = useAuthSession()
  const zone = useMemberTimeZone()
  const [open, setOpen] = useState<FeedCheckin | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  // Stamps are relative to the later of the last fetch and a clock taken at mount and once a minute
  // (Story 5.6: chips count down, "…" goes when the challenge window ends); a render never reads it.
  const clock = useMinuteClock()

  const items = query.data ?? []
  // Until a list fetched after the post arrives, the post shows from the moment's own photo.
  const showLocal =
    moment !== null &&
    !items.some((item) => item.id === moment.checkinId) &&
    (query.data === undefined || query.dataUpdatedAt <= moment.postedAt)
  const entries: MiniEntry[] = items.map((item) => ({ key: item.id, item }))
  if (showLocal && moment) entries.unshift(localEntry(moment))
  if (entries.length === 0) return null

  const viewer: FeedViewer = {
    userId: session.user?.id ?? '',
    zone,
    now: new Date(Math.max(query.dataUpdatedAt, clock.getTime())),
  }

  function onSeeAllClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let modified clicks (new tab / window) behave like plain links.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return
    }
    event.preventDefault()
    onSeeAll()
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col" data-component="friends-today">
      <h2 id={headingId} className="flex flex-wrap items-baseline gap-x-1.5 type-title">
        {FEED_COPY.friendsToday}{' '}
        <span className="type-meta text-muted">{postedCount(entries.length)}</span>
      </h2>
      <ul
        className="-mx-gutter flex snap-x snap-mandatory scroll-pl-gutter gap-4 overflow-x-auto px-gutter pt-3 pb-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-component="friends-strip"
      >
        {entries.map((entry, index) => {
          const tilt = MINI_TILTS[index % MINI_TILTS.length]
          const item = entry.item
          const isMoment = moment?.checkinId === entry.key
          // One button per check-in id, kept when the server's row replaces the local one, so focus
          // that landed on the just-posted mini stays on it.
          return (
            <li key={entry.key} className="flex-none snap-start">
              {/* The same frame and first button for both, so React keeps the button. */}
              <div className={cn(MINI_FRAME, tilt)} data-challenge-host={item ? '' : undefined}>
                {item ? (
                  <button
                    type="button"
                    aria-label={checkinAlt(item, viewer)}
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      setOpen(item)
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                    className={cn(MINI_BUTTON, 'press-overlay-obj')}
                    data-component={isMoment ? 'post-moment' : 'mini-polaroid'}
                  >
                    <span className={MINI_PHOTO}>
                      <CheckinPhoto item={item} alt="" variant="mini" />
                    </span>
                    <span
                      className={cn(
                        MINI_CAPTION,
                        canChallenge(item, viewer, memberCount) && 'pr-8',
                      )}
                    >
                      {miniCaption(item, viewer)}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={entry.label}
                    aria-disabled="true"
                    onContextMenu={(event) => event.preventDefault()}
                    className={cn(MINI_BUTTON, 'cursor-default')}
                    data-component="post-moment"
                    data-mini="local"
                  >
                    <span className={MINI_PHOTO}>
                      {entry.photoUrl ? (
                        <img
                          src={entry.photoUrl}
                          alt=""
                          draggable={false}
                          className="block size-full object-cover"
                        />
                      ) : null}
                    </span>
                    <span className={MINI_CAPTION}>{entry.caption}</span>
                  </button>
                )}
                {item ? (
                  <MiniChallenge item={item} viewer={viewer} memberCount={memberCount} />
                ) : null}
              </div>
            </li>
          )
        })}
        <li className="flex-none snap-start">
          <a
            href={seeAllHref}
            onClick={onSeeAllClick}
            className="flex h-full min-h-11 w-[104px] flex-col items-center justify-center gap-1.5 rounded-wob-sm border-[2.5px] border-dashed border-line px-2 py-2.5 text-center type-button text-ink press-overlay"
            data-component="see-all-card"
          >
            <Icon icon={Images} size={24} />
            {FEED_COPY.seeAll}
          </a>
        </li>
      </ul>
      <PhotoViewer
        item={open}
        viewer={viewer}
        onClose={() => setOpen(null)}
        returnFocusTo={() => opener.current}
      />
    </section>
  )
}
