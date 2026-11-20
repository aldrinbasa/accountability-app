import type { GroupActivity } from '@/domain/activities'
import {
  addedToast,
  deadlineOptions,
  deleteTaskTitle,
  endDateError,
  formatDayMonth,
  formatShortDate,
  hasErrors,
  hasTaskErrors,
  isCommitmentFormDirty,
  isTaskFormDirty,
  lastWeekNote,
  lockedNote,
  lockedTypeFor,
  otherScheduleType,
  selectionName,
  startNote,
  targetLabel,
  TASK_COPY,
  taskActivityName,
  taskAddedToast,
  toAddCommitmentInput,
  toAddTaskInput,
  validateCommitment,
  validateTask,
  WEEKDAYS,
  type CommitmentForm,
  type TaskDetails,
  type TaskForm,
} from '@/domain/plan'
import { TEST_PRESETS } from '@/test/fake-backend'

const GROUP_ROWS: GroupActivity[] = [
  {
    id: 'ga-gym',
    groupId: 'g1',
    presetKey: 'gym',
    customName: null,
    createdBy: 'user-2',
    lockedScheduleType: 'times_per_week',
  },
  {
    id: 'ga-pottery',
    groupId: 'g1',
    presetKey: null,
    customName: 'Pottery',
    createdBy: 'user-3',
    lockedScheduleType: 'fixed_days',
  },
  {
    id: 'ga-run',
    groupId: 'g1',
    presetKey: 'run',
    customName: null,
    createdBy: 'user-3',
    lockedScheduleType: null,
  },
]

const FORM: CommitmentForm = {
  activity: { kind: 'preset', presetKey: 'gym' },
  scheduleType: 'fixed_days',
  days: [5, 1, 3],
  target: 3,
  endDate: null,
}

