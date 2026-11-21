import type { PlanItem } from '@/domain/board'
import { formatLockTime } from '@/domain/time-zones'

/**
 * Badges, titles and member profiles (Story 4.6, FR-24, FR-30): what `get_member_profile` returns
 * and the copy built from it. Badge rules, statuses, points and titles are the server's (AD-4) and
 * the badge names, how-earned text and lines come from the `badges` catalog; this file only formats.
 */

export type BadgeStatus = 'earned' | 'pending' | 'locked'

/** One of the 15 catalog badges with the member's status. */
export interface ProfileBadge {
  key: string
  name: string
  howEarned: string
  line: string
  /** A Phosphor icon name (the catalog's `icon`). */
  icon: string
  status: BadgeStatus
  /** When earned: the (latest) award, ISO 8601. */
  awardedAt: string | null
  /** When pending: the lock of the earliest unlocked week that meets it, ISO 8601. */
  pendingLockAt: string | null
  /** How many times it was awarded (0 when never; Weekly Winner and Team Player repeat). */
  awardCount: number
}

/** A streak per active commitment on a profile. */
export interface ProfileStreak {
  commitmentId: string
  activityName: string
  currentStreak: number
  backToZero: boolean
}

/** A member in a group as Me and the member profile read it (`get_member_profile`). */
export interface MemberProfile {
  displayName: string
  avatarPath: string | null
  /** False for a member who left or was removed (only name and avatar are filled). */
  isCurrentMember: boolean
  allTimePoints: number
  /** The `titles` key for the all-time points; null for a member who left. */
  titleKey: string | null
  /** The group's zone for its current week (the pending seals' lock time). */
  timeZone: string | null
  badges: ProfileBadge[]
  streaks: ProfileStreak[]
  plan: PlanItem[]
  taskCount: number
}

/** One rung of the title ladder (`titles`). */
export interface Title {
  key: string
  name: string
  minPoints: number
}

export const PROFILE_COPY = {
  badges: 'Badges',
  streaks: 'Streaks',
  recent: 'Recent check-ins',
  titles: 'Titles',
  pendingChip: 'Unlocks at week lock',
  current: 'current title',
  back: 'Back',
  close: 'Close',
  unknownMember: "This member isn't in this group anymore.",
  noStreaks: 'No streaks yet.',
} as const

const NUMBER = new Intl.NumberFormat('en-US')

/** Thousands separators: 1284 → "1,284". */
export function formatPoints(points: number): string {
  return NUMBER.format(points)
}

/** "1,284 all-time points in Sunday Reset" ("1 all-time point in …"). */
export function allTimePointsText(points: number, groupName: string): string {
  const unit = points === 1 ? 'all-time point' : 'all-time points'
  return `${formatPoints(points)} ${unit} in ${groupName}`
}

/** "12 Nov": a day in the viewer's zone. */
export function shortDay(iso: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

/** The count mark on an earned seal ("×3"), or null below 2 (a one-time award shows none). */
export function awardCountMark(badge: Pick<ProfileBadge, 'status' | 'awardCount'>): string | null {
  return badge.status === 'earned' && badge.awardCount >= 2 ? `×${badge.awardCount}` : null
}

/**
 * The seal button's name: "First Proof, earned 12 Nov" / "Team Player, earned 3 times, last 12 Nov"
 * (a repeat badge earned 2+ times) / "First Proof, pending" / "…, locked".
 */
export function badgeLabel(badge: ProfileBadge, zone: string): string {
  if (badge.status === 'earned' && badge.awardedAt) {
    const day = shortDay(badge.awardedAt, zone)
    return badge.awardCount >= 2
      ? `${badge.name}, earned ${badge.awardCount} times, last ${day}`
      : `${badge.name}, earned ${day}`
  }
  return `${badge.name}, ${badge.status === 'pending' ? 'pending' : 'locked'}`
}

/** "Earned 12 Nov" in the badge Sheet; "Earned 3 times · last 12 Nov" for a count of 2 or more. */
export function earnedText(awardedAt: string, zone: string, awardCount = 1): string {
  const day = shortDay(awardedAt, zone)
  return awardCount >= 2 ? `Earned ${awardCount} times · last ${day}` : `Earned ${day}`
}

/**
 * "Unlocks when the week locks, Wed 23:59." in group time; the zone is named when the group's
 * differs from the viewer's ("Wed 23:59 Manila time").
 */
export function pendingText(lockAt: string, groupZone: string, viewerZone: string): string {
  return `Unlocks when the week locks, ${formatLockTime(lockAt, groupZone, viewerZone)}.`
}

/** DESIGN.md `badge-seal`: earned fills rotate vote / sticky / sticky2 in catalog order. */
export function sealFill(index: number): 'vote' | 'sticky' | 'sticky2' {
  return (['vote', 'sticky', 'sticky2'] as const)[index % 3] ?? 'vote'
}

/** The title's name for its key, or "" while the ladder is not loaded. */
export function titleName(titles: readonly Title[] | undefined, key: string | null): string {
  return titles?.find((title) => title.key === key)?.name ?? ''
}

/** A ladder rung: "Warming Up · 300 points". */
export function titleRungText(title: Title): string {
  return `${title.name} · ${formatPoints(title.minPoints)} points`
}

/** "Sam isn't in this group anymore." */
export function leftMemberText(name: string): string {
  return `${name} isn't in this group anymore.`
}

/** The Title sticky's accessible name: "Title: Couch Potato. Show all titles". */
export function titleButtonLabel(name: string): string {
  return `Title: ${name}. Show all titles`
}
