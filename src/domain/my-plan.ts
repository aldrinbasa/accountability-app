import type { ScheduleType } from '@/domain/activities'
import { ERROR_COPY } from '@/domain/error-codes'
import { formatShortDate } from '@/domain/plan'
import { daysText, shortDayName, timesPerWeekText, TODAY_COPY } from '@/domain/today'

/** A commitment's state from `get_my_plan` / `get_commitment`, computed by the server (AD-11). */
export type CommitmentState = 'active' | 'starts_next_week' | 'pending_change' | 'ending' | 'ended'

/** A task's state from `get_my_plan`: its deadline is today or later (open), or has passed. */
export type TaskState = 'open' | 'past'

export type MyPlanState = CommitmentState | TaskState

/** Where `get_my_plan` placed a row: Current, or Past (ended commitments, passed tasks). */
export type MyPlanSection = 'current' | 'past'

export const COMMITMENT_STATES: readonly CommitmentState[] = [
  'active',
  'starts_next_week',
  'pending_change',
  'ending',
  'ended',
]

const TASK_STATES: readonly TaskState[] = ['open', 'past']

export function isCommitmentState(value: unknown): value is CommitmentState {
  return typeof value === 'string' && (COMMITMENT_STATES as readonly string[]).includes(value)
}

export function isMyPlanState(value: unknown): value is MyPlanState {
  return (
    isCommitmentState(value) ||
    (typeof value === 'string' && (TASK_STATES as readonly string[]).includes(value))
  )
}

export function isMyPlanSection(value: unknown): value is MyPlanSection {
  return value === 'current' || value === 'past'
}

/**
 * One `get_my_plan` row: a commitment or task of the member's in a group, with its section, state
 * and dates from the server, in display order. The client only formats.
 */
export interface MyPlanItem {
  commitmentId: string
  kind: 'commitment' | 'task'
  section: MyPlanSection
  state: MyPlanState
  /** The activity: a preset key, or a custom name (exactly one is set). */
  presetKey: string | null
  customName: string | null
  /** The activity's display name. */
  activityName: string
  /** Tasks only. */
  name: string | null
  /** Commitments only. */
  scheduleType: ScheduleType | null
  /**
   * The version the row shows: the new one for a pending change or a commitment that starts next
   * week, the latest for an ended one, else the one in effect this week.
   */
  days: number[] | null
  target: number | null
  endDate: string | null
  /** Tasks only, `YYYY-MM-DD`. */
  deadline: string | null
  /** `starts_next_week`: the first Monday; `pending_change`: the Monday the change starts. */
  startsOn: string | null
  /** `ending`: the last day with a session. */
  endsOn: string | null
  /** The server's rule: a commitment `update_commitment` accepts, or an open task. */
  canEdit: boolean
  /** Tasks only: `delete_task`'s rule at read time. */
  canDelete: boolean
}

/** `get_commitment`: one of the member's own commitments, for the Plan sheet's edit mode. */
export interface CommitmentDetails {
  commitmentId: string
  groupId: string
  presetKey: string | null
  customName: string | null
  activityName: string
  scheduleType: ScheduleType
  /** The latest version (a pending change when there is one). */
  days: number[] | null
  target: number | null
  endDate: string | null
  /** The Monday an edit takes effect (`YYYY-MM-DD`). */
  changesFrom: string
  /** The earliest end date: the Sunday of `changesFrom`'s week. */
  minEndDate: string
  state: CommitmentState
  /** The server's rule: not ended, and not ended by the member. */
  canEdit: boolean
}

/** `update_commitment` input: exactly the field of the commitment's own schedule type is set. */
export interface UpdateCommitmentInput {
  commitmentId: string
  /** Fixed days: ISO weekdays, sorted. Null for times per week. */
  days: number[] | null
  /** Times per week: 1 to 7. Null for fixed days. */
  target: number | null
  /** `YYYY-MM-DD`, or null for no end date. */
  endDate: string | null
}

/** `update_commitment` result. */
export interface UpdateCommitmentResult {
  /** The Monday the change takes effect. */
  changesFrom: string
}

/** Copy for My plan, commitment edit mode and the End confirm (Story 2.6 ACs). */
export const MY_PLAN_COPY = {
  title: 'My plan',
  current: 'Current',
  past: 'Past',
  editTitle: 'Edit habit',
  lockNote: "Schedule type can't change while this habit is active. End it and add a new one.",
  endCommitment: 'End habit',
  endBody: 'It stops after this Sunday. Past check-ins stay in the Feed.',
  end: 'End',
  ending: 'Ending…',
  wrappedUp: ERROR_COPY.commitment_ended,
  loadFailed: "Couldn't load this habit. Tap Retry.",
  emptyLine: TODAY_COPY.noPlanLine,
} as const

