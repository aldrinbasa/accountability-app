import { useEffect, useState } from 'react'
import { postedAnnouncement } from '@/domain/checkin'
import {
  getPostMoment,
  markPostMomentAnnounced,
  markPostMomentPlayed,
  usePostMoment,
} from '@/data/post-moment'
import { Polaroid } from '@/ui/polaroid'

/** The drop (EXPERIENCE.md: stick-down 900 ms spring), then a fade; the end state is forced after it. */
const DROP_MS = 900
const FADE_MS = 300
const MOMENT_MS = DROP_MS + FADE_MS
/** A light haptic where `navigator.vibrate` exists (Android; iOS has none). */
const HAPTIC_MS = 10

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * The post moment on Today (Stories 3.2, 3.5): the member's last post in this group drops, wobbles
 * and sticks down (900 ms) as a fixed overlay at the top of Today, then fades, while the check-in
 * settles into the Friends today strip as its first mini (no layout shift). A polite "Posted. Gym 4
 * of 5. 67 weekly points. Rank 1." once (points and rank when ranked, Story 4.1) and a light haptic.
 * The Score sticker's count bump and the rank chip's wobble play inside the same moment. Transform
 * and opacity only; the overlay is `aria-hidden`, never takes pointer input, and any tap jumps to
 * the end state. `prefers-reduced-motion`: no overlay, the announcement kept. A late post's points
 * and rank are left out of the announcement (they may belong to an earlier week).
 */
export function PostMoment({ groupId }: { groupId: string }) {
  const moment = usePostMoment(groupId)
  const [message, setMessage] = useState('')
  const [reduced] = useState(prefersReducedMotion)
  const checkinId = moment?.checkinId ?? null
  const announce = moment !== null && !moment.announced
  const playing = moment !== null && !moment.played

  useEffect(() => {
    // Once per post, also when effects run twice (StrictMode) or Today mounts again.
    if (!announce || moment === null || getPostMoment()?.announced) return
    markPostMomentAnnounced(moment.checkinId)
    setMessage(
      // A late post may have scored an earlier week: its points and rank are not read out.
      postedAnnouncement(
        moment.title,
        moment.doneCount,
        moment.target,
        moment.isLate ? undefined : { weeklyPoints: moment.weeklyPoints, rank: moment.rank },
      ),
    )
    if (typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(HAPTIC_MS)
      } catch {
        // A refused haptic is fine.
      }
    }
  }, [announce, moment])

  // The end state after the drop and fade, or at the first tap anywhere (passive: the tap still works).
  useEffect(() => {
    if (!playing || checkinId === null) return
    const end = () => markPostMomentPlayed(checkinId)
    const timer = setTimeout(end, MOMENT_MS)
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
      {playing && !reduced ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-(--z-nav) flex justify-center px-gutter pt-[calc(env(safe-area-inset-top)+72px)] animate-polaroid-fade"
          data-component="post-moment-drop"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) markPostMomentPlayed(moment.checkinId)
          }}
        >
          <div className="w-full max-w-[280px] animate-polaroid-drop">
            <Polaroid
              photo={
                moment.photoUrl ? (
                  <img
                    src={moment.photoUrl}
                    alt=""
                    draggable={false}
                    className="block size-full object-cover"
                  />
                ) : null
              }
              caption={moment.caption}
              meta={`${moment.title} · ${moment.doneCount}/${moment.target}`}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}
