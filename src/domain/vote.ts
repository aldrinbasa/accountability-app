import { isOverturned, overturnLine, rulingLine } from '@/domain/challenge'
import type { BackendErrorCode } from '@/domain/error-codes'
import { errorCopy } from '@/domain/error-codes'
import { feedTitle, type ChallengeStatus, type FeedCheckin, type FeedRuling } from '@/domain/feed'

/**
 * Votes on a challenge (Story 5.2). The server decides who may vote, every time and every count
 * (`cast_vote`, `undo_vote`, `vote_tallies`, `private.close_vote`); this file only maps what the
 * server sent onto the Vote card's state and words it.
 */

/** What a vote is on: a challenge (Story 5.2) or a freeze request (Story 5.5). */
export type VoteKind = 'challenge' | 'freeze'

/** A challenge ballot. */
export type VoteChoice = 'fake' | 'real'

/** A freeze ballot (Story 5.5). */
export type FreezeChoice = 'approve' | 'deny'

/** Any ballot `cast_vote` takes: a challenge's or a freeze's. */
export type AnyVoteChoice = VoteChoice | FreezeChoice

export function isVoteChoice(value: unknown): value is VoteChoice {
  return value === 'fake' || value === 'real'
}

export function isFreezeChoice(value: unknown): value is FreezeChoice {
  return value === 'approve' || value === 'deny'
}

/** The kind a ballot belongs to. */
export function choiceKind(choice: AnyVoteChoice): VoteKind {
  return isFreezeChoice(choice) ? 'freeze' : 'challenge'
}

/** The toast shows Undo this long (the server accepts it until `cast_at + 6 s`). */
export const UNDO_WINDOW_MS = 5000
/** When a ballot becomes final at the server: tallies are refetched after it. */
export const BALLOT_FINAL_MS = 6000

export const VOTE_COPY = {
  kicker: 'QUESTION',
  question: 'Does this count?',
  rule: "If nobody else votes, it doesn't count.",
  fake: "Doesn't count",
  real: 'Counts',
  voteFake: "Vote: doesn't count",
  voteReal: 'Vote: counts',
  saidFake: "You said it doesn't count",
  saidReal: 'You said it counts',
  undo: 'Undo',
  retry: 'Retry',
  challenger: "You flagged it · your vote: doesn't count",
  joinedLater: 'You joined after this vote opened.',
  closing: "Voting's closed. The result is on its way.",
  cancelled: 'Cancelled',
  undone: 'Vote undone.',
  offline: "You're offline. Votes need a signal.",
  failed: "Couldn't send your vote. Check your signal and tap Retry.",
  undoOffline: "Couldn't undo. You're offline.",
  undoFailed: "Couldn't undo your vote. Tap Retry.",
} as const

/**
 * A challenge on the wall (Story 5.2, `feed_items` `item_kind = 'challenge'`): sorted at
 * `opened_at`, its id is the challenge id (the `/feed/v/{voteId}` id). The challenger and the
 * check-in's owner with their live names, the check-in's commitment and photo, the challenge's state,
 * the counts once closed, and the reader's own ballot (`myChoice`, readable only by its voter) and
 * whether the reader is an eligible voter (`canVote`).
 */
export interface FeedVote {
  type: 'vote'
  /** The challenge id. */
  id: string
  groupId: string
  /** `opened_at`. */
  sortAt: string
  checkinId: string
  challengerId: string | null
  challengerName: string
  ownerId: string | null
  ownerName: string
  commitmentId: string
  commitmentKind: 'commitment' | 'task'
  activityName: string
  presetKey: string | null
  taskName: string | null
  capturedAt: string
  receivedAt: string
  fullPrunedAt: string | null
  status: ChallengeStatus
  closesAt: string
  /** Null while open. */
  fakeCount: number | null
  realCount: number | null
  /** `lone` (no ballot counted) or `normal`; null unless closed. */
  variant: 'lone' | 'normal' | null
  /** Why it was cancelled (Story 5.6): the leaver's end reason, `left` | `removed` | `account_deleted`. */
  cancelReason: string | null
  /** Story 5.6: who left (the challenger or the check-in's owner), cancelling it. */
  cancelledById: string | null
  /** Story 5.6: the reader can see the check-in (false once its owner left: no thumbnail). */
  photoVisible: boolean
  myChoice: VoteChoice | null
  myCastAt: string | null
  canVote: boolean
  /** Story 5.3: the admin who overturned a Fake ruling (live name, else as at the overturn). */
  overturnedById: string | null
  overturnedByName: string | null
}

