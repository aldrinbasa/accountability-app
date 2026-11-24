import { DAY_SHORT, MONTH_SHORT } from '@/domain/dates'
import { errorCopy, type BackendErrorCode } from '@/domain/error-codes'
import type { TodayItem } from '@/domain/today'

/**
 * Freeze requests (Story 5.4). The server decides every window, target and outcome
 * (`my_freeze_options`, `request_freeze`, `my_freeze_requests`, `private.close_vote`); this file
 * only compares the server's timestamps with the clock to show or hide controls, picks which
 * server row belongs to a row on screen, and words what the server sent (AD-11).
 */

export const FREEZE_COPY = {
  requestFreeze: 'Request freeze',
  sheetTitle: 'Request freeze',
  reasonLabel: 'Reason',
  reasonError: 'Add a reason so the group knows why.',
  voteNote: 'The group votes for 24 h. No votes means approved.',
  soloNote: "Just you in this group, so it's approved right away.",
  sessionLabel: 'Session',
  weekLabel: 'Week',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  send: 'Send',
  sending: 'Sending…',
  requested: 'Freeze requested.',
  freezeVote: 'Freeze vote',
  frozen: 'Frozen',
  offline: "You're offline. Freezes need a signal.",
  failed: "Couldn't send the freeze request. Tap Retry.",
  locked: "That week has locked, so it can't be frozen.",
  retry: 'Retry',
} as const

/** Longest reason the server takes (trimmed). */
export const REASON_MAX = 80

/** `day`: a fixed-days or task session; `week`: a times-per-week week. */
export type FreezeOptionKind = 'day' | 'week'

/** `this` | `last`: the member week the option is in, relative to the member's current week. */
export type FreezeWhich = 'this' | 'last'

/** One `my_freeze_options` row: something the caller may freeze now, every window from the server. */
export interface FreezeOption {
  kind: FreezeOptionKind
  commitmentId: string
  /** Day options only. */
  sessionId: string | null
  /** Day: the session's span. Week: the first row's start and the last row's end. */
  startsAt: string
  endsAt: string
  /** Until when the server takes a request for it (never past the lock). */
  windowEndsAt: string
  /** Day: the session is missed. Week: a row of the week is miss-stamped. */
  missed: boolean
  /** The week's Monday, `YYYY-MM-DD`. */
  weekStart: string
  which: FreezeWhich
  /** Week options only: rows minus approved and pending freezes. */
  target: number | null
  /** Week options only: approved plus pending freezes. */
  frozen: number | null
  /** Week options only: `target - 1`. */
  targetAfter: number | null
  /** The member's IANA zone that week (for formatting the day only). */
  timeZone: string
}

export type FreezeStatus = 'pending' | 'approved'

/** One `my_freeze_requests` row: the caller's pending or approved request in an unlocked week. */
export interface FreezeRequest {
  id: string
  commitmentId: string
  sessionId: string
  kind: FreezeOptionKind
  weekStart: string
  status: FreezeStatus
  reason: string
  closesAt: string
  /** The frozen (or picked) session's start. */
  startsAt: string
  /** Week requests only: the week's effective target now (rows minus approved and pending). */
  targetAfter: number | null
}

/** `request_freeze`'s input: a day names the session, a week names its Monday. */
export interface RequestFreezeInput {
  commitmentId: string
  reason: string
  sessionId: string | null
  weekStart: string | null
}

/** What `request_freeze` returned: `approved` when the group has 1 member (closed at once). */
export interface RequestFreezeResult {
  freezeRequestId: string
  status: FreezeStatus | 'denied'
  closesAt: string
  sessionId: string
}

/** An option's identity in the Sheet: its session (day) or its week. */
export function freezeOptionKey(option: FreezeOption): string {
  return option.kind === 'day' ? `day:${option.sessionId ?? ''}` : `week:${option.weekStart}`
}

function isBefore(now: Date, timestamp: string): boolean {
  const at = Date.parse(timestamp)
  return !Number.isNaN(at) && now.getTime() < at
}

