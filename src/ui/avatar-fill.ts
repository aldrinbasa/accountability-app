/** DESIGN.md `avatar` fills, in pick order. Objects: they keep their light fill in dark mode. */
export const AVATAR_FILLS = ['primary', 'vote', 'sticky', 'sticky2'] as const
export type AvatarFill = (typeof AVATAR_FILLS)[number]

/** The same id always gets the same fill (FNV-1a over the UTF-16 code units). */
export function avatarFill(id: string): AvatarFill {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return AVATAR_FILLS[(hash >>> 0) % AVATAR_FILLS.length]
}

/** First character of the trimmed name, uppercased; empty for a blank name. */
export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0]
  return first ? first.toLocaleUpperCase() : ''
}
