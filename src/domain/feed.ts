import { formatLateLabel, type LateLabel } from '@/domain/checkin'
import type { FeedGoal } from '@/domain/goal'
import { beatLine, joinNames } from '@/domain/winner'

/**
 * The Feed wall (Story 3.4): check-ins and membership stickies, newest first. The server decides
 * what each member may see, the counted position and target, lateness and extras (`feed_items`);
 * this file only names the items and formats what the server returns.
 */

/** The membership event kinds the Feed renders as plain stickies. `miss` has its own item type. */
export type FeedEventKind = 'member_joined' | 'member_left' | 'member_removed' | 'admin_handover'

export const FEED_EVENT_KINDS: readonly FeedEventKind[] = [
  'member_joined',
  'member_left',
  'member_removed',
  'admin_handover',
]

export function isFeedEventKind(value: unknown): value is FeedEventKind {
  return typeof value === 'string' && (FEED_EVENT_KINDS as readonly string[]).includes(value)
}

/** A keyset position: the row's `sort_at` exactly as the server sent it, and its `item_id`. */
export interface FeedCursor {
  sortAt: string
  itemId: string
}

/** A check-in on the wall. */
export interface FeedCheckin {
  type: 'checkin'
  id: string
  groupId: string
  /** `received_at`, the wall's order. */
  sortAt: string
  authorId: string
  authorName: string
  authorAvatarPath: string | null
  commitmentId: string
  commitmentKind: 'commitment' | 'task'
  activityName: string
  presetKey: string | null
  /** Tasks only. */
  taskName: string | null
  /** The device clock at the shutter. */
  capturedAt: string
  receivedAt: string
  isLate: boolean
  /** Completed no session: never counts. */
  isExtra: boolean
  caption: string | null
  /** Set once only the 360 rendition is left (Story 7.3). */
  fullPrunedAt: string | null
  /** Its place among the commitment's counted check-ins that week; null for an extra. */
  countedPosition: number | null
  /** The commitment's sessions that week; null for an extra. */
  target: number | null
  /** The check-in's challenge (Story 5.1), null when nobody challenged it. */
  challengeId: string | null
  /** `open`, `real` or `cancelled` (a Fake-ruled check-in never reaches the wall); null without one. */
  challengeStatus: ChallengeStatus | null
  /** When an open challenge closes (server time); null without one. */
  challengeClosesAt: string | null
  /** Challengeable until `least(received_at + 24 h, lock_at)` (server time). */
  challengeUntil: string | null
}

/** A challenge's state as the server stores it. */
export type ChallengeStatus = 'open' | 'fake' | 'real' | 'cancelled'

export function isChallengeStatus(value: unknown): value is ChallengeStatus {
  return value === 'open' || value === 'fake' || value === 'real' || value === 'cancelled'
}

/** A membership sticky. */
export interface FeedEvent {
  type: 'event'
  kind: FeedEventKind
  id: string
  groupId: string
  sortAt: string
  actorId: string | null
  /** The live name when visible, else the name at write time. */
  actorName: string
  subjectId: string | null
  subjectName: string | null
}

/** The five couch teases a miss event carries (picked by the server, never the same twice in a row). */
export type MissTease =
  'couch_wins' | 'couch_regards' | 'couch_comfortable' | 'couch_thanks' | 'couch_loses'

export const MISS_TEASES: Readonly<Record<MissTease, string>> = {
  couch_wins: 'The couch wins this round.',
  couch_regards: 'The couch sends its regards.',
  couch_comfortable: 'The couch is getting comfortable.',
  couch_thanks: 'The couch says thanks for visiting.',
  couch_loses: 'Next time, the couch loses.',
}

function isMissTease(value: string | null): value is MissTease {
  return value !== null && Object.hasOwn(MISS_TEASES, value)
}

/**
 * A miss sticky (Story 3.5): a session (fixed days, task) or a times-per-week week that ended without
 * a counted check-in. The server stamps it, picks the tease and hides it once nothing is missed.
 */
