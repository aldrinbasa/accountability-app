import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ActivitySelection, ScheduleType } from '@/domain/activities'
import { backendErrorCode, errorCopy } from '@/domain/error-codes'
import { MY_PLAN_COPY } from '@/domain/my-plan'
import {
  addedToast,
  COMMITMENT_ERROR_ORDER,
  DEFAULT_SCHEDULE_TYPE,
  DEFAULT_TARGET,
  formatShortDate,
  hasErrors,
  isCommitmentFormDirty,
  lastWeekNote,
  lockedNote,
  lockedTypeFor,
  otherScheduleType,
  PLAN_COPY,
  PLAN_KIND_OPTIONS,
  SCHEDULE_TYPE_OPTIONS,
  selectionKey,
  selectionName,
  startNote,
  TARGET_MAX,
  TARGET_MIN,
  targetLabel,
  TASK_COPY,
  toAddCommitmentInput,
  validateCommitment,
  WEEKDAYS,
  type AddCommitmentInput,
  type CommitmentErrors,
  type CommitmentForm,
  type PlanKind,
} from '@/domain/plan'
import { useGroupActivities, usePresetActivities } from '@/data/activities'
import { isOffline } from '@/data/connectivity'
import { useAddCommitment, usePlanPreview } from '@/data/plan'
import { Button } from '@/ui/button'
import { DateField } from '@/ui/date-field'
import { FieldError } from '@/ui/field-error'
import { InlineRetry } from '@/ui/inline-retry'
import { SegmentedSwitch } from '@/ui/segmented-switch'
import { Sheet } from '@/ui/sheet'
import { Stepper } from '@/ui/stepper'
import { showToast } from '@/ui/toast'
import { WeekdaySelector, type WeekdayOption } from '@/ui/weekday-selector'
import { ActivityPicker } from '@/features/plan/activity-picker'
import { CommitmentEditView } from '@/features/plan/commitment-edit-view'
import type { DeleteTarget } from '@/features/plan/delete-task-sheet'
import type { EndTarget } from '@/features/plan/end-commitment-sheet'
import type { PlanSheetRequest } from '@/features/plan/plan-sheet-context'
import { TaskEditView } from '@/features/plan/task-edit-view'
import { TaskFormView } from '@/features/plan/task-form-view'

const WEEKDAY_OPTIONS: readonly WeekdayOption[] = WEEKDAYS.map((day) => ({
  value: day.iso,
  letter: day.letter,
  name: day.name,
}))

type ErrorKey = keyof CommitmentErrors

/** Why a save did not go through: offline, or anything else (codes with a field go to the field). */
type SaveFailure = 'offline' | 'failed'

function failureText(failure: SaveFailure): string {
  return failure === 'offline' ? PLAN_COPY.offline : PLAN_COPY.failed
}

const EMPTY_FORM: CommitmentForm = {
  activity: null,
  scheduleType: DEFAULT_SCHEDULE_TYPE,
  days: [],
  target: DEFAULT_TARGET,
  endDate: null,
}

export interface PlanSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  /** Add (Commitment pre-selected) or edit one item. Default: add. */
  request?: PlanSheetRequest
  /** Where focus goes on close (default: what had focus when the sheet opened). */
  returnFocusTo?: () => HTMLElement | null
  /** Edit mode's "Delete task": the caller swaps this sheet for the delete confirm. */
  onDeleteTask?: (task: DeleteTarget) => void
  /** Commitment edit mode's "End commitment": the caller swaps this sheet for the End confirm. */
  onEndCommitment?: (commitment: EndTarget) => void
  /** Commitment edit mode found the commitment gone, ended or ending. */
  onCommitmentUnavailable?: () => void
}

function sheetTitle(request: PlanSheetRequest): string {
  if (request.mode === 'add') return PLAN_COPY.title
  return request.kind === 'task' ? TASK_COPY.editTitle : MY_PLAN_COPY.editTitle
}

