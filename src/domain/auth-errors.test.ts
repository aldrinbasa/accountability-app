import { AUTH_COPY, codeErrorCopy } from '@/domain/auth-errors'
import { AuthError, isAuthError, isValidEmail, normalizeCode } from '@/domain/auth'

const sentAt = Date.UTC(2026, 10, 17, 9, 0, 0)
const at = (minutes: number, seconds = 0) => sentAt + (minutes * 60 + seconds) * 1000

describe('codeErrorCopy (wrong vs expired, decided by time)', () => {
  it('says the code does not match within 15 minutes of the last send', () => {
    expect(codeErrorCopy(sentAt, at(0, 5))).toEqual({
      message: "That code doesn't match. Use the newest email.",
      offerResend: false,
    })
    expect(codeErrorCopy(sentAt, at(14, 59))).toEqual({
      message: AUTH_COPY.codeWrong,
      offerResend: false,
    })
  })

  it('says the code expired from 15:00 on, with "Send a new one"', () => {
    expect(codeErrorCopy(sentAt, at(15, 0))).toEqual({
      message: 'That code expired.',
      offerResend: true,
    })
    expect(codeErrorCopy(sentAt, at(60))).toEqual({
      message: AUTH_COPY.codeExpired,
      offerResend: true,
    })
  })

  it('treats an unknown send time as expired', () => {
    expect(codeErrorCopy(null, at(1)).message).toBe(AUTH_COPY.codeExpired)
  })
})

describe('sign-in copy', () => {
  it('matches the Story 1.3 ACs word for word', () => {
    expect(AUTH_COPY.invalidEmail).toBe("That doesn't look like an email address.")
    expect(AUTH_COPY.offline).toBe("You're offline. Connect to sign in.")
    expect(AUTH_COPY.sendFailed).toBe("Couldn't send the email. Try again.")
    expect(AUTH_COPY.googleFailed).toBe("Couldn't sign in with Google. Try again.")
    expect(AUTH_COPY.sendNewOne).toBe('Send a new one')
  })
})

describe('auth helpers', () => {
  it('checks email shape', () => {
    expect(isValidEmail('jo@example.com')).toBe(true)
    expect(isValidEmail('  jo@example.com ')).toBe(true)
    for (const bad of ['', 'jo', 'jo@', 'jo@example', 'jo @example.com', '@example.com']) {
      expect(isValidEmail(bad)).toBe(false)
    }
  })

  it('normalizes typed or pasted codes to at most 6 digits', () => {
    expect(normalizeCode('123 456')).toBe('123456')
    expect(normalizeCode('123-4567')).toBe('123456')
    expect(normalizeCode('12a')).toBe('12')
  })

  it('AuthError carries its code', () => {
    const error = new AuthError('code_rejected')
    expect(isAuthError(error)).toBe(true)
    expect(error.code).toBe('code_rejected')
    expect(isAuthError(new Error('x'))).toBe(false)
  })
})