export interface FeedMiss {
  type: 'miss'
  id: string
  groupId: string
  sortAt: string
  /** The member who missed. */
  actorId: string | null
  actorName: string
  commitmentId: string | null
  /** The task's name, else the activity's. */
  title: string
  scheduleType: 'fixed_days' | 'times_per_week' | null
  /** The event's sessions still missed (times per week: target minus counted, minus late arrivals). */
  missCount: number
  /** The tease key as stored; an unknown key shows the line without a tease. */
  tease: string | null
  /** The member-local day the miss covers (`YYYY-MM-DD`), the last day of a times-per-week week. */
  missedOn: string | null
}

/**
 * A weekly winner sticky (Story 4.5): written once when a week with winners locks. Names and points
 * are the payload's, as they were at the lock.
 */
export interface FeedWinner {
  type: 'winner'
  id: string
  groupId: string
  sortAt: string
  /** The locked week's Monday, `YYYY-MM-DD`. */
  weekStart: string
  /** The winners' weekly points (co-winners share them). */
  weeklyPoints: number
  /** The winners by name: id and name at the lock. */
  winners: { userId: string; name: string }[]
}

/** How a challenge was decided: at once in a 2-member group, by the lone challenger, or by votes. */
export type RulingVariant = 'two_person' | 'lone' | 'normal'

/**
 * A ruling sticky (Story 5.1): a closed challenge. The challenger and the check-in's owner by id and
 * name, the check-in's title (task name, else activity), the outcome and the counts.
 */
export interface FeedRuling {
  type: 'ruling'
  id: string
  groupId: string
  sortAt: string
  challengeId: string
  checkinId: string
  challengerId: string | null
  challengerName: string
  ownerId: string | null
  ownerName: string
  /** The task's name, else the activity's. */
  title: string
  outcome: 'fake' | 'real'
  fakeCount: number
  realCount: number
  variant: RulingVariant
}

export type FeedItem = FeedCheckin | FeedEvent | FeedMiss | FeedWinner | FeedGoal | FeedRuling

/** One keyset read: older than `before`, or newer than `after` (never both), at most `limit` rows. */
export interface FeedRowsRequest {
  before?: FeedCursor
  after?: FeedCursor
  limit: number
}

/**
 * What one keyset read returned, newest first. `rowCount` and the cursors count the raw rows, so an
 * unknown kind the adapter dropped never ends paging early.
 */
export interface FeedRows {
  items: FeedItem[]
  rowCount: number
  newest: FeedCursor | null
  oldest: FeedCursor | null
}

/** A page as the repository hands it out. */
export interface FeedPage {
  items: FeedItem[]
  /** Where the next (older) page starts; null at the end of the wall. */
  nextCursor: FeedCursor | null
  /** Anchored pages only: newer items exist above this page ("See newest"). */
  hasNewer?: boolean
  /** Anchored pages only: the deep-linked check-in was found (false: gone, hidden, other group). */
  anchorFound?: boolean
}

/** Items per page (keyset on `sort_at`, `item_id`). */
export const FEED_PAGE_SIZE = 20
/** An anchored page: up to this many newer items above the deep-linked one … */
export const FEED_ANCHOR_NEWER = 10
/** … and this many older below it. */
export const FEED_ANCHOR_OLDER = 20
/** From this index on, items skip layout and paint while off screen (`content-visibility`). */
export const FEED_VIRTUALIZE_FROM = 50
/** The first polaroids load eagerly; the rest lazily. */
export const FEED_EAGER_PHOTOS = 2

export const FEED_COPY = {
  title: 'Feed',
  emptyLine: 'Nothing stuck here yet.',
  emptyBody: 'The first check-in gets the front page.',
  sending: 'sending…',
  extra: 'extra',
  photoFailed: "Photo didn't load.",
  photoOffline: "Loads when you're back online.",
  retry: 'Retry',
  gone: "That's already wrapped up.",
  seeNewest: 'See newest',
  olderFailed: "Couldn't load older posts.",
  close: 'Close',
  viewer: 'Photo',
  you: 'You',
  miss: 'Miss',
  friendsToday: 'Friends today',
  seeAll: 'See all in Feed',
} as const

/** The Friends today heading's count: "· 3 posted". */
export function postedCount(count: number): string {
  return `· ${count} posted`
}

/** A mini polaroid's caption: "Marco · Gym" ("You · Gym" for the viewer's own). */
export function miniCaption(item: FeedCheckin, viewer: Pick<FeedViewer, 'userId'>): string {
  const who = item.authorId === viewer.userId ? FEED_COPY.you : item.authorName
  return `${who} · ${feedTitle(item)}`
}

