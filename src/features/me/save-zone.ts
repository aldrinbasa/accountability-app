import { backendErrorCode } from '@/domain/error-codes'
import { TIME_ZONE_COPY } from '@/domain/time-zones'
import { isOffline } from '@/data/connectivity'
import { showToast } from '@/ui/toast'

const SAVE_TOAST_ID = 'time-zone-save'

function offline(): void {
  showToast(TIME_ZONE_COPY.offline, { variant: 'error', id: SAVE_TOAST_ID })
}

/**
 * Saves a picked zone through an optimistic mutation (which shows the choice at once and reverts
 * itself on failure) and raises the story's error toasts: "Couldn't save. You're offline." when the
 * device is offline (nothing is sent, so the row keeps its value) or no response came back, else
 * "Couldn't save your time zone." with Retry, which sends the same zone again.
 */
export function saveZone(save: (zone: string) => Promise<unknown>, zone: string): void {
  if (isOffline()) {
    offline()
    return
  }
  save(zone).catch((error: unknown) => {
    if (backendErrorCode(error) === 'network') {
      offline()
      return
    }
    showToast(TIME_ZONE_COPY.saveFailed, {
      variant: 'error',
      id: SAVE_TOAST_ID,
      action: { label: TIME_ZONE_COPY.retry, onClick: () => saveZone(save, zone) },
    })
  })
}
