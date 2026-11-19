import {
  getThemePreference,
  resetThemeMemory,
  setThemePreference,
  startThemeSync,
} from '@/data/theme'
import { THEME_STORAGE_KEY } from '@/domain/theme'
import { installMatchMedia } from '@/test/setup'

function addThemeColorMeta(): HTMLMetaElement {
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = '#F6EEE3'
  document.head.append(meta)
  return meta
}

afterEach(() => {
  vi.restoreAllMocks()
  resetThemeMemory()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove())
  installMatchMedia(false)
})

describe('theme preference', () => {
  it('defaults to Auto and follows the phone', () => {
    installMatchMedia(true)
    const meta = addThemeColorMeta()
    startThemeSync()()
    expect(getThemePreference()).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(meta.content).toBe('#1C1230')
  })

  it('stores a fixed choice and applies it over the phone setting', () => {
    installMatchMedia(true)
    const meta = addThemeColorMeta()
    setThemePreference('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(meta.content).toBe('#F6EEE3')
    setThemePreference('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('follows a live phone switch only while on Auto', () => {
    let handler: (() => void) | null = null
    let dark = false
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: () => ({
        get matches() {
          return dark
        },
        addEventListener: (_: string, fn: () => void) => {
          handler = fn
        },
        removeEventListener: vi.fn(),
      }),
    })
    const fire = () => {
      if (!handler) throw new Error('no change listener')
      handler()
    }
    const stop = startThemeSync()
    expect(document.documentElement.dataset.theme).toBe('light')
    dark = true
    fire()
    expect(document.documentElement.dataset.theme).toBe('dark')
    setThemePreference('light')
    fire()
    expect(document.documentElement.dataset.theme).toBe('light')
    stop()
  })

  it('falls back to memory when storage is blocked', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(getThemePreference()).toBe('system')
    setThemePreference('dark')
    expect(getThemePreference()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
