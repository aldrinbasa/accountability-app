import { createBrowserRouter, type RouteObject } from 'react-router'
import { AuthGate, InstallLayout, SetupLayout, SignInLayout } from '@/app/auth-gate'
import { AppShell } from '@/app/shell/app-shell'
import { RedirectToToday } from '@/app/shell/redirect-to-today'
import { TodayScreen } from '@/app/screens/today'
import { FeedScreen } from '@/app/screens/feed'
import { BoardScreen } from '@/app/screens/board'
import { MeScreen } from '@/app/screens/me'
import { SettingsScreen } from '@/app/screens/settings'
import { CodeScreen } from '@/features/auth/code-screen'
import { SignInScreen } from '@/features/auth/sign-in-screen'
import { SetupScreen } from '@/features/me/setup-screen'
import { InstallScreen } from '@/features/install/install-screen'

export const routes: RouteObject[] = [
  // Pre-auth screens, outside the shell. Signed in, they forward to `next` or /today.
  {
    element: <SignInLayout />,
    children: [
      { path: 'signin', element: <SignInScreen /> },
      { path: 'signin/code', element: <CodeScreen /> },
    ],
  },
  // Everything else needs a session, and (except /setup and /install) a profile.
  {
    element: <AuthGate />,
    children: [
      // Install guide: right after sign-in (before Setup), or from the Today Banner / Hint.
      {
        element: <InstallLayout />,
        children: [{ path: 'install', element: <InstallScreen /> }],
      },
      {
        element: <SetupLayout />,
        children: [{ path: 'setup', element: <SetupScreen /> }],
      },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <RedirectToToday /> },
          { path: 'today', element: <TodayScreen /> },
          { path: 'feed', element: <FeedScreen /> },
          { path: 'board', element: <BoardScreen /> },
          { path: 'me', element: <MeScreen /> },
          { path: 'me/settings', element: <SettingsScreen /> },
        ],
      },
      { path: '*', element: <RedirectToToday /> },
    ],
  },
]

/** History routing only (never hash routes), so deep links like /join/{code} work. */
export function createAppRouter() {
  return createBrowserRouter(routes)
}