describe('plan formatters', () => {
  it('formats server dates without the device zone moving the day', () => {
    expect(formatShortDate('2026-11-16')).toBe('Mon 16 Nov')
    expect(formatShortDate('2026-11-22')).toBe('Sun 22 Nov')
    expect(formatShortDate('2027-01-03')).toBe('Sun 3 Jan')
    expect(formatDayMonth('2026-11-16')).toBe('16 Nov')
    expect(formatShortDate('not a date')).toBe('not a date')
  })

  it('builds the story copy with the real dates and numbers', () => {
    expect(startNote('2026-11-16')).toBe(
      'Starts next Monday, 16 Nov. New commitments never change this week.',
    )
    expect(endDateError('2026-11-22')).toBe('End date has to be on or after Sun 22 Nov.')
    expect(lockedNote('Gym', 'times_per_week')).toBe('Gym is times per week in this group.')
    expect(lockedNote('Pottery', 'fixed_days')).toBe('Pottery is fixed days in this group.')
    expect(lastWeekNote(2, 3)).toBe('Last week is short: 2 times instead of 3.')
    expect(lastWeekNote(1, 4)).toBe('Last week is short: 1 time instead of 4.')
    expect(addedToast('Gym', '2026-11-16')).toBe('Gym added · starts Mon 16 Nov.')
    expect(targetLabel(4)).toBe('4 times per week')
  })

  it('lists the week Monday first with full day names', () => {
    expect(WEEKDAYS.map((d) => d.letter).join(' ')).toBe('M T W T F S S')
    expect(WEEKDAYS.map((d) => d.iso)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(WEEKDAYS[4]?.name).toBe('Friday')
  })
})

describe('locked schedule type', () => {
  it('reads the lock of a preset (from either chip) or a group activity; typed text is never locked', () => {
    expect(lockedTypeFor({ kind: 'preset', presetKey: 'gym' }, GROUP_ROWS)).toBe('times_per_week')
    expect(lockedTypeFor({ kind: 'group', groupActivityId: 'ga-pottery' }, GROUP_ROWS)).toBe(
      'fixed_days',
    )
    expect(lockedTypeFor({ kind: 'preset', presetKey: 'run' }, GROUP_ROWS)).toBeNull()
    expect(lockedTypeFor({ kind: 'preset', presetKey: 'yoga' }, GROUP_ROWS)).toBeNull()
    expect(lockedTypeFor({ kind: 'custom', name: 'Pottery' }, GROUP_ROWS)).toBeNull()
    expect(lockedTypeFor(null, GROUP_ROWS)).toBeNull()
  })

  it('a server lock against one type means the other', () => {
    expect(otherScheduleType('fixed_days')).toBe('times_per_week')
    expect(otherScheduleType('times_per_week')).toBe('fixed_days')
  })

  it('names the picked activity', () => {
    expect(selectionName({ kind: 'preset', presetKey: 'gym' }, TEST_PRESETS, GROUP_ROWS)).toBe(
      'Gym',
    )
    expect(
      selectionName({ kind: 'group', groupActivityId: 'ga-pottery' }, TEST_PRESETS, GROUP_ROWS),
    ).toBe('Pottery')
    expect(selectionName({ kind: 'custom', name: '  Kiln time ' }, TEST_PRESETS, GROUP_ROWS)).toBe(
      'Kiln time',
    )
    expect(selectionName(null, TEST_PRESETS, GROUP_ROWS)).toBe('')
  })
})

describe('Plan sheet validation', () => {
  it('nothing picked and fixed days with no day: both errors', () => {
    const errors = validateCommitment({ ...FORM, activity: null, days: [] }, '2026-11-29')
    expect(errors).toEqual({ activity: 'Pick an activity.', days: 'Pick at least one day.' })
    expect(hasErrors(errors)).toBe(true)
  })

  it('times per week needs no days', () => {
    expect(validateCommitment({ ...FORM, scheduleType: 'times_per_week', days: [] }, null)).toEqual(
      {},
    )
  })

  it('an end date before the earliest one names the real date; the earliest is fine', () => {
    expect(validateCommitment({ ...FORM, endDate: '2026-11-28' }, '2026-11-29')).toEqual({
      endDate: 'End date has to be on or after Sun 29 Nov.',
    })
    expect(validateCommitment({ ...FORM, endDate: '2026-11-29' }, '2026-11-29')).toEqual({})
    expect(hasErrors({})).toBe(false)
  })

  it('without the preview the end date is left to the server', () => {
    expect(validateCommitment({ ...FORM, endDate: '2026-01-01' }, null)).toEqual({})
  })

  it('sends only the fields of the schedule type, days sorted', () => {
    expect(
      toAddCommitmentInput('g1', { ...FORM, activity: { kind: 'preset', presetKey: 'gym' } }),
    ).toEqual({
      groupId: 'g1',
      activity: { kind: 'preset', presetKey: 'gym' },
      scheduleType: 'fixed_days',
      days: [1, 3, 5],
      target: null,
      endDate: null,
    })
    expect(
      toAddCommitmentInput('g1', {
        ...FORM,
        activity: { kind: 'preset', presetKey: 'gym' },
        scheduleType: 'times_per_week',
        endDate: '2026-12-04',
      }),
    ).toEqual({
      groupId: 'g1',
      activity: { kind: 'preset', presetKey: 'gym' },
      scheduleType: 'times_per_week',
      days: null,
      target: 3,
      endDate: '2026-12-04',
    })
  })

  it('a fresh form is clean; any input makes it dirty', () => {
    const fresh: CommitmentForm = {
      activity: null,
      scheduleType: 'fixed_days',
      days: [],
      target: 3,
      endDate: null,
    }
    expect(isCommitmentFormDirty(fresh)).toBe(false)
    expect(isCommitmentFormDirty({ ...fresh, days: [1] })).toBe(true)
    expect(isCommitmentFormDirty({ ...fresh, target: 4 })).toBe(true)
    expect(isCommitmentFormDirty({ ...fresh, scheduleType: 'times_per_week' })).toBe(true)
    expect(isCommitmentFormDirty({ ...fresh, endDate: '2026-12-01' })).toBe(true)
  })
})

describe('tasks (Story 2.4)', () => {
  it('deadline options run from the server today to the server Sunday, today labeled Today', () => {
    const options = deadlineOptions('2026-11-18', '2026-11-22')
    expect(options.map((o) => [o.date, o.iso, o.letter, o.name, o.today])).toEqual([
      ['2026-11-18', 3, 'W', 'Today', true],
      ['2026-11-19', 4, 'T', 'Thursday', false],
      ['2026-11-20', 5, 'F', 'Friday', false],
      ['2026-11-21', 6, 'S', 'Saturday', false],
      ['2026-11-22', 7, 'S', 'Sunday', false],
    ])
  })

  it('on a Sunday only Today is offered; a Monday offers the whole week', () => {
    expect(deadlineOptions('2026-11-22', '2026-11-22').map((o) => o.name)).toEqual(['Today'])
    expect(deadlineOptions('2026-11-16', '2026-11-22')).toHaveLength(7)
    // Across a month end.
    expect(deadlineOptions('2026-11-30', '2026-12-06').map((o) => o.date)).toEqual([
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
    ])
    expect(deadlineOptions('2026-11-23', '2026-11-22')).toEqual([])
    expect(deadlineOptions('nope', '2026-11-22')).toEqual([])
  })

  it('validation: "Pick an activity." and "Give the task a short name."', () => {
    const fresh: TaskForm = { activity: null, name: '', deadline: null }
    expect(validateTask(fresh)).toEqual({
      activity: 'Pick an activity.',
      name: 'Give the task a short name.',
    })
    expect(hasTaskErrors(validateTask(fresh))).toBe(true)
    const valid: TaskForm = {
      activity: { kind: 'preset', presetKey: 'groceries' },
      name: '  Grocery run ',
      deadline: null,
    }
    expect(validateTask(valid)).toEqual({})
    expect(hasTaskErrors({})).toBe(false)
    expect(validateTask({ ...valid, name: '   ' }).name).toBe('Give the task a short name.')
    expect(validateTask({ ...valid, name: 'x'.repeat(40) }).name).toBeUndefined()
    expect(validateTask({ ...valid, name: 'x'.repeat(41) }).name).toBe(
      'Give the task a short name.',
    )
    expect(validateTask({ ...valid, activity: { kind: 'custom', name: ' ' } }).activity).toBe(
      'Pick an activity.',
    )
  })

  it('copy: the added toast, the delete title and the start note', () => {
    expect(taskAddedToast('Grocery run')).toBe('Grocery run added · counts this week.')
    expect(deleteTaskTitle('Grocery run')).toBe('Delete Grocery run?')
    expect(TASK_COPY.deleteBody).toBe("It comes off this week's plan.")
    expect(TASK_COPY.startNote).toBe('Counts this week, starting now.')
    expect(TASK_COPY.tooLateToDelete).toBe('Too late to delete. Its day has started.')
  })

  it('dirty once anything differs from a fresh form (Sunday is the default deadline)', () => {
    const fresh: TaskForm = { activity: null, name: '', deadline: null }
    expect(isTaskFormDirty(fresh, '2026-11-22')).toBe(false)
    expect(isTaskFormDirty({ ...fresh, deadline: '2026-11-22' }, '2026-11-22')).toBe(false)
    expect(isTaskFormDirty({ ...fresh, deadline: '2026-11-20' }, '2026-11-22')).toBe(true)
    expect(isTaskFormDirty({ ...fresh, name: 'G' }, '2026-11-22')).toBe(true)
    expect(
      isTaskFormDirty({ ...fresh, activity: { kind: 'preset', presetKey: 'run' } }, null),
    ).toBe(true)
  })

  it('the add_task input trims the name', () => {
    expect(
      toAddTaskInput(
        'g1',
        { kind: 'preset', presetKey: 'groceries' },
        ' Grocery run ',
        '2026-11-22',
      ),
    ).toEqual({
      groupId: 'g1',
      activity: { kind: 'preset', presetKey: 'groceries' },
      name: 'Grocery run',
      deadline: '2026-11-22',
    })
  })

  it("a task's activity name: the custom name, else the preset's", () => {
    const task: TaskDetails = {
      commitmentId: 'c1',
      groupId: 'g1',
      presetKey: 'groceries',
      customName: null,
      name: 'Grocery run',
      deadline: '2026-11-22',
      canDelete: true,
      canRename: true,
    }
    expect(taskActivityName(task, TEST_PRESETS)).toBe('Groceries')
    expect(
      taskActivityName({ ...task, presetKey: null, customName: 'Errands' }, TEST_PRESETS),
    ).toBe('Errands')
  })
})
