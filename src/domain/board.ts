import { parseIsoDate } from '@/domain/dates'
import { formatLockTime } from '@/domain/time-zones'

/**
 * The weekly board (Stories 4.1 and 4.3): what `get_board` returns and the copy built from it. Every
 * number (points, sessions, ranks, misses, streaks) is the server's (AD-4); this file only compares
 * and formats them.
 */

/** One commitment of a member's plan for the week (`get_board` `plan`). */
export interface PlanItem {
  activityName: string
  scheduleType: 'fixed_days' | 'times_per_week'
  /** ISO weekdays (Monday = 1) for fixed days, else null. */
  days: number[] | null
  /** Times per week, else null. */
  target: number | null
}

/** One `get_board` row: a current member of the group for the week. */
export interface BoardRow {
  userId: string
  displayName: string
  avatarPath: string | null
  /** 0-100, null with no score this week. */
  weeklyPoints: number | null
  sessionsDone: number
  sessionsPlanned: number
  sessionsFrozen: number
  /** Competition rank ("#2, #2, #4"), null when unranked (no score, or a waiting group). */
  rank: number | null
  /** Sessions of the week that were missed (Story 4.3). */
  missCount: number
  /** The highest current streak over the member's active commitments, 0 when none. */
  bestStreak: number
  /** The commitments with sessions that week, in the order they were made. */
  plan: PlanItem[]
  /** Tasks with a session that week. */
  taskCount: number
  /**
   * One of a locked week's winners (Story 4.5, on points alone); always false for an unlocked week.
   * Co-winners stand together on the 1st block even when sessions ranked them apart.
   */
  isWinner: boolean
}

/**
 * A group's board for one week: ranked rows first (ties by name), then unscored members. A locked
 * week lists the members current at its lock, an unlocked week the current members.
 */
export interface Board {
  /**
   * Nobody is ranked: fewer than 2 current members (an unlocked week), or fewer than 2 members at
   * the lock (a locked week, `group_week_results.ranked = false`).
   */
  waiting: boolean
  rows: BoardRow[]
  /** The week's lock (Thursday 00:00 after it, group zone), ISO 8601; null with no rows. */
  lockAt: string | null
  /** Whether this is the group's current week (server-decided). */
  isCurrentWeek: boolean
  /** The group's zone for the week; null with no rows. */
  timeZone: string | null
  /**
   * The week is locked (Story 4.4): its results are final and come from the stored rows. A locked
   * week that was not ranked (a group of one) reports `waiting`.
   */
  locked: boolean
}

/** The group's current week (`get_group_week`, AD-11): never derived from the device clock. */
export interface GroupWeek {
  /** The Monday, `YYYY-MM-DD`. */
  weekStart: string
  /** Thursday 00:00 after the week in the group's zone, ISO 8601. */
  lockAt: string
}

export const BOARD_COPY = {
  weeklyPoints: 'Weekly points',
  noScore: 'no score this week',
  openBoard: 'Open the leaderboard',
  title: 'Leaderboard',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  weekSwitch: 'Week',
  locked: 'Locked',
  noScoreLastWeek: 'no score last week',
  wholeWeekFrozen: 'Whole week frozen · back Mon · ',
  thisWeekPodium: "This week's podium",
  lastWeekPodium: "Last week's podium",
  waitingLine: 'The leaderboard starts when a second friend joins.',
  invite: 'Invite',
  pointsUnit: 'weekly points',
} as const

/** The Score sticker's accessible name: "67 weekly points. Open the leaderboard". */
export function scoreStickerLabel(points: number | null): string {
  return points === null
    ? `No score this week. ${BOARD_COPY.openBoard}`
    : `${points} weekly points. ${BOARD_COPY.openBoard}`
}

function byName(a: BoardRow, b: BoardRow): number {
  return a.displayName.localeCompare(b.displayName) || (a.userId < b.userId ? -1 : 1)
}

/** The first row by name, or undefined. */
function firstByName(rows: readonly BoardRow[]): BoardRow | undefined {
  return [...rows].sort(byName)[0]
}

/**
 * "#1 · passed Jo": the passed member among `rows` ranked best (then by name), or null when none of
 * `passedUserIds` is in `rows`. Used alone right after a post, while the other rows' ranks are still
 * from before it.
 */
export function passedChipText(
  rows: readonly BoardRow[],
  rank: number,
  passedUserIds: readonly string[],
): string | null {
  const passed = rows
    .filter((row) => passedUserIds.includes(row.userId))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || byName(a, b))[0]
  return passed ? `#${rank} · passed ${passed.displayName}` : null
}

