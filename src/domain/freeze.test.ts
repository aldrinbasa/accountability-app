import { errorCopy } from '@/domain/error-codes'
import {
  approvedPlanLine,
  approvedToast,
  approvedWeekFreezes,
  commitmentOptions,
  dayLine,
  effectLine,
  FREEZE_COPY,
  freezeFailure,
  freezeTimeLeft,
  frozenMeta,
  localDate,
  missOptions,
  noScoreLine,
  pendingMeta,
  planRowApproved,
  planRowPending,
  reasonCounter,
  requestFreezeLabel,
  sessionLabel,
  todayRowOption,
  todayRowRequest,
  validateReason,
  voteNote,
  type FreezeOption,
  type FreezeRequest,
} from '@/domain/freeze'
import type { TodayItem } from '@/domain/today'

// Saturday 21 Nov 2026 in Manila (UTC+8): 00:00 local = Fri 20 Nov 16:00 UTC.
const NOW = new Date('2026-11-21T02:00:00Z') // Sat 10:00 Manila

function dayOption(overrides: Partial<FreezeOption> = {}): FreezeOption {
  return {
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
    ...overrides,
  }
}

function weekOption(overrides: Partial<FreezeOption> = {}): FreezeOption {
  return {
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
    ...overrides,
  }
}

function request(overrides: Partial<FreezeRequest> = {}): FreezeRequest {
  return {
    id: 'f-1',
    commitmentId: 'c-study',
    sessionId: 's-sat',
    kind: 'day',
    weekStart: '2026-11-16',
    status: 'pending',
    reason: 'flu',
    closesAt: '2026-11-22T01:00:00Z',
    startsAt: '2026-11-20T16:00:00Z',
    targetAfter: null,
    ...overrides,
  }
}

const STUDY: Pick<TodayItem, 'commitmentId' | 'kind' | 'scheduleType' | 'section'> = {
  commitmentId: 'c-study',
  kind: 'commitment',
  scheduleType: 'fixed_days',
  section: 'due_today',
}
const GYM: typeof STUDY = {
  commitmentId: 'c-gym',
  kind: 'commitment',
  scheduleType: 'times_per_week',
  section: 'this_week',
}
const TASK: typeof STUDY = {
  commitmentId: 'c-study',
  kind: 'task',
  scheduleType: null,
  section: 'this_week',
}

describe('time left and meta lines', () => {
  it('rounds hours down, shows minutes under 1 h (at least 1), and nothing once closed', () => {
    expect(freezeTimeLeft('2026-11-22T01:00:00Z', NOW)).toBe('23 h left')
    expect(freezeTimeLeft('2026-11-21T03:00:00Z', NOW)).toBe('1 h left')
    expect(freezeTimeLeft('2026-11-21T02:59:59Z', NOW)).toBe('59 min left')
    expect(freezeTimeLeft('2026-11-21T02:00:10Z', NOW)).toBe('1 min left')
    expect(freezeTimeLeft('2026-11-21T02:00:00Z', NOW)).toBeNull()
    expect(freezeTimeLeft('nope', NOW)).toBeNull()
  })

  it('words a pending day and week request, and an approved day', () => {
    expect(pendingMeta(request({ closesAt: '2026-11-21T23:00:00Z' }), NOW)).toBe(
      'Freeze vote · 21 h left',
    )
    expect(
      pendingMeta(request({ kind: 'week', targetAfter: 2, closesAt: '2026-11-21T23:00:00Z' }), NOW),
    ).toBe('Freeze vote · 21 h left · would make it 2 times')
    expect(pendingMeta(request({ kind: 'week', targetAfter: 1 }), NOW)).toMatch(
      /would make it 1 time$/,
    )
    expect(pendingMeta(request({ closesAt: '2026-11-21T01:00:00Z' }), NOW)).toBe('Freeze vote')
    expect(frozenMeta('flu, in bed')).toBe('Frozen · flu, in bed')
  })
})

