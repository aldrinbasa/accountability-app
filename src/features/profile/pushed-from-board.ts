/** Location state on a member profile pushed from the Board, so back can pop to the Board. */
export interface PushedFromBoardState {
  fromBoard?: boolean
}

export function cameFromBoard(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as PushedFromBoardState).fromBoard === true
}

/** The member profile route (AD-10: member routes use `user_id`). */
export function memberProfilePath(userId: string): string {
  return `/board/m/${userId}`
}
