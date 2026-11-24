import { DAY_SHORT } from '@/domain/dates'
import type { FreezeWhich } from '@/domain/freeze'
import { cancelledLine, type FreezeChoice, type VoteKicker, type VoteTally } from '@/domain/vote'

/**
 * Freeze votes and their outcomes (Story 5.5). The server decides who may vote, every time and the
 * outcome (`cast_vote`, `undo_vote`, `vote_tallies`, `private.close_vote`, `feed_items`); this file
 * only maps what it sent onto the yellow freeze Vote card and the result sticky, and words it.
 */

export const FREEZE_VOTE_COPY = {
  kicker: 'FREEZE REQUEST',
  rule: 'No votes means approved.',
  ruleTwoPerson: 'Just you deciding. No vote means approved.',
  approve: 'Approve',
  deny: 'Deny',
  voteApprove: 'Vote: approve',
  voteDeny: 'Vote: deny',
  requester: 'Your request · waiting on the group',
  cancelled: 'Cancelled',
  cancelledOverturned: 'Cancelled · the check-in counts again',
  resultKicker: 'FREEZE',
  yourRequest: 'Your request',
  missRemoved: 'Miss removed.',
} as const

/** A freeze request's status as the server stores it. */
export type FreezeVoteStatus = 'pending' | 'approved' | 'denied' | 'cancelled' | 'withdrawn'

export function isFreezeVoteStatus(value: unknown): value is FreezeVoteStatus {
  return (
    value === 'pending' ||
    value === 'approved' ||
    value === 'denied' ||
    value === 'cancelled' ||
    value === 'withdrawn'
  )
}

/** What a request or result names: the habit's title, its schedule and the day or week. */
interface FreezeSubject {
  /** The task's name, else the activity's. */
  title: string
  scheduleType: 'fixed_days' | 'times_per_week' | null
  /** The frozen day (`YYYY-MM-DD`): fixed days and tasks; null for times per week. */
  sessionDay: string | null
  /** The request's week relative to the requester's week when it was made. */
  which: FreezeWhich
  /** The week's sessions that are not frozen (times per week), live; null when unknown. */
  weekTarget: number | null
}

/**
 * A freeze request on the wall (`feed_items` `item_kind = 'freeze'`): sorted at `opened_at`, its id
 * is the request id (the `/feed/v/{voteId}` id). Never for a solo request or a withdrawn one.
 */
export interface FeedFreezeVote extends FreezeSubject {
  type: 'freezeVote'
  id: string
  groupId: string
  sortAt: string
  requesterId: string | null
  requesterName: string
  commitmentId: string | null
  status: FreezeVoteStatus
  reason: string
  closesAt: string
  /** Only one other member could vote when it opened (a 2-member group). */
  twoPerson: boolean
  /**
   * Why it was cancelled: the requester's end reason, `left` | `removed` | `account_deleted` (Story
   * 5.6), or `overturned` when an admin overturn restored its session's check-in (Epic 5 retro).
   */
  cancelReason: string | null
  /** Story 5.6: the requester who left, cancelling it (the admin on an overturn). */
  cancelledById: string | null
  /** The reader's own ballot (readable only by its voter). */
  myChoice: FreezeChoice | null
  myCastAt: string | null
  /** The reader is an eligible voter. */
  canVote: boolean
}

/** A closed freeze (`freeze_result` event): written once by `private.close_vote`. */
export interface FeedFreezeResult extends FreezeSubject {
  type: 'freezeResult'
  id: string
  groupId: string
  sortAt: string
  requesterId: string | null
  requesterName: string
  freezeRequestId: string
  outcome: 'approved' | 'denied'
  reason: string
  /** The approved session's miss had been recorded (its miss sticky is gone). */
  missRemoved: boolean
}

/** The freeze Vote card's state for the reader at `now`. */
export type FreezeVoteCardState =
  | { kind: 'open' }
  | { kind: 'voted'; choice: FreezeChoice }
  | { kind: 'requester' }
  | { kind: 'joinedLater' }
  | { kind: 'closing' }
  | { kind: 'closed'; outcome: 'approved' | 'denied' }
  | { kind: 'cancelled' }