/**
 * The rank chip under the Score sticker, or null when it hides (the member is unranked or not on
 * the board):
 * - shares a rank: "#2 · tied with Jo" (the first other tied member by name)
 * - the only ranked member: "#1"
 * - first: "#1 · 4 ahead of Marco" (the next ranked member), "#1 · level with Marco on points" at 0
 * - otherwise: "#3 · Marco's 4 ahead" (the member ranked directly above), "#3 · level with Marco on
 *   points" when separated only by sessions
 * - right after the member's post passed someone (`passedUserIds`): "#1 · passed Jo" (the passed
 *   member ranked best now, then by name; only members still ranked below count)
 */
export function rankChipText(
  rows: readonly BoardRow[],
  userId: string,
  passedUserIds: readonly string[] = [],
): string | null {
  const me = rows.find((row) => row.userId === userId)
  if (!me || me.rank === null) return null
  const rank = me.rank
  const ranked = rows.filter((row) => row.rank !== null && row.userId !== userId)

  // Only members still ranked below (one who has climbed back past the member no longer counts).
  const passed = passedChipText(
    rows.filter((row) => row.userId !== userId && (row.rank === null || row.rank > rank)),
    rank,
    passedUserIds,
  )
  if (passed) return passed

  const tied = firstByName(ranked.filter((row) => row.rank === rank))
  if (tied) return `#${rank} · tied with ${tied.displayName}`

  if (ranked.length === 0) return `#${rank}`

  const myPoints = me.weeklyPoints ?? 0
  if (rank === 1) {
    const nextRank = Math.min(...ranked.map((row) => row.rank as number))
    const next = firstByName(ranked.filter((row) => row.rank === nextRank))
    if (!next) return '#1'
    const gap = myPoints - (next.weeklyPoints ?? 0)
    return gap === 0
      ? `#1 · level with ${next.displayName} on points`
      : `#1 · ${gap} ahead of ${next.displayName}`
  }

  const above = ranked.filter((row) => (row.rank as number) < rank)
  const aboveRank = Math.max(...above.map((row) => row.rank as number))
  const next = firstByName(above.filter((row) => row.rank === aboveRank))
  if (!next) return `#${rank}`
  const gap = (next.weeklyPoints ?? 0) - myPoints
  return gap === 0
    ? `#${rank} · level with ${next.displayName} on points`
    : `#${rank} · ${next.displayName}'s ${gap} ahead`
}

