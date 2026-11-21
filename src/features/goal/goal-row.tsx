import { useRef, useState } from 'react'
import { CaretRight, Target } from '@phosphor-icons/react'
import { GOAL_COPY, goalTargetText } from '@/domain/goal'
import { isWaiting, type MyGroup } from '@/domain/groups'
import { useGroupGoal } from '@/data/goal'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { GoalSheet } from '@/features/goal/goal-sheet'

/**
 * The Group goal row in group settings (Story 4.7): the goal in effect ("85% this week") or "None";
 * the admin's row opens the goal Sheet, a member's is read-only. In a group of one the goal is set
 * here (the Board hides the panel) with the note "Starts counting when a friend joins." Until the
 * goal has loaded the row is read-only (so a Sheet never opens on defaults over a real goal); a
 * failed load shows Inline retry.
 */
export function GoalRow({ group }: { group: MyGroup }) {
  const query = useGroupGoal(group.id)
  const [editing, setEditing] = useState(false)
  const openerRef = useRef<HTMLButtonElement>(null)
  const isAdmin = group.role === 'admin'
  const goal = query.data
  const current =
    goal && goal.target !== null && goal.period !== null
      ? { target: goal.target, period: goal.period }
      : null
  const value = goal
    ? current
      ? goalTargetText(current.target, current.period)
      : GOAL_COPY.settingsNone
    : null
  const solo = isWaiting(group)

  const content = (
    <>
      <Icon icon={Target} size={24} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body">{GOAL_COPY.heading}</span>
        {value ? <span className="type-meta text-muted">{value}</span> : null}
      </span>
    </>
  )

  return (
    <div className="card flex flex-col gap-1 p-0 pb-3" data-component="goal-row">
      {isAdmin && goal ? (
        <button
          ref={openerRef}
          type="button"
          aria-label={value ? `${GOAL_COPY.heading}, ${value}` : GOAL_COPY.heading}
          onClick={() => setEditing(true)}
          className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 py-2 text-left text-ink press-overlay"
        >
          {content}
          <Icon icon={CaretRight} size={20} />
        </button>
      ) : (
        <div className="flex min-h-row-min w-full items-center gap-3 px-3 py-2">{content}</div>
      )}
      <p className="px-3 type-body-sm text-muted">{solo ? GOAL_COPY.soloNote : GOAL_COPY.note}</p>
      {!goal && query.isError ? (
        <InlineRetry
          className="mx-3"
          onRetry={() => void query.refetch()}
          retryLabel={GOAL_COPY.retry}
        >
          {GOAL_COPY.loadFailed}
        </InlineRetry>
      ) : null}
      {isAdmin && goal ? (
        <GoalSheet
          open={editing}
          onOpenChange={setEditing}
          groupId={group.id}
          current={current}
          returnFocusTo={() => openerRef.current}
        />
      ) : null}
    </div>
  )
}
