import type { FeedCheckin, FeedEvent } from '@/domain/feed'

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
