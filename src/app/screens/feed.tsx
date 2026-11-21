import { useEffect, useRef, useState, type RefObject } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { CloudSlash, Images } from '@phosphor-icons/react'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import {
  FEED_COPY,
  switchedToast,
  type FeedAnchorKind,
  type FeedItem,
  type FeedPage,
  type FeedViewer,
} from '@/domain/feed'
import { GROUP_COPY, isWaiting, type MyGroup } from '@/domain/groups'
import { useAuthSession } from '@/data/auth-session'
import { useOutboxItems } from '@/data/checkin-outbox'
import { useFeed, useFeedAround } from '@/data/feed'
import { getStoredFocusedGroup } from '@/data/focused-group'
import { useMemberTimeZone } from '@/data/profile'
import { Screen } from '@/app/screens/screen'
import { EmptyState } from '@/ui/empty-state'
import { showToast } from '@/ui/toast'
import { CreateGroupScreen } from '@/features/group/create-group-screen'
import { useFocusedGroup } from '@/features/group/use-focused-group'
import { WaitingEmptyState } from '@/features/group/waiting-empty-state'
import { FeedSkeleton } from '@/features/feed/feed-skeleton'
import { FeedWall } from '@/features/feed/feed-wall'
import { SendingPolaroid } from '@/features/feed/sending-polaroid'

type FeedQuery = UseInfiniteQueryResult<InfiniteData<FeedPage>, unknown>

/** One toast id per deep-link notice, so a repeat replaces it instead of stacking. */
const GONE_TOAST_ID = 'feed-gone'
const SWITCHED_TOAST_ID = 'feed-switched'

/** The pages' items in order, each id once (an anchored page and the next one never overlap, but a refetch may shift). */
function wallItems(query: FeedQuery): FeedItem[] {
  const seen = new Set<string>()
  const items: FeedItem[] = []
  for (const page of query.data?.pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
    }
  }
  return items
}

interface FeedContentProps {
  group: MyGroup
  query: FeedQuery
  anchorId?: string | null
  anchorRef?: RefObject<HTMLElement | null>
}

/**
 * The Feed for one group: the h1 "Feed" (" · {Group}" for screen readers only; the switcher shows
 * the name), the waiting block on top in a waiting group, the member's own outbox entries as
 * "sending…" polaroids, then the wall. No data yet: the skeleton after 300 ms, or "Can't reach
 * Proofy right now." + Try again when the first load failed. An active group with nothing on the
 * wall shows "Nothing stuck here yet."; an anchored wall with newer items offers "See newest".
 */
