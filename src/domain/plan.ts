import {
  SCHEDULE_TYPE_LABEL,
  type ActivitySelection,
  type GroupActivity,
  type PresetActivity,
  type ScheduleType,
} from '@/domain/activities'
import { DAY_LONG, DAY_SHORT, MONTH_SHORT, parseIsoDate } from '@/domain/dates'

/**
 * `plan_preview`: the dates the Plan sheet shows, computed by the server (AD-11). Dates are
 * `YYYY-MM-DD` strings in the member's zone; the client only formats them.
 */
export interface PlanPreview {
  /** The member's local today. */
  memberToday: string
  /** Monday of the member's current week. */
  weekStart: string
  /** Sunday of the member's current week. */
  weekEnd: string
  /** Next Monday: a new commitment's first week. */
  startsOn: string
  /** The earliest end date: the Sunday of the first week. */
  minEndDate: string
  /** The pro-rated target of a last week the end date cuts short, else null. */
  lastWeekTarget: number | null
}

/** `add_commitment` input. Exactly the fields that apply to the schedule type are set. */
export interface AddCommitmentInput {
  groupId: string
  activity: Exclude<ActivitySelection, null>
  scheduleType: ScheduleType
  /** Fixed days: ISO weekdays (Monday = 1). Null for times per week. */
  days: number[] | null
  /** Times per week: 1 to 7. Null for fixed days. */
  target: number | null
  /** `YYYY-MM-DD`, or null for no end date. */
  endDate: string | null
}

/** `add_commitment` result. */
export interface AddCommitmentResult {
  commitmentId: string
  /** The first Monday (`YYYY-MM-DD`). */
  startsOn: string
}

/** The seven days of the Weekday selector, Monday first (ISO numbering). */
export const WEEKDAYS: readonly { iso: number; letter: string; name: string }[] = [
  1, 2, 3, 4, 5, 6, 7,
].map((iso) => {
  const name = DAY_LONG[iso % 7]
  return { iso, letter: name.charAt(0), name }
})

/** Times per week: 1 to 7, default 3 (Stepper). */
export const TARGET_MIN = 1
export const TARGET_MAX = 7
export const DEFAULT_TARGET = 3

/** The schedule type the Plan sheet starts on. */
export const DEFAULT_SCHEDULE_TYPE: ScheduleType = 'fixed_days'

/** Copy for the Plan sheet and Add button (Story 2.2 ACs). */
export const PLAN_COPY = {
  title: 'Add a habit or task',
  addLabel: 'Add a habit or task',
  addText: 'Add',
  activity: 'Activity',
  schedule: 'Schedule',
  days: 'Days',
  timesPerWeek: 'Times per week',
  endDate: 'End date (optional)',
  noEndDate: 'No end date',
  clearEndDate: 'Clear end date',
  fewer: 'Fewer',
  more: 'More',
  unit: 'times per week',
  save: 'Save',
  saving: 'Saving…',
  retry: 'Retry',
  pickActivity: 'Pick an activity.',
  pickDay: 'Pick at least one day.',
  offline: "You're offline. Plans need a signal to save.",
  failed: "Couldn't save your plan. Tap Retry.",
} as const

/** Segmented switch labels for the schedule type. */
export const SCHEDULE_TYPE_OPTIONS: readonly { value: ScheduleType; label: string }[] = [
  { value: 'fixed_days', label: 'Fixed days' },
  { value: 'times_per_week', label: 'Times per week' },
]

/** "16 Nov". */
export function formatDayMonth(value: string): string {
  const date = parseIsoDate(value)
  if (!date) return value
  return `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]}`
}

/** "Mon 16 Nov". */
export function formatShortDate(value: string): string {
  const date = parseIsoDate(value)
  if (!date) return value
  return `${DAY_SHORT[date.getUTCDay()]} ${formatDayMonth(value)}`
}

