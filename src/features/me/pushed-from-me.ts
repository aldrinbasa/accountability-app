/** Location state on a screen pushed from Me (Settings, group settings), so back can pop to Me. */
export interface PushedFromMeState {
  fromMe?: boolean
}

export function cameFromMe(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as PushedFromMeState).fromMe === true
}

/** State for a push from Me: keeps what sits behind Me (the Today entry) so tab navigation still works. */
export function pushedFromMeState(state: unknown): PushedFromMeState {
  return { ...(state && typeof state === 'object' ? state : {}), fromMe: true }
}