/**
 * The Plan sheet (Stories 2.2 and 2.4; DESIGN.md `plan-sheet`, mockups/key-add-plan.html). Title
 * "Add a commitment or task", or "Edit task" in task edit mode. In add mode an unlabeled
 * Commitment / Task switch sits on top, Commitment pre-selected; Commitment mode has Activity,
 * Schedule, Days or Times per week, End date (optional) and the start note from `plan_preview`;
 * Task mode has Activity, Name and Deadline. In edit mode ("Edit task" or "Edit commitment", Story
 * 2.6) the switch is hidden. Save is coral and pinned to the bottom. Unsaved input asks "Discard this?" on close; focus is trapped
 * and returns to the opener. Reminders arrive in Epic 6.
 */
export function PlanSheet({
  open,
  onOpenChange,
  groupId,
  request = { mode: 'add' },
  returnFocusTo,
  onDeleteTask,
  onEndCommitment,
  onCommitmentUnavailable,
}: PlanSheetProps) {
  const [dirty, setDirty] = useState(false)

  function change(next: boolean) {
    if (!next) setDirty(false)
    onOpenChange(next)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={change}
      title={sheetTitle(request)}
      dirty={dirty}
      returnFocusTo={returnFocusTo}
    >
      {/* The sheet unmounts its content when closed, so every open starts from a fresh form. */}
      {request.mode === 'edit' && request.kind === 'commitment' ? (
        <CommitmentEditView
          groupId={groupId}
          commitmentId={request.commitmentId}
          onDirtyChange={setDirty}
          onSaved={() => change(false)}
          onEnd={(commitment) => {
            setDirty(false)
            onEndCommitment?.(commitment)
          }}
          onUnavailable={onCommitmentUnavailable}
        />
      ) : request.mode === 'edit' ? (
        <TaskEditView
          groupId={groupId}
          commitmentId={request.commitmentId}
          onDirtyChange={setDirty}
          onSaved={() => change(false)}
          onDelete={(task) => {
            setDirty(false)
            onDeleteTask?.(task)
          }}
        />
      ) : (
        <AddPlanView groupId={groupId} onDirtyChange={setDirty} onSaved={() => change(false)} />
      )}
    </Sheet>
  )
}

interface AddPlanViewProps {
  groupId: string
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}

/**
 * Add mode: the Commitment / Task switch, then the form of the chosen kind. Both forms stay mounted
 * (the other one hidden), so input survives a switch back and forth; the sheet is dirty when either
 * form is.
 */
function AddPlanView({ groupId, onDirtyChange, onSaved }: AddPlanViewProps) {
  const [kind, setKind] = useState<PlanKind>('commitment')
  const [commitmentDirty, setCommitmentDirty] = useState(false)
  const [taskDirty, setTaskDirty] = useState(false)

  useEffect(() => {
    onDirtyChange(commitmentDirty || taskDirty)
  }, [commitmentDirty, taskDirty, onDirtyChange])

  return (
    <div className="flex flex-col gap-5">
      <SegmentedSwitch
        options={PLAN_KIND_OPTIONS}
        value={kind}
        onChange={setKind}
        label={TASK_COPY.kindLabel}
      />
      <div hidden={kind !== 'commitment'}>
        <CommitmentFormView
          groupId={groupId}
          onDirtyChange={setCommitmentDirty}
          onSaved={onSaved}
        />
      </div>
      <div hidden={kind !== 'task'}>
        <TaskFormView groupId={groupId} onDirtyChange={setTaskDirty} onSaved={onSaved} />
      </div>
    </div>
  )
}

interface CommitmentFormViewProps {
  groupId: string
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}

