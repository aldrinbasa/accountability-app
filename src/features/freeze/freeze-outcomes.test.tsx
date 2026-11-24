import { screen, within } from '@testing-library/react'
import type { FreezeRequest } from '@/domain/freeze'
import type { MyPlanItem } from '@/domain/my-plan'
import type { TodayItem, TodaySummary } from '@/domain/today'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_TODAY_SUMMARY,
} from '@/test/fake-backend'
import { waitForGroupInUrl } from '@/test/router'

// Saturday 21 Nov 2026, 10:00 in Manila (the test profile's zone).
const NOW = new Date('2026-11-21T02:00:00Z')

const SUMMARY: TodaySummary = {
  ...TEST_TODAY_SUMMARY,
  memberToday: '2026-11-21',
  weekStart: '2026-11-16',
  planned: 4,
  left: 3,
  hasPlan: true,
}

/** Gym 3 times a week with one session frozen: the server lowered the target to 2. */
const GYM: TodayItem = {
  commitmentId: 'c-gym',
  kind: 'commitment',
  section: 'this_week',
  presetKey: 'gym',
  customName: null,
  activityName: 'Gym',
  name: null,
  scheduleType: 'times_per_week',
  days: null,
  target: 2,
  counted: 1,
  countedToday: false,
  targetMet: false,
  deadline: null,
  startsOn: null,
  canDelete: false,
}

const APPROVED_WEEK: FreezeRequest = {
  id: 'f-gym',
  commitmentId: 'c-gym',
  sessionId: 's-gym-3',
  kind: 'week',
  weekStart: '2026-11-16',
  status: 'approved',
  reason: 'knee',
  closesAt: '2026-11-20T02:00:00Z',
  startsAt: '2026-11-15T16:00:00Z',
  targetAfter: 2,
}

const APPROVED_DAY: FreezeRequest = {
  id: 'f-study',
  commitmentId: 'c-study',
  sessionId: 's-sat',
  kind: 'day',
  weekStart: '2026-11-16',
  status: 'approved',
  reason: 'flu, in bed',
  closesAt: '2026-11-21T01:00:00Z',
  startsAt: '2026-11-20T16:00:00Z',
  targetAfter: null,
}

const PLAN_STUDY: MyPlanItem = {
  commitmentId: 'c-study',
  kind: 'commitment',
  section: 'current',
  state: 'active',
  presetKey: 'study',
  customName: null,
  activityName: 'Study',
  name: null,
  scheduleType: 'fixed_days',
  days: [6],
  target: null,
  endDate: null,
  deadline: null,
  startsOn: null,
  endsOn: null,
  canEdit: true,
  canDelete: false,
}

const PLAN_GYM: MyPlanItem = {
  ...PLAN_STUDY,
  commitmentId: 'c-gym',
  presetKey: 'gym',
  activityName: 'Gym',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('approved freezes on Today and My plan (Story 5.5)', () => {
  it('times per week: the lowered ring "1/2", its label with the frozen count, the snowflake and meta', async () => {
    const backend = createFakeBackend(undefined, {
      today: { [TEST_GROUP.id]: { items: [GYM], summary: SUMMARY } },
      freezeRequests: { [TEST_GROUP.id]: [APPROVED_WEEK] },
    })
    renderRoutes(['/today'], backend)
    const ring = await screen.findByRole('img', { name: 'Gym, 1 of 2 this week, 1 frozen' })
    expect(ring).toHaveTextContent('1/2')
    const row = ring.closest('li') as HTMLElement
    expect(
      await within(row).findByText(/^2 times this week · 1 frozen · 1 to go/),
    ).toBeInTheDocument()
    expect(row.querySelector('[data-icon="week-frozen"]')).not.toBeNull()
    expect(within(row).getByRole('button', { name: 'Check in Gym' })).toBeInTheDocument()
  })

  it('without an approved freeze the row reads as before', async () => {
    const backend = createFakeBackend(undefined, {
      today: { [TEST_GROUP.id]: { items: [{ ...GYM, target: 3 }], summary: SUMMARY } },
      freezeRequests: { [TEST_GROUP.id]: [] },
    })
    renderRoutes(['/today'], backend)
    const ring = await screen.findByRole('img', { name: 'Gym, 1 of 3 this week' })
    const row = ring.closest('li') as HTMLElement
    expect(row.querySelector('[data-icon="week-frozen"]')).toBeNull()
  })

  it('My plan lists each approved freeze under its row', async () => {
    const backend = createFakeBackend(undefined, {
      myPlan: { [TEST_GROUP.id]: [PLAN_STUDY, PLAN_GYM] },
      freezeRequests: { [TEST_GROUP.id]: [APPROVED_DAY, APPROVED_WEEK] },
    })
    const { router } = renderRoutes(['/me/plan'], backend)
    await waitForGroupInUrl(router)
    expect(await screen.findByText('Frozen · Sat · flu, in bed')).toBeInTheDocument()
    expect(screen.getByText('Frozen · one session · knee')).toBeInTheDocument()
  })
})
