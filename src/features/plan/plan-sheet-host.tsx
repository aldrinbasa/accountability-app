import { useCallback, useState, type ReactNode } from 'react'
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
 * Today. One sheet at a time: "Delete task" in edit mode replaces the Plan sheet with its confirm
 * Sheet, and closing the confirm goes back to Today (not to the edit sheet), with focus on whatever
 * opened the Plan sheet.
 */
export function PlanSheetHost({ groupId, children }: { groupId: string; children: ReactNode }) {
  const [view, setView] = useState<View>('closed')
  const [request, setRequest] = useState<PlanSheetRequest>({ mode: 'add' })
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [opener, setOpener] = useState<HTMLElement | null>(null)

  const openPlanSheet = useCallback<OpenPlanSheet>((next) => {
    setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setRequest(next)
    setView('plan')
  }, [])

  return (
    <PlanSheetContext.Provider value={openPlanSheet}>
      {children}
      <PlanSheet
        open={view === 'plan'}
        onOpenChange={(open) => setView(open ? 'plan' : 'closed')}
        groupId={groupId}
        request={request}
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
          returnFocusTo={opener}
        />
      ) : null}
    </PlanSheetContext.Provider>
  )
}
