import type { FeedCheckin, FeedEvent, FeedMiss } from '@/domain/feed'
import type { FeedFreezeResult, FeedFreezeVote } from '@/domain/freeze-vote'
import type { FeedVote } from '@/domain/vote'

/** A check-in on `group-1`'s wall: Priya's Gym, 2 of 3, on time (override per test). */
export function feedCheckin(overrides: Partial<FeedCheckin> = {}): FeedCheckin {
  return {
    type: 'checkin',
    id: 'checkin-1',
    groupId: 'group-1',
    sortAt: '2026-11-20T00:12:30.000000+00:00',
    authorId: 'user-2',
    authorName: 'Priya',
    authorAvatarPath: null,
    commitmentId: 'commitment-gym',
    commitmentKind: 'commitment',
    activityName: 'Gym',
    presetKey: 'gym',
    taskName: null,
    capturedAt: '2026-11-20T00:12:00.000Z',
    receivedAt: '2026-11-20T00:12:30.000Z',
    isLate: false,
    isExtra: false,
    caption: 'leg day',
    fullPrunedAt: null,
    countedPosition: 2,
    target: 3,
    challengeId: null,
    challengeStatus: null,
    challengeClosesAt: null,
    // 24 h after `receivedAt`: challengeable on the test day.
    challengeUntil: '2026-11-21T00:12:30.000Z',
    ...overrides,
  }
}

/** A membership sticky on `group-1`'s wall: Sam joined (override per test). */
export function feedEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  return {
    type: 'event',
    kind: 'member_joined',
    id: 'event-1',
    groupId: 'group-1',
    sortAt: '2026-11-19T10:00:00.000000+00:00',
    actorId: 'user-3',
    actorName: 'Sam',
    subjectId: null,
    subjectName: null,
    ...overrides,
  }
}

/** A miss sticky on `group-1`'s wall: Dev missed Paint on Thursday (override per test). */
export function feedMiss(overrides: Partial<FeedMiss> = {}): FeedMiss {
  return {
    type: 'miss',
    id: 'miss-1',
    groupId: 'group-1',
    sortAt: '2026-11-20T00:00:30.000000+00:00',
    actorId: 'user-4',
    actorName: 'Dev',
    commitmentId: 'commitment-paint',
    title: 'Paint',
    scheduleType: 'fixed_days',
    missCount: 1,
    tease: 'couch_wins',
    missedOn: '2026-11-19',
    sessionIds: ['session-paint-thu'],
    weekStart: '2026-11-16',
    ...overrides,
  }
}

/**
 * An open challenge on `group-1`'s wall (Story 5.2): Lena (user-5) challenged Dev's (user-4) Study,
 * 18 h 59 min left at 2026-11-20 03:00 UTC; the reader may vote (override per test).
 */
export function feedVote(overrides: Partial<FeedVote> = {}): FeedVote {
  return {
    type: 'vote',
    id: '00000000-0000-4000-b000-000000000001',
    groupId: 'group-1',
    sortAt: '2026-11-20T01:59:00.000000+00:00',
    checkinId: 'checkin-dev',
    challengerId: 'user-5',
    challengerName: 'Lena',
    ownerId: 'user-4',
    ownerName: 'Dev',
    commitmentId: 'commitment-study',
    commitmentKind: 'commitment',
    activityName: 'Study',
    presetKey: 'study',
    taskName: null,
    capturedAt: '2026-11-20T01:00:00.000Z',
    receivedAt: '2026-11-20T01:00:30.000Z',
    fullPrunedAt: null,
    status: 'open',
    closesAt: '2026-11-20T21:59:00.000Z',
    fakeCount: null,
    realCount: null,
    variant: null,
    cancelReason: null,
    myChoice: null,
    myCastAt: null,
    canVote: true,
    overturnedById: null,
    overturnedByName: null,
    ...overrides,
  }
}

/**
 * A pending freeze request on `group-1`'s wall (Story 5.5): Dev (user-4) wants Study on Sat (21
 * Nov) frozen, "flu, in bed", 18 h 59 min left at 2026-11-20 03:00 UTC; the reader may vote
 * (override per test).
 */
export function feedFreezeVote(overrides: Partial<FeedFreezeVote> = {}): FeedFreezeVote {
  return {
    type: 'freezeVote',
    id: '00000000-0000-4000-c000-000000000001',
    groupId: 'group-1',
    sortAt: '2026-11-20T01:59:00.000000+00:00',
    requesterId: 'user-4',
    requesterName: 'Dev',
    commitmentId: 'commitment-study',
    title: 'Study',
    scheduleType: 'fixed_days',
    sessionDay: '2026-11-21',
    which: 'this',
    weekTarget: 6,
    status: 'pending',
    reason: 'flu, in bed',
    closesAt: '2026-11-20T21:59:00.000Z',
    twoPerson: false,
    cancelReason: null,
    myChoice: null,
    myCastAt: null,
    canVote: true,
    ...overrides,
  }
}

/** A closed freeze on `group-1`'s wall (Story 5.5): Dev's Study on Sat, approved (override per test). */
export function feedFreezeResult(overrides: Partial<FeedFreezeResult> = {}): FeedFreezeResult {
  return {
    type: 'freezeResult',
    id: 'event-freeze-1',
    groupId: 'group-1',
    sortAt: '2026-11-20T02:30:00.000000+00:00',
    requesterId: 'user-4',
    requesterName: 'Dev',
    freezeRequestId: '00000000-0000-4000-c000-000000000001',
    outcome: 'approved',
    reason: 'flu, in bed',
    missRemoved: false,
    title: 'Study',
    scheduleType: 'fixed_days',
    sessionDay: '2026-11-21',
    which: 'this',
    weekTarget: 6,
    ...overrides,
  }
}

/** The UUID of the `n`th check-in made by `feedCheckins` (1-based). */
export function feedCheckinId(n: number): string {
  return `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`
}

/** `count` check-ins, newest first, one minute apart from `2026-11-20 00:00 UTC` downwards. */
export function feedCheckins(count: number, groupId = 'group-1'): FeedCheckin[] {
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(Date.UTC(2026, 10, 20, 0, 0) - index * 60_000).toISOString()
    return feedCheckin({
      id: feedCheckinId(index + 1),
      groupId,
      sortAt: at.replace('Z', '000+00:00'),
      capturedAt: at,
      receivedAt: at,
      caption: `post ${index + 1}`,
    })
  })
}