/** `vote_tallies`: one open vote's "N of M voted" (a challenger counts in both; a requester never). */
export interface VoteTally {
  targetKind: VoteKind
  targetId: string
  votedCount: number
  eligibleCount: number
}

/** What `cast_vote` returned. */
export interface CastVoteResult {
  voteId: string
  castAt: string
}

/** The Vote card's state for the reader at `now`. */
export type VoteCardState =
  | { kind: 'open' }
  | { kind: 'voted'; choice: VoteChoice }
  | { kind: 'challenger' }
  | { kind: 'owner' }
  | { kind: 'joinedLater' }
  | { kind: 'closing' }
  | { kind: 'closed'; outcome: 'fake' | 'real' }
  | { kind: 'cancelled' }

/**
 * Which Vote card the reader sees: cancelled, closed (with the ruling), past `closes_at` but not yet
 * closed, the challenger's and the owner's locked cards, the reader's cast ballot, the buttons for an
 * eligible voter, else the "joined later" line.
 */
export function voteCardState(
  vote: Pick<FeedVote, 'status' | 'closesAt' | 'challengerId' | 'ownerId' | 'myChoice' | 'canVote'>,
  viewer: { userId: string; now: Date },
): VoteCardState {
  if (vote.status === 'cancelled') return { kind: 'cancelled' }
  if (vote.status === 'fake' || vote.status === 'real')
    return { kind: 'closed', outcome: vote.status }
  const closes = Date.parse(vote.closesAt)
  if (!Number.isNaN(closes) && viewer.now.getTime() >= closes) return { kind: 'closing' }
  if (viewer.userId !== '' && vote.challengerId === viewer.userId) return { kind: 'challenger' }
  if (viewer.userId !== '' && vote.ownerId === viewer.userId) return { kind: 'owner' }
  if (vote.myChoice !== null) return { kind: 'voted', choice: vote.myChoice }
  if (vote.canVote) return { kind: 'open' }
  return { kind: 'joinedLater' }
}

/** The kicker: what it shows ("QUESTION · 18 H LEFT") and what a screen reader says. */
export interface VoteKicker {
  text: string
  spoken: string
}

/**
 * The kicker of an open challenge: hours left rounded down ("QUESTION · 18 H LEFT", spoken
 * "Question, 18 hours left"); under 1 hour the minutes, at least 1 ("QUESTION · 5 MIN LEFT").
 * Plain "QUESTION" once it is past `closes_at`, closed or cancelled.
 */
export function voteKicker(vote: Pick<FeedVote, 'status' | 'closesAt'>, now: Date): VoteKicker {
  const plain = { text: VOTE_COPY.kicker, spoken: 'Question' }
  if (vote.status !== 'open') return plain
  const closes = Date.parse(vote.closesAt)
  if (Number.isNaN(closes)) return plain
  const left = closes - now.getTime()
  if (left <= 0) return plain
  const hours = Math.floor(left / 3_600_000)
  if (hours >= 1) {
    return {
      text: `${VOTE_COPY.kicker} · ${hours} H LEFT`,
      spoken: `Question, ${hours} ${hours === 1 ? 'hour' : 'hours'} left`,
    }
  }
  const minutes = Math.max(1, Math.floor(left / 60_000))
  return {
    text: `${VOTE_COPY.kicker} · ${minutes} MIN LEFT`,
    spoken: `Question, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`,
  }
}

/** The check-in's title: the task's name, else the activity's. */
export function voteTitle(vote: Pick<FeedVote, 'taskName' | 'activityName'>): string {
  return feedTitle(vote)
}

/**
 * "Lena questioned Dev's Study check-in." with the Feed's "You" rule: "You questioned Dev's Study
 * check-in.", "Lena questioned your Study check-in.".
 */
