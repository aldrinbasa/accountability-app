import { errorCopy } from '@/domain/error-codes'
import { deleteTaskTitle, TASK_COPY } from '@/domain/plan'
import { useDeleteTask } from '@/data/plan'
import { ConfirmSheet } from '@/features/plan/confirm-sheet'

/** The task the confirm is about: its id and saved name. */
export interface DeleteTarget {
  commitmentId: string
  name: string
}

/** Why a delete did not go through, besides offline and a plain failure (no Retry for these). */
type DeleteFailure = 'locked' | 'gone'

function failureText(failure: DeleteFailure): string {
  return failure === 'locked' ? TASK_COPY.tooLateToDelete : errorCopy('not_found')
}

export interface DeleteTaskSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  task: DeleteTarget
  /** Where focus goes on close (the Plan sheet's opener; this sheet replaced the Plan sheet). */
  returnFocusTo?: () => HTMLElement | null
  /** The delete went through (called before the sheet closes, so focus can go elsewhere). */
  onDeleted?: () => void
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
  onDeleted,
}: DeleteTaskSheetProps) {
  const deleteTask = useDeleteTask(groupId)
  return (
    <ConfirmSheet<DeleteFailure>
      open={open}
      onOpenChange={onOpenChange}
      title={deleteTaskTitle(task.name)}
      body={TASK_COPY.deleteBody}
      actionLabel={TASK_COPY.deleteTask}
      busyLabel={TASK_COPY.deleting}
      run={() => deleteTask.mutateAsync(task.commitmentId)}
      onError={(code) =>
        code === 'task_locked' ? 'locked' : code === 'not_found' ? 'gone' : 'failed'
      }
      failureText={failureText}
      returnFocusTo={returnFocusTo}
      onDone={onDeleted}
    />
  )
}
