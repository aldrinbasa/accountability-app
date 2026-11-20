import { useSyncExternalStore } from 'react'
import type { TodayData } from '@/domain/today'

/**
 * The member's last post this session, for the post moment on Today (Story 3.2). Kept in memory
 * only, never in the query cache, so Story 3.3's persisted cache never holds it; gone on reload and
 * cleared on sign-out.
 */
export interface PostMoment {
  checkinId: string
  groupId: string
  commitmentId: string
  /** The row's title: the task's name, else the activity's. */
  title: string
  /** `post_checkin`'s counts for the commitment's week, after the post. */
  doneCount: number
  target: number
  /** It completed a session (false for an extra). */
  counted: boolean
  /** A late post may have counted on an earlier day: its row is left to the refetch. */
  isLate: boolean
  /** `post_checkin`'s weekly points after the post (Story 4.1); never cached (AD-4, AD-12). */
  weeklyPoints: number | null
  /** `post_checkin`'s rank after the post, null when unranked. */
  rank: number | null
  /** Members the post passed: the rank chip reads "#1 · passed Jo" until the next open of Today. */
  passedUserIds: string[]
  /** The Today mount that first showed the passed chip; a later mount no longer shows it. */
  passedShownIn: number | null
  /** A local URL of the 1080 rendition, or null where object URLs don't exist. */
  photoUrl: string | null
  caption: string | null
  /** `Date.now()` when the post was accepted: Today data fetched after this replaces the moment's counts. */
  postedAt: number
  /** The drop and the count bump have run, or a tap skipped them: Today shows the end state. */
  played: boolean
  /** The announcement and the haptic have fired (once per post). */
  announced: boolean
}

let current: PostMoment | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function revoke(moment: PostMoment | null): void {
  if (moment?.photoUrl && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(moment.photoUrl)
  }
}

/** A local URL for `photo`, or null where the platform has none (tests). */
export function localPhotoUrl(photo: Blob): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(photo) : null
}

/** Records a new post; the previous one's photo URL is released. */
export function setPostMoment(moment: PostMoment): void {
  if (current && current.photoUrl !== moment.photoUrl) revoke(current)
  current = moment
  emit()
}

/** The moment has played (or a tap skipped it): Today shows its end state from now on. */
export function markPostMomentPlayed(checkinId: string): void {
  if (!current || current.checkinId !== checkinId || current.played) return
  current = { ...current, played: true }
  emit()
}

/** The announcement and haptic fired: never again for this post. */
export function markPostMomentAnnounced(checkinId: string): void {
  if (!current || current.checkinId !== checkinId || current.announced) return
  current = { ...current, announced: true }
  emit()
}

/** The passed chip was first shown by Today mount `mountId`: later mounts drop it. */
export function markPassedShown(checkinId: string, mountId: number): void {
  if (!current || current.checkinId !== checkinId || current.passedShownIn !== null) return
  current = { ...current, passedShownIn: mountId }
  emit()
}

let todayMounts = 0

/** A new id per Today mount ("an open of Today"), for `markPassedShown`. */
export function nextTodayMountId(): number {
  todayMounts += 1
  return todayMounts
}

/**
 * The members the moment passed, while the passed chip still shows on Today mount `mountId`: from
 * the post until the next open of Today.
 */
export function passedForMount(moment: PostMoment | null, mountId: number): string[] {
  if (!moment || moment.passedUserIds.length === 0) return []
  if (moment.passedShownIn !== null && moment.passedShownIn !== mountId) return []
  return moment.passedUserIds
}

/** Sign-out: forget the moment and release its photo. */
export function clearPostMoment(): void {
  revoke(current)
  current = null
  emit()
}

export function getPostMoment(): PostMoment | null {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The last post, when it was made in `groupId`. */
export function usePostMoment(groupId: string): PostMoment | null {
  const moment = useSyncExternalStore(subscribe, getPostMoment)
  return moment?.groupId === groupId ? moment : null
}

/**
 * The Score sticker's optimistic value (Story 4.1): the moment's weekly points and rank until board
 * data fetched after the post arrives (`dataUpdatedAt` newer than `postedAt`), then null (the
 * board's own values stand). Kept in memory only, so the persisted cache never holds it.
 */
export function optimisticScore(
  moment: PostMoment | null,
  boardUpdatedAt: number,
): { weeklyPoints: number | null; rank: number | null } | null {
  if (!moment || boardUpdatedAt > moment.postedAt) return null
  return { weeklyPoints: moment.weeklyPoints, rank: moment.rank }
}

/**
 * Today's rows with the moment's counts on its row, until Today data fetched after the post arrives
 * (`dataUpdatedAt` newer than `postedAt`): from then on the server's counts stand alone. A late post
 * (counted at its capture time, maybe another day) is not applied: "counted today" would be a guess.
 */
export function withPostMoment(
  data: TodayData,
  moment: PostMoment | null,
  dataUpdatedAt: number,
): TodayData {
  if (!moment || !moment.counted || moment.isLate || dataUpdatedAt > moment.postedAt) return data
  if (!data.items.some((item) => item.commitmentId === moment.commitmentId)) return data
  return {
    ...data,
    items: data.items.map((item) =>
      item.commitmentId === moment.commitmentId
        ? {
            ...item,
            counted: moment.doneCount,
            countedToday: true,
            targetMet: moment.doneCount >= moment.target,
          }
        : item,
    ),
  }
}
