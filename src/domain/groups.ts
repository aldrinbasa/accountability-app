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
  createLine: 'Give it a name your friends will recognize.',
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

// ===== Invites and joining (Story 1.7) =====

/** An invite as the admin's Invite panel shows it (`create_invite`). */
export interface Invite {
  /** 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. */
  code: string
  /** ISO timestamp: creation + 7 days. Expired once now ≥ this. */
  expiresAt: string
}

/** What an invite code leads to (`get_invite`), checked in this order on the server. */
export type InviteStatus = 'member' | 'expired' | 'full' | 'valid'

export const INVITE_STATUSES: readonly InviteStatus[] = ['member', 'expired', 'full', 'valid']

export function isInviteStatus(value: unknown): value is InviteStatus {
  return typeof value === 'string' && (INVITE_STATUSES as readonly string[]).includes(value)
}

/** The join screen's view of an invite. */
export interface InvitePreview {
  groupId: string
  groupName: string
  /** The group's current admin's display name. */
  adminName: string
  /** Current members. */
  memberCount: number
  status: InviteStatus
}

/** Copy for the admin's Invite panel (Story 1.7 ACs and approved Decisions). */
export const INVITE_COPY = {
  kicker: 'Invite friends',
  meta: 'Link or code · up to 10 people',
  shareLink: 'Share link',
  copyCode: 'Copy code',
  linkCopied: 'Link copied.',
  codeCopied: 'Code copied.',
  expired: 'This invite expired. Make a new one.',
  makeNew: 'Make a new one',
  making: 'Saving…',
  full: "Group's full. 10 is the max.",
  loadFailed: "Couldn't load the invite. Check your signal and tap Retry.",
  newFailed: "Couldn't make a new invite. Check your signal and tap Retry.",
  retry: 'Retry',
} as const

/** Copy for joining: the create screen's code entry and the /join/{code} screen. */
export const JOIN_COPY = {
  or: 'or',
  codeHeading: 'Got an invite code?',
  codeLabel: 'Invite code',
  joinWithCode: 'Join with a code',
  codeRequired: 'Type the invite code.',
  kicker: "You're invited to",
  join: 'Join',
  joining: 'Joining…',
  unknown: "That invite code doesn't work. Check it with whoever sent it.",
  goToday: 'Go to Today',
  offlineLine: "Can't reach Proofy.",
  offlineBody: 'Joining needs a signal.',
  tryAgain: 'Try again',
  loadFailed: "Couldn't load the invite. Check your signal and tap Retry.",
  joinFailed: "Couldn't join. Check your signal and tap Retry.",
  retry: 'Retry',
  screenTitle: 'Join a group',
} as const

/** "Couldn't copy. The code is K7QX2M." */
export function copyFailedText(code: string): string {
  return `Couldn't copy. The code is ${code}.`
}

/** "Couldn't copy. The link is https://…/join/K7QX2M." */
export function copyLinkFailedText(url: string): string {
  return `Couldn't copy. The link is ${url}.`
}

/** "Jo is the admin" */
export function adminLine(adminName: string): string {
  return `${adminName} is the admin`
}

/** "3 members" ("1 member" for one). */
export function joinMemberCountText(count: number): string {
  return count === 1 ? '1 member' : `${count} members`
}

/** "This invite expired. Ask Jo for a fresh one." */
export function joinExpiredText(adminName: string): string {
  return `This invite expired. Ask ${adminName} for a fresh one.`
}

/** "Sunday Reset is full. 10 is the max." */
export function joinFullText(groupName: string): string {
  return `${groupName} is full. 10 is the max.`
}

/**
 * What a typed, pasted or linked code is looked up as: the text after the last "/" (trailing slashes ignored, so a pasted
 * `…/join/K7QX2M` link works), upper-cased, with everything outside A–Z and 0–9 dropped.
 */
export function normalizeInviteCode(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  const tail = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return tail.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** The share URL: `{origin}/join/{code}` (the one link without `?g=`). */
export function inviteUrl(origin: string, code: string): string {
  return `${origin}/join/${encodeURIComponent(code)}`
}

/** Whether an invite has expired at `now` (expired once now ≥ `expiresAt`). */
export function inviteExpired(expiresAt: string, now: number | Date): boolean {
  const end = Date.parse(expiresAt)
  if (Number.isNaN(end)) return true
  return (typeof now === 'number' ? now : now.getTime()) >= end
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** "Expires Tue 24 Nov", in the device's local time zone. */
export function inviteExpiryText(expiresAt: string): string {
  const date = new Date(expiresAt)
  return `Expires ${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

/** The code spelled out for screen readers: "K 7 Q X 2 M". */
export function spelledCode(code: string): string {
  return Array.from(code).join(' ')
}
