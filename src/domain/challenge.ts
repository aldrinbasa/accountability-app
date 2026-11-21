import type { BackendErrorCode } from '@/domain/error-codes'
import { errorCopy } from '@/domain/error-codes'
import { feedTitle, type FeedCheckin, type FeedRuling, type FeedViewer } from '@/domain/feed'

/**
 * Challenges (Story 5.1). The server decides who may challenge, every time and every outcome
 * (`create_challenge`, `private.close_vote`, `feed_items.challenge_until`); this file only compares
 * the server's timestamps with the clock to show or hide controls, and words what the server sent.
 */

export const CHALLENGE_COPY = {
  challenge: 'Challenge',
  ruleItFake: 'Rule it Fake',
  sending: 'Sending…',
  ritual: "The photo's a ritual, not a court case.",
  offline: "You're offline. Challenges need a signal.",
  failed: "Couldn't send the challenge. Tap Retry.",
  gone: "That check-in can't be challenged anymore.",
  rulingKicker: 'Ruling',
} as const

/** What `create_challenge` returned: the new challenge, `fake` when a 2-member group ruled at once. */
export interface CreateChallengeResult {
  challengeId: string
  status: 'open' | 'fake'
  closesAt: string
}

/** "Dev's" for someone else, "Your" for the viewer. */
function owner(name: string, own: boolean): string {
  return own ? 'Your' : `${name}'s`
}

/**
 * Whether the viewer may challenge this check-in: someone else's, never challenged, still before the
 * server's `challenge_until`, in a group of 2 or more current members. Late check-ins stay
 * challengeable (the window runs from `received_at`, which the server already applied).
 */
export function canChallenge(
  item: Pick<FeedCheckin, 'authorId' | 'challengeId' | 'challengeUntil'>,
  viewer: Pick<FeedViewer, 'userId' | 'now'>,
  memberCount: number,
): boolean {
  if (memberCount < 2) return false
  if (viewer.userId === '' || item.authorId === viewer.userId) return false
  if (item.challengeId !== null || item.challengeUntil === null) return false
  const until = Date.parse(item.challengeUntil)
  return !Number.isNaN(until) && viewer.now.getTime() < until
}

/** The Vote chip: what it shows ("CHALLENGED · 18 H LEFT") and what a screen reader says. */
export interface ChallengeChip {
  text: string
  spoken: string
}

/**
 * The Vote chip of an open challenge: hours left rounded down ("CHALLENGED · 18 H LEFT", spoken
 * "challenged, 18 hours left"); under 1 hour the minutes, at least 1 ("CHALLENGED · 5 MIN LEFT").
 * Null unless the challenge is open and its `closes_at` is still ahead.
 */
export function challengeChip(
  item: Pick<FeedCheckin, 'challengeStatus' | 'challengeClosesAt'>,
  now: Date,
): ChallengeChip | null {
  if (item.challengeStatus !== 'open' || item.challengeClosesAt === null) return null
  const closes = Date.parse(item.challengeClosesAt)
  if (Number.isNaN(closes)) return null
  const left = closes - now.getTime()
  if (left <= 0) return null
  const hours = Math.floor(left / 3_600_000)
  if (hours >= 1) {
    return {
      text: `CHALLENGED · ${hours} H LEFT`,
      spoken: `challenged, ${hours} ${hours === 1 ? 'hour' : 'hours'} left`,
    }
  }
  const minutes = Math.max(1, Math.floor(left / 60_000))
  return {
    text: `CHALLENGED · ${minutes} MIN LEFT`,
    spoken: `challenged, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`,
  }
}

/** The Overflow's name: "More actions for Dev's Study check-in". */
export function challengeOverflowLabel(
  item: Pick<FeedCheckin, 'authorName' | 'taskName' | 'activityName'>,
): string {
  return `More actions for ${item.authorName}'s ${feedTitle(item)} check-in`
}

