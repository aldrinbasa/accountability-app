import { useId, useRef, useState, type ReactNode } from 'react'
import { CloudSlash, Couch, ListChecks } from '@phosphor-icons/react'
import { GROUP_COPY } from '@/domain/groups'
import {
  itemsIn,
  itemTitle,
  leftThisWeek,
  startsHeading,
  TODAY_COPY,
  todayEmptyState,
  type TodayItem,
} from '@/domain/today'
import { useToday } from '@/data/plan'
import { EmptyState } from '@/ui/empty-state'
import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'
import { AddPlanButton } from '@/features/plan/add-plan-button'
import { DueRow } from '@/features/plan/due-row'
import { usePlanSheet } from '@/features/plan/plan-sheet-context'
import { RowActionsSheet } from '@/features/plan/row-actions-sheet'

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="flex flex-wrap items-baseline gap-x-1.5 type-title">
        {title}
        {/* The space keeps the accessible name readable: "Due today · 3 left this week". */}
        {count ? ' ' : null}
        {count ? <span className="type-meta text-muted">{count}</span> : null}
      </h2>
      {children}
    </section>
  )
}

function Rows({
  items,
  onMore,
}: {
  items: readonly TodayItem[]
  onMore: (item: TodayItem, button: HTMLButtonElement) => void
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <DueRow key={item.commitmentId} item={item} onMore={(button) => onMore(item, button)} />
      ))}
    </ul>
  )
}

/** The static cold-load placeholder in the Today layout (shown only after 300 ms). */
function TodaySkeleton() {
  return (
    <Skeleton>
      <SkeletonBar className="h-4 w-1/2" />
      <SkeletonBlock>
        <SkeletonBar />
        <SkeletonBar className="w-1/3" />
      </SkeletonBlock>
      <SkeletonBlock>
        <SkeletonBar />
        <SkeletonBar className="w-1/3" />
      </SkeletonBlock>
    </Skeleton>
  )
}

/**
 * Today's plan for one group, under the heading and the waiting state (FR-4: a waiting group plans
 * as usual). From `useToday`: Due today ("Due today · N left this week"), This week, then
 * "Your plan here · starts Mon", then "+ Add". Every row and section comes from the server in display
 * order; nothing here does day or week math.
 * - No plan: "No plan here yet." with Add as its one action; in a waiting group, Add only.
 * - A plan with nothing due today (even with no rows listed, e.g. fixed days on another day):
 *   "Nothing due today. The couch is suspicious." in the Due today section.
 * - Cold load: the Skeleton after 300 ms; a failed cold load: "Can't reach Proofy right now." with
 *   Try again. Cached data shows at once and refreshes silently.
 * Mount inside the `PlanSheetHost`: Add and a row's Edit (task or commitment) open its Plan sheet.
 */
export function TodaySections({ groupId, waiting }: { groupId: string; waiting: boolean }) {
  const query = useToday(groupId)
  const { openPlanSheet } = usePlanSheet()
  const [actions, setActions] = useState<{ item: TodayItem; opener: HTMLButtonElement } | null>(
    null,
  )
  const [actionsOpen, setActionsOpen] = useState(false)
  // Edit hands focus over to the Plan sheet, which returns it to the row's Overflow later.
  const handedOff = useRef(false)

  const data = query.data
  // A refetch removed the row whose actions are open (deleted elsewhere, its week moved on): close.
  if (
    actionsOpen &&
    actions !== null &&
    data !== undefined &&
    !data.items.some((item) => item.commitmentId === actions.item.commitmentId)
  ) {
    setActionsOpen(false)
  }
  if (!data) {
    if (query.isError) {
      return (
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
        />
      )
    }
    return <TodaySkeleton />
  }

  const empty = todayEmptyState(data.items, waiting, data.summary.hasPlan)
  if (data.items.length === 0 && empty !== 'nothing_due') {
    if (empty === 'no_plan') {
      return (
        <EmptyState
          icon={ListChecks}
          line={TODAY_COPY.noPlanLine}
          body={TODAY_COPY.noPlanBody}
          actionSlot={<AddPlanButton variant="primary" />}
        />
      )
    }
    return <AddPlanButton />
  }

  const due = itemsIn(data.items, 'due_today')
  const thisWeek = itemsIn(data.items, 'this_week')
  const next = itemsIn(data.items, 'starts_next_week')

  function openActions(item: TodayItem, opener: HTMLButtonElement) {
    handedOff.current = false
    setActions({ item, opener })
    setActionsOpen(true)
  }

  return (
    <>
      <Section
        title={TODAY_COPY.dueToday}
        // Nothing planned this week (e.g. a first week with only next week's plan): no count.
        count={data.summary.planned > 0 ? leftThisWeek(data.summary.left) : undefined}
      >
        {empty === 'nothing_due' ? (
          <EmptyState icon={Couch} line={TODAY_COPY.nothingDue} />
        ) : (
          <Rows items={due} onMore={openActions} />
        )}
      </Section>
      {thisWeek.length > 0 ? (
        <Section title={TODAY_COPY.thisWeek}>
          <Rows items={thisWeek} onMore={openActions} />
        </Section>
      ) : null}
      {next.length > 0 ? (
        <Section title={TODAY_COPY.planHere} count={startsHeading(next[0]?.startsOn ?? null)}>
          <Rows items={next} onMore={openActions} />
        </Section>
      ) : null}
      <AddPlanButton />
      {actions ? (
        <RowActionsSheet
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          title={itemTitle(actions.item)}
          returnFocusTo={() => {
            if (handedOff.current) return null
            // The row may be gone by now: fall back to "+ Add".
            return actions.opener.isConnected
              ? actions.opener
              : document.querySelector<HTMLElement>('[data-plan-add]')
          }}
          onEdit={() => {
            handedOff.current = true
            setActionsOpen(false)
            openPlanSheet(
              { mode: 'edit', commitmentId: actions.item.commitmentId, kind: actions.item.kind },
              actions.opener,
            )
          }}
        />
      ) : null}
    </>
  )
}
