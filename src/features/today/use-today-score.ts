import { passedChipText, rankChipText } from '@/domain/board'
import { isWaiting, type MyGroup } from '@/domain/groups'
import { useAuthSession } from '@/data/auth-session'
import { useBoard, useGroupWeek } from '@/data/board'
import { optimisticScore, passedForMount, usePostMoment, type PostMoment } from '@/data/post-moment'

export interface TodayScore {
  /** The points the sticker shows (the post's optimistic value until the board refetch lands). */
  points: number | null
  /** The rank shown, null when unranked (the chip hides). */
  rank: number | null
  /** The board's own rank (never optimistic), for the last-seen rank memory. */
  boardRank: number | null
  /** The chip's text, or null when it hides. */
  chip: string | null
  /** The post moment for this group, when there is one. */
  moment: PostMoment | null
  /** The members the post passed, while the passed chip shows on this Today mount. */
  passed: string[]
}

/**
 * Today's score for the member in `group` (Story 4.1), or null while the Score sticker hides: a
 * waiting group, the board not loaded yet (or failed with nothing cached), or the member not on it.
 * Every number is the server's: `get_board`, or `post_checkin`'s answer until a board fetched after
 * the post arrives. A late post's answer is not applied: it may score an earlier week (the same rule
 * as Today's rows). While the post's values stand, the chip reads only "#N" (or the passed copy):
 * the other members' ranks are from before the post. Call it once per Today mount and pass it down.
 */
export function useTodayScore(group: MyGroup, mountId: number): TodayScore | null {
  const session = useAuthSession()
  const userId = session.user?.id ?? ''
  const week = useGroupWeek(group.id)
  const board = useBoard(group.id, week.data?.weekStart)
  const moment = usePostMoment(group.id)

  if (isWaiting(group) || !board.data || board.data.waiting) return null
  const me = board.data.rows.find((row) => row.userId === userId)
  if (!me) return null

  const optimistic = moment?.isLate ? null : optimisticScore(moment, board.dataUpdatedAt)
  const points = optimistic ? optimistic.weeklyPoints : me.weeklyPoints
  const rank = optimistic ? optimistic.rank : me.rank
  const passed = moment?.isLate ? [] : passedForMount(moment, mountId)
  let chip: string | null = null
  if (points !== null && rank !== null) {
    if (optimistic) {
      // The other rows' ranks are from before the post: only the passed copy, else the bare rank.
      const others = board.data.rows.filter((row) => row.userId !== userId)
      chip = passedChipText(others, rank, passed) ?? `#${rank}`
    } else {
      chip = rankChipText(board.data.rows, userId, passed)
    }
  }
  return { points, rank, boardRank: me.rank, chip, moment, passed }
}