/** The actions Sheet's title: "Dev's Study check-in". */
export function challengeActionsTitle(
  item: Pick<FeedCheckin, 'authorName' | 'taskName' | 'activityName'>,
): string {
  return `${item.authorName}'s ${feedTitle(item)} check-in`
}

/** The confirm Sheet's title: "Challenge Dev's Study?". */
export function challengeSheetTitle(
  item: Pick<FeedCheckin, 'authorName' | 'taskName' | 'activityName'>,
): string {
  return `Challenge ${item.authorName}'s ${feedTitle(item)}?`
}

/** True for a group of exactly two: the challenge rules Fake at once, no vote. */
export function isTwoPerson(memberCount: number): boolean {
  return memberCount === 2
}

/** The confirm Sheet's body: the vote rules (3+ members) or the at-once ruling (2 members). */
export function challengeSheetBody(memberCount: number): string {
  return isTwoPerson(memberCount)
    ? "It's just the two of you, so this rules it Fake right away. No vote."
    : "Your challenge counts as a Fake vote. The group has 24 h. If nobody else votes, it's ruled Fake; a tie keeps it."
}

/** The confirm button: "Rule it Fake" (2 members) or "Challenge". */
export function challengeActionLabel(memberCount: number): string {
  return isTwoPerson(memberCount) ? CHALLENGE_COPY.ruleItFake : CHALLENGE_COPY.challenge
}

/** The ritual meta line, shown only with a vote (3+ members). */
export function challengeSheetMeta(memberCount: number): string | null {
  return isTwoPerson(memberCount) ? null : CHALLENGE_COPY.ritual
}

/**
 * Why a challenge did not go through, besides offline and a plain failure (no Retry for these):
 * `gone` (already challenged, past 24 h, week locked, or `not_member`: the check-in's owner left;
 * a challenger who left meets it only with a stale cache), `own`, `waiting` (alone in the group).
 */
export type ChallengeFailure = 'gone' | 'own' | 'waiting'

/** A rejected `create_challenge` as a flow failure; anything unmapped is a plain `failed`. */
export function challengeFailure(code: BackendErrorCode): ChallengeFailure | 'failed' {
  switch (code) {
    case 'already_challenged':
    case 'challenge_expired':
    case 'week_locked':
    case 'not_member':
      return 'gone'
    case 'own_checkin':
      return 'own'
    case 'group_waiting':
      return 'waiting'
    default:
      return 'failed'
  }
}

/** The copy of a challenge failure ("That check-in can't be challenged anymore." for `gone`). */
export function challengeFailureText(failure: ChallengeFailure): string {
  switch (failure) {
    case 'gone':
      return CHALLENGE_COPY.gone
    case 'own':
      return errorCopy('own_checkin')
    case 'waiting':
      return errorCopy('group_waiting')
  }
}

/**
 * The ruling sticky's line, with the Feed's "You" rule (the viewer's own name reads "You", their own
 * check-in "Your Study"):
 * Real "Ruled Real · Dev's Study stands. 2 Fake, 2 Real.";
 * Fake "Ruled Fake · Dev's Study removed. 3 Fake, 1 Real.";
 * lone "Ruled Fake · nobody else voted · Dev's Study removed.";
 * 2-person "Ruled Fake · Lena challenged · Dev's Study removed.".
 */
export function rulingLine(item: FeedRuling, viewerId: string): string {
  const ownCheckin = item.ownerId !== null && item.ownerId === viewerId
  const what = `${owner(item.ownerName, ownCheckin)} ${item.title}`
  const counts = `${item.fakeCount} Fake, ${item.realCount} Real.`
  if (item.outcome === 'real') return `Ruled Real · ${what} stands. ${counts}`
  if (item.variant === 'lone') return `Ruled Fake · nobody else voted · ${what} removed.`
  if (item.variant === 'two_person') {
    const ownChallenge = item.challengerId !== null && item.challengerId === viewerId
    const who = ownChallenge ? 'You' : item.challengerName
    return `Ruled Fake · ${who} challenged · ${what} removed.`
  }
  return `Ruled Fake · ${what} removed. ${counts}`
}
