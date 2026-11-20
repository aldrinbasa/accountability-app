import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CUSTOM_ACTIVITY_ICON, presetIcon } from '@/domain/activities'
import { backendErrorCode, errorCopy } from '@/domain/error-codes'
import {
  formatShortDate,
  PLAN_COPY,
  TASK_COPY,
  TASK_NAME_MAX,
  taskActivityName,
  taskNameError,
  type TaskDetails,
} from '@/domain/plan'
import { usePresetActivities } from '@/data/activities'
import { useRenameTask, useTask } from '@/data/plan'
import { canRetry, useSaveFlow, type SaveFailure } from '@/data/save-flow'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { InlineRetry } from '@/ui/inline-retry'
import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'
import { TextField } from '@/ui/text-field'
import type { DeleteTarget } from '@/features/plan/delete-task-sheet'

/** Why a rename did not go through, besides offline and a plain failure (no Retry for these). */
type RenameFailure = 'locked' | 'gone'

function failureText(failure: SaveFailure<RenameFailure>): string {
  switch (failure) {
    case 'offline':
      return PLAN_COPY.offline
    case 'failed':
      return PLAN_COPY.failed
    case 'locked':
      return errorCopy('task_locked')
    case 'gone':
      return errorCopy('not_found')
  }
}

export interface TaskEditViewProps {
  groupId: string
  commitmentId: string
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
  /** "Delete task": the host swaps this sheet for the delete confirm. */
  onDelete: (task: DeleteTarget) => void
}

/**
 * The Plan sheet in task edit mode (Story 2.4), from `get_task`: activity and deadline read-only,
 * Name editable with Save calling `rename_task` while the server says `can_rename` (else read-only,
 * no Save), and the destructive "Delete task" link only while it says `can_delete` (before the
 * deadline day starts).
 */
export function TaskEditView({
  groupId,
  commitmentId,
  onDirtyChange,
  onSaved,
  onDelete,
}: TaskEditViewProps) {
  const task = useTask(groupId, commitmentId)

  if (task.data) {
    return (
      <TaskEditForm
        groupId={groupId}
        task={task.data}
        onDirtyChange={onDirtyChange}
        onSaved={onSaved}
        onDelete={onDelete}
      />
    )
  }

  if (task.isError) {
    const gone = backendErrorCode(task.error) === 'not_found'
    return (
      <InlineRetry
        onRetry={gone ? undefined : () => void task.refetch()}
        retryLabel={PLAN_COPY.retry}
      >
        {gone ? errorCopy('not_found') : TASK_COPY.loadFailed}
      </InlineRetry>
    )
  }

  return (
    <Skeleton>
      <SkeletonBlock>
        <SkeletonBar />
        <SkeletonBar className="w-1/3" />
      </SkeletonBlock>
    </Skeleton>
  )
}

interface TaskEditFormProps extends Omit<TaskEditViewProps, 'commitmentId'> {
  task: TaskDetails
}

function TaskEditForm({ groupId, task, onDirtyChange, onSaved, onDelete }: TaskEditFormProps) {
  const presets = usePresetActivities().data ?? []
  const rename = useRenameTask(groupId)

  const [name, setName] = useState(task.name)
  const [showNameError, setShowNameError] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const [focusTick, setFocusTick] = useState(0)

  // The server refused the name (invalid_plan); cleared by the next edit.
  const [serverNameError, setServerNameError] = useState(false)
  const flow = useSaveFlow<string, unknown, RenameFailure>({
    run: (trimmed) => rename.mutateAsync({ commitmentId: task.commitmentId, name: trimmed }),
    onSaved: (_result, _input, live) => {
      if (live) onSaved()
    },
    onError: (code) => {
      if (code === 'task_locked') return 'locked'
      if (code === 'not_found') return 'gone'
      if (code !== 'invalid_plan') return 'failed'
      setShowNameError(true)
      setServerNameError(true)
      setFocusTick((tick) => tick + 1)
      return null
    },
    holdBusyOnSaved: true,
  })
  const { failure, setFailure } = flow
  const nameError = showNameError
    ? (taskNameError(name) ?? (serverNameError ? TASK_COPY.pickName : undefined))
    : undefined

  useEffect(() => {
    onDirtyChange(name !== task.name)
  }, [name, task.name, onDirtyChange])

  useEffect(() => {
    if (focusTick > 0) nameRef.current?.focus()
  }, [focusTick])

  function save(event?: FormEvent) {
    event?.preventDefault()
    if (flow.isBusy()) return
    if (taskNameError(name) !== undefined) {
      setShowNameError(true)
      setFailure(null)
      setFocusTick((tick) => tick + 1)
      return
    }
    const trimmed = name.trim()
    // Nothing changed: nothing to save.
    if (trimmed === task.name) {
      onSaved()
      return
    }
    void flow.send(trimmed)
  }

  const activityName = taskActivityName(task, presets)
  const activityIcon = task.presetKey !== null ? presetIcon(task.presetKey) : CUSTOM_ACTIVITY_ICON

  return (
    <form noValidate className="flex flex-col" onSubmit={save}>
      <div className="flex flex-col gap-5 pb-1">
        <div className="flex flex-col gap-2">
          <p className="type-label text-muted">{PLAN_COPY.activity}</p>
          <p className="flex items-center gap-2 type-body text-ink" data-read-only="">
            <Icon icon={activityIcon} size={24} />
            <span>{activityName}</span>
          </p>
        </div>

        {task.canRename ? (
          <TextField
            ref={nameRef}
            label={TASK_COPY.name}
            placeholder={TASK_COPY.namePlaceholder}
            maxLength={TASK_NAME_MAX}
            autoComplete="off"
            aria-required="true"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              flow.reset()
              setServerNameError(false)
            }}
            error={nameError}
          />
        ) : (
          // The session has ended: the name can't change any more (rename_task would refuse).
          <div className="flex flex-col gap-2">
            <p className="type-label text-muted">{TASK_COPY.name}</p>
            <p className="type-body text-ink" data-read-only="">
              {task.name}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="type-label text-muted">{TASK_COPY.deadline}</p>
          <p className="type-body text-ink" data-read-only="">
            {formatShortDate(task.deadline)}
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 bg-card pt-[14px]">
        {failure ? (
          <InlineRetry
            onRetry={canRetry(failure) ? () => void flow.retry() : undefined}
            retryLabel={PLAN_COPY.retry}
          >
            {failureText(failure)}
          </InlineRetry>
        ) : null}
        {task.canRename ? (
          <Button
            type="submit"
            variant="primary"
            fullWidth
            busy={flow.busy}
            busyLabel={PLAN_COPY.saving}
          >
            {PLAN_COPY.save}
          </Button>
        ) : null}
        {task.canDelete ? (
          <Button
            variant="link"
            className="self-center text-miss"
            onClick={() => onDelete({ commitmentId: task.commitmentId, name: task.name })}
          >
            {TASK_COPY.deleteTask}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