function isAtOrAfter(now: Date, timestamp: string): boolean {
  const at = Date.parse(timestamp)
  return !Number.isNaN(at) && now.getTime() >= at
}

/** Whether the server's window for the option is still open by the clock. */
export function optionOpen(option: FreezeOption, now: Date): boolean {
  return isBefore(now, option.windowEndsAt)
}

function isTimesPerWeek(item: Pick<TodayItem, 'kind' | 'scheduleType'>): boolean {
  return item.kind === 'commitment' && item.scheduleType === 'times_per_week'
}

/**
 * The option a Today row's Overflow offers: fixed days the session containing now, a task its one
 * session, times per week this week. Null when none (outside its window, done, frozen, pending, a
 * Fake-ruling miss, a locked week: the server left it out) and for next week's rows.
 */
export function todayRowOption(
  item: Pick<TodayItem, 'commitmentId' | 'kind' | 'scheduleType' | 'section'>,
  options: readonly FreezeOption[],
  now: Date,
): FreezeOption | null {
  if (item.section === 'starts_next_week') return null
  const own = options.filter((o) => o.commitmentId === item.commitmentId && optionOpen(o, now))
  if (isTimesPerWeek(item)) {
    return own.find((o) => o.kind === 'week' && o.which === 'this') ?? null
  }
  if (item.kind === 'task') return own.find((o) => o.kind === 'day') ?? null
  return (
    own.find((o) => o.kind === 'day' && isAtOrAfter(now, o.startsAt) && isBefore(now, o.endsAt)) ??
    null
  )
}

/** Every option of a commitment still in its window (My plan), in the server's order. */
export function commitmentOptions(
  commitmentId: string,
  options: readonly FreezeOption[],
  now: Date,
): FreezeOption[] {
  return options.filter((o) => o.commitmentId === commitmentId && optionOpen(o, now))
}

/**
 * The options the own miss sticky offers: day options for the miss's sessions, or the week option
 * of the miss's week (times per week). Empty when none is in its window (never for a Fake-ruling
 * miss: the server leaves those out).
 */
export function missOptions(
  miss: { commitmentId: string | null; sessionIds: readonly string[]; weekStart: string | null },
  options: readonly FreezeOption[],
  now: Date,
): FreezeOption[] {
  if (miss.commitmentId === null) return []
  return options.filter(
    (o) =>
      o.commitmentId === miss.commitmentId &&
      optionOpen(o, now) &&
      (o.kind === 'day'
        ? o.sessionId !== null && miss.sessionIds.includes(o.sessionId)
        : o.weekStart === miss.weekStart),
  )
}

/** The calendar date (`YYYY-MM-DD`) of an instant in a zone; UTC for an unknown zone. */
export function localDate(timestamp: string, zone: string): string | null {
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return null
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  try {
    return format(zone)
  } catch {
    return format('UTC')
  }
}

/**
 * The request shown on a Today row: times per week the pending request of this week; a task its
 * request; fixed days the request on today's session (its start on the member's today). An approved
 * request wins over a pending one. Null when none.
 */
export function todayRowRequest(
  item: Pick<TodayItem, 'commitmentId' | 'kind' | 'scheduleType' | 'section'>,
  requests: readonly FreezeRequest[],
  memberToday: string,
  weekStart: string,
  zone: string,
): FreezeRequest | null {
  if (item.section === 'starts_next_week') return null
  const own = requests.filter((r) => r.commitmentId === item.commitmentId)
  let matches: FreezeRequest[]
  if (isTimesPerWeek(item)) {
    // An approved week freeze lowers the ring (approvedWeekFreezes); here only the pending vote.
    matches = own.filter((r) => r.kind === 'week' && r.weekStart === weekStart)
    return matches.find((r) => r.status === 'pending') ?? null
  }
  if (item.kind === 'task') matches = own
  else matches = own.filter((r) => localDate(r.startsAt, zone) === memberToday)
  return matches.find((r) => r.status === 'approved') ?? matches[0] ?? null
}