function CommitmentFormView({ groupId, onDirtyChange, onSaved }: CommitmentFormViewProps) {
  const presets = usePresetActivities().data ?? []
  const groupActivities = useGroupActivities(groupId).data ?? []
  const addCommitment = useAddCommitment(groupId)

  const [form, setForm] = useState<CommitmentForm>(EMPTY_FORM)
  // Errors shown since the last Save; each one clears as soon as its input is valid.
  const [shown, setShown] = useState<ReadonlySet<ErrorKey>>(new Set())
  // The server refused the end date (no preview to check it against first).
  const [serverEndDateError, setServerEndDateError] = useState(false)
  // The server answered schedule_type_locked for this activity: the type it must be.
  const [serverLock, setServerLock] = useState<{ key: string; type: ScheduleType } | null>(null)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [busy, setBusy] = useState(false)
  // The guard itself: Retry and Save can race within one render.
  const busyRef = useRef(false)
  const lastInput = useRef<AddCommitmentInput | null>(null)
  const mounted = useRef(true)
  const [focusTick, setFocusTick] = useState(0)
  const [focusKey, setFocusKey] = useState<ErrorKey | null>(null)

  const activityRef = useRef<HTMLDivElement>(null)
  const daysRef = useRef<HTMLButtonElement>(null)
  const endDateRef = useRef<HTMLInputElement>(null)

  const ids = useId()
  const activityLabelId = `${ids}-activity`
  const activityErrorId = `${ids}-activity-error`
  const scheduleLabelId = `${ids}-schedule`
  const daysLabelId = `${ids}-days`
  const daysErrorId = `${ids}-days-error`
  const targetLabelId = `${ids}-target`

  const key = selectionKey(form.activity)
  const lockedType =
    lockedTypeFor(form.activity, groupActivities) ??
    (serverLock !== null && serverLock.key === key ? serverLock.type : null)
  const scheduleType = lockedType ?? form.scheduleType
  const effective: CommitmentForm = { ...form, scheduleType }

  const preview = usePlanPreview(
    groupId,
    scheduleType === 'times_per_week' ? form.target : null,
    form.endDate,
  )
  const minEndDate = preview.data?.minEndDate ?? null
  const validation = validateCommitment(effective, minEndDate)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    onDirtyChange(isCommitmentFormDirty(form))
  }, [form, onDirtyChange])

  useEffect(() => {
    if (focusTick === 0 || focusKey === null) return
    if (focusKey === 'activity') {
      activityRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus()
    } else if (focusKey === 'days') {
      daysRef.current?.focus()
    } else {
      endDateRef.current?.focus()
    }
  }, [focusTick, focusKey])

  /** Applies a change and drops the shown errors it fixed. */
  function update(patch: Partial<CommitmentForm>) {
    const next = { ...form, ...patch }
    setForm(next)
    // An edit makes the failed request stale: Retry must not save what the form no longer shows.
    setFailure(null)
    lastInput.current = null
    const keepServerEndDate = serverEndDateError && !('endDate' in patch)
    if ('endDate' in patch) setServerEndDateError(false)
    const nextKey = selectionKey(next.activity)
    const nextLocked =
      lockedTypeFor(next.activity, groupActivities) ??
      (serverLock !== null && serverLock.key === nextKey ? serverLock.type : null)
    const nextErrors = validateCommitment(
      { ...next, scheduleType: nextLocked ?? next.scheduleType },
      minEndDate,
    )
    setShown((prev) => {
      const kept = [...prev].filter(
        (k) => nextErrors[k] !== undefined || (k === 'endDate' && keepServerEndDate),
      )
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }

  function focusError(errorKey: ErrorKey) {
    setFocusKey(errorKey)
    setFocusTick((tick) => tick + 1)
  }

  function save(event?: FormEvent) {
    event?.preventDefault()
    if (busyRef.current) return
    if (hasErrors(validation) || form.activity === null) {
      const keys = COMMITMENT_ERROR_ORDER.filter((k) => validation[k] !== undefined)
      setShown(new Set(keys))
      setFailure(null)
      const first = keys[0]
      if (first) focusError(first)
      return
    }
    void send(toAddCommitmentInput(groupId, { ...effective, activity: form.activity }))
  }

  async function send(input: AddCommitmentInput) {
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
      const result = await addCommitment.mutateAsync(input)
      // Saved even if the sheet was discarded meanwhile, so the toast always shows.
      showToast(
        addedToast(selectionName(input.activity, presets, groupActivities), result.startsOn),
      )
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
      } else if (code === 'schedule_type_locked') {
        setServerLock({
          key: selectionKey(input.activity) ?? '',
          type: otherScheduleType(input.scheduleType),
        })
      } else if (code === 'invalid_end_date') {
        setServerEndDateError(true)
        setShown((prev) => new Set([...prev, 'endDate']))
        focusError('endDate')
      } else {
        setFailure('failed')
      }
    }
  }

  function retry() {
    if (lastInput.current) void send(lastInput.current)
  }

  const activityError = shown.has('activity') ? validation.activity : undefined
  const daysError = shown.has('days') ? validation.days : undefined
  const endDateError = shown.has('endDate')
    ? (validation.endDate ?? (serverEndDateError ? errorCopy('invalid_end_date') : undefined))
    : undefined

  const activityName = selectionName(form.activity, presets, groupActivities)
  const fromServerLock = serverLock !== null && serverLock.key === key
  const lastWeek =
    scheduleType === 'times_per_week' && preview.data && !preview.isPlaceholderData
      ? preview.data.lastWeekTarget
      : null
  const lastWeekHint =
    lastWeek !== null && lastWeek < form.target ? lastWeekNote(lastWeek, form.target) : undefined

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

        <div className="flex flex-col gap-2">
          <p id={scheduleLabelId} className="type-label text-muted">
            {PLAN_COPY.schedule}
          </p>
          <SegmentedSwitch
            options={SCHEDULE_TYPE_OPTIONS}
            value={scheduleType}
            onChange={(type) => update({ scheduleType: type })}
            labelledBy={scheduleLabelId}
            locked={lockedType !== null}
            lockedNote={lockedType !== null ? lockedNote(activityName, lockedType) : undefined}
            announceNote={fromServerLock}
          />
        </div>

        {scheduleType === 'fixed_days' ? (
          <div className="flex flex-col gap-2">
            <p id={daysLabelId} className="type-label text-muted">
              {PLAN_COPY.days}
            </p>
            <WeekdaySelector
              ref={daysRef}
              days={WEEKDAY_OPTIONS}
              value={form.days}
              onChange={(days) => update({ days })}
              labelledBy={daysLabelId}
              describedBy={daysError ? daysErrorId : undefined}
              invalid={daysError !== undefined}
            />
            {daysError ? <FieldError id={daysErrorId}>{daysError}</FieldError> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p id={targetLabelId} className="type-label text-muted">
              {PLAN_COPY.timesPerWeek}
            </p>
            <Stepper
              value={form.target}
              onChange={(target) => update({ target })}
              min={TARGET_MIN}
              max={TARGET_MAX}
              unit={PLAN_COPY.unit}
              valueLabel={targetLabel}
              decrementLabel={PLAN_COPY.fewer}
              incrementLabel={PLAN_COPY.more}
              labelledBy={targetLabelId}
            />
          </div>
        )}

        <DateField
          ref={endDateRef}
          label={PLAN_COPY.endDate}
          value={form.endDate}
          displayValue={form.endDate ? formatShortDate(form.endDate) : ''}
          emptyText={PLAN_COPY.noEndDate}
          min={minEndDate ?? undefined}
          onChange={(endDate) => update({ endDate })}
          clearLabel={PLAN_COPY.clearEndDate}
          hint={lastWeekHint}
          error={endDateError}
        />

        {preview.data ? (
          <p className="type-meta text-muted" data-start-note="">
            {startNote(preview.data.startsOn)}
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 flex flex-col gap-3 bg-card pt-[14px]">
        {failure ? (
          <InlineRetry onRetry={retry} retryLabel={PLAN_COPY.retry}>
            {failureText(failure)}
          </InlineRetry>
        ) : null}
        <Button type="submit" variant="primary" fullWidth busy={busy} busyLabel={PLAN_COPY.saving}>
          {PLAN_COPY.save}
        </Button>
      </div>
    </form>
  )
}
