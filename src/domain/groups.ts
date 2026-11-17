import type { RpcErrorCode } from '@/domain/error-codes'

export type GroupRole = 'admin' | 'member'

/** One of the signed-in member's current groups (`public.groups` + their current membership). */
export interface MyGroup {
  id: string
  name: string
  /** The group time zone (week lock and winner). Read-only until Story 2.7. */
  timeZone: string
  /** The member's own role in the group. */
  role: GroupRole
  /** When the member joined (ISO timestamp). Breaks focus ties: earliest joined wins. */
  joinedAt: string
  /** Current members, the member included. */
  memberCount: number
}

/** Group names are trimmed and 1 to 32 characters (the same rule as the database check). */
export const GROUP_NAME_MAX = 32

/** Groups hold 1 to 10 members. */
export const GROUP_MEMBER_MAX = 10

/** Copy shared by the create form, the switcher, Me and group settings (Story 1.6 ACs). */
export const GROUP_COPY = {
  createHeading: 'Start a group',
  createLine: 'Give it a name your friends will recognize. Invites come next.',
  nameLabel: 'Group name',
  create: 'Create a group',
  saving: 'Saving…',
  offline: "You're offline. Groups need a signal to start.",
  createFailed: "Couldn't create the group. Check your signal and tap Retry.",
  retry: 'Retry',
  waitingLine: 'Just you in here so far.',
  waitingBody:
    'Scoring, votes and the leaderboard start the moment a second friend joins. Accountability needs an audience.',
  waitingCount: 'waiting for a 2nd member',
  switcherSheetTitle: 'Your groups',
  createOrJoin: 'Create or join a group',
  myGroups: 'My groups',
  timeZoneLabel: 'Group time zone',
  timeZoneNote: 'Sets the week lock and winner for everyone. Changes start next week.',
  loadFailedLine: "Can't reach Proofy right now.",
  loadFailedBody: 'Check your signal and try again.',
  tryAgain: 'Try again',
  myGroupsFailed: "Couldn't load your groups. Check your signal and tap Retry.",
} as const

export const ROLE_LABEL: Record<GroupRole, string> = {
  admin: 'Admin',
  member: 'Member',
}

/** Characters as the database counts them (code points), so an emoji is one, not two. */
function characters(value: string): string[] {
  return Array.from(value)
}

export function trimGroupName(value: string): string {
  return value.trim()
}

/** `invalid_group_name` for a blank or over-32-character name (after trimming), else null. */
export function validateGroupName(value: string): RpcErrorCode | null {
  const length = characters(trimGroupName(value)).length
  return length >= 1 && length <= GROUP_NAME_MAX ? null : 'invalid_group_name'
}

function joinedTime(group: MyGroup): number {
  const time = Date.parse(group.joinedAt)
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

/** Groups in the order the member joined them (earliest first; ties by id, so it is stable). */
export function sortByJoined(groups: readonly MyGroup[]): MyGroup[] {
  return [...groups].sort((a, b) => joinedTime(a) - joinedTime(b) || a.id.localeCompare(b.id))
}

/**
 * The focused group (AD-12): the URL's `?g=` when the member is a current member of it, else the
 * stored focused group when still current, else the current group joined earliest. Null with no
 * current groups.
 */
export function resolveFocusedGroup(
  urlId: string | null,
  storedId: string | null,
  groups: readonly MyGroup[],
): MyGroup | null {
  const find = (id: string | null) => (id ? groups.find((group) => group.id === id) : undefined)
  return find(urlId) ?? find(storedId) ?? sortByJoined(groups)[0] ?? null
}

/** A 1-member group waits: no scoring, votes or leaderboard until a second member joins. */
export function isWaiting(group: Pick<MyGroup, 'memberCount'>): boolean {
  return group.memberCount < 2
}

/** Switcher sheet: "5 members", or "waiting for a 2nd member". */
export function memberCountText(group: Pick<MyGroup, 'memberCount'>): string {
  return isWaiting(group) ? GROUP_COPY.waitingCount : `${group.memberCount} members`
}

/** Me > My groups: "5 of 10 members", or "waiting for a 2nd member". */
export function memberCapacityText(group: Pick<MyGroup, 'memberCount'>): string {
  return isWaiting(group)
    ? GROUP_COPY.waitingCount
    : `${group.memberCount} of ${GROUP_MEMBER_MAX} members`
}

/** The switcher's accessible name. */
export function switcherLabel(group: Pick<MyGroup, 'name'>): string {
  return `Group: ${group.name}, switch group`
}