/**
 * How many sessions of a times-per-week row's week are frozen (its approved week requests, Story
 * 5.5): the server already lowered the row's target by as many. 0 for other rows.
 */
export function approvedWeekFreezes(
  item: Pick<TodayItem, 'commitmentId' | 'kind' | 'scheduleType' | 'section'>,
  requests: readonly FreezeRequest[],
  weekStart: string,
): number {
  if (item.section === 'starts_next_week' || !isTimesPerWeek(item)) return 0
  return requests.filter(
    (r) =>
      r.commitmentId === item.commitmentId &&
      r.kind === 'week' &&
      r.status === 'approved' &&
      r.weekStart === weekStart,
  ).length
}

/** The approved requests a My plan row shows (Story 5.5), earliest session first. */
export function planRowApproved(
  commitmentId: string,
  requests: readonly FreezeRequest[],
): FreezeRequest[] {
  return requests
    .filter((r) => r.commitmentId === commitmentId && r.status === 'approved')
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
}

/**
 * A My plan row's approved freeze: a day "Frozen · Sat · flu, in bed" (the session's member-local
 * weekday), a times-per-week week "Frozen · one session · flu".
 */
export function approvedPlanLine(
  request: Pick<FreezeRequest, 'kind' | 'reason' | 'startsAt'>,
  zone: string,
): string {
  if (request.kind === 'week') return `${FREEZE_COPY.frozen} · one session · ${request.reason}`
  const day = sessionDay(request.startsAt, zone)
  return day ? `${FREEZE_COPY.frozen} · ${day} · ${request.reason}` : frozenMeta(request.reason)
}

/** The pending request a My plan row shows: the one closing first. Null when none. */
export function planRowPending(
  commitmentId: string,
  requests: readonly FreezeRequest[],
): FreezeRequest | null {
  const pending = requests
    .filter((r) => r.commitmentId === commitmentId && r.status === 'pending')
    .sort((a, b) => Date.parse(a.closesAt) - Date.parse(b.closesAt))
  return pending[0] ?? null
}

/**
 * Time left on a vote: hours rounded down ("21 h left"); under 1 hour the minutes, at least 1
 * ("5 min left"). Null once `closes_at` has passed (the tick closes it).
 */
export function freezeTimeLeft(closesAt: string, now: Date): string | null {
  const closes = Date.parse(closesAt)
  if (Number.isNaN(closes)) return null
  const left = closes - now.getTime()
  if (left <= 0) return null
  const hours = Math.floor(left / 3_600_000)
  if (hours >= 1) return `${hours} h left`
  return `${Math.max(1, Math.floor(left / 60_000))} min left`
}

function times(n: number): string {
  return `${n} ${n === 1 ? 'time' : 'times'}`
}

/**
 * A pending request's meta: "Freeze vote · 21 h left", for times per week
 * "Freeze vote · 21 h left · would make it 2 times".
 */
export function pendingMeta(
  request: Pick<FreezeRequest, 'kind' | 'closesAt' | 'targetAfter'>,
  now: Date,
): string {
  const parts: string[] = [FREEZE_COPY.freezeVote]
  const left = freezeTimeLeft(request.closesAt, now)
  if (left) parts.push(left)
  if (request.kind === 'week' && request.targetAfter !== null) {
    parts.push(`would make it ${times(Math.max(0, request.targetAfter))}`)
  }
  return parts.join(' · ')
}

/** An approved day session's meta: "Frozen · flu, in bed". */
export function frozenMeta(reason: string): string {
  return `${FREEZE_COPY.frozen} · ${reason}`
}

function zoned(timestamp: string, zone: string): { weekday: number; day: number; month: number } {
  const date = localDate(timestamp, zone)
  if (date === null) return { weekday: 0, day: 0, month: 0 }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return { weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(), day: d, month: m - 1 }
}

