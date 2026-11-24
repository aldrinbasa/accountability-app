import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BackendError } from '@/domain/error-codes'
import type { FreezeOption, FreezeRequest } from '@/domain/freeze'
import type { MyPlanItem } from '@/domain/my-plan'
import type { TodayItem, TodaySummary } from '@/domain/today'
import {
  createFakeBackend,
  renderRoutes,
  TEST_GROUP,
  TEST_TODAY_SUMMARY,
  TEST_USER,
} from '@/test/fake-backend'
import { feedMiss } from '@/test/feed-items'
import { waitForGroupInUrl } from '@/test/router'

const toast = vi.hoisted(() => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/ui/toast', () => toast)

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

const STUDY: TodayItem = {
  commitmentId: 'c-study',
  kind: 'commitment',
  section: 'due_today',
  presetKey: 'study',
  customName: null,
  activityName: 'Study',
  name: null,
  scheduleType: 'fixed_days',
  days: [6],
  target: 1,
  counted: 0,
  countedToday: false,
  targetMet: false,
  deadline: null,
  startsOn: null,
  canDelete: false,
}

const GYM: TodayItem = {
  ...STUDY,
  commitmentId: 'c-gym',
  section: 'this_week',
  presetKey: 'gym',
  activityName: 'Gym',
  scheduleType: 'times_per_week',
  days: null,
  target: 3,
  counted: 1,
}

/** Today's Study session (Sat 21 Nov, Manila). */
const SAT: FreezeOption = {
  kind: 'day',
  commitmentId: 'c-study',
  sessionId: 's-sat',
  startsAt: '2026-11-20T16:00:00Z',
  endsAt: '2026-11-21T16:00:00Z',
  windowEndsAt: '2026-11-21T16:00:00Z',
  missed: false,
  weekStart: '2026-11-16',
  which: 'this',
  target: null,
  frozen: null,
  targetAfter: null,
  timeZone: 'Asia/Manila',
}

/** Next Saturday's Study session (Sat 28 Nov, Manila). */
const NEXT_SAT: FreezeOption = {
  ...SAT,
  sessionId: 's-next-sat',
  startsAt: '2026-11-27T16:00:00Z',
  endsAt: '2026-11-28T16:00:00Z',
  windowEndsAt: '2026-11-28T16:00:00Z',
  weekStart: '2026-11-23',
}

const GYM_THIS: FreezeOption = {
  kind: 'week',
  commitmentId: 'c-gym',
  sessionId: null,
  startsAt: '2026-11-15T16:00:00Z',
  endsAt: '2026-11-22T16:00:00Z',
  windowEndsAt: '2026-11-22T16:00:00Z',
  missed: false,
  weekStart: '2026-11-16',
  which: 'this',
  target: 3,
  frozen: 0,
  targetAfter: 2,
  timeZone: 'Asia/Manila',
}

const GYM_LAST: FreezeOption = {
  ...GYM_THIS,
  startsAt: '2026-11-08T16:00:00Z',
  endsAt: '2026-11-15T16:00:00Z',
  windowEndsAt: '2026-11-21T16:00:00Z',
  missed: true,
  weekStart: '2026-11-09',
  which: 'last',
  target: 1,
  frozen: 0,
  targetAfter: 0,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  toast.showToast.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
})

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

function todayBackend(
  items: TodayItem[],
  options: FreezeOption[],
  memberCount = 3,
  requests: FreezeRequest[] = [],
) {
  return createFakeBackend(undefined, {
    groups: [{ ...TEST_GROUP, memberCount }],
    today: { [TEST_GROUP.id]: { items, summary: SUMMARY } },
    freezeOptions: { [TEST_GROUP.id]: options },
    freezeRequests: { [TEST_GROUP.id]: requests },
  })
}

/** Opens a Today row's Overflow, then Request freeze. */
async function openFromToday(title: string) {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: `More actions for ${title}` }))
  const actions = await screen.findByRole('dialog', { name: title })
  await user.click(await within(actions).findByRole('button', { name: 'Request freeze' }))
  const sheet = await screen.findByRole('dialog', { name: 'Request freeze' })
  return { user, sheet }
}

/** A Today row's lines under its title. */
async function rowOf(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 3, name: title })
  return heading.closest('li') as HTMLElement
}

