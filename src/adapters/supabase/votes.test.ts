import type { BackendErrorCode } from '@/domain/error-codes'
import { supabaseBackendAdapter as adapter, toFeedItem } from '@/adapters/supabase/backend-adapter'
import type { Tables } from '@/adapters/supabase/database.types'
import { toVoteTallies } from '@/adapters/supabase/votes'

const rpc = vi.hoisted(() => vi.fn())

vi.mock('@/adapters/supabase/client', () => ({
  supabase: { rpc },
  supabaseUrl: 'https://proj.supabase.co',
}))

function pgError(message: string) {
  return { message, details: '', hint: '', code: 'P0001', name: 'PostgrestError' }
}

async function codeOf(promise: Promise<unknown>): Promise<BackendErrorCode> {
  try {
    await promise
  } catch (error) {
    return (error as { code: BackendErrorCode }).code
  }
  throw new Error('expected a rejection')
}

describe('vote RPCs (Story 5.2)', () => {
  beforeEach(() => rpc.mockReset())

  it('cast_vote sends kind, id and choice and maps the ballot', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ vote_id: 'v-1', cast_at: '2026-11-20T03:00:00+00:00' }],
      error: null,
      status: 200,
    })
    expect(await adapter.castVote('challenge', 'ch-1', 'real')).toEqual({
      voteId: 'v-1',
      castAt: '2026-11-20T03:00:00+00:00',
    })
    expect(rpc).toHaveBeenLastCalledWith('cast_vote', {
      p_kind: 'challenge',
      p_id: 'ch-1',
      p_choice: 'real',
    })
  })

  it('cast_vote maps every refusal, no response and a malformed answer', async () => {
    for (const code of [
      'invalid_vote',
      'not_member',
      'group_waiting',
      'vote_closed',
      'not_eligible',
      'already_voted',
    ] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await codeOf(adapter.castVote('challenge', 'ch-1', 'fake'))).toBe(code)
    }
    rpc.mockResolvedValueOnce({ data: null, error: pgError('Failed to fetch'), status: 0 })
    expect(await codeOf(adapter.castVote('challenge', 'ch-1', 'fake'))).toBe('network')
    rpc.mockResolvedValueOnce({ data: [], error: null, status: 200 })
    expect(await codeOf(adapter.castVote('challenge', 'ch-1', 'fake'))).toBe('unknown')
  })

  it('undo_vote sends kind and id and maps its refusals', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null, status: 204 })
    await adapter.undoVote('challenge', 'ch-1')
    expect(rpc).toHaveBeenLastCalledWith('undo_vote', { p_kind: 'challenge', p_id: 'ch-1' })
    for (const code of ['undo_expired', 'vote_closed', 'not_member'] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: pgError(code), status: 400 })
      expect(await codeOf(adapter.undoVote('challenge', 'ch-1'))).toBe(code)
    }
  })

  it('vote_tallies maps challenge rows and drops unknown kinds', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { target_kind: 'challenge', target_id: 'ch-1', voted_count: 2, eligible_count: 4 },
        { target_kind: 'freeze', target_id: 'fr-1', voted_count: 1, eligible_count: 3 },
      ],
      error: null,
      status: 200,
    })
    expect(await adapter.listVoteTallies('g-1')).toEqual([
      { targetKind: 'challenge', targetId: 'ch-1', votedCount: 2, eligibleCount: 4 },
    ])
    expect(rpc).toHaveBeenLastCalledWith('vote_tallies', { p_group_id: 'g-1' })
    expect(toVoteTallies(null)).toEqual([])
    rpc.mockResolvedValueOnce({ data: null, error: pgError('not_member'), status: 400 })
    expect(await codeOf(adapter.listVoteTallies('g-1'))).toBe('not_member')
  })
})

function challengeRow(overrides: Partial<Tables<'feed_items'>> = {}): Tables<'feed_items'> {
  return {
    group_id: 'g-1',
    item_kind: 'challenge',
    item_id: 'ch-1',
    sort_at: '2026-11-20T08:00:00+00:00',
    actor_id: 'u-lena',
    actor_name: 'Lena',
    actor_avatar_path: null,
    subject_id: 'u-dev',
    subject_name: 'Dev',
    commitment_id: 'cm-1',
    commitment_kind: 'commitment',
    activity_name: 'Study',
    preset_key: 'study',
    task_name: null,
    captured_at: '2026-11-20T07:12:00+00:00',
    received_at: '2026-11-20T07:12:30+00:00',
    is_late: null,
    is_extra: null,
    caption: null,
    full_pruned_at: null,
    counted_position: null,
    target: null,
    payload: {
      checkin_id: 'c-1',
      fake_count: null,
      real_count: null,
      variant: null,
      cancel_reason: null,
      my_choice: 'real',
      my_cast_at: '2026-11-20T08:30:00+00:00',
      can_vote: true,
    },
    miss_count: null,
    challenge_id: 'ch-1',
    challenge_status: 'open',
    challenge_closes_at: '2026-11-21T08:00:00+00:00',
    challenge_until: null,
    ...overrides,
  }
}

describe('feed_items challenge rows (Story 5.2)', () => {
  it("maps an open challenge with the reader's own ballot", () => {
    expect(toFeedItem(challengeRow())).toEqual({
      type: 'vote',
      id: 'ch-1',
      groupId: 'g-1',
      sortAt: '2026-11-20T08:00:00+00:00',
      checkinId: 'c-1',
      challengerId: 'u-lena',
      challengerName: 'Lena',
      ownerId: 'u-dev',
      ownerName: 'Dev',
      commitmentId: 'cm-1',
      commitmentKind: 'commitment',
      activityName: 'Study',
      presetKey: 'study',
      taskName: null,
      capturedAt: '2026-11-20T07:12:00+00:00',
      receivedAt: '2026-11-20T07:12:30+00:00',
      fullPrunedAt: null,
      status: 'open',
      closesAt: '2026-11-21T08:00:00+00:00',
      fakeCount: null,
      realCount: null,
      variant: null,
      cancelReason: null,
      myChoice: 'real',
      myCastAt: '2026-11-20T08:30:00+00:00',
      canVote: true,
      overturnedById: null,
      overturnedByName: null,
    })
  })

  it('maps a closed challenge and drops malformed rows', () => {
    expect(
      toFeedItem(
        challengeRow({
          challenge_status: 'fake',
          payload: { checkin_id: 'c-1', fake_count: 3, real_count: 1, variant: 'normal' },
        }),
      ),
    ).toMatchObject({
      status: 'fake',
      fakeCount: 3,
      realCount: 1,
      variant: 'normal',
      myChoice: null,
      canVote: false,
    })
    // Story 5.3: an overturned Fake ruling names the admin.
    expect(
      toFeedItem(
        challengeRow({
          challenge_status: 'fake',
          payload: {
            checkin_id: 'c-1',
            fake_count: 3,
            real_count: 1,
            variant: 'normal',
            overturned_by_id: 'u-jo',
            overturned_by_name: 'Jo',
          },
        }),
      ),
    ).toMatchObject({ status: 'fake', overturnedById: 'u-jo', overturnedByName: 'Jo' })
    expect(toFeedItem(challengeRow({ payload: null }))).toBeNull()
    expect(toFeedItem(challengeRow({ challenge_status: 'weird' }))).toBeNull()
    expect(toFeedItem(challengeRow({ challenge_closes_at: null }))).toBeNull()
    expect(toFeedItem(challengeRow({ payload: { can_vote: true } }))).toBeNull()
  })
})
