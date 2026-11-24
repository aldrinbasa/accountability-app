import type { FreezeWhich } from '@/domain/freeze'
import {
  isFreezeVoteStatus,
  type FeedFreezeResult,
  type FeedFreezeVote,
} from '@/domain/freeze-vote'
import { isFreezeChoice } from '@/domain/vote'
import type { Tables } from '@/adapters/supabase/database.types'

/**
 * The Feed's freeze rows (Story 5.5), in their own module (Epic 4 retro A9: split the adapter by
 * area): `item_kind = 'freeze'` (a request's Vote card) and `freeze_result` (its outcome sticky).
 */

type FeedItemRow = Tables<'feed_items'>
type Payload = Record<string, unknown>

function asPayload(value: FeedItemRow['payload']): Payload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Payload)
    : null
}

function text(payload: Payload, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function count(payload: Payload, key: string): number | null {
  const value = payload[key]
  return typeof value === 'number' ? value : null
}

function scheduleOf(payload: Payload): 'fixed_days' | 'times_per_week' | null {
  const value = text(payload, 'schedule_type')
  return value === 'fixed_days' || value === 'times_per_week' ? value : null
}

function whichOf(payload: Payload): FreezeWhich {
  return text(payload, 'which') === 'last' ? 'last' : 'this'
}

/** The live title (task name, else activity), else the payload's activity name. */
function titleOf(row: FeedItemRow, payload: Payload): string {
  return row.task_name ?? row.activity_name ?? text(payload, 'activity_name') ?? ''
}

/**
 * A freeze request row: the requester (actor) with the live name, the habit, and the payload's
 * status, reason, deadline, day or week, the reader's own ballot and `can_vote`; null when malformed.
 */
export function toFeedFreezeVote(
  row: FeedItemRow,
  id: string,
  groupId: string,
  sortAt: string,
): FeedFreezeVote | null {
  const payload = asPayload(row.payload)
  if (!payload) return null
  const status = text(payload, 'status')
  const reason = text(payload, 'reason')
  const closesAt = text(payload, 'closes_at')
  if (!isFreezeVoteStatus(status) || reason === null || closesAt === null) return null
  const myChoice = text(payload, 'my_choice')
  return {
    type: 'freezeVote',
    id,
    groupId,
    sortAt,
    requesterId: row.actor_id,
    requesterName: row.actor_name ?? '',
    commitmentId: row.commitment_id,
    title: titleOf(row, payload),
    scheduleType: scheduleOf(payload),
    sessionDay: text(payload, 'session_day'),
    which: whichOf(payload),
    weekTarget: count(payload, 'week_target'),
    status,
    reason,
    closesAt,
    twoPerson: payload.two_person === true,
    cancelReason: text(payload, 'cancel_reason'),
    myChoice: isFreezeChoice(myChoice) ? myChoice : null,
    myCastAt: text(payload, 'my_cast_at'),
    canVote: payload.can_vote === true,
  }
}

/**
 * A `freeze_result` row: the requester, the request id, the outcome, reason, whether a miss was
 * removed, and the day or week; null when malformed.
 */
export function toFeedFreezeResult(
  row: FeedItemRow,
  id: string,
  groupId: string,
  sortAt: string,
): FeedFreezeResult | null {
  const payload = asPayload(row.payload)
  if (!payload) return null
  const freezeRequestId = text(payload, 'freeze_request_id')
  const outcome = text(payload, 'outcome')
  const reason = text(payload, 'reason')
  if (freezeRequestId === null || reason === null) return null
  if (outcome !== 'approved' && outcome !== 'denied') return null
  return {
    type: 'freezeResult',
    id,
    groupId,
    sortAt,
    requesterId: row.actor_id,
    requesterName: row.actor_name ?? '',
    freezeRequestId,
    outcome,
    reason,
    missRemoved: payload.miss_removed === true,
    title: titleOf(row, payload),
    scheduleType: scheduleOf(payload),
    sessionDay: text(payload, 'session_day'),
    which: whichOf(payload),
    weekTarget: count(payload, 'week_target'),
  }
}