describe('Request a freeze from Today (Story 5.4)', () => {
  it('a group day freeze: the pre-picked session, the Field error on a blank Send, then pending', async () => {
    const backend = todayBackend([STUDY], [SAT])
    renderRoutes(['/today'], backend)
    const { user, sheet } = await openFromToday('Study')

    expect(within(sheet).getByText('Study on Sat')).toBeInTheDocument()
    expect(
      within(sheet).getByText('The group votes for 24 h. No votes means approved.'),
    ).toBeInTheDocument()
    const reason = within(sheet).getByLabelText('Reason')
    expect(reason).toHaveAttribute('maxlength', '80')

    // Send stays enabled: a blank reason shows the Field error, focused and linked.
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    const alert = await within(sheet).findByRole('alert')
    expect(alert).toHaveTextContent('Add a reason so the group knows why.')
    expect(reason).toHaveFocus()
    expect(reason.getAttribute('aria-describedby')).toContain(alert.id)
    expect(backend.requestFreeze).not.toHaveBeenCalled()

    await user.type(reason, 'flu')
    expect(within(sheet).getByText('3/80')).toBeInTheDocument()
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Request freeze' })).not.toBeInTheDocument(),
    )
    expect(backend.requestFreeze).toHaveBeenCalledWith({
      commitmentId: 'c-study',
      reason: 'flu',
      sessionId: 's-sat',
      weekStart: null,
    })
    expect(toast.showToast).toHaveBeenCalledWith('Freeze requested.')
    const row = await rowOf('Study')
    expect(await within(row).findByText('Freeze vote · 24 h left')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Check in Study' })).toBeInTheDocument()
  })

  it('alone in the group: the solo note, approved at once, the row frozen without Check in', async () => {
    renderRoutes(['/today'], todayBackend([STUDY], [SAT], 1))
    const { user, sheet } = await openFromToday('Study')
    expect(
      within(sheet).getByText("Just you in this group, so it's approved right away."),
    ).toBeInTheDocument()
    await user.type(within(sheet).getByLabelText('Reason'), '  flu, in bed ')
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(toast.showToast).toHaveBeenCalledWith(
        'Freeze approved · Study on Sat is off the plan.',
      ),
    )
    const row = await rowOf('Study')
    expect(await within(row).findByText('Frozen · flu, in bed')).toBeInTheDocument()
    expect(row).toHaveAttribute('data-frozen')
    expect(within(row).queryByRole('button', { name: 'Check in Study' })).not.toBeInTheDocument()
  })

  it('times per week: the effect line, then the pending meta with the lowered target', async () => {
    const backend = todayBackend([GYM], [GYM_THIS])
    renderRoutes(['/today'], backend)
    const { user, sheet } = await openFromToday('Gym')
    expect(within(sheet).getByText('Gym this week: 3 → 2 times')).toBeInTheDocument()
    // Only this week is listed: no switch.
    expect(within(sheet).queryByRole('radiogroup')).not.toBeInTheDocument()
    await user.type(within(sheet).getByLabelText('Reason'), 'knee')
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(backend.requestFreeze).toHaveBeenCalledWith({
        commitmentId: 'c-gym',
        reason: 'knee',
        sessionId: null,
        weekStart: '2026-11-16',
      }),
    )
    const row = await rowOf('Gym')
    expect(
      await within(row).findByText('Freeze vote · 24 h left · would make it 2 times'),
    ).toBeInTheDocument()
  })

  it('offers no Request freeze when the server lists nothing for the row', async () => {
    const user = userEvent.setup()
    // Next Saturday's session only: not the session containing now.
    renderRoutes(['/today'], todayBackend([STUDY], [NEXT_SAT]))
    await user.click(await screen.findByRole('button', { name: 'More actions for Study' }))
    const actions = await screen.findByRole('dialog', { name: 'Study' })
    expect(within(actions).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(
      within(actions).queryByRole('button', { name: 'Request freeze' }),
    ).not.toBeInTheDocument()
  })

  it('offline: Inline retry above Send with the reason kept; Retry sends it', async () => {
    const backend = todayBackend([STUDY], [SAT])
    renderRoutes(['/today'], backend)
    const { user, sheet } = await openFromToday('Study')
    await user.type(within(sheet).getByLabelText('Reason'), 'flu')
    setOnline(false)
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    expect(
      await within(sheet).findByText("You're offline. Freezes need a signal."),
    ).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Reason')).toHaveValue('flu')
    expect(backend.requestFreeze).not.toHaveBeenCalled()

    setOnline(true)
    await user.click(within(sheet).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(backend.requestFreeze).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast.showToast).toHaveBeenCalledWith('Freeze requested.'))
  })

  it('a plain failure: "Couldn\'t send the freeze request. Tap Retry."', async () => {
    const backend = todayBackend([STUDY], [SAT])
    vi.mocked(backend.requestFreeze).mockRejectedValueOnce(new BackendError('unknown'))
    renderRoutes(['/today'], backend)
    const { user, sheet } = await openFromToday('Study')
    await user.type(within(sheet).getByLabelText('Reason'), 'flu')
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    expect(
      await within(sheet).findByText("Couldn't send the freeze request. Tap Retry."),
    ).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(backend.requestFreeze).toHaveBeenCalledTimes(2))
  })

  it('a refusal closes the Sheet with an error toast and refetches; reason_required is the Field error', async () => {
    const backend = todayBackend([STUDY], [SAT])
    vi.mocked(backend.requestFreeze)
      .mockRejectedValueOnce(new BackendError('reason_required'))
      .mockRejectedValueOnce(new BackendError('freeze_window_closed'))
    renderRoutes(['/today'], backend)
    const { user, sheet } = await openFromToday('Study')
    await user.type(within(sheet).getByLabelText('Reason'), 'flu')
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      'Add a reason so the group knows why.',
    )

    const reads = vi.mocked(backend.listFreezeOptions).mock.calls.length
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(toast.showToast).toHaveBeenCalledWith("That session can't be frozen anymore.", {
        variant: 'error',
      }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Request freeze' })).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(vi.mocked(backend.listFreezeOptions).mock.calls.length).toBeGreaterThan(reads),
    )
  })

  it('closing with a typed reason asks "Discard this?"', async () => {
    renderRoutes(['/today'], todayBackend([STUDY], [SAT]))
    const { user, sheet } = await openFromToday('Study')
    await user.type(within(sheet).getByLabelText('Reason'), 'flu')
    await user.click(within(sheet).getByRole('button', { name: 'Close' }))
    expect(within(sheet).getByText('Discard this?')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Keep' }))
    expect(within(sheet).getByLabelText('Reason')).toHaveValue('flu')
  })

  it("shows a pending day request on today's session only", async () => {
    const pending: FreezeRequest = {
      id: 'f-1',
      commitmentId: 'c-study',
      sessionId: 's-next-sat',
      kind: 'day',
      weekStart: '2026-11-23',
      status: 'pending',
      reason: 'trip',
      closesAt: '2026-11-21T23:00:00Z',
      startsAt: NEXT_SAT.startsAt,
      targetAfter: null,
    }
    const today: FreezeRequest = {
      ...pending,
      id: 'f-2',
      commitmentId: 'c-gym-days',
      sessionId: 's-sat-gym',
      weekStart: '2026-11-16',
      startsAt: SAT.startsAt,
    }
    const gymDays: TodayItem = { ...STUDY, commitmentId: 'c-gym-days', activityName: 'Lift' }
    renderRoutes(['/today'], todayBackend([STUDY, gymDays], [], 3, [pending, today]))
    // The request on today's Lift session shows; Study's next-Saturday request does not.
    const lift = await rowOf('Lift')
    expect(await within(lift).findByText('Freeze vote · 21 h left')).toBeInTheDocument()
    const row = await rowOf('Study')
    expect(within(row).queryByText(/Freeze vote/)).not.toBeInTheDocument()
  })
})

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

