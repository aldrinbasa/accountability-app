import { parseIsoDate } from '@/domain/dates'

/**
 * The weekly winner (Story 4.5): what `get_winner_week` returns, the Winner card's copy and the rule
 * for when the card opens by itself. Winners, points and ranks are the server's (AD-4); this file
 * only formats them and decides about showing.
 */

/** A member on the winner card's podium: a winner, or one of the week's top three ranks. */
export interface WinnerPodiumMember {
  userId: string
  displayName: string
  avatarPath: string | null
  weeklyPoints: number
  /** The stored rank (a co-winner split by sessions keeps its rank 2+ here). */
  rank: number
  isWinner: boolean
}

/** A locked week as the Winner card reads it (`get_winner_week`). */
export interface WinnerWeek {
  /** The week's Monday, `YYYY-MM-DD`. */
  weekStart: string
  /** The week's lock (Thursday 00:00 after it, group zone), ISO 8601. */
  lockAt: string
  scored: boolean
  ranked: boolean
  /** Every winner (on points alone); empty when nobody won. */
  winnerUserIds: string[]
  /** Winners first (by name), then the other top-three ranks. */
  podium: WinnerPodiumMember[]
  /** The Weekly Winner badge's name and line, from the `badges` catalog. */
  badgeName: string
  badgeLine: string
}

export const WINNER_COPY = {
  heading: "Last week's winner",
  headingMany: "Last week's winners",
  nice: 'Nice',
  fine: 'Fine.',
  podium: "Last week's podium",
  each: 'each',
  kicker: 'Weekly winner',
} as const

/** The card's winners, in the server's order (by name). */
export function winnersOf(week: WinnerWeek): WinnerPodiumMember[] {
  return week.podium.filter((member) => member.isWinner)
}

/**
 * The week has someone to announce: a ranked, scored week with at least one winner still on its
 * podium (a winner whose account was deleted is left off the podium, Epic 7).
 */
export function hasWinners(week: WinnerWeek | null | undefined): week is WinnerWeek {
  return (
    !!week &&
    week.scored &&
    week.ranked &&
    week.winnerUserIds.length > 0 &&
    week.podium.some((member) => member.isWinner)
  )
}

/** Names joined for the card and the sticky: "Marco", "Marco & Jo", "Ann, Marco & Jo". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

/** "Last week's winner" or, for co-winners, "Last week's winners". */
export function winnerHeading(count: number): string {
  return count > 1 ? WINNER_COPY.headingMany : WINNER_COPY.heading
}

/** The points under the names: "94", or "94 each" for co-winners. */
export function winnerPoints(points: number, count: number): string {
  return count > 1 ? `${points} ${WINNER_COPY.each}` : String(points)
}

/** The one button: "Nice" when the viewer is a winner, "Fine." otherwise. */
export function winnerButtonLabel(week: WinnerWeek, viewerId: string): string {
  return week.winnerUserIds.includes(viewerId) ? WINNER_COPY.nice : WINNER_COPY.fine
}

/** The single winner's tease: "Bow down. Or just beat Marco." */
export function beatLine(name: string): string {
  return `Bow down. Or just beat ${name}.`
}

/**
 * The card's ribbing line: someone else's single win gets the tease ("Bow down. Or just beat
 * Marco."); the viewer's own win, or co-winners, get the badge's line.
 */
export function winnerLine(week: WinnerWeek, viewerId: string): string {
  const winners = winnersOf(week)
  const only = winners.length === 1 ? winners[0] : undefined
  if (only && only.userId !== viewerId) return beatLine(only.displayName)
  return week.badgeLine
}

/** What the show-once rule needs to know. */
export interface WinnerShowInput {
  /** The group's most recent locked week (`get_winner_week` with no week), or null when none. */
  week: WinnerWeek | null | undefined
  /** This device already showed (or closed) the card for that group and week. */
  seen: boolean
  /** When the viewer's membership started (ISO). */
  joinedAt: string
}

/**
 * Whether the Winner card opens by itself: only for the group's latest locked week (older unseen
 * weeks never queue up), only when it has winners, only once per device (seen key), and only for a
 * member who joined before that week's lock.
 */
export function shouldAutoShowWinner({ week, seen, joinedAt }: WinnerShowInput): boolean {
  if (!hasWinners(week) || seen) return false
  const joined = Date.parse(joinedAt)
  const lock = Date.parse(week.lockAt)
  if (Number.isNaN(joined) || Number.isNaN(lock)) return false
  return joined < lock
}

/** A deep link's week: a real Monday as `YYYY-MM-DD`, else null. */
export function parseWinnerWeekStart(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = parseIsoDate(value)
  if (!date || date.getUTCDay() !== 1 || date.toISOString().slice(0, 10) !== value) return null
  return value
}

/** The Feed sticky kicker's week: "week of 9 Nov". */
export function weekOfLabel(weekStart: string): string {
  const date = parseIsoDate(weekStart)
  if (!date) return ''
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(date)
  return `week of ${day}`
}

/** One block of the Winner card's podium: the place drawn and the members on it. */
export interface WinnerPodiumBlock {
  place: 1 | 2 | 3
  members: WinnerPodiumMember[]
}

/**
 * The Winner card's podium: every winner together on the 1st block (one crown, even when sessions
 * stored them as rank 2 or lower), then the other members of ranks 2 and 3 on their own blocks.
 * Members sharing a rank share a block.
 */
export function winnerPodiumBlocks(week: WinnerWeek): WinnerPodiumBlock[] {
  const blocks: WinnerPodiumBlock[] = []
  const winners = winnersOf(week)
  if (winners.length > 0) blocks.push({ place: 1, members: winners })
  for (const place of [2, 3] as const) {
    const members = week.podium.filter((member) => !member.isWinner && member.rank === place)
    if (members.length > 0) blocks.push({ place, members })
  }
  return blocks
}

/** A podium member for screen readers, worded like the Board: "Marco, rank 1, weekly winner, 94 weekly points." */
export function winnerMemberSentence(member: WinnerPodiumMember): string {
  const rank = member.isWinner ? 1 : member.rank
  const parts = [member.displayName, `rank ${rank}`]
  if (member.isWinner) parts.push('weekly winner')
  parts.push(`${member.weeklyPoints} weekly points`)
  return `${parts.join(', ')}.`
}