/** "Changes start Mon 23 Nov." */
export function changesNote(changesFrom: string): string {
  return `Changes start ${formatShortDate(changesFrom)}.`
}

/** "End Gym?" */
export function endCommitmentTitle(activityName: string): string {
  return `End ${activityName}?`
}

/** "Edit Gym": the accessible name of a My plan row's Edit button. */
export function editLabel(title: string): string {
  return `${TODAY_COPY.edit} ${title}`
}

/** "Fixed days · Mon Wed Fri" or "3 times per week". */
export function scheduleText(
  scheduleType: ScheduleType | null,
  days: readonly number[] | null,
  target: number | null,
): string {
  return scheduleType === 'fixed_days'
    ? `${TODAY_COPY.fixedDays} · ${daysText(days ?? [])}`
    : timesPerWeekText(target ?? 0)
}

/**
 * The meta line under a My plan row's title, from the server's state and dates:
 * - active / ended: the schedule ("Fixed days · Mon Wed Fri", "3 times per week")
 * - starts next week: "3 times per week · starts Mon 23 Nov"
 * - pending change: the new schedule "from Mon" ("4 times per week from Mon")
 * - ending: "Fixed days · Mon Wed Fri · ends Sun"
 * - an open task: "Task · by Sun"; a past task: "Task · Sun 22 Nov"
 */
export function myPlanMeta(item: MyPlanItem): string {
  if (item.kind === 'task') {
    if (!item.deadline) return TODAY_COPY.task
    return item.state === 'open'
      ? `${TODAY_COPY.task} · by ${shortDayName(item.deadline)}`
      : `${TODAY_COPY.task} · ${formatShortDate(item.deadline)}`
  }
  const schedule = scheduleText(item.scheduleType, item.days, item.target)
  switch (item.state) {
    case 'starts_next_week':
      return item.startsOn ? `${schedule} · starts ${formatShortDate(item.startsOn)}` : schedule
    case 'pending_change':
      return item.startsOn ? `${schedule} from ${shortDayName(item.startsOn)}` : schedule
    case 'ending':
      return item.endsOn ? `${schedule} · ends ${shortDayName(item.endsOn)}` : schedule
    default:
      return schedule
  }
}

/**
 * The toast after an edit: "Gym changes to 4 times per week from Mon 23 Nov." or, for fixed days,
 * "Gym changes to Mon Wed Fri from Mon 23 Nov."
 */
export function updatedToast(
  activityName: string,
  input: Pick<UpdateCommitmentInput, 'days' | 'target'>,
  changesFrom: string,
): string {
  const schedule = input.days !== null ? daysText(input.days) : timesPerWeekText(input.target ?? 0)
  return `${activityName} changes to ${schedule} from ${formatShortDate(changesFrom)}.`
}

/** The rows of one section, in the server's order. */
export function myPlanIn(items: readonly MyPlanItem[], section: MyPlanSection): MyPlanItem[] {
  return items.filter((item) => item.section === section)
}

/** The Plan sheet's commitment edit inputs. */
export interface CommitmentEditForm {
  days: readonly number[]
  target: number
  endDate: string | null
}

/** The edit form a commitment starts from (its latest version). */
export function commitmentEditForm(details: CommitmentDetails, defaultTarget: number) {
  return {
    days: details.days ?? [],
    target: details.target ?? defaultTarget,
    endDate: details.endDate,
  } satisfies CommitmentEditForm
}

/** Whether the edit form differs from what the commitment already is. */
export function isCommitmentEditDirty(
  form: CommitmentEditForm,
  details: CommitmentDetails,
): boolean {
  if (form.endDate !== details.endDate) return true
  if (details.scheduleType === 'fixed_days') {
    return daysText(form.days) !== daysText(details.days ?? [])
  }
  return form.target !== details.target
}

/** The `update_commitment` input for the form (days sorted; only the field of the type). */
export function toUpdateCommitmentInput(
  details: CommitmentDetails,
  form: CommitmentEditForm,
): UpdateCommitmentInput {
  const fixed = details.scheduleType === 'fixed_days'
  return {
    commitmentId: details.commitmentId,
    days: fixed ? [...form.days].sort((a, b) => a - b) : null,
    target: fixed ? null : form.target,
    endDate: form.endDate,
  }
}
