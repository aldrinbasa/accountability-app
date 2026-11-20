import { THEME_STORAGE_KEY } from '@/domain/theme'
import { clearAccountDeviceState } from '@/data/account-device-state'
import { getLastSeenRank, lastSeenRankKey, setLastSeenRank } from '@/data/board'
import {
  FOCUSED_GROUP_KEY,
  getStoredFocusedGroup,
  setStoredFocusedGroup,
} from '@/data/focused-group'
import {
  getLastSeenCount,
  hasSeenRemovedNotice,
  lastSeenCountKey,
  markRemovedNoticeSeen,
  removedNoticeKey,
  setLastSeenCount,
} from '@/data/group-notices'
import { GUIDE_DISMISSED_KEY, INSTALLED_KEY } from '@/data/install-state'
import { NEXT_KEY } from '@/data/pending-signin'
import { isWinnerSeen, markWinnerSeen, winnerSeenKey } from '@/data/winner'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('clearAccountDeviceState', () => {
  it('forgets the focused group, every last-seen count and rank, and seen winner cards; keeps device-wide keys', () => {
    setStoredFocusedGroup('group-1')
    setLastSeenCount('group-1', 3)
    setLastSeenCount('group-2', 1)
    setLastSeenRank('group-1', 2)
    markWinnerSeen('group-1', '2026-11-09')
    markRemovedNoticeSeen('m-1')
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    localStorage.setItem(INSTALLED_KEY, '1')
    localStorage.setItem(GUIDE_DISMISSED_KEY, '1')
    sessionStorage.setItem(NEXT_KEY, '/feed')

    clearAccountDeviceState()

    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBeNull()
    expect(getStoredFocusedGroup()).toBeNull()
    expect(localStorage.getItem(lastSeenCountKey('group-1'))).toBeNull()
    expect(getLastSeenCount('group-1')).toBeNull()
    expect(getLastSeenCount('group-2')).toBeNull()
    expect(localStorage.getItem(lastSeenRankKey('group-1'))).toBeNull()
    expect(getLastSeenRank('group-1')).toBeNull()
    expect(localStorage.getItem(winnerSeenKey('group-1', '2026-11-09'))).toBeNull()
    expect(isWinnerSeen('group-1', '2026-11-09')).toBe(false)
    expect(localStorage.getItem(removedNoticeKey('m-1'))).toBe('1')
    expect(hasSeenRemovedNotice('m-1')).toBe(true)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(localStorage.getItem(INSTALLED_KEY)).toBe('1')
    expect(localStorage.getItem(GUIDE_DISMISSED_KEY)).toBe('1')
    expect(sessionStorage.getItem(NEXT_KEY)).toBe('/feed')
  })

  it('also forgets values held in memory while storage was blocked', () => {
    const block = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(localStorage, 'setItem').mockImplementation(block)
    setStoredFocusedGroup('group-1')
    setLastSeenCount('group-1', 3)
    setLastSeenRank('group-1', 2)
    markWinnerSeen('group-1', '2026-11-09')
    markRemovedNoticeSeen('m-1')
    expect(getStoredFocusedGroup()).toBe('group-1')
    expect(isWinnerSeen('group-1', '2026-11-09')).toBe(true)
    expect(getLastSeenCount('group-1')).toBe(3)
    expect(getLastSeenRank('group-1')).toBe(2)

    clearAccountDeviceState()

    expect(getStoredFocusedGroup()).toBeNull()
    expect(getLastSeenCount('group-1')).toBeNull()
    expect(getLastSeenRank('group-1')).toBeNull()
    expect(isWinnerSeen('group-1', '2026-11-09')).toBe(false)
    expect(hasSeenRemovedNotice('m-1')).toBe(true)
  })
})
