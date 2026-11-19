import { DEFAULT_NEXT_PATH, sanitizeNext, signInRedirectUrl } from '@/domain/next-path'

describe('sanitizeNext', () => {
  it.each(['/today', '/join/AB12CD?x=1', '/me/settings?g=abc', '/'])('keeps %s', (path) => {
    expect(sanitizeNext(path)).toBe(path)
  })

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'today',
    '',
    null,
    undefined,
    42,
  ])('drops %s', (value) => {
    expect(sanitizeNext(value)).toBeNull()
  })
})

describe('signInRedirectUrl', () => {
  it('points at /signin carrying the encoded next path', () => {
    expect(signInRedirectUrl('https://proofy-dev.vercel.app', '/join/AB12CD?x=1')).toBe(
      'https://proofy-dev.vercel.app/signin?next=%2Fjoin%2FAB12CD%3Fx%3D1',
    )
  })

  it('falls back to /today for a missing or unsafe next', () => {
    const fallback = `https://a.test/signin?next=${encodeURIComponent(DEFAULT_NEXT_PATH)}`
    expect(signInRedirectUrl('https://a.test', null)).toBe(fallback)
    expect(signInRedirectUrl('https://a.test', '//evil')).toBe(fallback)
  })
})