/**
 * Which card the reader sees: cancelled (or withdrawn), closed with its outcome, past `closes_at`
 * but not yet closed, the requester's locked card, the reader's cast ballot, the buttons for an
 * eligible voter, else the "joined later" line.
 */
export function freezeVoteCardState(
  vote: Pick<FeedFreezeVote, 'status' | 'closesAt' | 'requesterId' | 'myChoice' | 'canVote'>,
  viewer: { userId: string; now: Date },
): FreezeVoteCardState {
  if (vote.status === 'cancelled' || vote.status === 'withdrawn') return { kind: 'cancelled' }
  if (vote.status === 'approved' || vote.status === 'denied')
    return { kind: 'closed', outcome: vote.status }
  const closes = Date.parse(vote.closesAt)
  if (!Number.isNaN(closes) && viewer.now.getTime() >= closes) return { kind: 'closing' }
  if (viewer.userId !== '' && vote.requesterId === viewer.userId) return { kind: 'requester' }
  if (vote.myChoice !== null) return { kind: 'voted', choice: vote.myChoice }
  if (vote.canVote) return { kind: 'open' }
  return { kind: 'joinedLater' }
}

/**
 * The kicker of an open request: hours left rounded down ("FREEZE REQUEST · 21 H LEFT", spoken
 * "Freeze request, 21 hours left"); under 1 hour the minutes, at least 1. Plain "FREEZE REQUEST"
 * once it is past `closes_at`, closed or cancelled.
 */
export function freezeVoteKicker(
  vote: Pick<FeedFreezeVote, 'status' | 'closesAt'>,
  now: Date,
): VoteKicker {
  const plain = { text: FREEZE_VOTE_COPY.kicker, spoken: 'Freeze request' }
  if (vote.status !== 'pending') return plain
  const closes = Date.parse(vote.closesAt)
  if (Number.isNaN(closes)) return plain
  const left = closes - now.getTime()
  if (left <= 0) return plain
  const hours = Math.floor(left / 3_600_000)
  if (hours >= 1) {
    return {
      text: `${FREEZE_VOTE_COPY.kicker} · ${hours} H LEFT`,
      spoken: `Freeze request, ${hours} ${hours === 1 ? 'hour' : 'hours'} left`,
    }
  }
  const minutes = Math.max(1, Math.floor(left / 60_000))
  return {
    text: `${FREEZE_VOTE_COPY.kicker} · ${minutes} MIN LEFT`,
    spoken: `Freeze request, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`,
  }
}

