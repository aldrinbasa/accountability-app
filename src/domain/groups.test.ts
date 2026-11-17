import {
  isWaiting,
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
