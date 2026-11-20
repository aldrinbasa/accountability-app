import {
  memberSentence,
  planSummary,
  unscoredText,
  type BoardRow,
  type BoardWeek,
} from '@/domain/board'
import { cn } from '@/ui/lib/utils'
import { MemberAvatar } from '@/features/me/member-avatar'
import { MemberMarks } from '@/features/board/member-marks'

/**
 * A Leaderboard row (DESIGN.md `leaderboard-row`): rank, avatar, the name with miss marks and flame,
 * the muted plan summary, the points in numeral-md. A member without a score gets the dashed
 * variant: "{Name} · no score this week" (with "Whole week frozen · back Mon · " when every session
 * was frozen). Read as one sentence; not a link until Story 4.6.
 */
export function LeaderboardRow({ row, week }: { row: BoardRow; week: BoardWeek }) {
  const unscored = row.weeklyPoints === null
  const plan = planSummary(row.plan, row.taskCount)
  return (
    <li
      data-component="leaderboard-row"
      data-unscored={unscored ? '' : undefined}
      className={cn(
        'rounded-wob border-[2.5px] border-line',
        unscored ? 'border-dashed bg-transparent' : 'bg-card',
      )}
    >
      <span className="sr-only">{memberSentence(row, week)}</span>
      <div
        aria-hidden="true"
        className="flex min-h-row-min flex-wrap items-center gap-x-[10px] gap-y-1 px-[10px] py-2"
      >
        <span className="w-[26px] flex-none text-center type-title">
          {row.rank !== null ? `#${row.rank}` : '–'}
        </span>
        <MemberAvatar id={row.userId} name={row.displayName} avatarPath={row.avatarPath} />
        <div className="min-w-0 flex-1 basis-32">
          <p className="flex flex-wrap items-center gap-x-[6px] type-title-sm [overflow-wrap:anywhere]">
            <span>
              {row.displayName}
              {unscored ? (
                <span className="type-meta text-muted">{` · ${unscoredText(row, week)}`}</span>
              ) : null}
            </span>
            <MemberMarks row={row} week={week} />
          </p>
          {!unscored && plan ? (
            <p className="type-meta text-muted [overflow-wrap:anywhere]">{plan}</p>
          ) : null}
        </div>
        {!unscored ? (
          <span className="ml-auto type-numeral-md tabular-nums">{row.weeklyPoints}</span>
        ) : null}
      </div>
    </li>
  )
}
