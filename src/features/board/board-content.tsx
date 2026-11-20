import { useEffect, useRef, useState } from 'react'
import { CloudSlash, UserPlus } from '@phosphor-icons/react'
import {
  BOARD_COPY,
  boardLayout,
  previousWeekStart,
  weekChipText,
  type Board,
  type BoardWeek,
} from '@/domain/board'
import { GROUP_COPY, type MyGroup } from '@/domain/groups'
import { useAuthSession } from '@/data/auth-session'
import { useBoard, useGroupWeek } from '@/data/board'
import { useMemberTimeZone } from '@/data/profile'
import { Button } from '@/ui/button'
import { EmptyState } from '@/ui/empty-state'
import { SegmentedSwitch } from '@/ui/segmented-switch'
import { WeekChip } from '@/ui/week-chip'
import { InvitePanel } from '@/features/group/invite-panel'
import { BoardSkeleton } from '@/features/board/board-skeleton'
import { LeaderboardRow } from '@/features/board/leaderboard-rows'
import { Podium, SoloStand } from '@/features/board/podium'

const WEEK_OPTIONS = [
  { value: 'this', label: BOARD_COPY.thisWeek },
  { value: 'last', label: BOARD_COPY.lastWeek },
] as const

/**
 * A group of one (2026-11-20 decision: a solo member scores their own plan): the line "The
 * leaderboard starts when a second friend joins." and, for the admin, Invite, which shows the Invite
 * panel (Story 1.7) under it.
 */
function WaitingInvite({ group }: { group: MyGroup }) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const isAdmin = group.role === 'admin'

  // The Invite button leaves once pressed: focus moves to the panel that replaced it.
  useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  return (
    <>
      <EmptyState
        icon={UserPlus}
        line={BOARD_COPY.waitingLine}
        actionSlot={
          isAdmin && !open ? (
            <Button variant="primary" className="mt-2" onClick={() => setOpen(true)}>
              {BOARD_COPY.invite}
            </Button>
          ) : undefined
        }
      />
      {open ? (
        <div ref={panelRef} tabIndex={-1} className="outline-none">
          <InvitePanel key={group.id} group={group} />
        </div>
      ) : null}
    </>
  )
}

/**
 * The week's standings: the solo view for a week of one (a group of one now, or a locked week that
 * had one member at its lock), else Podium, rows and unscored rows. The waiting line and Invite show
 * only while the group is waiting now (`groupWaiting`), not because a past week was solo.
 */
function Standings({
  board,
  week,
  group,
  userId,
  groupWaiting,
}: {
  board: Board
  week: BoardWeek
  group: MyGroup
  userId: string
  groupWaiting: boolean
}) {
  if (board.waiting) {
    // The viewer's row; a locked solo week may belong to another member (the viewer joined later).
    const solo =
      board.rows.find((row) => row.userId === userId) ?? (board.locked ? board.rows[0] : undefined)
    return (
      <>
        {solo && solo.weeklyPoints !== null ? <SoloStand row={solo} week={week} /> : null}
        {solo && solo.weeklyPoints === null ? (
          <ul className="flex flex-col gap-2">
            <LeaderboardRow row={solo} week={week} />
          </ul>
        ) : null}
        {groupWaiting ? <WaitingInvite group={group} /> : null}
      </>
    )
  }
  const layout = boardLayout(board.rows)
  const others = [...layout.rows, ...layout.unscored]
  return (
    <>
      <Podium
        blocks={layout.podium}
        week={week}
        label={week === 'this' ? BOARD_COPY.thisWeekPodium : BOARD_COPY.lastWeekPodium}
      />
      {others.length > 0 ? (
        <ul className="flex flex-col gap-2" data-component="leaderboard">
          {others.map((row) => (
            <LeaderboardRow key={row.userId} row={row} week={week} />
          ))}
        </ul>
      ) : null}
    </>
  )
}

/**
 * The Board for one group (Stories 4.3, 4.4): the week switch (only while last week awaits its lock),
 * the week chip, then the standings. Current week from `get_group_week`; both weeks' boards load so
 * the switch is instant. Last week counts as locked once the server says so (`locked`, its frozen
 * results) or its lock passed before its latest fetch (the tick may not have run yet); until then
 * the switch shows. If the lock passes while Last week is open, the next refetch shows "Locked" and
 * the switch stays until the member goes back to This week. No data yet: the skeleton after 300 ms,
 * or "Can't reach Proofy right now." + Try again when the first load failed. Every number is the
 * server's.
 */
export function BoardContent({ group }: { group: MyGroup }) {
  const session = useAuthSession()
  const userId = session.user?.id ?? ''
  const memberZone = useMemberTimeZone()
  const weekQuery = useGroupWeek(group.id)
  const weekStart = weekQuery.data?.weekStart
  const current = useBoard(group.id, weekStart)
  const last = useBoard(group.id, weekStart ? previousWeekStart(weekStart) : undefined)
  const [selected, setSelected] = useState<BoardWeek>('this')

  const lastLockAt = last.data?.lockAt ?? null
  const lastLocked =
    last.data?.locked === true ||
    (lastLockAt !== null && Date.parse(lastLockAt) <= last.dataUpdatedAt)
  const offerSwitch = lastLockAt !== null && !lastLocked
  const showSwitch = offerSwitch || selected === 'last'
  const week: BoardWeek = showSwitch ? selected : 'this'
  const query = week === 'this' ? current : last

  const failed = (
    <EmptyState
      icon={CloudSlash}
      line={GROUP_COPY.loadFailedLine}
      body={GROUP_COPY.loadFailedBody}
      action={{
        label: GROUP_COPY.tryAgain,
        onClick: () => {
          void weekQuery.refetch()
          // A disabled board query (week unknown) would still fetch on refetch(); the week's own
          // refetch enables it.
          if (weekStart) void query.refetch()
        },
      }}
    />
  )

  function body() {
    if (!weekQuery.data) return weekQuery.isError ? failed : <BoardSkeleton />
    const board = query.data
    if (!board) return query.isError ? failed : <BoardSkeleton />
    const lockAt = board.lockAt ?? (week === 'this' ? weekQuery.data.lockAt : null)
    return (
      <>
        {lockAt ? (
          <WeekChip
            text={weekChipText({
              week,
              lockAt,
              groupZone: board.timeZone ?? group.timeZone,
              memberZone,
              locked: week === 'last' && lastLocked,
            })}
          />
        ) : null}
        <Standings
          board={board}
          week={week}
          group={group}
          userId={userId}
          groupWaiting={current.data ? current.data.waiting : !board.locked && board.waiting}
        />
      </>
    )
  }

  return (
    <>
      {showSwitch ? (
        <SegmentedSwitch
          label={BOARD_COPY.weekSwitch}
          options={WEEK_OPTIONS}
          value={selected}
          onChange={setSelected}
        />
      ) : null}
      {body()}
    </>
  )
}
