import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ActivitySelection } from '@/domain/activities'
import { backendErrorCode, errorCopy } from '@/domain/error-codes'
import {
  deadlineOptions,
  hasTaskErrors,
  isTaskFormDirty,
  PLAN_COPY,
  TASK_COPY,
  TASK_ERROR_ORDER,
  TASK_NAME_MAX,
  taskAddedToast,
  toAddTaskInput,
  validateTask,
  type AddTaskInput,
  type TaskErrors,
  type TaskForm,
} from '@/domain/plan'
import { useGroupActivities, usePresetActivities } from '@/data/activities'
import { isOffline } from '@/data/connectivity'
import { useAddTask, usePlanPreview } from '@/data/plan'
import { Button } from '@/ui/button'
import { FieldError } from '@/ui/field-error'
import { InlineRetry } from '@/ui/inline-retry'
import { TextField } from '@/ui/text-field'
import { showToast } from '@/ui/toast'
import { WeekdaySelector } from '@/ui/weekday-selector'
import { ActivityPicker } from '@/features/plan/activity-picker'

type ErrorKey = keyof TaskErrors | 'deadline'

type SaveFailure = 'offline' | 'failed'

const EMPTY_TASK: TaskForm = { activity: null, name: '', deadline: null }

export interface TaskFormViewProps {
  groupId: string
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}

/**
 * The Plan sheet in Task mode (Story 2.4): Activity, Name (max 40, placeholder "Grocery run") and
 * Deadline, a single-mode Weekday selector of the days from today to Sunday that `plan_preview`
 * gives (default Sunday; "Today" under today's circle), then "Counts this week, starting now." and
 * Save. Field errors, "Saving…", offline and failure work as in Commitment mode.
 */