describe('Request a freeze from My plan (Story 5.4)', () => {
  function planBackend(
    options: FreezeOption[],
    items: MyPlanItem[] = [PLAN_STUDY, PLAN_GYM],
    memberCount = TEST_GROUP.memberCount,
  ) {
    return createFakeBackend(undefined, {
      groups: [{ ...TEST_GROUP, memberCount }],
      myPlan: { [TEST_GROUP.id]: items },
      freezeOptions: { [TEST_GROUP.id]: options },
    })
  }

  it('lists the sessions to pick from, then shows the pending line on the row', async () => {
    const user = userEvent.setup()
    const backend = planBackend([SAT, NEXT_SAT])
    const { router } = renderRoutes(['/me/plan'], backend)
    await waitForGroupInUrl(router)
    const button = await screen.findByRole('button', { name: 'Request freeze for Study' })
    // Nothing freezable for Gym.
    expect(screen.queryByRole('button', { name: 'Request freeze for Gym' })).not.toBeInTheDocument()
    await user.click(button)
    const sheet = await screen.findByRole('dialog', { name: 'Request freeze' })
    expect(within(sheet).getByRole('radio', { name: 'Sat 21 Nov' })).toBeChecked()
    await user.click(within(sheet).getByRole('radio', { name: 'Sat 28 Nov' }))
    await user.type(within(sheet).getByLabelText('Reason'), 'trip')
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(backend.requestFreeze).toHaveBeenCalledWith({
        commitmentId: 'c-study',
        reason: 'trip',
        sessionId: 's-next-sat',
        weekStart: null,
      }),
    )
    const row = (await screen.findByRole('heading', { level: 3, name: 'Study' })).closest('li')
    expect(
      await within(row as HTMLElement).findByText('Freeze vote · 24 h left'),
    ).toBeInTheDocument()
  })

  it('alone in the group: the Sheet says it is approved right away', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes(['/me/plan'], planBackend([SAT], [PLAN_STUDY], 1))
    await waitForGroupInUrl(router)
    await user.click(await screen.findByRole('button', { name: 'Request freeze for Study' }))
    const sheet = await screen.findByRole('dialog', { name: 'Request freeze' })
    expect(
      within(sheet).getByText("Just you in this group, so it's approved right away."),
    ).toBeInTheDocument()
  })

  it('times per week: This week / Last week, the effect line and the no-score line', async () => {
    const user = userEvent.setup()
    const backend = planBackend([GYM_LAST, GYM_THIS])
    const { router } = renderRoutes(['/me/plan'], backend)
    await waitForGroupInUrl(router)
    await user.click(await screen.findByRole('button', { name: 'Request freeze for Gym' }))
    const sheet = await screen.findByRole('dialog', { name: 'Request freeze' })
    expect(within(sheet).getByRole('radio', { name: 'This week' })).toBeChecked()
    expect(within(sheet).getByText('Gym this week: 3 → 2 times')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('radio', { name: 'Last week' }))
    expect(within(sheet).getByText('Gym last week: 1 → 0 times')).toBeInTheDocument()
    expect(within(sheet).getByText('Gym will have no score last week.')).toBeInTheDocument()
    await user.type(within(sheet).getByLabelText('Reason'), 'sick')
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(backend.requestFreeze).toHaveBeenCalledWith({
        commitmentId: 'c-gym',
        reason: 'sick',
        sessionId: null,
        weekStart: '2026-11-09',
      }),
    )
  })
})

