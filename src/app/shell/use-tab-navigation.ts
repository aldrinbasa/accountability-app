import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  todaySearchBehind,
  TODAY_PATH,
  type TabLocationState,
  type TabPath,
} from '@/app/shell/tabs'
import { cameFromMe } from '@/features/me/pushed-from-me'
import { cameFromBoard } from '@/features/profile/pushed-from-board'

/**
 * Tab switching that never stacks tabs in history. History holds at most `[/today, /tab]`:
 * - Today -> tab: push (marked `fromToday`), so system back from the tab lands on Today.
 * - tab -> tab: replace. From a screen pushed from Me (or a tab that replaced one), the Me tab goes
 *   back one entry to the Me entry instead, so Me is never stacked on Me. From a member profile
 *   pushed from the Board (Story 4.6), a tab goes back to the Board entry, which the tab then
 *   replaces (the Board tab just pops).
 * - tab -> Today: go back to the Today entry when it sits behind (one entry, or two from a screen
 *   pushed from Me, like My plan, whose Me entry sits in between). If the group changed on the tab, that
 *   entry still holds the old `?g=`, so it is then replaced with the current one (see
 *   `useFinishTodayReturn`). With no Today behind, replace.
 * - re-tapping the active tab scrolls to the top.
 * The `?g=` group query is carried along.
 */
/**
 * What the entry a tab back step lands on (`landOn`: Today, Me or the Board) should become once it is
 * there: the same tab with the current `?g=`, or another tab (a tab picked on a member profile
 * replaces the Board entry behind it, so tabs never stack).
 */
let pendingReturn: { landOn: string; pathname: string; search: string } | null = null

export function useTabNavigation(): (to: TabPath) => void {
  const navigate = useNavigate()
  const location = useLocation()

  return useCallback(
    (to: TabPath) => {
      const current = location.pathname
      const search = location.search
      if (to === current) {
        window.scrollTo({ top: 0, left: 0 })
        return
      }
      if (current === TODAY_PATH) {
        const state: TabLocationState = { fromToday: true, todaySearch: search }
        void navigate({ pathname: to, search }, { state })
        return
      }
      const behind = todaySearchBehind(location.state)
      // Pushed screens between this entry and its tab: My plan or Settings over Me, a member
      // profile over the Board (both when the Board replaced a screen pushed from Me).
      const overBoard = cameFromBoard(location.state) ? 1 : 0
      const overMe = cameFromMe(location.state) ? 1 : 0
      if (to === TODAY_PATH) {
        if (behind === null) {
          void navigate({ pathname: TODAY_PATH, search }, { replace: true })
          return
        }
        if (behind !== search) pendingReturn = { landOn: TODAY_PATH, pathname: TODAY_PATH, search }
        void navigate(-(1 + overMe + overBoard))
        return
      }
      if (to === '/me' && overMe) {
        // The Me entry may hold an older `?g=` (group changed since): fixed after the pop.
        pendingReturn = { landOn: to, pathname: to, search }
        void navigate(-(1 + overBoard))
        return
      }
      if (overBoard) {
        // From a member profile: back to the Board entry, which then becomes the tab picked.
        pendingReturn = { landOn: '/board', pathname: to, search }
        void navigate(-1)
        return
      }
      // Tab -> tab keeps what sits behind (the Today entry and its search).
      void navigate({ pathname: to, search }, { replace: true, state: location.state })
    },
    [navigate, location.pathname, location.search, location.state],
  )
}

/**
 * After a tab back step (to Today, or to Me from a screen pushed from Me) whose entry holds an older
 * `?g=`, replace that entry's search with the tab's, so it shows the group picked on the tab and no
 * old-group entry stays behind. After a tab picked on a member profile popped back to the Board
 * entry, replace that entry with the tab (Story 4.6).
 * Mounted once, in the app shell, before the focus sync.
 */
export function useFinishTodayReturn(): void {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (pendingReturn === null) return
    const { landOn, pathname, search } = pendingReturn
    pendingReturn = null
    if (location.pathname !== landOn) return
    if (pathname === landOn && location.search === search) return
    void navigate({ pathname, search }, { replace: true, state: location.state })
  }, [location, navigate])
}