/** "Starts next Monday, 16 Nov. New habits never change this week." */
export function startNote(startsOn: string): string {
  return `Starts next Monday, ${formatDayMonth(startsOn)}. New habits never change this week.`
}

/** "End date has to be on or after Sun 22 Nov." */
export function endDateError(minEndDate: string): string {
  return `End date has to be on or after ${formatShortDate(minEndDate)}.`
}

/** "Gym is times per week in this group." */
export function lockedNote(activityName: string, type: ScheduleType): string {
  return `${activityName} is ${SCHEDULE_TYPE_LABEL[type]} in this group.`
}

function times(count: number): string {
  return count === 1 ? '1 time' : `${count} times`
}

/** "Last week is short: 2 times instead of 3." */
export function lastWeekNote(lastWeekTarget: number, target: number): string {
  return `Last week is short: ${times(lastWeekTarget)} instead of ${target}.`
}

/** The Stepper's announced value: "4 times per week". */
export function targetLabel(target: number): string {
  return `${target} ${PLAN_COPY.unit}`
}

/** "Gym added · starts Mon 16 Nov." */
export function addedToast(activityName: string, startsOn: string): string {
  return `${activityName} added · starts ${formatShortDate(startsOn)}.`
}

/** The other schedule type. Only two exist, so a lock against one means the other. */
export function otherScheduleType(type: ScheduleType): ScheduleType {
  return type === 'fixed_days' ? 'times_per_week' : 'fixed_days'
}

/** The display name of a picked activity (toast, lock note): preset name, custom name or typed text. */
export function selectionName(
  selection: ActivitySelection,
  presets: readonly PresetActivity[],
  groupActivities: readonly GroupActivity[],
): string {
  if (selection === null) return ''
  switch (selection.kind) {
    case 'preset':
      return presets.find((p) => p.key === selection.presetKey)?.name ?? selection.presetKey
    case 'group': {
      const row = groupActivities.find((r) => r.id === selection.groupActivityId)
      if (!row) return ''
      if (row.customName !== null) return row.customName
      return presets.find((p) => p.key === row.presetKey)?.name ?? ''
    }
    case 'custom':
      return selection.name.trim()
  }
}

/**
 * The schedule type the group has locked for a picked activity (`locked_schedule_type`), or null.
 * Free-typed text is a new activity of the member's own (FR-10), so it is never locked here; the
 * server still answers `schedule_type_locked` if it turns out to be.
 */
export function lockedTypeFor(
  selection: ActivitySelection,
  groupActivities: readonly GroupActivity[],
): ScheduleType | null {
  if (selection === null) return null
  switch (selection.kind) {
    case 'preset':
      return (
        groupActivities.find((r) => r.presetKey === selection.presetKey)?.lockedScheduleType ?? null
      )
    case 'group':
      return (
        groupActivities.find((r) => r.id === selection.groupActivityId)?.lockedScheduleType ?? null
      )
    case 'custom':
      return null
  }
}

/** A key that identifies a picked activity, so a server lock can be tied to it. */
export function selectionKey(selection: ActivitySelection): string | null {
  if (selection === null) return null
  switch (selection.kind) {
    case 'preset':
      return `preset:${selection.presetKey}`
    case 'group':
      return `group:${selection.groupActivityId}`
    case 'custom':
      return `custom:${selection.name.trim().toLowerCase()}`
  }
}

/** The Plan sheet's commitment inputs. */
export interface CommitmentForm {
  activity: ActivitySelection
  scheduleType: ScheduleType
  days: readonly number[]
  target: number
  endDate: string | null
}

export interface CommitmentErrors {
  activity?: string
  days?: string
  endDate?: string
}

/** The field order errors are focused in: the first one present gets focus. */
export const COMMITMENT_ERROR_ORDER: readonly (keyof CommitmentErrors)[] = [
  'activity',
  'days',
  'endDate',
]

/**
 * Field errors for Save. `minEndDate` comes from `plan_preview`; without it the end date is left to
 * the server. Dates compare as `YYYY-MM-DD` strings (no week math).
 */
