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
 * Today's rows with the moment's counts on its row, until Today data fetched after the post arrives
 * (`dataUpdatedAt` newer than `postedAt`): from then on the server's counts stand alone.
 */
export function withPostMoment(
  data: TodayData,
  moment: PostMoment | null,
  dataUpdatedAt: number,
): TodayData {
  if (!moment || !moment.counted || dataUpdatedAt > moment.postedAt) return data
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
