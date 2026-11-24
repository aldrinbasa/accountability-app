import { useId, useRef, useState } from 'react'
import { OPEN_VOTES_COPY } from '@/domain/open-votes'
import type { FeedCheckin, FeedViewer } from '@/domain/feed'
import { useAuthSession } from '@/data/auth-session'
import { useOpenVotes } from '@/data/open-votes'
import { useMemberTimeZone } from '@/data/profile'
import { PhotoViewer } from '@/features/feed/photo-viewer'
import { useMinuteClock } from '@/ui/use-minute-clock'
import { FreezeVoteCard } from '@/features/vote/freeze-vote-card'
import { VoteCard } from '@/features/vote/vote-card'

/**
 * Today's "Open votes" (Story 5.6, FR-35): the challenges and freeze requests the member can still
 * vote on, nearest deadline first, as the Feed's own Vote cards, so a vote needs no trip to the Feed
 * and no push. A card just voted on keeps its voted state (and the Undo toast) until the fetch after
 * its 6 s window. Absent when nothing waits; the caller leaves it out of a waiting group.
 */
export function OpenVotes({ groupId }: { groupId: string }) {
  const headingId = useId()
  const query = useOpenVotes(groupId)
  const session = useAuthSession()
  const zone = useMemberTimeZone()
  const clock = useMinuteClock()
  const [open, setOpen] = useState<FeedCheckin | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  // Server times are compared with the later of the last fetch and a minute clock (AD-11).
  const viewer: FeedViewer = {
    userId: session.user?.id ?? '',
    zone,
    now: new Date(Math.max(query.dataUpdatedAt, clock.getTime())),
  }
  // A vote whose deadline passed while Today stayed open leaves at the next minute tick.
  const votes = (query.data?.openVotes ?? []).filter(
    (vote) => !(Date.parse(vote.closesAt) <= viewer.now.getTime()),
  )

  // The Photo viewer stays mounted even when the last card leaves under it.
  const viewerSheet = (
    <PhotoViewer
      item={open}
      viewer={viewer}
      onClose={() => setOpen(null)}
      returnFocusTo={() => opener.current}
    />
  )
  if (votes.length === 0) return viewerSheet

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
      data-component="open-votes"
    >
      <h2 id={headingId} className="type-title">
        {OPEN_VOTES_COPY.title}
      </h2>
      <ul className="flex flex-col gap-4">
        {votes.map((vote, index) => {
          const tilt = index % 2 === 0 ? 'right' : 'left'
          return (
            <li key={vote.id}>
              {vote.type === 'vote' ? (
                <VoteCard
                  item={vote}
                  viewer={viewer}
                  tilt={tilt}
                  onOpenPhoto={(checkin, button) => {
                    opener.current = button
                    setOpen(checkin)
                  }}
                />
              ) : (
                <FreezeVoteCard item={vote} viewer={viewer} tilt={tilt} />
              )}
            </li>
          )
        })}
      </ul>
      {viewerSheet}
    </section>
  )
}
