import { sanitizeNext } from '@/domain/next-path'
import { readDevice, writeDevice } from '@/data/device-storage'

/**
 * Device-only, per-tab sign-in state in sessionStorage. Every access tolerates a blocked storage,
 * falling back to memory for the session.
 */
export const NEXT_KEY = 'proofy.next'
export const SIGNIN_KEY = 'proofy.signin'

function read(key: string): string | null {
  return readDevice(key, 'session')
}

function write(key: string, value: string | null): void {
  writeDevice(key, value, 'session')
}

/** Save the path to open after sign-in. Unsafe values (other origins, `//host`) are dropped. */
export function savePendingNext(path: unknown): void {
  const safe = sanitizeNext(path)
  if (safe) write(NEXT_KEY, safe)
}

/** The pending `next` path, re-validated on read. */
export function peekPendingNext(): string | null {
  return sanitizeNext(read(NEXT_KEY))
}

export function clearPendingNext(): void {
  write(NEXT_KEY, null)
}

/** The email the code went to and when it was last sent, so a reload of /signin/code keeps working. */
export interface PendingSignIn {
  email: string
  /** Epoch ms of the last send. */
  sentAt: number
}

export function savePendingSignIn(pending: PendingSignIn): void {
  write(SIGNIN_KEY, JSON.stringify(pending))
}

export function readPendingSignIn(): PendingSignIn | null {
  const raw = read(SIGNIN_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PendingSignIn> | null
    if (parsed && typeof parsed.email === 'string' && typeof parsed.sentAt === 'number') {
      return { email: parsed.email, sentAt: parsed.sentAt }
    }
  } catch {
    // Corrupt value: treat as nothing pending.
  }
  return null
}

export function clearPendingSignIn(): void {
  write(SIGNIN_KEY, null)
}
