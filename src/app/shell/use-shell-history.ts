import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { isSheetOpen } from '@/ui/sheet-history'
import { cameFromToday, isTabPath, TODAY_PATH } from '@/app/shell/tabs'
import { useTabNavigation } from '@/app/shell/use-tab-navigation'

/**
 * Cold start on a non-Today tab: rebuild history as `[/today, /tab]` so system back (Android back,
 * browser back) lands on Today rather than leaving the app.
 */
export function useColdStartHistory(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const { pathname, search, hash, state } = location
    if (!isTabPath(pathname) || pathname === TODAY_PATH || cameFromToday(state)) return
    void (async () => {
      await navigate({ pathname: TODAY_PATH, search }, { replace: true })
      await navigate(
        { pathname, search, hash },
        { state: { fromToday: true, todaySearch: search } },
      )
    })()
    // Runs once per shell mount, on the first location only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/** Esc on desktop (with no sheet open) on a tab other than Today goes to Today. */
export function useEscapeToToday(): void {
  const { pathname } = useLocation()
  const goToTab = useTabNavigation()

  useEffect(() => {
    if (pathname === TODAY_PATH || !isTabPath(pathname)) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      // Esc while typing belongs to the field (clearing, closing a picker), not to navigation.
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      ) {
        return
      }
      if (isSheetOpen() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      goToTab(TODAY_PATH)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pathname, goToTab])
}

/** On route change (not the first render), focus moves to the screen's h1. */
export function useFocusHeadingOnRouteChange(): void {
  const { pathname } = useLocation()
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const heading = document.querySelector<HTMLElement>('main h1')
    heading?.focus({ preventScroll: true })
  }, [pathname])
}
