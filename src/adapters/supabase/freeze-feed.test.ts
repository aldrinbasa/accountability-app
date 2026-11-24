import { describe, expect, it } from 'vitest'
import type { Tables } from '@/adapters/supabase/database.types'
import { toFeedItem } from '@/adapters/supabase/backend-adapter'
import { toFeedFreezeResult, toFeedFreezeVote } from '@/adapters/supabase/freeze-feed'

function row(overrides: Partial<Tables<'feed_items'>> = {}): Tables<'feed_items'> {
  return {
    group_id: 'g-1',
    item_kind: 'freeze',
    item_id: 'fr-1',
    sort_at: '2026-11-20T07:12:30.123456+00:00',
    actor_id: 'u-4',
    actor_name: 'Dev',
    actor_avatar_path: null,
    subject_id: null,
    subject_name: null,
    commitment_id: 'cm-1',
    commitment_kind: 'commitment',
    activity_name: 'Study',
    preset_key: 'study',
    task_name: null,
    captured_at: null,
    received_at: null,
    is_late: null,
    is_extra: null,
    caption: null,
    full_pruned_at: null,
    counted_position: null,
    target: null,
    payload: {
      status: 'pending',
      reason: 'flu, in bed',
      closes_at: '2026-11-21T07:12:30.123456+00:00',
      schedule_type: 'fixed_days',
      session_day: '2026-11-21',
      week_start: '2026-11-16',
      which: 'this',
      week_target: 6,
      two_person: false,
      cancel_reason: null,
      my_choice: 'approve',
      my_cast_at: '2026-11-20T08:00:00+00:00',
      can_vote: true,
    },
    miss_count: null,
    challenge_id: null,
    challenge_status: null,
    challenge_closes_at: null,
    challenge_until: null,
    ...overrides,
  }
}

describe('freeze feed rows (Story 5.5)', () => {
  it('maps a freeze request row onto the Vote card item', () => {
    expect(toFeedItem(row())).toEqual({
      type: 'freezeVote',
      id: 'fr-1',
      groupId: 'g-1',
      sortAt: '2026-11-20T07:12:30.123456+00:00',
      requesterId: 'u-4',
      requesterName: 'Dev',
      commitmentId: 'cm-1',
      title: 'Study',
      scheduleType: 'fixed_days',
      sessionDay: '2026-11-21',
      which: 'this',
      weekTarget: 6,
      status: 'pending',
      reason: 'flu, in bed',
      closesAt: '2026-11-21T07:12:30.123456+00:00',
      twoPerson: false,
      cancelReason: null,
      myChoice: 'approve',
      myCastAt: '2026-11-20T08:00:00+00:00',
      canVote: true,
    })
  })

  it('takes a task name as the title, two_person and last week; drops unknown ballots', () => {
    const item = toFeedFreezeVote(
      row({
        task_name: 'Tax return',
        payload: {
          status: 'pending',
          reason: 'x',
          closes_at: '2026-11-21T07:00:00+00:00',
          which: 'last',
          two_person: true,
          my_choice: 'fake',
        },
      }),
      'fr-1',
      'g-1',
      's',
    )
    expect(item).toMatchObject({
      title: 'Tax return',
      which: 'last',
      twoPerson: true,
      myChoice: null,
      canVote: false,
      scheduleType: null,
      weekTarget: null,
    })
  })

  it('drops a malformed freeze row', () => {
    expect(toFeedFreezeVote(row({ payload: null }), 'fr-1', 'g-1', 's')).toBeNull()
    expect(
      toFeedFreezeVote(
        row({ payload: { status: 'open', reason: 'x', closes_at: 'y' } }),
        'a',
        'b',
        'c',
      ),
    ).toBeNull()
    expect(toFeedFreezeVote(row({ payload: { status: 'pending' } }), 'a', 'b', 'c')).toBeNull()
  })

  it('maps a freeze_result row onto the result sticky', () => {
    const result = toFeedItem(
      row({
        item_kind: 'freeze_result',
        item_id: 'ev-1',
        activity_name: 'Gym',
        payload: {
          freeze_request_id: 'fr-1',
          outcome: 'denied',
          reason: 'knee',
          miss_removed: false,
          schedule_type: 'times_per_week',
          session_day: null,
          which: 'this',
          week_target: 3,
        },
      }),
    )
    expect(result).toEqual({
      type: 'freezeResult',
      id: 'ev-1',
      groupId: 'g-1',
      sortAt: '2026-11-20T07:12:30.123456+00:00',
      requesterId: 'u-4',
      requesterName: 'Dev',
      freezeRequestId: 'fr-1',
      outcome: 'denied',
      reason: 'knee',
      missRemoved: false,
      title: 'Gym',
      scheduleType: 'times_per_week',
      sessionDay: null,
      which: 'this',
      weekTarget: 3,
    })
  })

  it('falls back to the payload activity name and drops a malformed result', () => {
    const fallback = toFeedFreezeResult(
      row({
        item_kind: 'freeze_result',
        activity_name: null,
        payload: {
          freeze_request_id: 'fr-1',
          outcome: 'approved',
          reason: 'flu',
          miss_removed: true,
          activity_name: 'Walk',
        },
      }),
      'ev',
      'g',
      's',
    )
    expect(fallback).toMatchObject({ title: 'Walk', missRemoved: true })
    const bad = (payload: Tables<'feed_items'>['payload']) =>
      toFeedFreezeResult(row({ item_kind: 'freeze_result', payload }), 'ev', 'g', 's')
    expect(bad(null)).toBeNull()
    expect(bad({ freeze_request_id: 'fr-1', outcome: 'maybe', reason: 'x' })).toBeNull()
    expect(bad({ outcome: 'approved', reason: 'x' })).toBeNull()
  })
})
