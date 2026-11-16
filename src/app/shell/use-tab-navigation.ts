import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  todaySearchBehind,
  TODAY_PATH,
  type TabLocationState,
  type TabPath,
} from '@/app/shell/tabs'

/**
 * Tab switching that never stacks tabs in history. History holds at most `[/today, /tab]`:
 * - Today -> tab: push (marked `fromToday`), so system back from the tab lands on Today.
 * - tab -> tab: replace.
 * - tab -> Today: go back one entry when Today sits behind with the same `?g=`, else replace
 *   (popping would restore an old group query).
 * - re-tapping the active tab scrolls to the top.
 * The `?g=` group query is carried along.
 */
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
        if (behind === search) void navigate(-1)
        else void navigate({ pathname: TODAY_PATH, search }, { replace: true })
        return
      }
      // Tab -> tab keeps what sits behind (the Today entry and its search).
      void navigate({ pathname: to, search }, { replace: true, state: location.state })
    },
    [navigate, location.pathname, location.search, location.state],
  )
}
