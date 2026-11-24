import type { BackendErrorCode } from '@/domain/error-codes'
import { errorCopy } from '@/domain/error-codes'
import { feedTitle, type FeedCheckin, type FeedRuling, type FeedViewer } from '@/domain/feed'
import { formatLockTime } from '@/domain/time-zones'

/**
 * Challenges (Story 5.1). The server decides who may challenge, every time and every outcome
 * (`create_challenge`, `private.close_vote`, `feed_items.challenge_until`); this file only compares
 * the server's timestamps with the clock to show or hide controls, and words what the server sent.
 */

export const CHALLENGE_COPY = {
  challenge: 'Question it',
  ruleItFake: "Don't count it",
  sending: 'Sending…',
  ritual: "The photo's a ritual, not a court case.",
  offline: "You're offline. Questioning a check-in needs a signal.",
  failed: "Couldn't question the check-in. Tap Retry.",
  gone: "That check-in can't be questioned anymore.",
  rulingKicker: 'Result',
  overturnOffline: "You're offline. Overturns need a signal.",
  overturnFailed: "Couldn't overturn it. Tap Retry.",
  overturnLocked: 'This week has locked. The result is final.',
  overturnNotAdmin: 'Only the group admin can overturn a result.',
  overturnOwn: "You can't overturn a result on your own check-in.",
  overturnOwnerLeft: 'That member left the group, so the result stands.',
  retry: 'Retry',
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

/** The Vote chip: what it shows ("QUESTIONED · 18 H LEFT") and what a screen reader says. */
export interface ChallengeChip {
  text: string
  spoken: string
}

/**
 * The Vote chip of an open challenge: hours left rounded down ("QUESTIONED · 18 H LEFT", spoken
 * "questioned, 18 hours left"); under 1 hour the minutes, at least 1 ("QUESTIONED · 5 MIN LEFT").
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
      text: `QUESTIONED · ${hours} H LEFT`,
      spoken: `questioned, ${hours} ${hours === 1 ? 'hour' : 'hours'} left`,
    }
  }
  const minutes = Math.max(1, Math.floor(left / 60_000))
  return {
    text: `QUESTIONED · ${minutes} MIN LEFT`,
    spoken: `questioned, ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`,
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

/** The confirm Sheet's title: "Question Dev's Study?". */
export function challengeSheetTitle(
  item: Pick<FeedCheckin, 'authorName' | 'taskName' | 'activityName'>,
): string {
  return `Question ${item.authorName}'s ${feedTitle(item)}?`
}

/** True for a group of exactly two: the check-in stops counting at once, no vote. */
export function isTwoPerson(memberCount: number): boolean {
  return memberCount === 2
}

/** The confirm Sheet's body: the vote rules (3+ members) or the at-once result (2 members). */
export function challengeSheetBody(memberCount: number): string {
  return isTwoPerson(memberCount)
    ? "It's just the two of you, so it stops counting right away. No vote."
    : "This casts your vote: doesn't count. The group has 24 h. If nobody else votes, it doesn't count; a tie keeps it."
}

/** The confirm button: "Don't count it" (2 members) or "Question it". */
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

/** The copy of a challenge failure ("That check-in can't be questioned anymore." for `gone`). */
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
 * The result sticky's line, with the Feed's "You" rule (the viewer's own name reads "You", their
 * own check-in "Your Study"):
 * real "Counts · the group backed it · Dev's Study · 3 said it counts, 1 said it doesn't.";
 * tie "Counts · a tie keeps it · Dev's Study · 2 said it counts, 2 said it doesn't.";
 * fake "Didn't count · Dev's Study · 3 said it doesn't count, 1 said it counts.";
 * lone "Didn't count · Dev's Study · nobody else voted.";
 * 2-person "Didn't count · Dev's Study · Lena questioned it.".
 */
export function rulingLine(item: FeedRuling, viewerId: string): string {
  const ownCheckin = item.ownerId !== null && item.ownerId === viewerId
  const what = `${owner(item.ownerName, ownCheckin)} ${item.title}`
  if (item.outcome === 'real') {
    const why = item.fakeCount === item.realCount ? 'a tie keeps it' : 'the group backed it'
    return `Counts · ${why} · ${what} · ${item.realCount} said it counts, ${item.fakeCount} said it doesn't.`
  }
  if (item.variant === 'lone') return `Didn't count · ${what} · nobody else voted.`
  if (item.variant === 'two_person') {
    const ownChallenge = item.challengerId !== null && item.challengerId === viewerId
    const who = ownChallenge ? 'You' : item.challengerName
    return `Didn't count · ${what} · ${who} questioned it.`
  }
  return `Didn't count · ${what} · ${item.fakeCount} said it doesn't count, ${item.realCount} said it counts.`
}

/** What `overturn_ruling` returned (Story 5.3). */
export interface OverturnResult {
  overturnId: string
  createdAt: string
}

/** The overturn fields a ruling sticky or a Vote card carries. */
interface Overturnable {
  ownerId: string | null
  ownerName: string
  overturnedById: string | null
  overturnedByName: string | null
}

/** True once an admin overturned the ruling. */
export function isOverturned(item: Pick<Overturnable, 'overturnedById' | 'overturnedByName'>) {
  return item.overturnedById !== null || item.overturnedByName !== null
}

/**
 * The overturned line, with the Feed's "You" rule: "Overturned by Jo · Dev's Study is back.";
 * the admin reads "Overturned by you · …", the owner "… · Your Study is back.". Null until
 * overturned.
 */
export function overturnLine(item: Overturnable, title: string, viewerId: string): string | null {
  if (!isOverturned(item)) return null
  const byYou = viewerId !== '' && item.overturnedById === viewerId
  const ownCheckin = viewerId !== '' && item.ownerId === viewerId
  const who = byYou ? 'you' : (item.overturnedByName ?? '')
  return `Overturned by ${who} · ${owner(item.ownerName, ownCheckin)} ${title} is back.`
}

/**
 * Whether the ruling sticky shows the admin's Overturn button: the server said the reader may
 * (`can_overturn`), the ruling is Fake and not overturned, and the clock is still before the
 * server's `overturn_until` (the week's lock).
 */
export function canShowOverturn(
  item: Pick<
    FeedRuling,
    'outcome' | 'canOverturn' | 'overturnUntil' | 'overturnedById' | 'overturnedByName'
  >,
  now: Date,
): boolean {
  if (!item.canOverturn || item.outcome !== 'fake' || isOverturned(item)) return false
  if (item.overturnUntil === null) return false
  const until = Date.parse(item.overturnUntil)
  return !Number.isNaN(until) && now.getTime() < until
}

/**
 * The button: "Overturn (admin) until Wed 23:59", the lock time in the group's zone, naming it
 * when the member's zone differs ("until Wed 23:59 London time").
 */
export function overturnButtonLabel(
  overturnUntil: string,
  groupZone: string,
  memberZone: string,
): string {
  return `Overturn (admin) until ${formatLockTime(overturnUntil, groupZone, memberZone)}`
}

/**
 * How a failed overturn shows: `offline` (error toast), `failed` (Inline retry on the sticky, Retry
 * resends), or a refusal (error toast with its copy, then a Feed refetch).
 */
export type OverturnFailure =
  { kind: 'offline'; text: string } | { kind: 'failed' } | { kind: 'refused'; text: string }

export function overturnFailure(code: BackendErrorCode, offline: boolean): OverturnFailure {
  if (offline) return { kind: 'offline', text: CHALLENGE_COPY.overturnOffline }
  switch (code) {
    case 'week_locked':
      return { kind: 'refused', text: CHALLENGE_COPY.overturnLocked }
    case 'not_admin':
      return { kind: 'refused', text: CHALLENGE_COPY.overturnNotAdmin }
    case 'own_checkin':
      return { kind: 'refused', text: CHALLENGE_COPY.overturnOwn }
    // Also raised when the check-in's owner left: the admin is told the result stands.
    case 'not_member':
      return { kind: 'refused', text: CHALLENGE_COPY.overturnOwnerLeft }
    case 'not_fake_ruling':
    case 'already_overturned':
      return { kind: 'refused', text: errorCopy(code) }
    default:
      return { kind: 'failed' }
  }
}