export function validateCommitment(
  form: CommitmentForm,
  minEndDate: string | null,
): CommitmentErrors {
  const errors: CommitmentErrors = {}
  if (form.activity === null || selectionKey(form.activity) === 'custom:') {
    errors.activity = PLAN_COPY.pickActivity
  }
  if (form.scheduleType === 'fixed_days' && form.days.length === 0) {
    errors.days = PLAN_COPY.pickDay
  }
  if (form.endDate !== null && minEndDate !== null && form.endDate < minEndDate) {
    errors.endDate = endDateError(minEndDate)
  }
  return errors
}

export function hasErrors(errors: CommitmentErrors): boolean {
  return COMMITMENT_ERROR_ORDER.some((key) => errors[key] !== undefined)
}

/** The `add_commitment` input for a valid form (days sorted; only the fields of the type). */
export function toAddCommitmentInput(
  groupId: string,
  form: CommitmentForm & { activity: Exclude<ActivitySelection, null> },
): AddCommitmentInput {
  const fixed = form.scheduleType === 'fixed_days'
  return {
    groupId,
    activity: form.activity,
    scheduleType: form.scheduleType,
    days: fixed ? [...form.days].sort((a, b) => a - b) : null,
    target: fixed ? null : form.target,
    endDate: form.endDate,
  }
}

/** Whether the form differs from a fresh sheet (closing then asks "Discard this?"). */
export function isCommitmentFormDirty(form: CommitmentForm): boolean {
  return (
    form.activity !== null ||
    form.scheduleType !== DEFAULT_SCHEDULE_TYPE ||
    form.days.length > 0 ||
    form.target !== DEFAULT_TARGET ||
    form.endDate !== null
  )
}

// ===== Tasks (Story 2.4) =====

/** What the Plan sheet adds: a weekly commitment or a one-off task. */
export type PlanKind = 'commitment' | 'task'

/** The unlabeled Habit / Task switch on top of the sheet (Habit pre-selected; kind stays `commitment`). */
export const PLAN_KIND_OPTIONS: readonly { value: PlanKind; label: string }[] = [
  { value: 'commitment', label: 'Habit' },
  { value: 'task', label: 'Task' },
]

/** A task name: 1 to 40 characters once trimmed (same rule as `add_task` / `rename_task`). */
export const TASK_NAME_MAX = 40

/** Copy for Task mode, task edit mode and the delete confirm (Story 2.4 ACs). */
export const TASK_COPY = {
  /** The switch has no visible label; this is only its accessible name. */
  kindLabel: 'Habit or task',
  /** The Plan sheet's title in task edit mode. */
  editTitle: 'Edit task',
  name: 'Name',
  namePlaceholder: 'Grocery run',
  deadline: 'Deadline',
  today: 'Today',
  pickName: 'Give the task a short name.',
  startNote: 'Counts this week, starting now.',
  deleteTask: 'Delete task',
  deleteBody: "It comes off this week's plan.",
  tooLateToDelete: 'Too late to delete. Its day has started.',
  deleting: 'Deleting…',
  loadFailed: "Couldn't load this task. Tap Retry.",
} as const

/** `add_task` input. */
export interface AddTaskInput {
  groupId: string
  activity: Exclude<ActivitySelection, null>
  /** Trimmed, 1 to 40 characters. */
  name: string
  /** `YYYY-MM-DD`: from the member's today to the Sunday of their current week. */
  deadline: string
}

/** `add_task` result. */
export interface AddTaskResult {
  commitmentId: string
}

/** `get_task`: one of the member's own tasks, for the Plan sheet's edit mode. */
export interface TaskDetails {
  commitmentId: string
  groupId: string
  /** The activity: a preset key, or a custom name (exactly one is set). */
  presetKey: string | null
  customName: string | null
  name: string
  /** `YYYY-MM-DD`. */
  deadline: string
  /** The server's rule: true before the deadline day starts. */
  canDelete: boolean
  /** The server's rule: true until the task's session ends. */
  canRename: boolean
}

