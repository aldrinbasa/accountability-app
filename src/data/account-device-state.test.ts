import { THEME_STORAGE_KEY } from '@/domain/theme'
import { clearAccountDeviceState } from '@/data/account-device-state'
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

afterEach(() => {
  vi.restoreAllMocks()
})

describe('clearAccountDeviceState', () => {
  it('forgets the focused group and every last-seen count; keeps device-wide keys', () => {
    setStoredFocusedGroup('group-1')
    setLastSeenCount('group-1', 3)
    setLastSeenCount('group-2', 1)
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
    markRemovedNoticeSeen('m-1')
    expect(getStoredFocusedGroup()).toBe('group-1')
    expect(getLastSeenCount('group-1')).toBe(3)

    clearAccountDeviceState()

    expect(getStoredFocusedGroup()).toBeNull()
    expect(getLastSeenCount('group-1')).toBeNull()
    expect(hasSeenRemovedNotice('m-1')).toBe(true)
  })
})