/** Two-letter weekday codes by ISO weekday (Monday = 1). */
const DAY_CODE = ['', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const
const DAY_NAME = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
/** Days whose single letter is unambiguous (M, W, F). */
const DAY_LETTER: Partial<Record<number, string>> = { 1: 'M', 3: 'W', 5: 'F' }

/**
 * Fixed days, short: one day "Thu"; every day "daily"; only Mon/Wed/Fri as letters ("MWF", "MF");
 * otherwise two-letter codes joined by "/" ("Tu/Th", "Mo/We/Sa").
 */
export function shortDays(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  if (sorted.length === 7) return 'daily'
  if (sorted.length === 1) return DAY_NAME[sorted[0] as number] ?? ''
  if (sorted.every((d) => DAY_LETTER[d] !== undefined)) {
    return sorted.map((d) => DAY_LETTER[d]).join('')
  }
  return sorted.map((d) => DAY_CODE[d]).join('/')
}

/**
 * The plan summary (FR-26): "Gym 3x · Study MWF · Paint Tu/Th · 1 task". Commitments by activity
 * only, times per week as "Nx", fixed days short, tasks counted; "" for an empty plan.
 */
export function planSummary(plan: readonly PlanItem[], taskCount: number): string {
  const parts = plan.map((item) => {
    if (item.scheduleType === 'times_per_week') return `${item.activityName} ${item.target ?? 0}x`
    const days = shortDays(item.days ?? [])
    return days ? `${item.activityName} ${days}` : item.activityName
  })
  if (taskCount > 0) parts.push(taskCount === 1 ? '1 task' : `${taskCount} tasks`)
  return parts.join(' · ')
}

/** Which week the Board shows. */
export type BoardWeek = 'this' | 'last'

/** The miss marks' screen-reader text: "1 miss this week", "3 misses last week". */
export function missText(count: number, week: BoardWeek): string {
  const when = week === 'this' ? 'this week' : 'last week'
  return count === 1 ? `1 miss ${when}` : `${count} misses ${when}`
}

/** The flame's accessible name: "Best current streak 6". */
export function streakLabel(streak: number): string {
  return `Best current streak ${streak}`
}

/**
 * The week chip. This week: "This week · locks Wed 23:59 after Sun" (the group's zone named when it
 * differs from the member's: "locks Wed 23:59 London time after Sun"). Last week before its lock:
 * "Locks Wed 23:59 · can still change"; after it: "Locked".
 */
export function weekChipText(options: {
  week: BoardWeek
  lockAt: string
  groupZone: string
  memberZone: string
  locked: boolean
}): string {
  const lock = formatLockTime(options.lockAt, options.groupZone, options.memberZone)
  if (options.week === 'this') return `This week · locks ${lock} after Sun`
  return options.locked ? BOARD_COPY.locked : `Locks ${lock} · can still change`
}

/** The Monday before a week's Monday (`YYYY-MM-DD`): key arithmetic, never the device clock. */
export function previousWeekStart(weekStart: string): string {
  const date = parseIsoDate(weekStart)
  if (!date) return weekStart
  date.setUTCDate(date.getUTCDate() - 7)
  return date.toISOString().slice(0, 10)
}

/** One podium block: a rank (1, 2 or 3) and the members sharing it, by name. */
export interface PodiumBlock {
  rank: 1 | 2 | 3
  rows: BoardRow[]
}

/** The Board split for display (rows keep the server's order: rank, then name). */
export interface BoardLayout {
  /** Blocks for the ranks 1, 2 and 3 that someone holds, in rank order. */
  podium: PodiumBlock[]
  /** Ranked 4th and below. */
  rows: BoardRow[]
  /** No score this week, by name. */
  unscored: BoardRow[]
}

/**
 * Podium blocks for ranks 1-3 (ties share one), leaderboard rows from rank 4, unscored rows last. A
 * locked week's winners (Story 4.5) all stand on the 1st block, by name, shown as rank 1 even when
 * sessions stored them lower; the other members keep their ranks (EXPERIENCE.md "Weekly winner tie
 * (locked week)").
 */
export function boardLayout(rows: readonly BoardRow[]): BoardLayout {
  const winners = rows
    .filter((row) => row.isWinner)
    .sort(byName)
    .map((row) => ({ ...row, rank: 1 }))
  const others = rows.filter((row) => !row.isWinner)
  const podium: PodiumBlock[] = []
  if (winners.length > 0) podium.push({ rank: 1, rows: winners })
  for (const rank of [1, 2, 3] as const) {
    if (rank === 1 && winners.length > 0) continue
    const holders = others.filter((row) => row.rank === rank)
    if (holders.length > 0) podium.push({ rank, rows: holders })
  }
  return {
    podium,
    rows: others.filter((row) => row.rank !== null && row.rank >= 4),
    unscored: others.filter((row) => row.weeklyPoints === null),
  }
}

/** Every session of the week frozen: the unscored row says why ("Whole week frozen · back Mon"). */
function wholeWeekFrozen(row: BoardRow): boolean {
  return row.sessionsPlanned > 0 && row.sessionsFrozen === row.sessionsPlanned
}

/**
 * An unscored row's text after the name: "no score this week" (with "Whole week frozen · back Mon · "
 * when every session was frozen), or "no score last week" on the Last week view, where "back Mon" is
 * already past.
 */
export function unscoredText(row: BoardRow, week: BoardWeek): string {
  if (week === 'last') return BOARD_COPY.noScoreLastWeek
  return wholeWeekFrozen(row)
    ? `${BOARD_COPY.wholeWeekFrozen}${BOARD_COPY.noScore}`
    : BOARD_COPY.noScore
}

/**
 * What a screen reader reads for a member on the podium or in a row: "Marco, rank 1, 88 weekly
 * points, Gym 5x · 1 task, 2 misses this week, best current streak 8." A locked week's winner adds
 * "weekly winner" after the rank. Absent parts (no rank in a waiting group, an empty plan, no
 * misses, no streak) are left out.
 */
export function memberSentence(row: BoardRow, week: BoardWeek): string {
  const parts = [row.displayName]
  if (row.rank !== null) parts.push(`rank ${row.rank}`)
  if (row.isWinner) parts.push('weekly winner')
  parts.push(
    row.weeklyPoints === null ? unscoredText(row, week) : `${row.weeklyPoints} weekly points`,
  )
  const plan = planSummary(row.plan, row.taskCount)
  if (plan) parts.push(plan)
  if (row.missCount > 0) parts.push(missText(row.missCount, week))
  if (row.bestStreak > 0) parts.push(`best current streak ${row.bestStreak}`)
  return `${parts.join(', ')}.`
}
