import { parseIsoDate } from '@/domain/dates'
import { joinNames, weekOfLabel } from '@/domain/winner'

/** A group goal's period: decided every week, or on the lock that closes the month. */
export type GoalPeriod = 'weekly' | 'monthly'

/** Targets run 50 to 100 in steps of 5 (the same rule as the database check). */
export const GOAL_TARGET_MIN = 50
export const GOAL_TARGET_MAX = 100
export const GOAL_TARGET_STEP = 5
/** Where the goal Sheet starts when the group has no goal yet. */
export const GOAL_TARGET_DEFAULT = 85

/** A current member's part this week: their weekly points, or null with no score. */
export interface GoalContribution {
  userId: string
  name: string
  weeklyPoints: number | null
}

/** A decided goal result (a locked week): the value it was decided on and whether it was hit. */
export interface GoalResult {
  /** The locked week's Monday, `YYYY-MM-DD`. */
  weekStart: string
  period: GoalPeriod
  target: number
  /** Weekly: that week's average; monthly: the month's average. One decimal. */
  average: number
  hit: boolean
}

/** One locked week of the current month (a monthly goal) and its average. */
export interface GoalMonthWeek {
  weekStart: string
  average: number
}

/** `get_group_goal`: the Goal panel's data. Every number is the server's. */
export interface GroupGoal {
  /** The group's current week. */
  weekStart: string
  /** Current members (the panel hides in a group of one). */
  memberCount: number
  /** The version in effect for the current week; both null with no goal. */
  target: number | null
  period: GoalPeriod | null
  /** The current week's average of the members with a score; null when nobody has one yet. */
  liveAverage: number | null
  /** Monthly: the month's locked weeks with an average, oldest first. */
  monthWeeks: GoalMonthWeek[]
  /** Monthly: their average; null before the month's first lock. */
  monthAverage: number | null
  /**
   * Monthly: the value the lock would decide now (the month's locked weeks with an average plus the
   * current week's live average when it would get one); null for a weekly goal, none, or no value.
   */
  monthValueNow: number | null
  contributions: GoalContribution[]
  /**
   * The newest decided result while it still applies (the server's rule: a weekly result while its
   * week is the newest locked week, a monthly one through the next lock month), else null. Worded by
   * its own period, which can differ from the goal in effect.
   */
  lastResult: GoalResult | null
}

/** A goal result sticky on the Feed (written once when a result is decided at a lock). */
export interface FeedGoal {
  type: 'goal'
  id: string
  groupId: string
  sortAt: string
  weekStart: string
  period: GoalPeriod
  target: number
  average: number
  hit: boolean
}

/** Copy for the Goal panel, the goal Sheet, group settings and the Feed (Story 4.7). */
export const GOAL_COPY = {
  heading: 'Group goal',
  setGoal: 'Set a group goal',
  edit: 'Edit',
  noGoal: 'No group goal yet.',
  everyonesPart: "Everyone's part",
  noScore: 'no score',
  sheetTitleNew: 'Set a group goal',
  sheetTitleEdit: 'Edit group goal',
  target: 'Target',
  period: 'Weekly or monthly',
  weekly: 'Weekly',
  monthly: 'Monthly',
  note: 'Average of everyone with a score.',
  lower: 'Lower target',
  raise: 'Raise target',
  save: 'Save',
  saving: 'Saving…',
  retry: 'Retry',
  offline: "You're offline. Goals need a signal to save.",
  failed: "Couldn't save the goal. Tap Retry.",
  loadFailed: "Couldn't load the group goal.",
  hitSticky: 'Goal hit. Nobody let the group down. This time.',
  settingsNone: 'None',
  soloNote: 'Starts counting when a friend joins.',
  noScoresYet: 'No scores yet.',
} as const

/** The goal Sheet's period switch. */
export const GOAL_PERIOD_OPTIONS = [
  { value: 'weekly', label: GOAL_COPY.weekly },
  { value: 'monthly', label: GOAL_COPY.monthly },
] as const

export function isGoalPeriod(value: unknown): value is GoalPeriod {
  return value === 'weekly' || value === 'monthly'
}

function span(period: GoalPeriod): string {
  return period === 'weekly' ? 'this week' : 'this month'
}

/** "85% this week" / "85% this month". */
export function goalTargetText(target: number, period: GoalPeriod): string {
  return `${target}% ${span(period)}`
}