/** "Switched to Sunday Reset." when a deep link moved the focus to another group. */
export function switchedToast(groupName: string): string {
  return `Switched to ${groupName}.`
}

/** A check-in's title: the task's name, else the activity's. */
export function feedTitle(item: Pick<FeedCheckin, 'taskName' | 'activityName'>): string {
  return item.taskName ?? item.activityName
}

/** The member-local calendar date of an instant, `YYYY-MM-DD`. */
function localDate(at: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

function dayNumber(isoDate: string): number {
  return Math.round(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000)
}

/**
 * The capture time in the viewer's zone: "07:12" today, "Thu 07:12" within the last 6 days,
 * "12 Nov" older (or a capture dated after today by the viewer's clock).
 */
export function formatFeedStamp(capturedAt: string, zone: string, now: Date): string {
  const at = new Date(capturedAt)
  if (Number.isNaN(at.getTime())) return ''
  const days = dayNumber(localDate(now, zone)) - dayNumber(localDate(at, zone))
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
  if (days === 0) return clock
  if (days > 0 && days <= 6) {
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short' }).format(
      at,
    )
    return `${weekday} ${clock}`
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
  }).format(at)
}

/** What a check-in's text needs besides the item: who is looking, in which zone, and when. */
export interface FeedViewer {
  userId: string
  zone: string
  now: Date
}

function isOwn(item: FeedCheckin, viewer: FeedViewer): boolean {
  return item.authorId === viewer.userId
}

/** "You" for the viewer's own items, else the author's name. */
export function authorLabel(item: FeedCheckin, viewer: FeedViewer): string {
  return isOwn(item, viewer) ? FEED_COPY.you : item.authorName
}

/**
 * The meta line's parts after the name: "Gym · 3/3 · 07:12"; an extra "Gym · extra · 07:12"; a
 * task "Groceries · 07:12" (always 1/1, so no fraction).
 */
export function checkinMetaRest(item: FeedCheckin, viewer: FeedViewer): string {
  const parts = [feedTitle(item)]
  if (item.isExtra) parts.push(FEED_COPY.extra)
  else if (
    item.commitmentKind === 'commitment' &&
    item.countedPosition !== null &&
    item.target !== null
  ) {
    parts.push(`${item.countedPosition}/${item.target}`)
  }
  parts.push(formatFeedStamp(item.capturedAt, viewer.zone, viewer.now))
  return parts.filter((part) => part !== '').join(' · ')
}

/** The meta line: "Marco · Gym · 3/3 · 07:12" ("You · …" for the viewer's own). */
export function checkinMeta(item: FeedCheckin, viewer: FeedViewer): string {
  return `${authorLabel(item, viewer)} · ${checkinMetaRest(item, viewer)}`
}

/** The item's h2: "Marco · Gym · 07:12". */
export function checkinHeading(item: FeedCheckin, viewer: FeedViewer): string {
  const stamp = formatFeedStamp(item.capturedAt, viewer.zone, viewer.now)
  return [authorLabel(item, viewer), feedTitle(item), stamp].filter((p) => p !== '').join(' · ')
}

/**
 * The photo's alt text: "Marco's Gym check-in, 07:12, caption: leg day. send help." ("Your Gym
 * check-in, …" for the viewer's own; no caption part without one).
 */
export function checkinAlt(item: FeedCheckin, viewer: FeedViewer): string {
  const owner = isOwn(item, viewer) ? 'Your' : `${item.authorName}'s`
  const stamp = formatFeedStamp(item.capturedAt, viewer.zone, viewer.now)
  const base = `${owner} ${feedTitle(item)} check-in${stamp ? `, ${stamp}` : ''}`
  return item.caption ? `${base}, caption: ${item.caption}` : base
}

/** A late check-in's label ("sent 5 h later" / "sent 5 hours later"), else null. */
export function checkinLateLabel(item: FeedCheckin): LateLabel | null {
  return item.isLate ? formatLateLabel(item.capturedAt, item.receivedAt) : null
}

/**
 * A sticky's line: "Priya joined.", "Sam left.", "Sam was removed.", "Jo left. Marco is admin
 * now."; the viewer's own name reads "You" ("You joined.", "Jo left. You're admin now.").
 */
