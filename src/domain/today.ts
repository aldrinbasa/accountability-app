import type { ScheduleType } from '@/domain/activities'
import { DAY_LONG, DAY_SHORT, parseIsoDate } from '@/domain/dates'
import { formatShortDate, PLAN_COPY } from '@/domain/plan'

/** Where `get_today_items` placed a row. */
export type TodaySection = 'due_today' | 'this_week' | 'starts_next_week'

export const TODAY_SECTIONS: readonly TodaySection[] = [
  'due_today',
  'this_week',
  'starts_next_week',
]

export function isTodaySection(value: unknown): value is TodaySection {
  return typeof value === 'string' && (TODAY_SECTIONS as readonly string[]).includes(value)
}

/**
 * One `get_today_items` row: a commitment or a task of the member's, already placed in a section
 * and in display order by the server. The client never computes the section, the target or what
 * counts (AD-11).
 */
export interface TodayItem {
  commitmentId: string
  kind: 'commitment' | 'task'
  section: TodaySection
  /** The activity: a preset key, or a custom name (exactly one is set). */
  presetKey: string | null
  customName: string | null
  /** The activity's display name (preset name or custom name). */
  activityName: string
  /** Tasks only: the task's own name. */
  name: string | null
  /** Commitments only. */
  scheduleType: ScheduleType | null
  /** Fixed days: ISO weekdays (Monday = 1). */
  days: number[] | null
  /**
   * Check-ins owed this week (the week's session count; 1 for a task). For a `starts_next_week`
   * row, the first week's times-per-week target (null for fixed days).
   */
  target: number | null
  /** Check-ins that count this week (0 until Epic 3). */
  counted: number
  /** Tasks only, `YYYY-MM-DD`. */
  deadline: string | null
  /** `starts_next_week` rows only: the first Monday, `YYYY-MM-DD`. */
  startsOn: string | null
  /** The server's `delete_task` rule at read time (false for commitments). */
  canDelete: boolean
}

/** `get_today_summary`: the member-local day and week and this week's counts. */
export interface TodaySummary {
  /** The member's local today (profile zone), `YYYY-MM-DD`. */
  memberToday: string
  /** Monday of the member's current week, `YYYY-MM-DD`. */
  weekStart: string
  /** Weeks since the member joined this group; the week of joining is week 1. */
  weekNumber: number
  /** Sessions this week. */
  planned: number
  /** Sessions that count (0 until Epic 3). */
  done: number
  /** `planned - done`. */
  left: number
  /**
   * The member has an active commitment (this week or from next week) or an open task in the group,
   * even when nothing is listed today (fixed days on another day). False means "No plan here yet."
   */
  hasPlan: boolean
}

/** Both Today reads, under one query key. */
export interface TodayData {
  items: TodayItem[]
  summary: TodaySummary
}

/** Copy for Today (Story 2.5 ACs). */
export const TODAY_COPY = {
  dueToday: 'Due today',
  thisWeek: 'This week',
  planHere: 'Your plan here',
  nothingDue: 'Nothing due today. The couch is suspicious.',
  noPlanLine: 'No plan here yet.',
  noPlanBody: 'Add a commitment or a task to start scoring.',
  fixedDays: 'Fixed days',
  task: 'Task',
  edit: 'Edit',
} as const

function utcDay(value: string): number | null {
  return parseIsoDate(value)?.getUTCDay() ?? null
}

/** "Mon" for a server date (`YYYY-MM-DD`). Formatting only: the date comes from the server. */
export function shortDayName(value: string): string {
  const day = utcDay(value)
  if (day === null) return value
  return DAY_SHORT[day] ?? value
}

/**
 * The Today heading: the member-local day name ("Friday") from the server's `memberToday`. Before
 * the summary arrives it falls back to the device's day name.
 */
export function todayDayName(
  memberToday: string | null | undefined,
  now: Date = new Date(),
): string {
  if (memberToday) {
    const day = utcDay(memberToday)
    if (day !== null) return DAY_LONG[day] ?? memberToday
  }
  return new Intl.DateTimeFormat('en', { weekday: 'long' }).format(now)
}