/** An average as shown: "72%", or "72.5%" when it is not whole. */
export function goalValueText(value: number): string {
  const tenths = Math.round(value * 10)
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)}%`
}

/**
 * What the panel shows as "now": for a monthly goal the server's `monthValueNow` (what the month's
 * last lock would decide if nothing changes: locked weeks plus the live week), else the current
 * week's live average; null when there is no value yet.
 */
export function goalNow(goal: GroupGoal): number | null {
  if (goal.period === 'monthly') return goal.monthValueNow
  return goal.liveAverage
}

/** How far a missed result fell short, rounded up to a whole percent (84.5 of 85 → 1). */
export function goalShortfall(target: number, average: number): number {
  const tenths = Math.round((target - average) * 10)
  return Math.max(1, Math.ceil(tenths / 10))
}

function nextSpan(period: GoalPeriod): string {
  return period === 'weekly' ? 'Next week, then.' : 'Next month, then.'
}

/** The panel's missed line (meta, no member called out): "Missed by 4%. Next week, then." */
export function goalMissedText(result: GoalResult): string {
  return `Missed by ${goalShortfall(result.target, result.average)}%. ${nextSpan(result.period)}`
}

/** The panel's accessible summary: "Group goal 85% this week. Now 72%." */
export function goalSummary(goal: GroupGoal): string {
  if (goal.target === null || goal.period === null) return GOAL_COPY.heading
  const now = goalNow(goal)
  const head = `${GOAL_COPY.heading} ${goalTargetText(goal.target, goal.period)}.`
  return now === null ? `${head} ${GOAL_COPY.noScoresYet}` : `${head} Now ${goalValueText(now)}.`
}

/** A contribution row's name: "Priya, 64%" or "Priya, no score". */
export function contributionLabel(contribution: GoalContribution): string {
  return contribution.weeklyPoints === null
    ? `${contribution.name}, ${GOAL_COPY.noScore}`
    : `${contribution.name}, ${contribution.weeklyPoints}%`
}

/**
 * The note under Everyone's part for members without a score (null when everyone has one): "Priya
 * has no score, so they're left out of the average." / "Priya & Sam have no score, so they're left
 * out of the average." The app knows no pronouns, so it always says "they".
 */
export function noScoreNote(contributions: readonly GoalContribution[]): string | null {
  const names = contributions.filter((c) => c.weeklyPoints === null).map((c) => c.name)
  if (names.length === 0) return null
  const verb = names.length === 1 ? 'has' : 'have'
  return `${joinNames(names)} ${verb} no score, so they're left out of the average.`
}

/** The toast after a save: "Goal set: 85% this week." */
export function goalSavedToast(target: number, period: GoalPeriod): string {
  return `Goal set: ${goalTargetText(target, period)}.`
}

/** The Stepper's announced value: "85 percent". */
export function goalTargetLabel(target: number): string {
  return `${target} percent`
}

/** A monthly tick bar's name: "Week of 2 Nov, 70%". */
export function monthWeekLabel(week: GoalMonthWeek): string {
  const label = weekOfLabel(week.weekStart)
  const name = label ? label.charAt(0).toUpperCase() + label.slice(1) : week.weekStart
  return `${name}, ${goalValueText(week.average)}`
}

/**
 * The Feed sticky's line: "Goal hit · 85% this week. Nobody let the group down. This time." or
 * "Goal missed by 4% · 85% this week. Next week, then." (monthly: "this month", "Next month, then.").
 */
export function goalStickyLine(item: FeedGoal): string {
  const target = goalTargetText(item.target, item.period)
  return item.hit
    ? `Goal hit · ${target}. Nobody let the group down. This time.`
    : `Goal missed by ${goalShortfall(item.target, item.average)}% · ${target}. ${nextSpan(item.period)}`
}

/**
 * The Feed sticky's kicker after "Group goal": "week of 9 Nov", or for a monthly result the month its
 * closing lock fell in ("November": the lock is the Thursday 10 days after the Monday).
 */
export function goalKickerSpan(item: FeedGoal): string {
  if (item.period === 'weekly') return weekOfLabel(item.weekStart)
  const monday = parseIsoDate(item.weekStart)
  if (!monday) return ''
  const lock = new Date(monday.getTime() + 10 * 86_400_000)
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(lock)
}