export function voteWhoLine(vote: FeedVote, viewerId: string): string {
  const who = viewerId !== '' && vote.challengerId === viewerId ? 'You' : vote.challengerName
  const whose = viewerId !== '' && vote.ownerId === viewerId ? 'your' : `${vote.ownerName}'s`
  return `${who} questioned ${whose} ${voteTitle(vote)} check-in.`
}

/** The card's heading for screen readers: "Vote on whether Dev's Study check-in counts". */
export function voteHeading(vote: FeedVote, viewerId: string): string {
  const whose = viewerId !== '' && vote.ownerId === viewerId ? 'your' : `${vote.ownerName}'s`
  return `Vote on whether ${whose} ${voteTitle(vote)} check-in counts`
}

/** "3 of 4 voted". */
export function tallyLine(tally: Pick<VoteTally, 'votedCount' | 'eligibleCount'>): string {
  return `${tally.votedCount} of ${tally.eligibleCount} voted`
}

/** The button's text: "Doesn't count" / "Counts". */
export function choiceLabel(choice: VoteChoice): string {
  return choice === 'fake' ? VOTE_COPY.fake : VOTE_COPY.real
}

/** The button's name: "Vote: doesn't count" / "Vote: counts". */
export function choiceButtonLabel(choice: VoteChoice): string {
  return choice === 'fake' ? VOTE_COPY.voteFake : VOTE_COPY.voteReal
}

/** What the reader said: "You said it counts" / "You said it doesn't count". */
export function choiceSaid(choice: VoteChoice): string {
  return choice === 'fake' ? VOTE_COPY.saidFake : VOTE_COPY.saidReal
}

/** "You said it counts · 3 of 4 voted" ("You said it counts" until the tally is in). */
export function votedLine(
  choice: VoteChoice,
  tally: Pick<VoteTally, 'votedCount' | 'eligibleCount'> | null,
): string {
  const line = choiceSaid(choice)
  return tally ? `${line} · ${tallyLine(tally)}` : line
}

/** The toast after a cast: "You said it doesn't count" (its Undo button follows). */
export function votedToast(choice: VoteChoice): string {
  return choiceSaid(choice)
}

/** The closed card's ruling line (Story 5.1's `rulingLine`); null unless closed with counts. */
export function voteRulingLine(vote: FeedVote, viewerId: string): string | null {
  if (vote.status !== 'fake' && vote.status !== 'real') return null
  if (vote.fakeCount === null || vote.realCount === null) return null
  const ruling: FeedRuling = {
    type: 'ruling',
    id: vote.id,
    groupId: vote.groupId,
    sortAt: vote.sortAt,
    challengeId: vote.id,
    checkinId: vote.checkinId,
    challengerId: vote.challengerId,
    challengerName: vote.challengerName,
    ownerId: vote.ownerId,
    ownerName: vote.ownerName,
    title: voteTitle(vote),
    outcome: vote.status,
    fakeCount: vote.fakeCount,
    realCount: vote.realCount,
    variant: vote.variant ?? (vote.realCount === 0 && vote.fakeCount === 1 ? 'lone' : 'normal'),
    overturnUntil: null,
    canOverturn: false,
    overturnedById: vote.overturnedById,
    overturnedByName: vote.overturnedByName,
    overturnedAt: null,
  }
  return rulingLine(ruling, viewerId)
}

/**
 * The closed Fake card's overturned line (Story 5.3): "Overturned by Jo · Dev's Study is back."
 * with the Feed's "You" rule; null unless a Fake ruling was overturned.
 */
export function voteOverturnLine(vote: FeedVote, viewerId: string): string | null {
  if (vote.status !== 'fake') return null
  return overturnLine(vote, voteTitle(vote), viewerId)
}

/**
 * Whether the card shows the thumbnail: never once the check-in's owner left (the reader cannot see
 * it, Story 5.6); not on a standing Fake ruling (Storage denies its photo); again once overturned.
 */
export function voteShowsThumbnail(
  vote: Pick<FeedVote, 'status' | 'overturnedById' | 'overturnedByName' | 'photoVisible'>,
): boolean {
  if (!vote.photoVisible) return false
  return vote.status !== 'fake' || isOverturned(vote)
}