/** "Grocery run added · counts this week." */
export function taskAddedToast(name: string): string {
  return `${name} added · counts this week.`
}

/** "Delete Grocery run?" */
export function deleteTaskTitle(name: string): string {
  return `Delete ${name}?`
}

/** The display name of a task's activity: its custom name, else the preset's name. */
export function taskActivityName(task: TaskDetails, presets: readonly PresetActivity[]): string {
  if (task.customName !== null) return task.customName
  if (task.presetKey === null) return ''
  return presets.find((p) => p.key === task.presetKey)?.name ?? task.presetKey
}

/** One circle of the deadline selector: a day of the member's current week from today on. */
export interface DeadlineOption {
  /** `YYYY-MM-DD`. */
  date: string
  /** ISO weekday (Monday = 1). */
  iso: number
  letter: string
  /** The accessible name: "Today" for today, else the full day name. */
  name: string
  today: boolean
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The deadline choices: every calendar day from the server's `memberToday` to its `weekEnd` (both
 * from `plan_preview`), today labeled "Today". On a Sunday only today is left. The week's bounds come
 * from the server; this only lists the days between them.
 */
export function deadlineOptions(memberToday: string, weekEnd: string): DeadlineOption[] {
  const start = parseIsoDate(memberToday)
  if (!start || parseIsoDate(weekEnd) === null || weekEnd < memberToday) return []
  const options: DeadlineOption[] = []
  // A week has at most 7 days left; the cap guards against bad input.
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(start.getTime())
    day.setUTCDate(start.getUTCDate() + offset)
    const date = isoDate(day)
    if (date > weekEnd) break
    const iso = day.getUTCDay() === 0 ? 7 : day.getUTCDay()
    const weekday = WEEKDAYS[iso - 1]
    if (!weekday) break
    options.push({
      date,
      iso,
      letter: weekday.letter,
      name: offset === 0 ? TASK_COPY.today : weekday.name,
      today: offset === 0,
    })
  }
  return options
}

/** The Plan sheet's task inputs. `deadline` null means the default, the Sunday of this week. */
export interface TaskForm {
  activity: ActivitySelection
  name: string
  deadline: string | null
}

export interface TaskErrors {
  activity?: string
  name?: string
}

/** The field order task errors are focused in. */
export const TASK_ERROR_ORDER: readonly (keyof TaskErrors)[] = ['activity', 'name']

/** The name Field error, or undefined when the trimmed name is 1 to 40 characters. */
export function taskNameError(name: string): string | undefined {
  const trimmed = name.trim()
  return trimmed.length === 0 || trimmed.length > TASK_NAME_MAX ? TASK_COPY.pickName : undefined
}

/** Field errors for a task Save. The deadline is a choice from the server's days, never typed. */
export function validateTask(form: TaskForm): TaskErrors {
  const errors: TaskErrors = {}
  if (form.activity === null || selectionKey(form.activity) === 'custom:') {
    errors.activity = PLAN_COPY.pickActivity
  }
  const nameError = taskNameError(form.name)
  if (nameError) errors.name = nameError
  return errors
}

export function hasTaskErrors(errors: TaskErrors): boolean {
  return TASK_ERROR_ORDER.some((key) => errors[key] !== undefined)
}

/** Whether a task form differs from a fresh one (closing then asks "Discard this?"). */
export function isTaskFormDirty(form: TaskForm, defaultDeadline: string | null): boolean {
  return (
    form.activity !== null ||
    form.name !== '' ||
    (form.deadline !== null && form.deadline !== defaultDeadline)
  )
}

/** The `add_task` input for a valid form (name trimmed). */
export function toAddTaskInput(
  groupId: string,
  activity: Exclude<ActivitySelection, null>,
  name: string,
  deadline: string,
): AddTaskInput {
  return { groupId, activity, name: name.trim(), deadline }
}
