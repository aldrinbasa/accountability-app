import {
  getLastSeenCount,
  hasSeenRemovedNotice,
  lastSeenCountKey,
  markRemovedNoticeSeen,
  removedNoticeKey,
  resetGroupNoticesMemory,
  setLastSeenCount,
} from '@/data/group-notices'

afterEach(() => {
  vi.restoreAllMocks()
  resetGroupNoticesMemory()
})

describe('group notice state', () => {
  it('round-trips through localStorage under the proofy keys', () => {
    expect(hasSeenRemovedNotice('m1')).toBe(false)
    markRemovedNoticeSeen('m1')
    expect(localStorage.getItem(removedNoticeKey('m1'))).toBe('1')
    expect(hasSeenRemovedNotice('m1')).toBe(true)

    expect(getLastSeenCount('g1')).toBeNull()
    setLastSeenCount('g1', 3)
    expect(localStorage.getItem(lastSeenCountKey('g1'))).toBe('3')
    expect(getLastSeenCount('g1')).toBe(3)
    expect(removedNoticeKey('m1')).toBe('proofy.notice.removed.m1')
    expect(lastSeenCountKey('g1')).toBe('proofy.lastSeenCount.g1')
  })

  it('falls back to memory when storage is blocked', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    markRemovedNoticeSeen('m2')
    expect(hasSeenRemovedNotice('m2')).toBe(true)
    setLastSeenCount('g2', 4)
    expect(getLastSeenCount('g2')).toBe(4)
    setLastSeenCount('g2', 1)
    expect(getLastSeenCount('g2')).toBe(1)
  })
})
