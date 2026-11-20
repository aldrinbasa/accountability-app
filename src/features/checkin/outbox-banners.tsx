import { CloudArrowUp, WarningCircle } from '@phosphor-icons/react'
import { OUTBOX_COPY, rejectionBannerText, waitingBannerText } from '@/domain/outbox'
import { useCheckinOutbox, useOutboxItems } from '@/data/checkin-outbox'
import { useMemberTimeZone } from '@/data/profile'
import { Banner } from '@/ui/banner'

/**
 * The outbox on Today (Story 3.3), for every group's entries: the photo-waiting Banner ("1 photo
 * waiting to send · Gym · Sunday Reset · taken 07:12. Sends when you're back online." + Retry, which
 * sends now and resets the backoff) and one Banner per rejected entry ("Too late for last week. It
 * locked Wed 23:59, so this photo can't count." + Got it, which deletes it). Times in the member's
 * zone, else the device's. Nothing here can swap, edit or re-target a held photo.
 */
export function OutboxBanners() {
  const outbox = useCheckinOutbox('OutboxBanners')
  const items = useOutboxItems()
  const zone = useMemberTimeZone()
  const waiting = items.filter((item) => item.rejection === null)
  const rejected = items.filter((item) => item.rejection !== null)
  const waitingText = waitingBannerText(waiting, Date.now(), zone)

  if (waitingText === null && rejected.length === 0) return null
  return (
    <div data-component="outbox-banners" tabIndex={-1} className="flex flex-col gap-2 outline-none">
      {waitingText !== null ? (
        <Banner
          icon={CloudArrowUp}
          action={{ label: OUTBOX_COPY.retry, onClick: () => outbox.retry() }}
        >
          {waitingText}
        </Banner>
      ) : null}
      {rejected.map((item) =>
        item.rejection ? (
          <Banner
            key={item.id}
            icon={WarningCircle}
            action={{ label: OUTBOX_COPY.gotIt, onClick: () => void outbox.dismiss(item.id) }}
          >
            {rejectionBannerText(item.title, item.rejection, zone)}
          </Banner>
        ) : null,
      )}
    </div>
  )
}
