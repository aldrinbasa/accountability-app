import { useEffect } from 'react'
import { Outlet, ScrollRestoration, useLocation } from 'react-router'
import { GroupSwitcher } from '@/features/group/group-switcher'
import { NotInGroupState } from '@/features/group/not-in-group-state'
import { useStaleGroupLink, useSyncFocusedGroup } from '@/features/group/use-focused-group'
import { AppBottomNav } from '@/app/shell/app-bottom-nav'
import { useFinishTodayReturn } from '@/app/shell/use-tab-navigation'
import {
  useColdStartHistory,
  useEscapeToToday,
  useFocusHeadingOnRouteChange,
} from '@/app/shell/use-shell-history'

/** Screens whose top bar carries the group switcher. */
const SWITCHER_PATHS = new Set(['/today', '/feed', '/board'])

/**
 * Phone-first shell: one column up to 480px on paper, top safe area (with the group switcher on
 * Today, Feed and Board), content, bottom nav with the lifted Camera button. The document is the
 * scroller; it keeps focused items clear of the nav with `scroll-padding-bottom` (class on <html>),
 * and the content ends with the same clearance. It also keeps `?g=` on the resolved focused group;
 * Today, Feed or Board opened with the `?g=` of a group the member left or was removed from (and
 * not the stored focus) shows "You're not in {Group} anymore." instead (no switcher), and `?g=`
 * stays until "Go to Today".
 */
export function AppShell() {
  const { pathname } = useLocation()
  // Trailing slashes still match a route (`/today/`), so compare without them.
  const screenPath = pathname.replace(/\/+$/, '') || '/'
  const stale = useStaleGroupLink(SWITCHER_PATHS.has(screenPath))
  useFinishTodayReturn()
  useSyncFocusedGroup(stale !== null)
  useColdStartHistory()
  useEscapeToToday()
  useFocusHeadingOnRouteChange()

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('has-bottom-nav')
    return () => root.classList.remove('has-bottom-nav')
  }, [])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-content-max flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      {/* Top bar: pads the top safe area. The bell joins the switcher in Epic 6. */}
      <header className="paper sticky top-0 z-(--z-top-bar) pt-[env(safe-area-inset-top)]">
        {SWITCHER_PATHS.has(screenPath) && !stale ? (
          <div className="flex px-gutter pt-2 empty:hidden">
            <GroupSwitcher />
          </div>
        ) : null}
      </header>
      <main className="flex flex-1 flex-col px-gutter nav-clearance">
        {stale ? (
          <div className="flex flex-1 flex-col justify-center">
            <NotInGroupState ended={stale} />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
      <AppBottomNav />
      <ScrollRestoration />
    </div>
  )
}
