import { useEffect, useRef, useState } from 'react'
import { BOARD_COPY, scoreStickerLabel } from '@/domain/board'
import { getLastSeenRank, setLastSeenRank } from '@/data/board'
import { markPassedShown } from '@/data/post-moment'
import { RankChip } from '@/ui/rank-chip'
import { ScoreSticker } from '@/ui/score-sticker'
import type { TodayScore } from '@/features/today/use-today-score'

export interface TodayScoreStickerProps {
  /** `useTodayScore` for this Today mount (null: hidden). */
  score: TodayScore | null
  href: string
  onOpen: () => void
}

export interface TodayRankChipProps {
  groupId: string
  /** This Today mount's id (`nextTodayMountId`): the passed chip lasts until the next open. */
  mountId: number
  /** `useTodayScore` for this Today mount (null: hidden). */
  score: TodayScore | null
}

/**
 * The Score sticker on Today: the member's weekly points (or "no score this week"), ticking with
 * the 400 ms count bump inside the post moment; a tap opens the Board (`/board?g=`).
 */
export function TodayScoreSticker({ score, href, onOpen }: TodayScoreStickerProps) {
  if (!score) return null
  // A late post's points are not applied, so there is no new number to bump.
  const bump =
    score.moment !== null && !score.moment.played && !score.moment.isLate && score.points !== null
  return (
    <ScoreSticker
      points={score.points}
      unit={BOARD_COPY.weeklyPoints}
      emptyText={BOARD_COPY.noScore}
      label={scoreStickerLabel(score.points)}
      href={href}
      onOpen={onOpen}
      bump={bump}
    />
  )
}

/**
 * The rank chip under the Score sticker: "#2 · Marco's 4 ahead" and its variants (`rankChipText`),
 * hidden when unranked. Right after a post that passed someone it reads "#1 · passed Jo" with a
 * 300 ms wobble until the next open of Today; a rank worse than the one this device last showed
 * wobbles once too. A rank change is announced once in a polite live region (not per refetch, and
 * not when the post's own announcement already said it).
 */
export function TodayRankChip({ groupId, mountId, score }: TodayRankChipProps) {
  const [wobble, setWobble] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const previousRank = useRef<number | null | undefined>(undefined)
  const mountedAt = useRef(Number.POSITIVE_INFINITY)

  const moment = score?.moment ?? null
  const passedNow = (score?.passed.length ?? 0) > 0
  const momentId = moment?.checkinId ?? null
  const momentPlayed = moment?.played ?? true
  const momentPassedShownIn = moment?.passedShownIn ?? null
  const boardRank = score?.boardRank ?? null
  const rank = score?.chip ? score.rank : null
  const chip = score?.chip ?? null

  useEffect(() => {
    mountedAt.current = Date.now()
  }, [])

  // The passed chip: first shown on this mount; it wobbles in as part of the post moment.
  useEffect(() => {
    if (!passedNow || momentId === null) return
    if (momentPassedShownIn === null) markPassedShown(momentId, mountId)
    if (!momentPlayed) setWobble(`passed:${momentId}`)
  }, [passedNow, momentId, momentPassedShownIn, momentPlayed, mountId])

  // Last-seen rank (device only): a drop since the last look wobbles once; then remember this rank.
  useEffect(() => {
    if (boardRank === null) return
    const last = getLastSeenRank(groupId)
    if (last !== null && boardRank > last) setWobble(`drop:${boardRank}`)
    setLastSeenRank(groupId, boardRank)
  }, [groupId, boardRank])

  // One polite announcement per rank change on this mount, from the first loaded rank on (also
  // unranked to ranked); nothing while the board loads.
  const loaded = score !== null
  useEffect(() => {
    if (!loaded) return
    const previous = previousRank.current
    previousRank.current = rank
    if (rank === null || previous === undefined || previous === rank) return
    const current = moment
    if (
      current &&
      !current.isLate &&
      current.rank === rank &&
      current.postedAt >= mountedAt.current
    ) {
      return
    }
    // Only a rank change announces; the chip's copy changing alone does not.
    if (chip) setMessage(chip)
  }, [loaded, rank, chip, moment])

  // A tap during the wobble jumps to the end state.
  useEffect(() => {
    if (wobble === null) return
    const end = () => setWobble(null)
    document.addEventListener('pointerdown', end, { capture: true, passive: true })
    return () => document.removeEventListener('pointerdown', end, { capture: true })
  }, [wobble])

  if (!score) return null
  const [head, ...rest] = chip === null ? [] : chip.split(' · ')
  return (
    <>
      {chip !== null ? (
        <RankChip
          key={wobble ?? 'still'}
          rank={head ?? chip}
          detail={rest.length > 0 ? rest.join(' · ') : null}
          wobble={wobble !== null}
          onWobbleEnd={() => setWobble(null)}
        />
      ) : null}
      {/* Mounted with the sticker, then filled on a rank change, so the update is read. */}
      <p role="status" className="sr-only">
        {message}
      </p>
    </>
  )
}
