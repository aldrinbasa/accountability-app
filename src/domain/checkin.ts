import type { ScheduleType } from '@/domain/activities'
import { shortDayName } from '@/domain/today'

/**
 * Check-in rules and copy (Story 3.2). The server decides timing, which session a check-in completes
 * and whether it counts (`post_checkin`), and what the picker says about each target
 * (`get_checkin_targets`); this file only formats what it returns.
 */

/** Why a check-in posted now would not count (`get_checkin_targets.wont_count`). */
export type WontCount = 'not_today' | 'counted_today' | 'target_met' | 'done'

export const WONT_COUNT_REASONS: readonly WontCount[] = [
  'not_today',
  'counted_today',
  'target_met',
  'done',
]

export function isWontCount(value: unknown): value is WontCount {
  return typeof value === 'string' && (WONT_COUNT_REASONS as readonly string[]).includes(value)
}

/**
 * One `get_checkin_targets` row: a commitment with sessions this week, or a task due today or later,
 * in the picker's order (due today first, then the rest).
 */
export interface CheckinTarget {
  commitmentId: string
  kind: 'commitment' | 'task'
  /** The activity: a preset key, or null for a custom activity. */
  presetKey: string | null
  /** The activity's display name. */
  activityName: string
  /** Tasks only: the task's own name. */
  name: string | null
  /** Commitments only. */
  scheduleType: ScheduleType | null
  /** Today's Due today section holds this row. */
  dueToday: boolean
  /** The member's local today, `YYYY-MM-DD`. */
  memberToday: string
  /** Tasks only, `YYYY-MM-DD`. */
  deadline: string | null
  /** Sessions this week (1 for a task). */
  target: number
  /** Check-ins that count this week. */
  doneCount: number
  /** Null when a post now would count. */
  wontCount: WontCount | null
}

/** What `post_checkin` is called with. The id is generated on the device once per photo. */
export interface PostCheckinInput {
  id: string
  groupId: string
  commitmentId: string
  /** The device clock at the shutter press, ISO 8601. */
  capturedAt: string
  /** Trimmed; null when empty. */
  caption: string | null
}

/** `post_checkin`'s answer. */
export interface PostCheckinResult {
  checkinId: string
  /** The session it completed; null for an extra that never counts. */
  sessionId: string | null
  counted: boolean
  isLate: boolean
  /** Check-ins that count this week for the commitment, after this one. */
  doneCount: number
  /** Sessions this week. */
  target: number
  /**
   * The member's weekly points in the group after the post (Story 4.1), null with no score this
   * week. The server's value; never computed on the device (AD-4).
   */
  weeklyPoints: number | null
  /** The member's rank after the post, null when unranked (no score, or a waiting group). */
  rank: number | null
  /**
   * Members this post moved the poster past. Empty for an extra, a post counted at its capture time
   * (sent over 10 minutes late), a waiting group and an idempotent replay.
   */
  passedUserIds: string[]
}

/** The two renditions uploaded per check-in (long edge in px). */
export type CheckinPhotoSize = 1080 | 360

export const CHECKIN_PHOTO_SIZES: readonly CheckinPhotoSize[] = [1080, 360]

/** WebP quality for check-in photos (0 to 1). */
export const CHECKIN_PHOTO_QUALITY = 0.8

/** `checkins/{group_id}/{checkin_id}/{1080|360}.webp`, inside the `checkins` bucket. */
export function checkinPhotoPath(groupId: string, checkinId: string, size: CheckinPhotoSize) {
  return `${groupId}/${checkinId}/${size}.webp`
}

/** Captions are at most 80 characters (the server checks it too: `invalid_caption`). */
export const CAPTION_MAX = 80

