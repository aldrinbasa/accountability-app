import {
  daysText,
  isTodaySection,
  itemsIn,
  itemTitle,
  leftThisWeek,
  overflowLabel,
  ringLabel,
  scheduleMeta,
  shortDayName,
  showsRing,
  startsHeading,
  timesPerWeekText,
  todayDayName,
  todayEmptyState,
  weekLine,
  type TodayItem,
} from '@/domain/today'

const BASE: TodayItem = {
  commitmentId: 'c1',
  kind: 'commitment',
  section: 'due_today',
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  name: null,
  scheduleType: 'fixed_days',
  days: [1, 3, 5],
  target: 3,
  counted: 0,
  deadline: null,
  startsOn: null,
  canDelete: false,
}

const FIXED = BASE
const TIMES: TodayItem = {
  ...BASE,
  commitmentId: 'c2',
  section: 'this_week',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
}
const TASK: TodayItem = {
  ...BASE,
  commitmentId: 't1',
  kind: 'task',
  section: 'this_week',
  presetKey: 'groceries',
  activityName: 'Groceries',
  name: 'Grocery run',
  scheduleType: null,
  days: null,
  target: 1,
  deadline: '2026-11-22',
  canDelete: true,
}
const NEXT: TodayItem = {
  ...BASE,
  commitmentId: 'c3',
  section: 'starts_next_week',
  presetKey: 'read',
  activityName: 'Read',
  scheduleType: 'times_per_week',
  days: null,
  target: 4,
  startsOn: '2026-11-16',
}

describe('Today formatters', () => {
  it('schedule meta: fixed days, times per week with what is left, tasks and next week', () => {
    expect(scheduleMeta(FIXED)).toBe('Fixed days · Mon Wed Fri')
    expect(scheduleMeta(TIMES)).toBe('3 times per week · 3 to go')
    expect(scheduleMeta({ ...TIMES, counted: 2 })).toBe('3 times per week · 1 to go')
    expect(scheduleMeta({ ...TIMES, counted: 3 })).toBe('3 times per week')
    expect(scheduleMeta({ ...TIMES, target: 1 })).toBe('1 time per week · 1 to go')
    expect(scheduleMeta(TASK)).toBe('Task · by Sun')
    expect(scheduleMeta({ ...TASK, deadline: '2026-11-20' })).toBe('Task · by Fri')
    expect(scheduleMeta(NEXT)).toBe('4 times per week · starts Mon 16 Nov')
    expect(scheduleMeta({ ...NEXT, scheduleType: 'fixed_days', days: [2, 4], target: null })).toBe(
      'Fixed days · Tue Thu · starts Mon 16 Nov',
    )
  })

  it('days and day names come from the server dates, Monday first', () => {
    expect(daysText([5, 1, 3])).toBe('Mon Wed Fri')
    expect(daysText([7])).toBe('Sun')
    expect(shortDayName('2026-11-16')).toBe('Mon')
    expect(shortDayName('2026-11-22')).toBe('Sun')
    expect(timesPerWeekText(4)).toBe('4 times per week')
  })

  it('the heading is the member-local day from the server, else the device day', () => {
    expect(todayDayName('2026-11-20')).toBe('Friday')
    expect(todayDayName('2026-11-22')).toBe('Sunday')
    expect(todayDayName(undefined, new Date(2026, 10, 18, 12))).toBe('Wednesday')
    expect(todayDayName('nonsense', new Date(2026, 10, 18, 12))).toBe('Wednesday')
  })

  it('titles, ring and overflow labels', () => {
    expect(itemTitle(FIXED)).toBe('Gym')
    expect(itemTitle(TASK)).toBe('Grocery run')
    expect(ringLabel('Gym', 0, 3)).toBe('Gym, 0 of 3 this week')
    expect(overflowLabel('Grocery run')).toBe('More actions for Grocery run')
    expect(showsRing(TIMES)).toBe(true)
    expect(showsRing(FIXED)).toBe(false)
    expect(showsRing(TASK)).toBe(false)
    expect(showsRing(NEXT)).toBe(false)
  })

  it('section heading counts and the week line (hidden with nothing planned)', () => {
    expect(leftThisWeek(3)).toBe('· 3 left this week')
    expect(startsHeading('2026-11-23')).toBe('· starts Mon')
    const summary = {
      memberToday: '2026-11-20',
      weekStart: '2026-11-16',
      weekNumber: 4,
      planned: 9,
      done: 6,
      left: 3,
      hasPlan: true,
    }
    expect(weekLine(summary)).toBe('Week 4 of the grind · 6 of 9 done')
    expect(weekLine({ ...summary, planned: 0, done: 0, left: 0 })).toBeNull()
  })

  it('empty-state selection', () => {
    expect(todayEmptyState([], false, false)).toBe('no_plan')
    expect(todayEmptyState([], true, false)).toBeNull()
    expect(todayEmptyState([TIMES, TASK], false, true)).toBe('nothing_due')
    expect(todayEmptyState([NEXT], true, true)).toBe('nothing_due')
    expect(todayEmptyState([FIXED, TIMES], false, true)).toBeNull()
  })

  it('a plan with nothing listed today is "nothing due", not "no plan" (retro F1)', () => {
    // Fixed days Mon Wed Fri on a Tuesday: no rows, but the member has a plan.
    expect(todayEmptyState([], false, true)).toBe('nothing_due')
    expect(todayEmptyState([], true, true)).toBe('nothing_due')
  })

  it('sections keep the server order', () => {
    const items = [FIXED, TIMES, TASK, NEXT]
    expect(itemsIn(items, 'this_week').map((i) => i.commitmentId)).toEqual(['c2', 't1'])
    expect(isTodaySection('due_today')).toBe(true)
    expect(isTodaySection('later')).toBe(false)
  })
})
