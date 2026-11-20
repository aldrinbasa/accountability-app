import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  FEED_ANCHOR_NEWER,
  FEED_ANCHOR_OLDER,
  FEED_PAGE_SIZE,
  type FeedCheckin,
  type FeedCursor,
  type FeedPage,
} from '@/domain/feed'
import type { BackendPort } from '@/ports/backend-port'
import { useBackendContext } from '@/data/backend-context-value'
import { retryOnline } from '@/data/query-client'

/** `['feed', groupId]`: the group's wall (the outbox and later writes invalidate this prefix). */
export function feedKey(groupId: string) {
  return ['feed', groupId] as const
}

/** `['feed', groupId, 'wall']`: the wall from the newest item down. */
export function feedWallKey(groupId: string) {
  return [...feedKey(groupId), 'wall'] as const
}

/** `['feed', groupId, 'around', checkinId]`: the wall anchored on a deep-linked check-in. */
export function feedAroundKey(groupId: string, checkinId: string) {
  return [...feedKey(groupId), 'around', checkinId] as const
}

/** `['feed', groupId, 'today']`: Today's Friends today strip (refreshed with the wall's prefix). */
export function feedTodayKey(groupId: string) {
  return [...feedKey(groupId), 'today'] as const
}

export interface FeedRepository {
  /** A page of `FEED_PAGE_SIZE` from the newest item (null) or older than `cursor`. */
  page(groupId: string, cursor: FeedCursor | null): Promise<FeedPage>
  /**
   * A page anchored on a check-in: up to `FEED_ANCHOR_NEWER` newer items, the check-in, then up to
   * `FEED_ANCHOR_OLDER` older. `anchorFound` is false (and the page empty) when it is gone, hidden or
   * in another group.
   */
  around(groupId: string, checkinId: string): Promise<FeedPage>
  /** The group's check-ins received since the member's local midnight, newest first. */
  today(groupId: string): Promise<FeedCheckin[]>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NOT_FOUND: FeedPage = { items: [], nextCursor: null, hasNewer: false, anchorFound: false }

/** Feed reads over `BackendPort` (AD-2: feature hook → repository → adapter). */
export function createFeedRepository(backend: BackendPort): FeedRepository {
  return {
    async page(groupId, cursor) {
      const rows = await backend.listFeed(groupId, {
        ...(cursor ? { before: cursor } : {}),
        limit: FEED_PAGE_SIZE,
      })
      return {
        items: rows.items,
        // A full page may have more below it; the raw rows' cursor, so dropped kinds never stop it.
        nextCursor: rows.rowCount === FEED_PAGE_SIZE ? rows.oldest : null,
      }
    },
    async around(groupId, checkinId) {
      // A malformed id can never be a check-in (and would make Postgres raise 22P02).
      if (!UUID.test(checkinId)) return NOT_FOUND
      const anchor = await backend.getFeedCheckin(groupId, checkinId)
      if (!anchor) return NOT_FOUND
      const cursor = { sortAt: anchor.sortAt, itemId: anchor.id }
      const [newer, older] = await Promise.all([
        backend.listFeed(groupId, { after: cursor, limit: FEED_ANCHOR_NEWER }),
        backend.listFeed(groupId, { before: cursor, limit: FEED_ANCHOR_OLDER }),
      ])
      return {
        items: [...newer.items, anchor, ...older.items],
        nextCursor: older.rowCount === FEED_ANCHOR_OLDER ? older.oldest : null,
        hasNewer: newer.rowCount > 0,
        anchorFound: true,
      }
    },
    today(groupId) {
      return backend.listFriendsToday(groupId)
    },
  }
}

function useFeedRepository(hook: string): FeedRepository {
  const { backend } = useBackendContext(hook)
  return useMemo(() => createFeedRepository(backend), [backend])
}

/** Older pages continue from a page's `nextCursor` (keyset). */
function nextPageParam(last: FeedPage): FeedCursor | undefined {
  return last.nextCursor ?? undefined
}

/**
 * The group's wall, newest first, 20 items a page. Refetches when the Feed opens (`'always'`) and on
 * app focus; cached data shows at once. Retries once.
 */
export function useFeed(groupId: string) {
  const repository = useFeedRepository('useFeed')
  return useInfiniteQuery({
    queryKey: feedWallKey(groupId),
    queryFn: ({ pageParam }) => repository.page(groupId, pageParam),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: nextPageParam,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
  })
}

/**
 * The wall anchored on a deep-linked check-in (`/feed/c/{checkinId}`): the first page holds the
 * newer items, the check-in and the older ones; later pages continue down by keyset.
 */
export function useFeedAround(groupId: string, checkinId: string) {
  const repository = useFeedRepository('useFeedAround')
  return useInfiniteQuery({
    queryKey: feedAroundKey(groupId, checkinId),
    queryFn: ({ pageParam }) =>
      pageParam === null
        ? repository.around(groupId, checkinId)
        : repository.page(groupId, pageParam),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: nextPageParam,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
    // One per link: not worth keeping for 14 days.
    meta: { persist: false },
  })
}

/**
 * Today's Friends today strip: the group's check-ins posted on the member's local day, newest first
 * (`get_friends_today`). Refetches when Today opens and on app focus; the outbox's feed invalidation
 * refreshes it after a post. Retries once.
 */
export function useFriendsToday(groupId: string) {
  const repository = useFeedRepository('useFriendsToday')
  return useQuery({
    queryKey: feedTodayKey(groupId),
    queryFn: () => repository.today(groupId),
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryOnline(1),
    retryDelay: 500,
    // Day-scoped: a saved copy opened on a later day would show yesterday's posts.
    meta: { persist: false },
  })
}