/** "Sat": the weekday of a calendar date (`YYYY-MM-DD`), read as that date; empty when malformed. */
export function dayOf(isoDate: string | null): string {
  if (isoDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return ''
  const at = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return ''
  return DAY_SHORT[at.getUTCDay()] ?? ''
}

function isWeek(subject: Pick<FreezeSubject, 'scheduleType'>): boolean {
  return subject.scheduleType === 'times_per_week'
}

/** "Study on Sat" ("Study" when the server sent no day). */
function dayTitle(subject: Pick<FreezeSubject, 'title' | 'sessionDay'>): string {
  const day = dayOf(subject.sessionDay)
  return day ? `${subject.title} on ${day}` : subject.title
}

function weekWord(which: FreezeWhich): string {
  return which === 'last' ? 'last week' : 'this week'
}

/**
 * The request line: "Dev wants Study on Sat frozen."; times per week "Dev wants one Gym session off
 * this week." ("… last week."); the requester's own "You want …".
 */
export function freezeRequestLine(vote: FeedFreezeVote, viewerId: string): string {
  const own = viewerId !== '' && vote.requesterId === viewerId
  const who = own ? 'You want' : `${vote.requesterName} wants`
  if (isWeek(vote)) return `${who} one ${vote.title} session off ${weekWord(vote.which)}.`
  return `${who} ${dayTitle(vote)} frozen.`
}

/** The card's heading for screen readers: "Vote on Dev's freeze request for Study". */
export function freezeVoteHeading(vote: FeedFreezeVote, viewerId: string): string {
  const own = viewerId !== '' && vote.requesterId === viewerId
  return `Vote on ${own ? 'your' : `${vote.requesterName}'s`} freeze request for ${vote.title}`
}

/** The reason's accessible name: "Reason: flu, in bed". */
export function reasonLabel(reason: string): string {
  return `Reason: ${reason}`
}

/** The rule line: "No votes means approved." (2 members: "Just you deciding. …"). */
export function freezeRuleLine(vote: Pick<FeedFreezeVote, 'twoPerson'>): string {
  return vote.twoPerson ? FREEZE_VOTE_COPY.ruleTwoPerson : FREEZE_VOTE_COPY.rule
}

/** The button's text: "Approve" / "Deny". */
export function freezeChoiceLabel(choice: FreezeChoice): string {
  return choice === 'approve' ? FREEZE_VOTE_COPY.approve : FREEZE_VOTE_COPY.deny
}

/** The button's name: "Vote: approve" / "Vote: deny". */
export function freezeChoiceButtonLabel(choice: FreezeChoice): string {
  return choice === 'approve' ? FREEZE_VOTE_COPY.voteApprove : FREEZE_VOTE_COPY.voteDeny
}

/** The toast after a cast: "Voted Approve" (its Undo button follows). */
export function freezeVotedToast(choice: FreezeChoice): string {
  return `Voted ${freezeChoiceLabel(choice)}`
}

/** "Voted Approve · 1 of 3 voted" ("Voted Approve" until the tally is in). */
export function freezeVotedLine(
  choice: FreezeChoice,
  tally: Pick<VoteTally, 'votedCount' | 'eligibleCount'> | null,
): string {
  const line = freezeVotedToast(choice)
  return tally ? `${line} · ${tally.votedCount} of ${tally.eligibleCount} voted` : line
}

/**
 * The outcome line: "Freeze approved · Study on Sat is off the plan." (+ " Miss removed." when a miss
 * had been recorded) / "Freeze denied · Study on Sat still counts."; times per week "Freeze approved
 * · one Gym session is off the plan." / "Freeze denied · Gym still needs 3 this week." (last week
 * "… still needed 3 last week.").
 */
export function freezeOutcomeLine(
  subject: FreezeSubject,
  outcome: 'approved' | 'denied',
  missRemoved = false,
): string {
  if (outcome === 'approved') {
    const what = isWeek(subject) ? `one ${subject.title} session` : dayTitle(subject)
    const line = `Freeze approved · ${what} is off the plan.`
    return missRemoved ? `${line} ${FREEZE_VOTE_COPY.missRemoved}` : line
  }
  if (isWeek(subject) && subject.weekTarget !== null && subject.weekTarget > 0) {
    const needs = subject.which === 'last' ? 'still needed' : 'still needs'
    return `Freeze denied · ${subject.title} ${needs} ${subject.weekTarget} ${weekWord(subject.which)}.`
  }
  return `Freeze denied · ${isWeek(subject) ? subject.title : dayTitle(subject)} still counts.`
}

/** The result sticky's request line: "Dev's request" / "Your request". */
export function freezeResultWho(item: FeedFreezeResult, viewerId: string): string {
  return viewerId !== '' && item.requesterId === viewerId
    ? FREEZE_VOTE_COPY.yourRequest
    : `${item.requesterName}'s request`
}

/**
 * The cancelled request's line (Story 5.6): "Cancelled · Dev left the group"; after an overturn
 * "Cancelled · the check-in counts again".
 */
export function freezeCancelledLine(
  vote: Pick<FeedFreezeVote, 'cancelReason' | 'cancelledById' | 'requesterId' | 'requesterName'>,
): string {
  if (vote.cancelReason === 'overturned') return FREEZE_VOTE_COPY.cancelledOverturned
  const name =
    vote.cancelledById !== null && vote.cancelledById === vote.requesterId
      ? vote.requesterName
      : null
  return cancelledLine(name, vote.cancelReason)
}