/** "Sat": the session's member-local weekday. */
export function sessionDay(startsAt: string, zone: string): string {
  return DAY_SHORT[zoned(startsAt, zone).weekday] ?? ''
}

/** "Sat 29 Nov": a session in the Sheet's list. */
export function sessionLabel(startsAt: string, zone: string): string {
  const { weekday, day, month } = zoned(startsAt, zone)
  return `${DAY_SHORT[weekday] ?? ''} ${day} ${MONTH_SHORT[month] ?? ''}`
}

/** The Sheet's pre-picked session: "Study on Sat". */
export function dayLine(
  title: string,
  option: Pick<FreezeOption, 'startsAt' | 'timeZone'>,
): string {
  return `${title} on ${sessionDay(option.startsAt, option.timeZone)}`
}

function weekWord(which: FreezeWhich): string {
  return which === 'this' ? 'this week' : 'last week'
}

/**
 * The times-per-week effect line: "Gym this week: 3 → 2 times", or with freezes already on the week
 * "Already 1 frozen: 2 → 1".
 */
export function effectLine(
  title: string,
  option: Pick<FreezeOption, 'which' | 'target' | 'frozen' | 'targetAfter'>,
): string {
  const target = option.target ?? 0
  const after = option.targetAfter ?? Math.max(0, target - 1)
  if ((option.frozen ?? 0) > 0) return `Already ${option.frozen} frozen: ${target} → ${after}`
  return `${title} ${weekWord(option.which)}: ${target} → ${times(after)}`
}

/** "Gym will have no score this week." when the freeze would lower the target to 0; else null. */
export function noScoreLine(
  title: string,
  option: Pick<FreezeOption, 'which' | 'targetAfter'>,
): string | null {
  return option.targetAfter === 0 ? `${title} will have no score ${weekWord(option.which)}.` : null
}

/** The solo toast: "Freeze approved · Study on Sat is off the plan." / "… · one Gym session …". */
export function approvedToast(title: string, option: FreezeOption): string {
  if (option.kind === 'week') return `Freeze approved · one ${title} session is off the plan.`
  return `Freeze approved · ${dayLine(title, option)} is off the plan.`
}

/** The Sheet's vote note: the 24 h vote, or approved at once when alone in the group. */
export function voteNote(solo: boolean): string {
  return solo ? FREEZE_COPY.soloNote : FREEZE_COPY.voteNote
}

/** My plan's snowflake button: "Request freeze for Study". */
export function requestFreezeLabel(title: string): string {
  return `${FREEZE_COPY.requestFreeze} for ${title}`
}

/** The Reason field's live counter: "12/80". */
export function reasonCounter(reason: string): string {
  return `${reason.length}/${REASON_MAX}`
}

/** The Field error for a reason the server would refuse (blank after trimming, or over 80). */
export function validateReason(reason: string): string | null {
  const trimmed = reason.trim()
  return trimmed.length === 0 || trimmed.length > REASON_MAX ? FREEZE_COPY.reasonError : null
}

/**
 * Why a request did not go through, besides offline and a plain failure: `reason` (the Field
 * error) or `refused` with its line (the Sheet closes with an error toast and the views refetch).
 */
export type FreezeFailure =
  { kind: 'reason' } | { kind: 'refused'; text: string } | { kind: 'failed' }

/** A rejected `request_freeze` as a Sheet failure; anything unmapped is a plain `failed`. */
export function freezeFailure(code: BackendErrorCode): FreezeFailure {
  switch (code) {
    case 'reason_required':
      return { kind: 'reason' }
    case 'week_locked':
      return { kind: 'refused', text: FREEZE_COPY.locked }
    case 'not_member':
    case 'invalid_freeze':
    case 'freeze_window_closed':
    case 'session_done':
    case 'session_frozen':
    case 'freeze_pending':
    case 'fake_ruling_miss':
    case 'target_met':
      return { kind: 'refused', text: errorCopy(code) }
    default:
      return { kind: 'failed' }
  }
}
