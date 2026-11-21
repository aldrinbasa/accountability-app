import {
  changesNote,
  commitmentEditForm,
  editLabel,
  endCommitmentTitle,
  isCommitmentEditDirty,
  isCommitmentState,
  isMyPlanSection,
  isMyPlanState,
  MY_PLAN_COPY,
  myPlanIn,
  myPlanMeta,
  toUpdateCommitmentInput,
  updatedToast,
  type CommitmentDetails,
  type MyPlanItem,
} from '@/domain/my-plan'

const GYM: MyPlanItem = {
  commitmentId: 'c-gym',
  kind: 'commitment',
  section: 'current',
  state: 'active',
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  name: null,
  scheduleType: 'fixed_days',
  days: [5, 1, 3],
  target: null,
  endDate: null,
  deadline: null,
  startsOn: null,
  endsOn: null,
  canEdit: true,
  canDelete: false,
}

const RUN: MyPlanItem = {
  ...GYM,
  commitmentId: 'c-run',
  presetKey: 'run',
  activityName: 'Run',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
}

const TASK: MyPlanItem = {
  ...GYM,
  commitmentId: 't-garage',
  kind: 'task',
  state: 'open',
  presetKey: 'clean',
  activityName: 'Clean',
  name: 'Garage',
  scheduleType: null,
  days: null,
  deadline: '2026-11-22',
  canDelete: true,
}

const DETAILS: CommitmentDetails = {
  commitmentId: 'c-run',
  groupId: 'g1',
  presetKey: 'run',
  customName: null,
  activityName: 'Run',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
  endDate: null,
  changesFrom: '2026-11-23',
  minEndDate: '2026-11-29',
  state: 'active',
  canEdit: true,
}

describe('My plan state labels', () => {
  it('active and ended show the schedule meta', () => {
    expect(myPlanMeta(GYM)).toBe('Fixed days · Mon Wed Fri')
    expect(myPlanMeta(RUN)).toBe('3 times per week')
    expect(myPlanMeta({ ...RUN, target: 1 })).toBe('1 time per week')
    expect(myPlanMeta({ ...GYM, section: 'past', state: 'ended', canEdit: false })).toBe(
      'Fixed days · Mon Wed Fri',
    )
  })

  it('starts next week: "starts Mon 16 Nov" with the real date', () => {
    expect(myPlanMeta({ ...RUN, state: 'starts_next_week', startsOn: '2026-11-16' })).toBe(
      '3 times per week · starts Mon 16 Nov',
    )
  })

  it('a pending change: the new schedule "from Mon"', () => {
    expect(myPlanMeta({ ...RUN, state: 'pending_change', target: 4, startsOn: '2026-11-23' })).toBe(
      '4 times per week from Mon',
    )
    expect(
      myPlanMeta({ ...GYM, state: 'pending_change', days: [3, 1], startsOn: '2026-11-23' }),
    ).toBe('Fixed days · Mon Wed from Mon')
  })

  it('ending: "ends Sun" (or the weekday the end date falls on)', () => {
    expect(myPlanMeta({ ...GYM, state: 'ending', endsOn: '2026-11-22', canEdit: false })).toBe(
      'Fixed days · Mon Wed Fri · ends Sun',
    )
    expect(myPlanMeta({ ...RUN, state: 'ending', endsOn: '2026-11-19' })).toBe(
      '3 times per week · ends Thu',
    )
  })

  it('tasks: open "by Sun", past with its date', () => {
    expect(myPlanMeta(TASK)).toBe('Task · by Sun')
    expect(myPlanMeta({ ...TASK, section: 'past', state: 'past', deadline: '2026-11-17' })).toBe(
      'Task · Tue 17 Nov',
    )
  })

  it('splits rows into Current and Past in the server order', () => {
    const ended = { ...RUN, section: 'past' as const, state: 'ended' as const }
    expect(myPlanIn([GYM, ended, TASK], 'current')).toEqual([GYM, TASK])
    expect(myPlanIn([GYM, ended, TASK], 'past')).toEqual([ended])
  })

  it('knows the server states and sections', () => {
    expect(isCommitmentState('pending_change')).toBe(true)
    expect(isCommitmentState('open')).toBe(false)
    expect(isMyPlanState('open')).toBe(true)
    expect(isMyPlanState('paused')).toBe(false)
    expect(isMyPlanSection('past')).toBe(true)
    expect(isMyPlanSection('later')).toBe(false)
  })
})

describe('Commitment edit copy', () => {
  it('the start note, End confirm and lock note read as the story says', () => {
    expect(changesNote('2026-11-23')).toBe('Changes start Mon 23 Nov.')
    expect(endCommitmentTitle('Gym')).toBe('End Gym?')
    expect(MY_PLAN_COPY.endBody).toBe(
      'It stops after this Sunday. Past check-ins stay in the Feed.',
    )
    expect(MY_PLAN_COPY.lockNote).toBe(
      "Schedule type can't change while this habit is active. End it and add a new one.",
    )
    expect(MY_PLAN_COPY.wrappedUp).toBe("That's already wrapped up.")
    expect(editLabel('Gym')).toBe('Edit Gym')
  })

  it('the saved toast names the new schedule and the real Monday', () => {
    expect(updatedToast('Gym', { days: null, target: 4 }, '2026-11-23')).toBe(
      'Gym changes to 4 times per week from Mon 23 Nov.',
    )
    expect(updatedToast('Gym', { days: [5, 1, 3], target: null }, '2026-11-23')).toBe(
      'Gym changes to Mon Wed Fri from Mon 23 Nov.',
    )
  })
})

describe('Commitment edit rules', () => {
  it('starts from the latest version; unchanged is not dirty', () => {
    const form = commitmentEditForm(DETAILS, 3)
    expect(form).toEqual({ days: [], target: 3, endDate: null })
    expect(isCommitmentEditDirty(form, DETAILS)).toBe(false)
    expect(isCommitmentEditDirty({ ...form, target: 4 }, DETAILS)).toBe(true)
    expect(isCommitmentEditDirty({ ...form, endDate: '2026-12-06' }, DETAILS)).toBe(true)
  })

  it('fixed days compare as sets of days', () => {
    const fixed = { ...DETAILS, scheduleType: 'fixed_days' as const, days: [1, 3], target: null }
    const form = commitmentEditForm(fixed, 3)
    expect(isCommitmentEditDirty({ ...form, days: [3, 1] }, fixed)).toBe(false)
    expect(isCommitmentEditDirty({ ...form, days: [1] }, fixed)).toBe(true)
  })

  it('sends only the field of the commitment own type, days sorted', () => {
    expect(
      toUpdateCommitmentInput(DETAILS, { days: [2], target: 5, endDate: '2026-12-06' }),
    ).toEqual({ commitmentId: 'c-run', days: null, target: 5, endDate: '2026-12-06' })
    const fixed = { ...DETAILS, scheduleType: 'fixed_days' as const }
    expect(toUpdateCommitmentInput(fixed, { days: [5, 1], target: 5, endDate: null })).toEqual({
      commitmentId: 'c-run',
      days: [1, 5],
      target: null,
      endDate: null,
    })
  })
})
