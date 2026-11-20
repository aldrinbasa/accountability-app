import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  todaySearchBehind,
  TODAY_PATH,
  type TabLocationState,
  type TabPath,
} from '@/app/shell/tabs'
import { cameFromMe } from '@/features/me/pushed-from-me'

/**
 * Tab switching that never stacks tabs in history. History holds at most `[/today, /tab]`:
 * - Today -> tab: push (marked `fromToday`), so system back from the tab lands on Today.
 * - tab -> tab: replace.
 * - tab -> Today: go back to the Today entry when it sits behind (one entry, or two from a screen
 *   pushed from Me, like My plan, whose Me entry sits in between). If the group changed on the tab, that
 *   entry still holds the old `?g=`, so it is then replaced with the current one (see
 *   `useFinishTodayReturn`). With no Today behind, replace.
 * - re-tapping the active tab scrolls to the top.
 * The `?g=` group query is carried along.
 */
/** The `?g=` search the Today entry should get once a back step from a tab lands on it. */
let pendingTodaySearch: string | null = null

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
      if (to === TODAY_PATH) {
        if (behind === null) {
          void navigate({ pathname: TODAY_PATH, search }, { replace: true })
          return
        }
        if (behind !== search) pendingTodaySearch = search
        void navigate(cameFromMe(location.state) ? -2 : -1)
        return
      }
      // Tab -> tab keeps what sits behind (the Today entry and its search).
      void navigate({ pathname: to, search }, { replace: true, state: location.state })
    },
    [navigate, location.pathname, location.search, location.state],
  )
}

/**
 * After a tab -> Today back step whose Today entry holds an older `?g=`, replace that entry's search
 * with the tab's, so Today shows the group picked on the tab and no old-group entry stays behind.
 * Mounted once, in the app shell, before the focus sync.
 */
export function useFinishTodayReturn(): void {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (pendingTodaySearch === null) return
    const search = pendingTodaySearch
    pendingTodaySearch = null
    if (location.pathname !== TODAY_PATH || location.search === search) return
    void navigate({ pathname: TODAY_PATH, search }, { replace: true, state: location.state })
  }, [location, navigate])
}
