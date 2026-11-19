import { useCallback, useRef, useState, type ReactNode } from 'react'
import { DeleteTaskSheet, type DeleteTarget } from '@/features/plan/delete-task-sheet'
import { PlanSheet } from '@/features/plan/plan-sheet'
import {
  PlanSheetContext,
  type OpenPlanSheet,
  type PlanSheetRequest,
} from '@/features/plan/plan-sheet-context'

type View = 'closed' | 'plan' | 'delete'

/**
 * Hosts the Plan sheet for one group and hands out `openPlanSheet` (`usePlanSheet`). Mounted once on
 * Today. "+ Add" opens it to add; a Today row's Overflow Sheet opens it to edit. One sheet at a
 * time: "Delete task" in edit mode replaces the Plan sheet with its confirm Sheet, and closing the
 * confirm goes back to Today (not to the edit sheet). Focus returns to whatever opened the Plan
 * sheet (for a row, its Overflow button), or to "+ Add" when that is gone.
 */
export function PlanSheetHost({ groupId, children }: { groupId: string; children: ReactNode }) {
  const [view, setView] = useState<View>('closed')
  const [request, setRequest] = useState<PlanSheetRequest>({ mode: 'add' })
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const openPlanSheet = useCallback<OpenPlanSheet>((next, from) => {
    opener.current =
      from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setRequest(next)
    setView('plan')
  }, [])

  /** The opener, or "+ Add" when the opener is gone (e.g. its row was deleted). */
  const returnFocusTo = useCallback(
    () =>
      opener.current?.isConnected
        ? opener.current
        : (root.current?.querySelector<HTMLElement>('[data-plan-add]') ?? null),
    [],
  )

  return (
    <PlanSheetContext.Provider value={openPlanSheet}>
      <div ref={root} className="contents">
        {children}
      </div>
      <PlanSheet
        open={view === 'plan'}
        onOpenChange={(open) => setView(open ? 'plan' : 'closed')}
        groupId={groupId}
        request={request}
        returnFocusTo={returnFocusTo}
        onDeleteTask={(target) => {
          setDeleteTarget(target)
          setView('delete')
        }}
      />
      {deleteTarget ? (
        <DeleteTaskSheet
          key={deleteTarget.commitmentId}
          open={view === 'delete'}
          onOpenChange={(open) => setView(open ? 'delete' : 'closed')}
          groupId={groupId}
          task={deleteTarget}
          returnFocusTo={returnFocusTo}
          // The deleted row (and its Overflow, the opener) is about to go: focus "+ Add" instead.
          onDeleted={() => {
            opener.current = null
          }}
        />
      ) : null}
    </PlanSheetContext.Provider>
  )
}
