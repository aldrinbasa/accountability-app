/**
 * The weekly board (Story 4.1): what `get_board` returns and the copy built from it. Every number
 * (points, sessions, ranks) is the server's (AD-4); this file only compares and formats them.
 */

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
}

/** A group's board for one week: ranked rows first (ties by name), then unscored members. */
export interface Board {
  /** Fewer than 2 current members: nobody is ranked and the score UI hides. */
  waiting: boolean
  rows: BoardRow[]
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