describe('sheet copy', () => {
  it('names the session by its member-local day', () => {
    expect(dayLine('Study', dayOption())).toBe('Study on Sat')
    expect(sessionLabel('2026-11-27T16:00:00Z', 'Asia/Manila')).toBe('Sat 28 Nov')
    expect(sessionLabel('2026-11-27T16:00:00Z', 'Europe/London')).toBe('Fri 27 Nov')
    // An unknown zone falls back to UTC rather than throwing.
    expect(localDate('2026-11-27T16:00:00Z', 'Not/AZone')).toBe('2026-11-27')
  })

  it('words the effect line, the already-frozen variant and the no-score line', () => {
    expect(effectLine('Gym', weekOption())).toBe('Gym this week: 3 → 2 times')
    expect(effectLine('Gym', weekOption({ which: 'last' }))).toBe('Gym last week: 3 → 2 times')
    expect(effectLine('Gym', weekOption({ target: 2, frozen: 1, targetAfter: 1 }))).toBe(
      'Already 1 frozen: 2 → 1',
    )
    expect(effectLine('Gym', weekOption({ target: 2, targetAfter: 1 }))).toBe(
      'Gym this week: 2 → 1 time',
    )
    expect(noScoreLine('Gym', weekOption())).toBeNull()
    expect(noScoreLine('Gym', weekOption({ target: 1, targetAfter: 0 }))).toBe(
      'Gym will have no score this week.',
    )
    expect(noScoreLine('Gym', weekOption({ which: 'last', targetAfter: 0 }))).toBe(
      'Gym will have no score last week.',
    )
  })

  it('words the solo toast, the vote note, the button label and the counter', () => {
    expect(approvedToast('Study', dayOption())).toBe(
      'Freeze approved · Study on Sat is off the plan.',
    )
    expect(approvedToast('Gym', weekOption())).toBe(
      'Freeze approved · one Gym session is off the plan.',
    )
    expect(voteNote(false)).toBe('The group votes for 24 h. No votes means approved.')
    expect(voteNote(true)).toBe("Just you in this group, so it's approved right away.")
    expect(requestFreezeLabel('Study')).toBe('Request freeze for Study')
    expect(reasonCounter('flu')).toBe('3/80')
  })

  it('validates the reason like the server: blank after trimming or over 80', () => {
    expect(validateReason('')).toBe('Add a reason so the group knows why.')
    expect(validateReason('   ')).toBe(FREEZE_COPY.reasonError)
    expect(validateReason('x'.repeat(81))).toBe(FREEZE_COPY.reasonError)
    expect(validateReason(` ${'x'.repeat(80)} `)).toBeNull()
    expect(validateReason('flu')).toBeNull()
  })
})

describe('which option a row offers', () => {
  it('fixed days: only the session containing now, while its window is open', () => {
    const sat = dayOption()
    const sun = dayOption({
      sessionId: 's-sun',
      startsAt: '2026-11-21T16:00:00Z',
      endsAt: '2026-11-22T16:00:00Z',
      windowEndsAt: '2026-11-22T16:00:00Z',
    })
    expect(todayRowOption(STUDY, [sun, sat], NOW)).toBe(sat)
    expect(todayRowOption(STUDY, [sun], NOW)).toBeNull()
    expect(todayRowOption(STUDY, [sat], new Date('2026-11-21T16:00:00Z'))).toBeNull()
    expect(todayRowOption({ ...STUDY, section: 'starts_next_week' }, [sat], NOW)).toBeNull()
    expect(todayRowOption({ ...STUDY, commitmentId: 'other' }, [sat], NOW)).toBeNull()
  })

  it('a task: its session; times per week: this week only', () => {
    const later = dayOption({
      startsAt: '2026-11-22T16:00:00Z',
      endsAt: '2026-11-23T16:00:00Z',
      windowEndsAt: '2026-11-23T16:00:00Z',
    })
    expect(todayRowOption(TASK, [later], NOW)).toBe(later)
    const last = weekOption({ which: 'last', weekStart: '2026-11-09' })
    const current = weekOption()
    expect(todayRowOption(GYM, [last], NOW)).toBeNull()
    expect(todayRowOption(GYM, [last, current], NOW)).toBe(current)
  })

  it('My plan: every open option of the commitment; the miss sticky: its sessions or its week', () => {
    const sat = dayOption()
    const closed = dayOption({ sessionId: 's-thu', windowEndsAt: '2026-11-21T01:00:00Z' })
    expect(commitmentOptions('c-study', [sat, closed, weekOption()], NOW)).toEqual([sat])

    const missedThu = dayOption({
      sessionId: 's-thu',
      missed: true,
      windowEndsAt: '2026-11-21T16:00:00Z',
    })
    const miss = { commitmentId: 'c-study', sessionIds: ['s-thu'], weekStart: '2026-11-16' }
    expect(missOptions(miss, [sat, missedThu], NOW)).toEqual([missedThu])
    expect(missOptions({ ...miss, commitmentId: null }, [missedThu], NOW)).toEqual([])
    const last = weekOption({ which: 'last', weekStart: '2026-11-09', missed: true })
    expect(
      missOptions(
        { commitmentId: 'c-gym', sessionIds: ['x'], weekStart: '2026-11-09' },
        [weekOption(), last],
        NOW,
      ),
    ).toEqual([last])
  })
})