export function TaskFormView({ groupId, onDirtyChange, onSaved }: TaskFormViewProps) {
  const presets = usePresetActivities().data ?? []
  const groupActivities = useGroupActivities(groupId).data ?? []
  const preview = usePlanPreview(groupId, null, null)
  const addTask = useAddTask(groupId)

  const [form, setForm] = useState<TaskForm>(EMPTY_TASK)
  // Errors shown since the last Save; each one clears as soon as its input is valid.
  const [shown, setShown] = useState<ReadonlySet<keyof TaskErrors>>(new Set())
  // The server refused the deadline (the member's day moved on); cleared by picking a day.
  const [serverDeadlineError, setServerDeadlineError] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const lastInput = useRef<AddTaskInput | null>(null)
  const mounted = useRef(true)
  const [focusTick, setFocusTick] = useState(0)
  const [focusKey, setFocusKey] = useState<ErrorKey | null>(null)

  const activityRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const deadlineRef = useRef<HTMLButtonElement>(null)

  const ids = useId()
  const activityLabelId = `${ids}-activity`
  const activityErrorId = `${ids}-activity-error`
  const deadlineLabelId = `${ids}-deadline`
  const deadlineErrorId = `${ids}-deadline-error`

  const options = preview.data
    ? deadlineOptions(preview.data.memberToday, preview.data.weekEnd)
    : []
  const defaultDeadline = preview.data?.weekEnd ?? null
  // A picked day the server no longer offers (the day moved on) falls back to Sunday.
  const deadline =
    form.deadline !== null && options.some((o) => o.date === form.deadline)
      ? form.deadline
      : defaultDeadline
  const deadlineIso = options.find((o) => o.date === deadline)?.iso ?? null
  const validation = validateTask(form)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    onDirtyChange(isTaskFormDirty(form, defaultDeadline))
  }, [form, defaultDeadline, onDirtyChange])

  useEffect(() => {
    if (focusTick === 0 || focusKey === null) return
    if (focusKey === 'activity') {
      activityRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus()
    } else if (focusKey === 'name') {
      nameRef.current?.focus()
    } else {
      deadlineRef.current?.focus()
    }
  }, [focusTick, focusKey])

  function update(patch: Partial<TaskForm>) {
    const next = { ...form, ...patch }
    setForm(next)
    // An edit makes the failed request stale: Retry must not save what the form no longer shows.
    setFailure(null)
    lastInput.current = null
    if ('deadline' in patch) setServerDeadlineError(false)
    const nextErrors = validateTask(next)
    setShown((prev) => {
      const kept = [...prev].filter((k) => nextErrors[k] !== undefined)
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }

  function focusError(key: ErrorKey) {
    setFocusKey(key)
    setFocusTick((tick) => tick + 1)
  }

  function save(event?: FormEvent) {
    event?.preventDefault()
    if (busyRef.current) return
    if (hasTaskErrors(validation) || form.activity === null) {
      const keys = TASK_ERROR_ORDER.filter((k) => validation[k] !== undefined)
      setShown(new Set(keys))
      setFailure(null)
      const first = keys[0]
      if (first) focusError(first)
      return
    }
    if (deadline === null) {
      // No days from the server yet: nothing to save against.
      setFailure(isOffline() ? 'offline' : 'failed')
      void preview.refetch()
      return
    }
    void send(toAddTaskInput(groupId, form.activity, form.name, deadline))
  }

  async function send(input: AddTaskInput) {
    if (busyRef.current) return
    lastInput.current = input
    if (isOffline()) {
      setFailure('offline')
      return
    }
    busyRef.current = true
    setBusy(true)
    setFailure(null)
    try {
      await addTask.mutateAsync(input)
      // Saved even if the sheet was discarded meanwhile, so the toast always shows.
      showToast(taskAddedToast(input.name))
      if (!mounted.current) return
      // Stays busy while the sheet closes.
      onSaved()
    } catch (error) {
      busyRef.current = false
      if (!mounted.current) return
      setBusy(false)
      const code = backendErrorCode(error)
      if (code === 'network') {
        setFailure('offline')
      } else if (code === 'invalid_deadline') {
        // The plan refetches (useAddTask), so the days catch up with the member's today.
        lastInput.current = null
        setServerDeadlineError(true)
        focusError('deadline')
      } else {
        setFailure('failed')
      }
    }
  }

  function retry() {
    // No request yet when the days had not loaded: Retry runs Save again.
    if (lastInput.current) void send(lastInput.current)
    else save()
  }

  const activityError = shown.has('activity') ? validation.activity : undefined
  const nameError = shown.has('name') ? validation.name : undefined
  const deadlineError = serverDeadlineError ? errorCopy('invalid_deadline') : undefined

  return (
    <form noValidate className="flex flex-col" onSubmit={save}>
      <div className="flex flex-col gap-5 pb-1">
        <div ref={activityRef} className="flex flex-col gap-2">
          <p id={activityLabelId} className="type-label text-muted">
            {PLAN_COPY.activity}
          </p>
          <ActivityPicker
            presets={presets}
            groupActivities={groupActivities}
            value={form.activity}
            onChange={(activity: ActivitySelection) => update({ activity })}
            labelledBy={activityLabelId}
            describedBy={activityError ? activityErrorId : undefined}
          />
          {activityError ? <FieldError id={activityErrorId}>{activityError}</FieldError> : null}
        </div>

        <TextField
          ref={nameRef}
          label={TASK_COPY.name}
          placeholder={TASK_COPY.namePlaceholder}
          maxLength={TASK_NAME_MAX}
          autoComplete="off"
          aria-required="true"
          value={form.name}
          onChange={(event) => update({ name: event.target.value })}
          error={nameError}
        />

        <div className="flex flex-col gap-2">
          <p id={deadlineLabelId} className="type-label text-muted">
            {TASK_COPY.deadline}
          </p>
          <WeekdaySelector
            ref={deadlineRef}
            mode="single"
            days={options.map((o) => ({
              value: o.iso,
              letter: o.letter,
              name: o.name,
              caption: o.today ? TASK_COPY.today : undefined,
            }))}
            value={deadlineIso}
            onChange={(iso) =>
              update({ deadline: options.find((o) => o.iso === iso)?.date ?? null })
            }
            labelledBy={deadlineLabelId}
            describedBy={deadlineError ? deadlineErrorId : undefined}
            invalid={deadlineError !== undefined}
          />
          {deadlineError ? <FieldError id={deadlineErrorId}>{deadlineError}</FieldError> : null}
        </div>

        <p className="type-meta text-muted" data-start-note="">
          {TASK_COPY.startNote}
        </p>
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 bg-card pt-[14px]">
        {failure ? (
          <InlineRetry onRetry={retry} retryLabel={PLAN_COPY.retry}>
            {failure === 'offline' ? PLAN_COPY.offline : PLAN_COPY.failed}
          </InlineRetry>
        ) : null}
        <Button type="submit" variant="primary" fullWidth busy={busy} busyLabel={PLAN_COPY.saving}>
          {PLAN_COPY.save}
        </Button>
      </div>
    </form>
  )
}