/** "Mon Wed Fri" from ISO weekdays. */
export function daysText(days: readonly number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((iso): string | undefined => (iso >= 1 && iso <= 7 ? DAY_SHORT[iso % 7] : undefined))
    .filter((name): name is string => typeof name === 'string')
    .join(' ')
}

/** "3 times per week", "1 time per week". */
export function timesPerWeekText(target: number): string {
  return target === 1 ? '1 time per week' : `${target} ${PLAN_COPY.unit}`
}

/** A row's title: the task's name, else the activity's name. */
export function itemTitle(item: Pick<TodayItem, 'name' | 'activityName'>): string {
  return item.name ?? item.activityName
}

/**
 * The schedule meta under a row's title (one formatter for every row):
 * "Fixed days · Mon Wed Fri", "3 times per week · 1 to go", "Task · by Sun", and for a commitment
 * that starts next week "4 times per week · starts Mon 23 Nov".
 */
export function scheduleMeta(item: TodayItem): string {
  if (item.kind === 'task') {
    return item.deadline
      ? `${TODAY_COPY.task} · by ${shortDayName(item.deadline)}`
      : TODAY_COPY.task
  }
  const schedule =
    item.scheduleType === 'fixed_days'
      ? `${TODAY_COPY.fixedDays} · ${daysText(item.days ?? [])}`
      : timesPerWeekText(item.target ?? 0)
  if (item.section === 'starts_next_week') {
    return item.startsOn ? `${schedule} · starts ${formatShortDate(item.startsOn)}` : schedule
  }
  if (item.scheduleType === 'times_per_week' && item.target !== null) {
    const toGo = Math.max(0, item.target - item.counted)
    return toGo > 0 ? `${schedule} · ${toGo} to go` : schedule
  }
  return schedule
}

/** Whether a row shows the Progress ring: times per week, in this week. */
export function showsRing(item: TodayItem): boolean {
  return (
    item.kind === 'commitment' &&
    item.scheduleType === 'times_per_week' &&
    item.section !== 'starts_next_week' &&
    item.target !== null
  )
}

/** The Progress ring's accessible name: "Gym, 0 of 3 this week". */
export function ringLabel(activity: string, counted: number, target: number): string {
  return `${activity}, ${counted} of ${target} this week`
}

/** The Overflow button's name: "More actions for Grocery run". */
export function overflowLabel(title: string): string {
  return `More actions for ${title}`
}

/** "· 3 left this week" after "Due today". */
export function leftThisWeek(left: number): string {
  return `· ${left} left this week`
}

/** "Week 4 of the grind · 6 of 9 done", or null when nothing is planned this week (hidden). */
export function weekLine(summary: TodaySummary): string | null {
  if (summary.planned <= 0) return null
  return `Week ${summary.weekNumber} of the grind · ${summary.done} of ${summary.planned} done`
}

/** "· starts Mon" after "Your plan here", from the first next-week row's Monday. */
export function startsHeading(startsOn: string | null): string {
  return startsOn ? `· starts ${shortDayName(startsOn)}` : ''
}

/** Which Empty state Today shows above or instead of the sections. */
export type TodayEmptyState = 'no_plan' | 'nothing_due' | null

/**
 * - No commitments or tasks in the group (`hasPlan` false, no rows): "No plan here yet." with the Add
 *   button as its action, except in a waiting group, where the waiting state already fills that place
 *   (Add only).
 * - A plan, but none of it due today (rows only later this week or next, or none listed today, like
 *   fixed days Mon Wed Fri on a Tuesday): "Nothing due today. The couch is suspicious." (retro F1).
 * - Otherwise none.
 */
export function todayEmptyState(
  items: readonly TodayItem[],
  waiting: boolean,
  hasPlan: boolean,
): TodayEmptyState {
  if (items.length === 0 && !hasPlan) return waiting ? null : 'no_plan'
  if (!items.some((item) => item.section === 'due_today')) return 'nothing_due'
  return null
}

/** The rows of one section, in the server's order. */
export function itemsIn(items: readonly TodayItem[], section: TodaySection): TodayItem[] {
  return items.filter((item) => item.section === section)
}