describe('which request a row shows', () => {
  it("fixed days: the request on today's session (member-local), approved first", () => {
    const today = request()
    const sat = request({ id: 'f-2', startsAt: '2026-11-27T16:00:00Z' })
    expect(todayRowRequest(STUDY, [sat, today], '2026-11-21', '2026-11-16', 'Asia/Manila')).toBe(
      today,
    )
    expect(todayRowRequest(STUDY, [sat], '2026-11-21', '2026-11-16', 'Asia/Manila')).toBeNull()
    const approved = request({ id: 'f-3', status: 'approved' })
    expect(
      todayRowRequest(STUDY, [today, approved], '2026-11-21', '2026-11-16', 'Asia/Manila'),
    ).toBe(approved)
  })

  it('times per week: the pending request of this week; a task: its request', () => {
    const week = request({ commitmentId: 'c-gym', kind: 'week', targetAfter: 2 })
    const approvedWeek = request({ ...week, id: 'f-2', status: 'approved' })
    expect(todayRowRequest(GYM, [approvedWeek, week], '2026-11-21', '2026-11-16', 'UTC')).toBe(week)
    expect(todayRowRequest(GYM, [approvedWeek], '2026-11-21', '2026-11-16', 'UTC')).toBeNull()
    expect(todayRowRequest(GYM, [week], '2026-11-28', '2026-11-23', 'UTC')).toBeNull()
    const task = request({ startsAt: '2026-11-16T16:00:00Z' })
    expect(todayRowRequest(TASK, [task], '2026-11-21', '2026-11-16', 'Asia/Manila')).toBe(task)
  })

  it('My plan: the pending request closing first', () => {
    const late = request({ id: 'late', closesAt: '2026-11-22T05:00:00Z' })
    const soon = request({ id: 'soon', closesAt: '2026-11-21T20:00:00Z' })
    const approved = request({ id: 'ok', status: 'approved', closesAt: '2026-11-21T03:00:00Z' })
    expect(planRowPending('c-study', [late, approved, soon])).toBe(soon)
    expect(planRowPending('c-gym', [late])).toBeNull()
  })
})

describe('freezeFailure', () => {
  it('maps the reason to the Field error, refusals to their line and the rest to failed', () => {
    expect(freezeFailure('reason_required')).toEqual({ kind: 'reason' })
    expect(freezeFailure('week_locked')).toEqual({ kind: 'refused', text: FREEZE_COPY.locked })
    for (const code of [
      'not_member',
      'invalid_freeze',
      'freeze_window_closed',
      'session_done',
      'session_frozen',
      'freeze_pending',
      'fake_ruling_miss',
      'target_met',
    ] as const) {
      expect(freezeFailure(code)).toEqual({ kind: 'refused', text: errorCopy(code) })
    }
    // New 5.4 copy avoids Fake/Real (copy decision 2026-11-24).
    expect(errorCopy('fake_ruling_miss')).toBe(
      "The group said that check-in doesn't count, so this miss can't be frozen.",
    )
    expect(freezeFailure('unknown')).toEqual({ kind: 'failed' })
    expect(freezeFailure('vote_closed')).toEqual({ kind: 'failed' })
  })
})

describe('approved freezes (Story 5.5)', () => {
  it('counts the approved week freezes of a times-per-week row in its week only', () => {
    const approved = request({
      id: 'f-2',
      commitmentId: 'c-gym',
      kind: 'week',
      status: 'approved',
      reason: 'knee',
    })
    const requests = [
      approved,
      { ...approved, id: 'f-3' },
      { ...approved, id: 'f-4', status: 'pending' as const },
      { ...approved, id: 'f-5', weekStart: '2026-11-09' },
    ]
    expect(approvedWeekFreezes(GYM, requests, '2026-11-16')).toBe(2)
    expect(approvedWeekFreezes(STUDY, requests, '2026-11-16')).toBe(0)
    expect(
      approvedWeekFreezes({ ...GYM, section: 'starts_next_week' }, requests, '2026-11-16'),
    ).toBe(0)
  })

  it('My plan lines: the approved requests of a commitment, earliest first', () => {
    const sat = request({ status: 'approved', reason: 'flu, in bed' })
    const fri = request({ id: 'f-0', status: 'approved', startsAt: '2026-11-19T16:00:00Z' })
    const pending = request({ id: 'f-9' })
    expect(planRowApproved('c-study', [sat, pending, fri]).map((r) => r.id)).toEqual(['f-0', 'f-1'])
    expect(approvedPlanLine(sat, 'Asia/Manila')).toBe('Frozen · Sat · flu, in bed')
    expect(approvedPlanLine({ ...sat, kind: 'week', reason: 'flu' }, 'Asia/Manila')).toBe(
      'Frozen · one session · flu',
    )
  })
})
