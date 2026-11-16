import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from '@/app/shell/app-shell'
import { RedirectToToday } from '@/app/shell/redirect-to-today'
import { TodayScreen } from '@/app/screens/today'
import { FeedScreen } from '@/app/screens/feed'
import { BoardScreen } from '@/app/screens/board'
import { MeScreen } from '@/app/screens/me'

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <RedirectToToday /> },
      { path: 'today', element: <TodayScreen /> },
      { path: 'feed', element: <FeedScreen /> },
      { path: 'board', element: <BoardScreen /> },
      { path: 'me', element: <MeScreen /> },
    ],
  },
  { path: '*', element: <RedirectToToday /> },
]

/** History routing only (never hash routes), so deep links like /join/{code} work. */
export function createAppRouter() {
  return createBrowserRouter(routes)
}
