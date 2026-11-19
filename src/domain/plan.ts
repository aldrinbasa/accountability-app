import {
  SCHEDULE_TYPE_LABEL,
  type ActivitySelection,
  type GroupActivity,
  type PresetActivity,
  type ScheduleType,
} from '@/domain/activities'

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
  { iso: 1, letter: 'M', name: 'Monday' },
  { iso: 2, letter: 'T', name: 'Tuesday' },
  { iso: 3, letter: 'W', name: 'Wednesday' },
  { iso: 4, letter: 'T', name: 'Thursday' },
  { iso: 5, letter: 'F', name: 'Friday' },
  { iso: 6, letter: 'S', name: 'Saturday' },
  { iso: 7, letter: 'S', name: 'Sunday' },
]

/** Times per week: 1 to 7, default 3 (Stepper). */
export const TARGET_MIN = 1
export const TARGET_MAX = 7
export const DEFAULT_TARGET = 3

/** The schedule type the Plan sheet starts on. */
export const DEFAULT_SCHEDULE_TYPE: ScheduleType = 'fixed_days'

/** Copy for the Plan sheet and Add button (Story 2.2 ACs). */
export const PLAN_COPY = {
  title: 'Add a commitment or task',
  addLabel: 'Add a commitment or task',
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * A server date (`YYYY-MM-DD`) as a calendar date. Read in UTC, so the device zone never moves it
 * to another day; this is formatting only, never week math.
 */
function calendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return Number.isNaN(date.getTime()) ? null : date
}

/** "16 Nov". */
export function formatDayMonth(value: string): string {
  const date = calendarDate(value)
  if (!date) return value
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** "Mon 16 Nov". */
export function formatShortDate(value: string): string {
  const date = calendarDate(value)
  if (!date) return value
  return `${DAY_SHORT[date.getUTCDay()]} ${formatDayMonth(value)}`
}

/** "Starts next Monday, 16 Nov. New commitments never change this week." */
export function startNote(startsOn: string): string {
  return `Starts next Monday, ${formatDayMonth(startsOn)}. New commitments never change this week.`
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
