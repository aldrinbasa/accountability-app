import {
  adminLine,
  copyFailedText,
  inviteExpired,
  inviteExpiryText,
  inviteUrl,
  isInviteStatus,
  isWaiting,
  joinExpiredText,
  joinFullText,
  joinMemberCountText,
  normalizeInviteCode,
  spelledCode,
  memberCapacityText,
  memberCountText,
  resolveFocusedGroup,
  sortByJoined,
  switcherLabel,
  trimGroupName,
  validateGroupName,
  type MyGroup,
} from '@/domain/groups'

function group(id: string, joinedAt: string, memberCount = 2): MyGroup {
  return { id, name: id.toUpperCase(), timeZone: 'UTC', role: 'member', joinedAt, memberCount }
}

const A = group('a', '2026-11-01T10:00:00Z')
const B = group('b', '2026-11-05T10:00:00Z')
const C = group('c', '2026-10-20T10:00:00Z')

describe('resolveFocusedGroup', () => {
  it('the URL group wins when it is a current group', () => {
    expect(resolveFocusedGroup('b', 'a', [A, B])).toBe(B)
  })

  it('a stale URL id falls back to the stored group', () => {
    expect(resolveFocusedGroup('x', 'a', [A, B])).toBe(A)
  })

  it('no URL id: the stored group', () => {
    expect(resolveFocusedGroup(null, 'b', [A, B])).toBe(B)
  })

  it('stale or absent stored id: the group joined earliest', () => {
    expect(resolveFocusedGroup(null, 'gone', [A, B, C])).toBe(C)
    expect(resolveFocusedGroup(null, null, [B, A])).toBe(A)
    expect(resolveFocusedGroup('x', 'y', [B, A])).toBe(A)
  })

  it('no groups: null', () => {
    expect(resolveFocusedGroup('a', 'a', [])).toBeNull()
  })
})

describe('sortByJoined', () => {
  it('orders by joined time, then id', () => {
    const twin = group('aa', A.joinedAt)
    expect(sortByJoined([B, twin, A, C]).map((g) => g.id)).toEqual(['c', 'a', 'aa', 'b'])
  })
})

describe('group names', () => {
  it('trims and accepts 1 to 32 characters', () => {
    expect(trimGroupName('  Gym Rats  ')).toBe('Gym Rats')
    expect(validateGroupName('   ')).toBe('invalid_group_name')
    expect(validateGroupName('a'.repeat(32))).toBeNull()
    expect(validateGroupName('a'.repeat(33))).toBe('invalid_group_name')
    expect(validateGroupName(` ${'a'.repeat(32)} `)).toBeNull()
  })
})

describe('member counts', () => {
  it('a 1-member group is waiting', () => {
    expect(isWaiting({ memberCount: 1 })).toBe(true)
    expect(isWaiting({ memberCount: 2 })).toBe(false)
  })

  it('reads "N members" in the sheet and "N of 10 members" in Me', () => {
    expect(memberCountText({ memberCount: 5 })).toBe('5 members')
    expect(memberCountText({ memberCount: 1 })).toBe('waiting for a 2nd member')
    expect(memberCapacityText({ memberCount: 5 })).toBe('5 of 10 members')
    expect(memberCapacityText({ memberCount: 1 })).toBe('waiting for a 2nd member')
  })

  it('names the switcher', () => {
    expect(switcherLabel({ name: 'Gym Rats' })).toBe('Group: Gym Rats, switch group')
  })
})

describe('invites and joining', () => {
  it('normalizes a typed code: trimmed and upper-cased', () => {
    expect(normalizeInviteCode(' k7qx2m ')).toBe('K7QX2M')
    expect(normalizeInviteCode('   ')).toBe('')
    expect(normalizeInviteCode('K7Q X2M')).toBe('K7QX2M')
    expect(normalizeInviteCode('K7QX2M.')).toBe('K7QX2M')
    expect(normalizeInviteCode('k7q-x2m')).toBe('K7QX2M')
    expect(normalizeInviteCode('https://proofy.test/join/K7QX2M')).toBe('K7QX2M')
    expect(normalizeInviteCode('https://proofy.test/join/k7qx2m/')).toBe('K7QX2M')
  })

  it('builds the share URL without ?g=', () => {
    expect(inviteUrl('https://proofy.test', 'K7QX2M')).toBe('https://proofy.test/join/K7QX2M')
  })

  it('an invite is expired once now ≥ expires_at', () => {
    const expiresAt = '2026-11-24T10:00:00.000Z'
    const end = Date.parse(expiresAt)
    expect(inviteExpired(expiresAt, end - 1)).toBe(false)
    expect(inviteExpired(expiresAt, end)).toBe(true)
    expect(inviteExpired(expiresAt, new Date(end + 1))).toBe(true)
    expect(inviteExpired('not a date', 0)).toBe(true)
  })

  it('formats the expiry as "Expires {weekday} {d} {Mon}" in device local time', () => {
    // Local noon, so the day is the same in every test-runner zone.
    const local = new Date(2026, 10, 24, 12, 0, 0)
    expect(inviteExpiryText(local.toISOString())).toBe('Expires Tue 24 Nov')
    expect(inviteExpiryText(new Date(2027, 0, 3, 12).toISOString())).toBe('Expires Sun 3 Jan')
  })

  it('has the join copy with names filled in', () => {
    expect(adminLine('Jo')).toBe('Jo is the admin')
    expect(joinMemberCountText(3)).toBe('3 members')
    expect(joinMemberCountText(1)).toBe('1 member')
    expect(joinExpiredText('Jo')).toBe('This invite expired. Ask Jo for a fresh one.')
    expect(joinFullText('Sunday Reset')).toBe('Sunday Reset is full. 10 is the max.')
    expect(copyFailedText('K7QX2M')).toBe("Couldn't copy. The code is K7QX2M.")
    expect(spelledCode('K7Q')).toBe('K 7 Q')
  })

  it('knows the get_invite statuses only', () => {
    for (const status of ['valid', 'expired', 'full', 'member']) {
      expect(isInviteStatus(status)).toBe(true)
    }
    expect(isInviteStatus('open')).toBe(false)
    expect(isInviteStatus(null)).toBe(false)
  })
})
