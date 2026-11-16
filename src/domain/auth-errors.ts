import { OTP_EXPIRY_MS } from '@/domain/auth'

/** Every sign-in message, in one table (AD-14 style). Copy from EXPERIENCE.md and the 1.3 ACs. */
export const AUTH_COPY = {
  invalidEmail: "That doesn't look like an email address.",
  offline: "You're offline. Connect to sign in.",
  sendFailed: "Couldn't send the email. Try again.",
  codeWrong: "That code doesn't match. Use the newest email.",
  codeExpired: 'That code expired.',
  sendNewOne: 'Send a new one',
  googleFailed: "Couldn't sign in with Google. Try again.",
  signInFailed: "Couldn't sign in. Try again.",
  signOutFailed: "Couldn't sign out. Try again.",
} as const

export interface CodeErrorCopy {
  message: string
  /** Show the "Send a new one" link next to the message. */
  offerResend: boolean
}

/**
 * Supabase answers a wrong code and an expired code with the same error, so the app decides:
 * rejected within 15 min of the last send means wrong; from 15:00 on it means expired.
 * Without a known send time the code can only be treated as expired.
 */
export function codeErrorCopy(sentAt: number | null, now: number): CodeErrorCopy {
  if (sentAt !== null && now - sentAt < OTP_EXPIRY_MS) {
    return { message: AUTH_COPY.codeWrong, offerResend: false }
  }
  return { message: AUTH_COPY.codeExpired, offerResend: true }
}
