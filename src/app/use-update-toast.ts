import { useEffect, useSyncExternalStore } from 'react'
import { dismissToast, showToast } from '@/ui/toast'
import { canShowUpdatePrompt, subscribeUpdateGuard } from '@/ui/update-guard'

export const UPDATE_TOAST_ID = 'sw-update'

/**
 * Raises the "Update ready." toast for a waiting service worker, but only while
 * `canShowUpdatePrompt()` allows it (not over the camera, not during an upload). When blocked it waits
 * and re-checks as soon as the guard clears. Tapping Update activates the new worker and reloads;
 * otherwise it activates on the next cold start (prompt mode, no auto skipWaiting).
 */
export function useUpdateToast(needRefresh: boolean, update: () => void): void {
  const allowed = useSyncExternalStore(subscribeUpdateGuard, canShowUpdatePrompt)

  useEffect(() => {
    if (!needRefresh) return
    if (!allowed) {
      dismissToast(UPDATE_TOAST_ID)
      return
    }
    showToast('Update ready.', {
      id: UPDATE_TOAST_ID,
      persistent: true,
      action: { label: 'Update', onClick: update },
    })
  }, [needRefresh, allowed, update])
}
