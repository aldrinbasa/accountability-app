import { useEffect, useState } from 'react'
import { outboxPhotoBlob } from '@/data/checkin-outbox'
import { getOutboxEntry } from '@/data/outbox-db'

/**
 * A local URL of a waiting outbox entry's 360 rendition, for its "sending…" polaroid in the Feed
 * (Story 3.4). Read from the device store, never from the network; null while reading, where object
 * URLs don't exist, or once the entry has no photo. The URL is released on unmount.
 */
export function useOutboxPhoto(checkinId: string): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    void getOutboxEntry(checkinId)
      .then((entry) => {
        const photo = entry?.photos?.[360]
        if (cancelled || !photo || typeof URL.createObjectURL !== 'function') return
        created = URL.createObjectURL(outboxPhotoBlob(photo))
        setUrl(created)
      })
      .catch(() => {
        // Unreadable store: the polaroid keeps its placeholder.
      })
    return () => {
      cancelled = true
      if (created && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(created)
    }
  }, [checkinId])

  return url
}
