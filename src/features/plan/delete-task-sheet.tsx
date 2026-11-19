import { useRef, useState } from 'react'
import { backendErrorCode, errorCopy } from '@/domain/error-codes'
import { deleteTaskTitle, PLAN_COPY, TASK_COPY } from '@/domain/plan'
import { isOffline } from '@/data/connectivity'
import { useDeleteTask } from '@/data/plan'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { Sheet } from '@/ui/sheet'

/** The task the confirm is about: its id and saved name. */
export interface DeleteTarget {
  commitmentId: string
  name: string
}

/** Why a delete did not go through. Only offline and a plain failure offer Retry. */
type DeleteFailure = 'offline' | 'failed' | 'locked' | 'gone'

function failureText(failure: DeleteFailure): string {
  switch (failure) {
    case 'offline':
      return PLAN_COPY.offline
    case 'failed':
      return PLAN_COPY.failed
    case 'locked':
      return TASK_COPY.tooLateToDelete
    case 'gone':
      return errorCopy('not_found')
  }
}

export interface DeleteTaskSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  task: DeleteTarget
  /** Where focus goes on close (the Plan sheet's opener; this sheet replaced the Plan sheet). */
  returnFocusTo?: HTMLElement | null
}

/**
 * "Delete Grocery run?" confirm Sheet: "It comes off this week's plan." and one full-width coral
 * "Delete task" button; the close is cancel. Offline and failure show the Plan sheet's Inline retry
 * copy. `task_locked` (the deadline day has started) shows "Too late to delete. Its day has started."
 * with no Retry, and the plan refetches.
 */
export function DeleteTaskSheet({
  open,
  onOpenChange,
  groupId,
  task,
  returnFocusTo,
}: DeleteTaskSheetProps) {
  const deleteTask = useDeleteTask(groupId)
  const [failure, setFailure] = useState<DeleteFailure | null>(null)
  const [busy, setBusy] = useState(false)
  // The guard itself: Retry and the button can race within one render.
  const busyRef = useRef(false)

  function change(next: boolean) {
    if (!next) setFailure(null)
    onOpenChange(next)
  }

  async function confirm() {
    if (busyRef.current) return
    if (isOffline()) {
      setFailure('offline')
      return
    }
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    try {
      await deleteTask.mutateAsync(task.commitmentId)
      busyRef.current = false
      setBusy(false)
      change(false)
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      const code = backendErrorCode(error)
      if (code === 'network') setFailure('offline')
      else if (code === 'task_locked') setFailure('locked')
      else if (code === 'not_found') setFailure('gone')
      else setFailure('failed')
    }
  }

  const canRetry = failure === 'offline' || failure === 'failed'

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      title={deleteTaskTitle(task.name)}
      returnFocusTo={returnFocusTo}
    >
      <div className="flex flex-col gap-4">
        <p className="type-body">{TASK_COPY.deleteBody}</p>
        {failure ? (
          <InlineRetry
            onRetry={canRetry ? () => void confirm() : undefined}
            retryLabel={PLAN_COPY.retry}
          >
            {failureText(failure)}
          </InlineRetry>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          busy={busy}
          busyLabel={TASK_COPY.deleting}
          onClick={() => void confirm()}
        >
          {TASK_COPY.deleteTask}
        </Button>
      </div>
    </Sheet>
  )
}
