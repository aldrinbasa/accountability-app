import { Crown } from '@phosphor-icons/react'
import {
  BOARD_COPY,
  memberSentence,
  planSummary,
  type BoardRow,
  type BoardWeek,
  type PodiumBlock,
} from '@/domain/board'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import { MemberAvatar } from '@/features/me/member-avatar'
import { MemberMarks } from '@/features/board/member-marks'

/** Block look per place (DESIGN.md `podium`): 1st coral center, 2nd lavender left, 3rd yellow right. */
const PLACE = {
  1: { fill: 'bg-primary', height: 'min-h-[150px]', order: 'order-2' },
  2: { fill: 'bg-vote', height: 'min-h-[118px]', order: 'order-1' },
  3: { fill: 'bg-sticky', height: 'min-h-[96px]', order: 'order-3' },
} as const

/** A member above the block: name, plan summary, miss marks and flame. */
function MemberLabel({ row, week }: { row: BoardRow; week: BoardWeek }) {
  const plan = planSummary(row.plan, row.taskCount)
  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-0.5">
      <span className="w-full type-title-sm [overflow-wrap:anywhere]">{row.displayName}</span>
      {plan ? (
        <span className="w-full type-meta text-muted [overflow-wrap:anywhere]">{plan}</span>
      ) : null}
      <MemberMarks row={row} week={week} className="min-h-[22px] justify-center" />
    </div>
  )
}

/**
 * The block itself: a light object in both themes (`obj-ink` text and outline), the points in
 * numeral-lg and, when ranked, the rank. Its min-height grows with the text.
 */
function PodiumStand({
  place,
  points,
  rank,
}: {
  place: 1 | 2 | 3
  points: number
  rank: number | null
}) {
  const look = PLACE[place]
  return (
    <div
      className={cn(
        'mt-1 flex w-full flex-col items-center gap-0.5 rounded-t-[14px] border-[2.5px] border-b-0 border-obj-ink pt-2 text-obj-ink',
        look.fill,
        look.height,
      )}
    >
      <span className="type-numeral-lg tabular-nums">{points}</span>
      {rank !== null ? <span className="type-title">#{rank}</span> : null}
    </div>
  )
}

/**
 * One podium place: the crown doodle on 1st, the avatars side by side, each member's label, then the
 * block. Read as one sentence per member; the drawing is hidden from screen readers.
 */
function PodiumPlace({ block, week }: { block: PodiumBlock; week: BoardWeek }) {
  const look = PLACE[block.rank]
  const first = block.rows[0]
  return (
    <li
      className={cn('flex min-w-0 flex-col', look.order)}
      style={{ flex: `${block.rows.length} 1 0%` }}
      data-place={block.rank}
    >
      <span className="sr-only">
        {block.rows.map((row) => memberSentence(row, week)).join(' ')}
      </span>
      <div
        aria-hidden="true"
        className="flex flex-1 flex-col items-center justify-end gap-[3px] text-center"
      >
        {block.rank === 1 ? <Icon icon={Crown} size={32} /> : null}
        <span className="flex gap-1">
          {block.rows.map((row) => (
            <MemberAvatar
              key={row.userId}
              id={row.userId}
              name={row.displayName}
              avatarPath={row.avatarPath}
            />
          ))}
        </span>
        <div className="flex w-full flex-col gap-1.5">
          {block.rows.map((row) => (
            <MemberLabel key={row.userId} row={row} week={week} />
          ))}
        </div>
        <PodiumStand place={block.rank} points={first?.weeklyPoints ?? 0} rank={block.rank} />
      </div>
    </li>
  )
}

/**
 * The Podium (DESIGN.md `podium`): the members ranked 1st to 3rd, ties sharing a block, as an ordered
 * list in rank order (1st, 2nd, 3rd) laid out 2nd left, 1st center, 3rd right on an 8px line base.
 * Only the places someone holds are drawn.
 */
export function Podium({
  blocks,
  week,
  label,
}: {
  blocks: readonly PodiumBlock[]
  week: BoardWeek
  label: string
}) {
  if (blocks.length === 0) return null
  return (
    <div className="pt-1" data-component="podium">
      <ol aria-label={label} className="flex items-stretch justify-center gap-[6px]">
        {blocks.map((block) => (
          <PodiumPlace key={block.rank} block={block} week={week} />
        ))}
      </ol>
      <div aria-hidden="true" className="h-2 rounded-[3px] bg-line" />
    </div>
  )
}

/**
 * A solo member's week (a group of one, 2026-11-20 decision): their own block like the 1st place
 * but without crown or rank, "weekly points" under the numeral. Not a list: nobody is ranked.
 */
export function SoloStand({ row, week }: { row: BoardRow; week: BoardWeek }) {
  return (
    <section className="mx-auto flex w-full max-w-[240px] flex-col" data-component="solo-stand">
      <p className="sr-only">{memberSentence(row, week)}</p>
      <div aria-hidden="true" className="flex flex-col items-center gap-[3px] text-center">
        <MemberAvatar id={row.userId} name={row.displayName} avatarPath={row.avatarPath} />
        <MemberLabel row={row} week={week} />
        <div className="mt-1 flex min-h-[150px] w-full flex-col items-center gap-0.5 rounded-t-[14px] border-[2.5px] border-b-0 border-obj-ink bg-primary pt-2 text-obj-ink">
          <span className="type-numeral-lg tabular-nums">{row.weeklyPoints ?? 0}</span>
          <span className="type-label uppercase">{BOARD_COPY.pointsUnit}</span>
        </div>
      </div>
      <div aria-hidden="true" className="h-2 rounded-[3px] bg-line" />
    </section>
  )
}