describe('Request a freeze from the own miss sticky (Story 5.4)', () => {
  const THU: FreezeOption = {
    ...SAT,
    commitmentId: 'commitment-paint',
    sessionId: 'session-paint-thu',
    startsAt: '2026-11-18T16:00:00Z',
    endsAt: '2026-11-19T16:00:00Z',
    windowEndsAt: '2026-11-21T16:00:00Z',
    missed: true,
  }

  it("offers Request freeze on the own miss in its window, never on someone else's", async () => {
    const user = userEvent.setup()
    const mine = feedMiss({ id: 'miss-mine', actorId: TEST_USER.id, actorName: 'Jo' })
    const theirs = feedMiss({
      id: 'miss-theirs',
      sortAt: '2026-11-19T00:00:30.000000+00:00',
      commitmentId: 'commitment-other',
    })
    const backend = createFakeBackend(undefined, {
      feed: { [TEST_GROUP.id]: [mine, theirs] },
      freezeOptions: { [TEST_GROUP.id]: [THU] },
    })
    const { router } = renderRoutes(['/feed'], backend)
    await waitForGroupInUrl(router)
    const button = await screen.findByRole('button', { name: 'Request freeze' })
    expect(screen.getAllByRole('button', { name: 'Request freeze' })).toHaveLength(1)
    expect(button.closest('article')).toHaveAttribute('data-feed-item', 'miss-mine')

    await user.click(button)
    const sheet = await screen.findByRole('dialog', { name: 'Request freeze' })
    expect(within(sheet).getByText('Paint on Thu')).toBeInTheDocument()
    await user.type(within(sheet).getByLabelText('Reason'), 'flu')
    await user.click(within(sheet).getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(backend.requestFreeze).toHaveBeenCalledWith({
        commitmentId: 'commitment-paint',
        reason: 'flu',
        sessionId: 'session-paint-thu',
        weekStart: null,
      }),
    )
    // The option is gone after the refetch: no button any more.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Request freeze' })).not.toBeInTheDocument(),
    )
  })

  it('alone in the group: the Sheet says it is approved right away', async () => {
    const user = userEvent.setup()
    const mine = feedMiss({ id: 'miss-mine', actorId: TEST_USER.id, actorName: 'Jo' })
    const backend = createFakeBackend(undefined, {
      groups: [{ ...TEST_GROUP, memberCount: 1 }],
      feed: { [TEST_GROUP.id]: [mine] },
      freezeOptions: { [TEST_GROUP.id]: [THU] },
    })
    const { router } = renderRoutes(['/feed'], backend)
    await waitForGroupInUrl(router)
    await user.click(await screen.findByRole('button', { name: 'Request freeze' }))
    const sheet = await screen.findByRole('dialog', { name: 'Request freeze' })
    expect(
      within(sheet).getByText("Just you in this group, so it's approved right away."),
    ).toBeInTheDocument()
  })

  it('offers nothing when the server lists no option for the miss (a Fake-ruling miss)', async () => {
    const mine = feedMiss({ id: 'miss-mine', actorId: TEST_USER.id, actorName: 'Jo' })
    const backend = createFakeBackend(undefined, {
      feed: { [TEST_GROUP.id]: [mine] },
      freezeOptions: { [TEST_GROUP.id]: [] },
    })
    const { router } = renderRoutes(['/feed'], backend)
    await waitForGroupInUrl(router)
    await screen.findByRole('heading', { level: 2, name: /^You missed Paint/ })
    await waitFor(() => expect(backend.listFreezeOptions).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Request freeze' })).not.toBeInTheDocument()
  })
})
