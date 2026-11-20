import { useEffect, useState } from 'react'
import { checkinAlt, postedAnnouncement } from '@/domain/checkin'
import {
  getPostMoment,
  markPostMomentAnnounced,
  markPostMomentPlayed,
  usePostMoment,
} from '@/data/post-moment'
import { Polaroid } from '@/ui/polaroid'
import { cn } from '@/ui/lib/utils'

/** The drop's length (EXPERIENCE.md: stick-down 900 ms spring); the end state is forced after it. */
const DROP_MS = 900
/** A light haptic where `navigator.vibrate` exists (Android; iOS has none). */
const HAPTIC_MS = 10

/**
 * The post moment at the top of Today (Story 3.2): the member's last post in this group as a polaroid
 * that drops, wobbles and sticks down (900 ms), a polite "Posted. Gym 4 of 5." once and a light
 * haptic. Transform and opacity only; it never blocks input, and any tap jumps to the end state.
 * `prefers-reduced-motion` shows the end state at once (app.css), the announcement kept. The polaroid
 * stays for the session (Story 3.5 moves it into Friends today).
 */
export function PostMoment({ groupId }: { groupId: string }) {
  const moment = usePostMoment(groupId)
  const [message, setMessage] = useState('')
  const checkinId = moment?.checkinId ?? null
  const announce = moment !== null && !moment.announced
  const playing = moment !== null && !moment.played

  useEffect(() => {
    // Once per post, also when effects run twice (StrictMode) or Today mounts again.
    if (!announce || moment === null || getPostMoment()?.announced) return
    markPostMomentAnnounced(moment.checkinId)
    setMessage(postedAnnouncement(moment.title, moment.doneCount, moment.target))
    if (typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(HAPTIC_MS)
      } catch {
        // A refused haptic is fine.
      }
    }
  }, [announce, moment])

  // The end state after the drop, or at the first tap anywhere (passive: the tap still works).
  useEffect(() => {
    if (!playing || checkinId === null) return
    const end = () => markPostMomentPlayed(checkinId)
    const timer = setTimeout(end, DROP_MS)
    document.addEventListener('pointerdown', end, { capture: true, passive: true })
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', end, { capture: true })
    }
  }, [playing, checkinId])

  if (!moment) return null
  return (
    <>
      {/* Mounted empty, then filled by the effect, so the polite announcement is read. */}
      <p role="status" className="sr-only">
        {message}
      </p>
      <div
        className={cn('mx-auto w-full max-w-[280px] pt-2 pb-1', playing && 'animate-polaroid-drop')}
        data-component="post-moment"
        data-playing={playing ? '' : undefined}
        onAnimationEnd={() => markPostMomentPlayed(moment.checkinId)}
      >
        <Polaroid
          photo={
            moment.photoUrl ? (
              <img
                src={moment.photoUrl}
                alt={checkinAlt(moment.title, moment.caption)}
                draggable={false}
                onContextMenu={(event) => event.preventDefault()}
                className="block size-full object-cover"
              />
            ) : (
              <span
                role="img"
                aria-label={checkinAlt(moment.title, moment.caption)}
                className="block size-full"
              />
            )
          }
          caption={moment.caption}
          meta={`${moment.title} · ${moment.doneCount}/${moment.target}`}
        />
      </div>
    </>
  )
}
