import { parseThemePreference, resolveTheme } from '@/domain/theme'

describe('theme', () => {
  it('parses stored values, anything unknown is Auto', () => {
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('system')).toBe('system')
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference('purple')).toBe('system')
  })

  it('resolves Auto from the phone and keeps a fixed choice', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
