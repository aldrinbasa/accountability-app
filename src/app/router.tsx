import { createBrowserRouter, type RouteObject } from 'react-router'
import { PlaceholderScreen } from '@/app/placeholder-screen'

export const routes: RouteObject[] = [{ path: '*', element: <PlaceholderScreen /> }]

/** History routing only (never hash routes), so deep links like /join/{code} work. */
export function createAppRouter() {
  return createBrowserRouter(routes)
}