/** The caption sent to the server: trimmed, and null when nothing is left. */
export function normalizeCaption(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** The live counter under the Caption field: "17/80". */
export function captionCount(text: string): string {
  return `${text.length}/${CAPTION_MAX}`
}

/**
 * The size to encode a `width` x `height` frame at so its long edge is `longEdge`, never larger than
 * the source (no upscaling). Whole pixels, at least 1.
 */
export function scaledSize(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(1, longEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Copy for the picker, preview and post moment (Story 3.2 ACs). */
export const CHECKIN_COPY = {
  pickerTitle: "What's this check-in for?",
  nothingLine: 'Nothing to check in for here yet.',
  nothingBody: 'Add a habit or a task first.',
  close: 'Close',
  caption: 'Caption',
  retake: 'Retake',
  post: 'Post',
  posting: 'Posting…',
  discardTitle: 'Discard this photo?',
  keep: 'Keep',
  discard: 'Discard',
  postFailed: "Couldn't post your photo. Tap Retry.",
  loadFailed: "Can't reach Proofy right now.",
  retry: 'Retry',
  preview: 'Your photo',
} as const

/** The won't-count note, which replaces the picker row's normal status. */
export const WONT_COUNT_COPY: Record<WontCount, string> = {
  not_today: "not today · won't count",
  counted_today: "counted today · won't count",
  target_met: "target met · won't add points",
  done: "done · won't count",
}

/** A target's title: the task's name, else the activity's. */
export function targetTitle(target: Pick<CheckinTarget, 'name' | 'activityName'>): string {
  return target.name ?? target.activityName
}

/**
 * The picker row's status: the won't-count note when there is one, else "Fri · due" (fixed days),
 * "2/3 this week" (times per week) or "Task · by Sun".
 */
export function pickerStatus(target: CheckinTarget): string {
  if (target.wontCount !== null) return WONT_COUNT_COPY[target.wontCount]
  if (target.kind === 'task') {
    return target.deadline ? `Task · by ${shortDayName(target.deadline)}` : 'Task'
  }
  if (target.scheduleType === 'times_per_week') {
    return `${target.doneCount}/${target.target} this week`
  }
  return `${shortDayName(target.memberToday)} · due`
}

/**
 * The post moment's one polite announcement: "Posted. Gym 4 of 5. 67 weekly points. Rank 1." The
 * points sentence whenever the post has a score (a group of one too: "Posted. Gym 4 of 5. 67 weekly
 * points."), the rank sentence only when ranked; no score keeps "Posted. Gym 4 of 5."
 */
export function postedAnnouncement(
  title: string,
  doneCount: number,
  target: number,
  score: { weeklyPoints: number | null; rank: number | null } = { weeklyPoints: null, rank: null },
): string {
  const base = `Posted. ${title} ${doneCount} of ${target}.`
  if (score.weeklyPoints === null) return base
  const points = `${base} ${score.weeklyPoints} weekly points.`
  return score.rank === null ? points : `${points} Rank ${score.rank}.`
}

/** The polaroid photo's alt text: "Your Gym check-in, caption: leg day." */
export function checkinAlt(title: string, caption: string | null): string {
  return caption ? `Your ${title} check-in, caption: ${caption}` : `Your ${title} check-in`
}

/** A late check-in's label: "sent 5 h later", and how a screen reader says it. */
export interface LateLabel {
  text: string
  spoken: string
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The "sent … later" label of a late check-in (Story 3.3, shown by the Feed in Story 3.4): the time
 * from capture to receipt, both from the server, rounded down: `sent {n} min later` under 1 hour,
 * `sent {n} h later` under 24 hours, `sent {n} day(s) later` from 24 hours. `spoken` spells the unit
 * out ("sent 5 hours later"). A receipt before the capture reads as 0 min.
 */
export function formatLateLabel(capturedAt: string, receivedAt: string): LateLabel {
  const ms = Date.parse(receivedAt) - Date.parse(capturedAt)
  const minutes = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0
  if (minutes < 60) {
    return {
      text: `sent ${minutes} min later`,
      spoken: `sent ${plural(minutes, 'minute', 'minutes')} later`,
    }
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return { text: `sent ${hours} h later`, spoken: `sent ${plural(hours, 'hour', 'hours')} later` }
  }
  const days = Math.floor(hours / 24)
  const dayText = `sent ${plural(days, 'day', 'days')} later`
  return { text: dayText, spoken: dayText }
}
