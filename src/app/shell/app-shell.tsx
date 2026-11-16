import { useEffect } from 'react'
import { Outlet, ScrollRestoration } from 'react-router'
import { AppBottomNav } from '@/app/shell/app-bottom-nav'
import {
  useColdStartHistory,
  useEscapeToToday,
  useFocusHeadingOnRouteChange,
} from '@/app/shell/use-shell-history'

/**
 * Phone-first shell: one column up to 480px on paper, top safe area, content, bottom nav with the
 * lifted Camera button. The document is the scroller; it keeps focused items clear of the nav with
 * `scroll-padding-bottom` (class on <html>), and the content ends with the same clearance.
 */
export function AppShell() {
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
      {/* Top bar: pads the top safe area. Story 1.6 adds the group switcher and the bell here. */}
      <header className="paper sticky top-0 z-(--z-top-bar) pt-[env(safe-area-inset-top)]" />
      <main className="flex flex-1 flex-col px-gutter nav-clearance">
        <Outlet />
      </main>
      <AppBottomNav />
      <ScrollRestoration />
    </div>
  )
}
