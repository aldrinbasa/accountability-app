import { Navigate, useLocation } from 'react-router'
import { TODAY_PATH } from '@/app/shell/tabs'

/** `/` (and any unknown path, until later stories add routes) opens Today, keeping `?g=`. */
export function RedirectToToday() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: TODAY_PATH, search }} replace />
}