export function eventLine(item: FeedEvent, viewerId: string): string {
  const actorOwn = item.actorId !== null && item.actorId === viewerId
  const subjectOwn = item.subjectId !== null && item.subjectId === viewerId
  const actor = actorOwn ? FEED_COPY.you : item.actorName
  const subject = subjectOwn ? FEED_COPY.you : (item.subjectName ?? '')
  switch (item.kind) {
    case 'member_joined':
      return `${actor} joined.`
    case 'member_left':
      return `${actor} left.`
    case 'member_removed':
      return subjectOwn ? 'You were removed.' : `${subject} was removed.`
    case 'admin_handover':
      return subjectOwn
        ? `${actor} left. You're admin now.`
        : `${actor} left. ${subject} is admin now.`
  }
}

/** Connection hints the browser exposes (`navigator.connection`), when it does. */
export interface ConnectionHints {
  saveData: boolean
  effectiveType: string | null
}

/**
 * Which renditions a photo box uses: `small` (52 px and 104 px boxes), a pruned 1080, Save-Data or a
 * 2g link get the 360 rendition only; everything else gets 360 as `src` with a 360w/1080w `srcset`.
 */
export function photoRenditions(options: {
  small: boolean
  fullPruned: boolean
  hints: ConnectionHints
}): 'small' | 'responsive' {
  const slow = options.hints.effectiveType === '2g' || options.hints.effectiveType === 'slow-2g'
  if (options.small || options.fullPruned || options.hints.saveData || slow) return 'small'
  return 'responsive'
}

/**
 * A miss sticky's line: "Dev missed Paint. The couch wins this round."; times per week "Dev missed 2
 * Gym sessions. …" ("1 Gym session"); the viewer's own "You missed …"; tasks use the task name. No
 * score and no judgment words: only who, what and the tease. An unknown tease key leaves it off.
 */
export function missLine(item: FeedMiss, viewerId: string): string {
  const who = item.actorId !== null && item.actorId === viewerId ? FEED_COPY.you : item.actorName
  const what =
    item.scheduleType === 'times_per_week'
      ? `${item.missCount} ${item.title} ${item.missCount === 1 ? 'session' : 'sessions'}`
      : item.title
  const line = `${who} missed ${what}.`
  return isMissTease(item.tease) ? `${line} ${MISS_TEASES[item.tease]}` : line
}

/** The weekday of a calendar date (`YYYY-MM-DD`), read as that date (no zone shift). */
function dateLabel(isoDate: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(
    new Date(`${isoDate}T00:00:00Z`),
  )
}

/**
 * The miss sticky's day: "Thu" when the missed day is within the last 6 days of the viewer's today
 * (or is the viewer's tomorrow, for a member in a zone ahead), else "12 Nov". Empty when the server sent no day.
 */
export function missDay(missedOn: string | null, zone: string, now: Date): string {
  if (missedOn === null || !/^\d{4}-\d{2}-\d{2}$/.test(missedOn)) return ''
  const days = dayNumber(localDate(now, zone)) - dayNumber(missedOn)
  if (Number.isNaN(days)) return ''
  // -1: a viewer behind the member's zone can see the member's day as their own tomorrow.
  if (days >= -1 && days <= 6) return dateLabel(missedOn, { weekday: 'short' })
  return dateLabel(missedOn, { day: 'numeric', month: 'short' })
}

/**
 * The winner sticky's line: "Last week's winner · Marco · 94 · Bow down. Or just beat Marco.";
 * co-winners "Last week's winners · Marco & Jo · 94 each." with no tease. The winner reading their
 * own sticky gets no tease either ("Last week's winner · Marco · 94."): it is about them.
 */
export function winnerStickyLine(item: FeedWinner, viewerId: string): string {
  const names = joinNames(item.winners.map((winner) => winner.name))
  if (item.winners.length > 1) {
    return `Last week's winners · ${names} · ${item.weeklyPoints} each.`
  }
  const only = item.winners[0]
  if (!only || only.userId === viewerId) {
    return `Last week's winner · ${names} · ${item.weeklyPoints}.`
  }
  return `Last week's winner · ${names} · ${item.weeklyPoints} · ${beatLine(only.name)}`
}
