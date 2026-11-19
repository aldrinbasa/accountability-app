import { useCallback } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useUpdateToast } from '@/app/use-update-toast'

/** Registers the service worker (prompt mode) and wires its update signal to the toast. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const update = useCallback(() => {
    void updateServiceWorker(true)
  }, [updateServiceWorker])
  useUpdateToast(needRefresh, update)
  return null
}
