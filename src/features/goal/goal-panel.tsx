import { useId, useRef, useState } from 'react'
import { Target } from '@phosphor-icons/react'
import {
  contributionLabel,
  GOAL_COPY,
  goalMissedText,
  goalNow,
  goalSummary,
  goalTargetText,
  goalValueText,
  monthWeekLabel,
  noScoreNote,
  type GoalContribution,
  type GoalMonthWeek,
  type GroupGoal,
} from '@/domain/goal'
import { isWaiting, type MyGroup } from '@/domain/groups'
import { useGroupGoal } from '@/data/goal'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'
import { StickyNote } from '@/ui/sticky-note'
import { GoalSheet } from '@/features/goal/goal-sheet'

/** A share of the track, kept inside 0-100. */
function percent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * The 16px outlined track (DESIGN.md `goal-panel`): `success` fill to "now", the % beside the fill
 * end (kept inside the track's ends), and a 3px `line` tick at the target with its % under it.
 * Hidden from screen readers: the panel's summary says the same.
 */
function GoalTrack({ now, target }: { now: number | null; target: number }) {
  const fill = now === null ? 0 : percent(now)
  return (
    <div aria-hidden="true" className="relative mt-[30px] mb-7" data-component="goal-track">
      <div className="relative h-4 overflow-hidden rounded-full border-2 border-line bg-paper">
        <span className="absolute inset-y-0 left-0 bg-success" style={{ width: `${fill}%` }} />
      </div>
      {now !== null ? (
        <span
          className="absolute -top-[26px] -translate-x-1/2 type-title-sm tabular-nums"
          style={{ left: `${Math.min(92, Math.max(8, fill))}%` }}
        >
          {goalValueText(now)}
        </span>
      ) : null}
      <span
        className="absolute -top-2 -bottom-2 -ml-[1.5px] w-[3px] bg-line"
        style={{ left: `${percent(target)}%` }}
      />
      <span
        className="absolute top-[26px] -translate-x-1/2 type-label"
        style={{ left: `${Math.min(92, Math.max(8, percent(target)))}%` }}
      >
        {`${target}%`}
      </span>
    </div>
  )
}

/** A monthly goal: one small tick bar per locked week of the month, each with its % (FR-29). */
function MonthWeeks({ weeks }: { weeks: readonly GoalMonthWeek[] }) {
  if (weeks.length === 0) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-3" data-component="goal-month-weeks">
      {weeks.map((week) => (
        <li key={week.weekStart}>
          <div role="img" aria-label={monthWeekLabel(week)} className="flex items-center gap-[6px]">
            <span className="relative h-3 w-10 overflow-hidden rounded-full border-2 border-line bg-paper">
              <span
                className="absolute inset-y-0 left-0 bg-success"
                style={{ width: `${percent(week.average)}%` }}
              />
            </span>
            <span className="type-meta tabular-nums">{goalValueText(week.average)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * "Everyone's part" (DESIGN.md `goal-contribution-bar`): one row per current member, a wrapping name
 * column minmax(52px, 30%), a 12px outlined `deco` bar and the weekly score % in title-sm; "no score"
 * instead of a bar, and the note naming who is left out of the average. No member is ranked or
 * blamed here.
 */
function EveryonesPart({ contributions }: { contributions: readonly GoalContribution[] }) {
  const headingId = useId()
  const note = noScoreNote(contributions)
  if (contributions.length === 0) return null
  return (
    <div className="mt-4 flex flex-col" data-component="goal-contributions">
      <h3 id={headingId} className="mb-[6px] type-label text-muted">
        {GOAL_COPY.everyonesPart}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-1">
        {contributions.map((contribution) => (
          <li key={contribution.userId}>
            <div
              role="img"
              aria-label={contributionLabel(contribution)}
              className="grid min-h-[28px] grid-cols-[minmax(52px,30%)_1fr_auto] items-center gap-[10px] type-body-sm font-semibold"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{contribution.name}</span>
              {contribution.weeklyPoints === null ? (
                <span className="col-span-2 type-meta text-muted">{GOAL_COPY.noScore}</span>
              ) : (
                <>
                  <span className="h-3 overflow-hidden rounded-full border-2 border-line bg-paper">
                    <span
                      className="block h-full bg-deco"
                      style={{ width: `${percent(contribution.weeklyPoints)}%` }}
                    />
                  </span>
                  <span className="min-w-10 text-right type-title-sm tabular-nums">
                    {`${contribution.weeklyPoints}%`}
                  </span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-[10px] type-body-sm text-muted">{note}</p> : null}
    </div>
  )
}

/** The latest decided result: the hit sticky, or the missed line in meta (nobody called out). */
function LastResult({ goal }: { goal: GroupGoal }) {
  const result = goal.lastResult
  if (!result) return null
  if (result.hit) {
    return (
      <StickyNote tilt="right" className="mt-3 w-fit max-w-full">
        <p className="type-hand-md" data-goal-result="hit">
          {GOAL_COPY.hitSticky}
        </p>
      </StickyNote>
    )
  }
  return (
    <p className="mt-3 type-meta text-muted" data-goal-result="missed">
      {goalMissedText(result)}
    </p>
  )
}

/**
 * The Goal panel under the This week standings (Story 4.7, DESIGN.md `goal-panel`): with no goal,
 * "Set a group goal" for the admin or "No group goal yet." for members; with one, "Group goal · 85%
 * this week", the current value in numeral-md (a monthly goal: the server's `monthValueNow`, what
 * the month's last lock would decide now), the track, the month's tick bars, the latest result
 * (worded by its own period) and Everyone's part; the admin's Edit opens the goal Sheet. Its
 * accessible name is the summary ("Group goal 85% this week. Now 72%."). Hidden in a group of one
 * (`isWaiting(group)`).
 */
export function GoalPanel({ group }: { group: MyGroup }) {
  const query = useGroupGoal(group.id)
  const [editing, setEditing] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const isAdmin = group.role === 'admin'
  const goal = query.data

  // A group of one reads from the groups list (one source with the Board and the settings row).
  if (isWaiting(group)) return null
  if (!goal) {
    if (query.isError) {
      return (
        <InlineRetry onRetry={() => void query.refetch()} retryLabel={GOAL_COPY.retry}>
          {GOAL_COPY.loadFailed}
        </InlineRetry>
      )
    }
    return (
      <Skeleton>
        <GoalPanelSkeleton />
      </Skeleton>
    )
  }
  const { target, period } = goal
  const current = target !== null && period !== null ? { target, period } : null
  const now = goalNow(goal)

  return (
    <section
      aria-label={goalSummary(goal)}
      className="card flex flex-col px-3 pt-3 pb-[14px]"
      data-component="goal-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex min-w-0 flex-wrap items-center gap-[6px] type-title">
          <Icon icon={Target} size={24} />
          <span>{GOAL_COPY.heading}</span>
          {current ? (
            <>
              {' '}
              <span>{`· ${goalTargetText(current.target, current.period)}`}</span>
            </>
          ) : null}
        </h2>
        {current ? (
          <span className="shrink-0 type-numeral-md tabular-nums" data-goal-now="">
            {now === null ? '–' : goalValueText(now)}
          </span>
        ) : null}
      </div>
      {current ? (
        <>
          <GoalTrack now={now} target={current.target} />
          {current.period === 'monthly' ? <MonthWeeks weeks={goal.monthWeeks} /> : null}
          <LastResult goal={goal} />
          <EveryonesPart contributions={goal.contributions} />
          {isAdmin ? (
            <div className="mt-[6px]">
              <Button ref={openerRef} variant="link" onClick={() => setEditing(true)}>
                {GOAL_COPY.edit}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-[10px] flex flex-col items-start gap-[10px]">
          {isAdmin ? (
            <Button ref={openerRef} variant="secondary" onClick={() => setEditing(true)}>
              {GOAL_COPY.setGoal}
            </Button>
          ) : (
            <p className="type-body-sm text-muted">{GOAL_COPY.noGoal}</p>
          )}
        </div>
      )}
      {isAdmin ? (
        <GoalSheet
          open={editing}
          onOpenChange={setEditing}
          groupId={group.id}
          current={current}
          returnFocusTo={() => openerRef.current}
        />
      ) : null}
    </section>
  )
}

/** The goal panel's skeleton block (also part of the Board's cold-load skeleton). */
export function GoalPanelSkeleton() {
  return (
    <SkeletonBlock className="min-h-[120px]">
      <SkeletonBar />
    </SkeletonBlock>
  )
}
