import type { MouseEvent } from 'react'
import { useLocation } from 'react-router'
import { BottomNav, BottomNavItem, CameraButton } from '@/ui/bottom-nav'
import { LEADING_TABS, tabOf, TRAILING_TABS, type Tab } from '@/app/shell/tabs'
import { useTabNavigation } from '@/app/shell/use-tab-navigation'
import { useCameraLauncher } from '@/features/camera/camera-launcher'

/** Bottom nav wired to the router and the camera: Today, Feed, Camera, Board, Me. */
export function AppBottomNav() {
  const { pathname, search } = useLocation()
  const goToTab = useTabNavigation()
  const { openCamera } = useCameraLauncher()

  function renderTab(tab: Tab) {
    function onNavigate(event: MouseEvent<HTMLAnchorElement>) {
      // Let modified clicks (new tab / window) behave like plain links.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return
      }
      event.preventDefault()
      goToTab(tab.path)
    }
    return (
      <BottomNavItem
        key={tab.path}
        href={`${tab.path}${search}`}
        label={tab.label}
        icon={tab.icon}
        active={tabOf(pathname) === tab.path}
        onNavigate={onNavigate}
      />
    )
  }

  return (
    <BottomNav>
      {LEADING_TABS.map(renderTab)}
      {/* Snap-first: the camera opens with no target. */}
      <CameraButton
        onClick={(event) => openCamera({ mode: 'checkin', target: null }, event.currentTarget)}
      />
      {TRAILING_TABS.map(renderTab)}
    </BottomNav>
  )
}
