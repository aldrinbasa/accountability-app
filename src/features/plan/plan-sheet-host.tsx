import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MY_PLAN_COPY } from '@/domain/my-plan'
import { showToast } from '@/ui/toast'
import { DeleteTaskSheet, type DeleteTarget } from '@/features/plan/delete-task-sheet'
import { EndCommitmentSheet, type EndTarget } from '@/features/plan/end-commitment-sheet'
import { PlanSheet } from '@/features/plan/plan-sheet'
import {
  PlanSheetContext,
  type OpenPlanSheet,
  type PlanSheetRequest,
} from '@/features/plan/plan-sheet-context'

type View = 'closed' | 'plan' | 'delete' | 'end'

export interface PlanSheetHostProps {
  groupId: string
  children: ReactNode
  /** Every sheet of the host is closed again (after any close path, swaps included). */
  onClosed?: () => void
}

/**
 * Hosts the Plan sheet for one group and hands out `openPlanSheet` (`usePlanSheet`). Mounted once on
 * Today and once on My plan. "+ Add" opens it to add; a row's Overflow or Edit opens it to edit a
 * task or a habit. One sheet at a time: "Delete task" or "End habit" in edit mode replaces
 * the Plan sheet with its confirm Sheet, and closing the confirm goes back to the screen (not to the
 * edit sheet). A habit that turns out gone or ended closes the sheet with the toast "That's
 * already wrapped up." Focus returns to whatever opened the Plan sheet (for a row, its Overflow
 * button), or to "+ Add" (else the screen's h1) when that is gone.
 */
export function PlanSheetHost({ groupId, children, onClosed }: PlanSheetHostProps) {
  const [view, setView] = useState<View>('closed')
  const [request, setRequest] = useState<PlanSheetRequest>({ mode: 'add' })
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [endTarget, setEndTarget] = useState<EndTarget | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const root = useRef<HTMLDivElement>(null)

  const openPlanSheet = useCallback<OpenPlanSheet>((next, from) => {
    opener.current =
      from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setRequest(next)
    setView('plan')
  }, [])

  /** The opener, or "+ Add" (else the screen's h1) when the opener is gone (its row went). */
  const returnFocusTo = useCallback(
    () =>
      opener.current?.isConnected
        ? opener.current
        : (root.current?.querySelector<HTMLElement>('[data-plan-add]') ??
          root.current?.querySelector<HTMLElement>('h1') ??
          null),
    [],
  )

  // Tells the screen once every sheet is closed again (not on the first render).
  const latestOnClosed = useRef(onClosed)
  useEffect(() => {
    latestOnClosed.current = onClosed
  })
  const wasOpen = useRef(false)
  useEffect(() => {
    if (view !== 'closed') {
      wasOpen.current = true
    } else if (wasOpen.current) {
      wasOpen.current = false
      latestOnClosed.current?.()
    }
  }, [view])

  const commitmentUnavailable = useCallback(() => {
    showToast(MY_PLAN_COPY.wrappedUp)
    setView('closed')
  }, [])

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
        onEndCommitment={(target) => {
          setEndTarget(target)
          setView('end')
        }}
        onCommitmentUnavailable={commitmentUnavailable}
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
      {endTarget ? (
        <EndCommitmentSheet
          key={endTarget.commitmentId}
          open={view === 'end'}
          onOpenChange={(open) => setView(open ? 'end' : 'closed')}
          groupId={groupId}
          commitment={endTarget}
          returnFocusTo={returnFocusTo}
        />
      ) : null}
    </PlanSheetContext.Provider>
  )
}
