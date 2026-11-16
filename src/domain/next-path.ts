/** Where a member lands after sign-in when no pending `next` path is stored. */
export const DEFAULT_NEXT_PATH = '/today'

/**
 * Accepts only a same-origin relative path: starts with `/`, but not `//` or `/\` (both of which
 * browsers treat as another host). Anything else (absolute URLs, `javascript:`, empty) is dropped.
 */
export function sanitizeNext(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  return value
}

/**
 * The URL every sign-in redirect points at (email link and Google): `{origin}/signin?next=…`.
 * The email template appends `&token_hash=…&type=email` to it, so it must already carry a query.
 */
export function signInRedirectUrl(origin: string, next: string | null): string {
  const target = sanitizeNext(next) ?? DEFAULT_NEXT_PATH
  return `${origin}/signin?next=${encodeURIComponent(target)}`
}