/**
 * A cancelled vote's line (Story 5.6): "Cancelled · Sam left the group" (left, or the account was
 * deleted), "Cancelled · Sam was removed from the group" (removed); plain "Cancelled" without a name.
 */
export function cancelledLine(name: string | null, reason: string | null): string {
  if (name === null || name === '') return VOTE_COPY.cancelled
  const what = reason === 'removed' ? 'was removed from the group' : 'left the group'
  return `${VOTE_COPY.cancelled} · ${name} ${what}`
}

/** The cancelled challenge's line, naming the challenger or the owner who left. */
export function voteCancelledLine(
  vote: Pick<
    FeedVote,
    'cancelReason' | 'cancelledById' | 'challengerId' | 'challengerName' | 'ownerId' | 'ownerName'
  >,
): string {
  const by = vote.cancelledById
  const name =
    by === null
      ? null
      : by === vote.challengerId
        ? vote.challengerName
        : by === vote.ownerId
          ? vote.ownerName
          : null
  return cancelledLine(name, vote.cancelReason)
}

/**
 * The challenged check-in as a Feed check-in, for the thumbnail and the Photo viewer (no caption or
 * counted position: the card's row carries neither).
 */
export function voteCheckin(vote: FeedVote): FeedCheckin {
  return {
    type: 'checkin',
    id: vote.checkinId,
    groupId: vote.groupId,
    sortAt: vote.receivedAt,
    authorId: vote.ownerId ?? '',
    authorName: vote.ownerName,
    authorAvatarPath: null,
    commitmentId: vote.commitmentId,
    commitmentKind: vote.commitmentKind,
    activityName: vote.activityName,
    presetKey: vote.presetKey,
    taskName: vote.taskName,
    capturedAt: vote.capturedAt,
    receivedAt: vote.receivedAt,
    isLate: false,
    isExtra: false,
    caption: null,
    fullPrunedAt: vote.fullPrunedAt,
    countedPosition: null,
    target: null,
    challengeId: vote.id,
    challengeStatus: vote.status,
    challengeClosesAt: vote.closesAt,
    challengeUntil: null,
  }
}

/** The thumbnail button's name: "View Dev's Study check-in photo". */
export function voteThumbnailLabel(vote: FeedVote, viewerId: string): string {
  const whose = viewerId !== '' && vote.ownerId === viewerId ? 'your' : `${vote.ownerName}'s`
  return `View ${whose} ${voteTitle(vote)} check-in photo`
}

/**
 * How a failed cast shows: `offline` (error toast, card stays unvoted), `failed` (Inline retry on
 * the card, Retry resends the same choice), or a refusal (error toast with the table copy, then a
 * Feed refetch).
 */
export type CastFailure =
  { kind: 'offline' } | { kind: 'failed' } | { kind: 'refused'; text: string }

export function castFailure(code: BackendErrorCode, offline: boolean): CastFailure {
  if (offline) return { kind: 'offline' }
  switch (code) {
    case 'vote_closed':
    case 'already_voted':
    case 'not_eligible':
    case 'not_member':
    case 'group_waiting':
    case 'invalid_vote':
      return { kind: 'refused', text: errorCopy(code) }
    default:
      return { kind: 'failed' }
  }
}

/**
 * How a failed undo shows (always an error toast): offline; a plain failure (Retry while the toast's
 * 5 s window is open); or a refusal with the table copy (`undo_expired`, `vote_closed`, `not_member`,
 * then a Feed refetch).
 */
export type UndoFailure =
  | { kind: 'offline'; text: string }
  | { kind: 'failed'; text: string }
  | { kind: 'refused'; text: string }

export function undoFailure(code: BackendErrorCode, offline: boolean): UndoFailure {
  if (offline) return { kind: 'offline', text: VOTE_COPY.undoOffline }
  switch (code) {
    case 'undo_expired':
    case 'vote_closed':
    case 'not_member':
    case 'invalid_vote':
      return { kind: 'refused', text: errorCopy(code) }
    default:
      return { kind: 'failed', text: VOTE_COPY.undoFailed }
  }
}
