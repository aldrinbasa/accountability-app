import {
  FOCUSED_GROUP_KEY,
  getStoredFocusedGroup,
  resetFocusedGroupMemory,
  setStoredFocusedGroup,
} from '@/data/focused-group'

afterEach(() => {
  vi.restoreAllMocks()
  resetFocusedGroupMemory()
})

describe('stored focused group', () => {
  it('round-trips through localStorage and can be forgotten', () => {
    expect(getStoredFocusedGroup()).toBeNull()
    setStoredFocusedGroup('g1')
    expect(localStorage.getItem(FOCUSED_GROUP_KEY)).toBe('g1')
    expect(getStoredFocusedGroup()).toBe('g1')
    setStoredFocusedGroup(null)
    expect(getStoredFocusedGroup()).toBeNull()
  })

  it('falls back to memory when storage is blocked', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    setStoredFocusedGroup('g2')
    expect(getStoredFocusedGroup()).toBe('g2')
  })
})
