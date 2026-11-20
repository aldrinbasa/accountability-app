import { act } from '@testing-library/react'
import { expect, vi } from 'vitest'

/** The part of a data router these helpers read. */
interface RouterWithLocation {
  state: { location: { search: string } }
}

/**
 * Waits until the URL holds the focused group (`?g=`): `groupId` when given, else any non-empty
 * value. The app writes it in a replace navigation after the groups load, and the router state can
 * lead React's render, so the helper then flushes one render; click handlers and links read the new
 * search after it. Use it before acting on a screen that has just written `?g=` (Epic 2 retro P7).
 */
export async function waitForGroupInUrl(
  router: RouterWithLocation,
  groupId?: string,
): Promise<void> {
  await vi.waitFor(() => {
    const g = new URLSearchParams(router.state.location.search).get('g')
    if (groupId === undefined) expect(g, `?g= in "${router.state.location.search}"`).toBeTruthy()
    else expect(g).toBe(groupId)
  })
  await act(async () => {})
}