function FeedContent({ group, query, anchorId = null, anchorRef }: FeedContentProps) {
  const session = useAuthSession()
  const zone = useMemberTimeZone()
  const { search } = useLocation()
  const sending = useOutboxItems().filter(
    (item) => item.groupId === group.id && item.rejection === null,
  )
  const waiting = isWaiting(group)
  const items = wallItems(query)
  // Stamps are relative to the later of the last fetch and this mount, so a saved wall opened the
  // next morning reads "Thu 07:12", not "07:12"; a render never reads the clock.
  const [mountedAt] = useState(() => Date.now())
  const hasNewer = query.data?.pages[0]?.hasNewer === true
  const viewer: FeedViewer = {
    userId: session.user?.id ?? '',
    zone,
    now: new Date(Math.max(query.dataUpdatedAt, mountedAt)),
  }

  function body() {
    if (!query.data) {
      if (query.isError) {
        return (
          <EmptyState
            icon={CloudSlash}
            line={GROUP_COPY.loadFailedLine}
            body={GROUP_COPY.loadFailedBody}
            action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
          />
        )
      }
      return <FeedSkeleton />
    }
    // A first page of only dropped kinds still pages on through the wall's sentinel.
    if (items.length === 0 && !query.hasNextPage) {
      if (waiting || sending.length > 0) return null
      return <EmptyState icon={Images} line={FEED_COPY.emptyLine} body={FEED_COPY.emptyBody} />
    }
    return (
      <>
        {hasNewer ? (
          <Link
            to={{ pathname: '/feed', search }}
            replace
            className="self-start rounded-wob-xs px-1 text-ink underline decoration-2 underline-offset-3 type-button press-overlay"
          >
            {FEED_COPY.seeNewest}
          </Link>
        ) : null}
        <FeedWall
          items={items}
          viewer={viewer}
          memberCount={group.memberCount}
          groupZone={group.timeZone}
          hasMore={query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          // Any fetch in flight (a whole refetch too) holds auto-load, so a next page never
          // cancels a refresh.
          fetching={query.isFetching}
          loadMoreFailed={query.isFetchNextPageError}
          onLoadMore={() => {
            if (!query.isFetching) void query.fetchNextPage()
          }}
          anchorId={anchorId}
          anchorRef={anchorRef}
        />
      </>
    )
  }

  return (
    <Screen
      title={
        <>
          {FEED_COPY.title} <span className="sr-only">{`· ${group.name}`}</span>
        </>
      }
    >
      {waiting ? <WaitingEmptyState group={group} /> : null}
      {sending.length > 0 ? (
        <ol className="flex flex-col gap-feed-gap" data-component="feed-sending">
          {sending.map((item, index) => (
            <li key={item.id}>
              <SendingPolaroid item={item} tilt={index % 2 === 0 ? 'left' : 'right'} />
            </li>
          ))}
        </ol>
      ) : null}
      {body()}
    </Screen>
  )
}

/** The wall from the newest item down (`/feed`). */
function WallFeed({ group }: { group: MyGroup }) {
  const query = useFeed(group.id)
  return <FeedContent group={group} query={query} />
}

/**
 * The wall anchored on a deep-linked check-in (`/feed/c/{checkinId}`) or Vote card
 * (`/feed/v/{voteId}`): scrolls to and focuses that item once it is there. Gone, hidden or in another
 * group: the Feed opens at the top with "That's already wrapped up.". A `?g=` that moved the focus to
 * another group says "Switched to {Group}.".
 */
function AnchoredFeed({
  group,
  anchorId,
  kind,
}: {
  group: MyGroup
  anchorId: string
  kind: FeedAnchorKind
}) {
  const query = useFeedAround(group.id, anchorId, kind)
  const navigate = useNavigate()
  const location = useLocation()
  const anchorRef = useRef<HTMLElement | null>(null)
  const focused = useRef(false)
  // Found once in this mount: a later refetch that loses it never moves the reader away.
  const everFound = useRef(false)
  // Read before the shell stores the new focus (its effect runs after this first render).
  const [previousFocus] = useState(getStoredFocusedGroup)
  const first = query.data?.pages[0]

  useEffect(() => {
    const linked = new URLSearchParams(location.search).get('g')
    if (linked === group.id && previousFocus !== null && previousFocus !== group.id) {
      showToast(switchedToast(group.name), { id: SWITCHED_TOAST_ID })
    }
    // Once per deep link (the component is keyed by group and anchor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (first?.anchorFound === true) everFound.current = true
    if (first?.anchorFound !== false) return
    // Gone at first sight: say so. Gone on a later refetch: just leave for the wall, quietly.
    if (!everFound.current) showToast(FEED_COPY.gone, { id: GONE_TOAST_ID })
    void navigate(
      { pathname: '/feed', search: location.search },
      { replace: true, state: location.state },
    )
  }, [first?.anchorFound, navigate, location.search, location.state])

  useEffect(() => {
    if (focused.current || first?.anchorFound !== true) return
    const node = anchorRef.current
    if (!node) return
    focused.current = true
    // One frame later, so the shell's route-change h1 focus (a parent effect) runs first.
    let done = false
    const frame = requestAnimationFrame(() => {
      done = true
      node.scrollIntoView?.({ block: 'center' })
      node.focus({ preventScroll: true })
    })
    return () => {
      if (done) return
      cancelAnimationFrame(frame)
      focused.current = false
    }
  }, [first])

  return <FeedContent group={group} query={query} anchorId={anchorId} anchorRef={anchorRef} />
}

/**
 * The Feed tab (Story 3.4) for the focused group, and its deep links `/feed/c/{checkinId}` and
 * `/feed/v/{voteId}` (Story 5.2). While the
 * groups load: blank. Load failed: an Empty state with Try again. No current groups: the create
 * screen, as on Today.
 */
export function FeedScreen() {
  const { group, groups, query } = useFocusedGroup()
  const { checkinId, voteId } = useParams()

  if (groups === undefined) {
    if (!query.isError) return null
    return (
      <Screen title={FEED_COPY.title}>
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
        />
      </Screen>
    )
  }

  if (!group) return <CreateGroupScreen />

  if (checkinId) {
    return (
      <AnchoredFeed
        key={`${group.id}:c:${checkinId}`}
        group={group}
        anchorId={checkinId}
        kind="checkin"
      />
    )
  }
  if (voteId) {
    return (
      <AnchoredFeed key={`${group.id}:v:${voteId}`} group={group} anchorId={voteId} kind="vote" />
    )
  }
  return <WallFeed key={group.id} group={group} />
}
