import { useId, useRef, useState } from 'react'
import { checkinAlt, type FeedCheckin, type FeedViewer } from '@/domain/feed'
import { PROFILE_COPY } from '@/domain/badges'
import { useAuthSession } from '@/data/auth-session'
import { useMemberCheckins } from '@/data/member-profile'
import { useMemberTimeZone } from '@/data/profile'
import { CheckinPhoto } from '@/features/feed/checkin-photo'
import { PhotoViewer } from '@/features/feed/photo-viewer'

/**
 * A member's recent check-ins (Story 4.6) as 52px flat thumbnails (the 360 rendition) that open the
 * Photo viewer; focus returns to the thumbnail. Hidden while loading, after a failed read and with
 * no check-ins.
 */
export function RecentCheckins({ groupId, userId }: { groupId: string; userId: string }) {
  const headingId = useId()
  const query = useMemberCheckins(groupId, userId, true)
  const session = useAuthSession()
  const zone = useMemberTimeZone()
  const [open, setOpen] = useState<FeedCheckin | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [mountedAt] = useState(() => Date.now())
  const items = query.data ?? []
  if (items.length === 0) return null
  const viewer: FeedViewer = {
    userId: session.user?.id ?? '',
    zone,
    now: new Date(Math.max(query.dataUpdatedAt, mountedAt)),
  }
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
      data-component="recent-checkins"
    >
      <h2 id={headingId} className="type-title">
        {PROFILE_COPY.recent}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              aria-label={checkinAlt(item, viewer)}
              onClick={(event) => {
                opener.current = event.currentTarget
                setOpen(item)
              }}
              onContextMenu={(event) => event.preventDefault()}
              className="relative block size-[52px] overflow-hidden rounded-photo border-2 border-line bg-linear-to-br from-ph1 to-ph2 press-overlay"
              data-component="checkin-thumb"
            >
              <CheckinPhoto item={item} alt="" variant="mini" />
            </button>
          </li>
        ))}
      </ul>
      <PhotoViewer
        item={open}
        viewer={viewer}
        onClose={() => setOpen(null)}
        returnFocusTo={() => opener.current}
      />
    </section>
  )
}
