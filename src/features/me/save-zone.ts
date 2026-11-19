import { backendErrorCode } from '@/domain/error-codes'
import { TIME_ZONE_COPY } from '@/domain/time-zones'
import { isOffline } from '@/data/connectivity'
import { dismissToast, showToast } from '@/ui/toast'

const SAVE_TOAST_ID = 'time-zone-save'

function offline(): void {
  showToast(TIME_ZONE_COPY.offline, { variant: 'error', id: SAVE_TOAST_ID })
}

/**
 * Saves a picked zone through an optimistic mutation (which shows the choice at once and reverts
 * itself on failure) and raises the story's error toasts: "Couldn't save. You're offline." when the
 * device is offline (nothing is sent, so the row keeps its value) or no response came back, else
 * "Couldn't save your time zone.": with Retry (which sends the same zone again) only for a failure
 * that may pass on a second try (`unknown`); a refused zone (`invalid_time_zone`, e.g. a browser
 * zone the database lacks), `not_admin` or `not_member` get no Retry. A successful save dismisses
 * any earlier save toast, so an old Retry cannot overwrite a newer choice.
 */
export function saveZone(save: (zone: string) => Promise<unknown>, zone: string): void {
  if (isOffline()) {
    offline()
    return
  }
  save(zone).then(
    () => dismissToast(SAVE_TOAST_ID),
    (error: unknown) => {
      const code = backendErrorCode(error)
      if (code === 'network') {
        offline()
        return
      }
      showToast(TIME_ZONE_COPY.saveFailed, {
        variant: 'error',
        id: SAVE_TOAST_ID,
        ...(code === 'unknown'
          ? { action: { label: TIME_ZONE_COPY.retry, onClick: () => saveZone(save, zone) } }
          : {}),
      })
    },
  )
}
