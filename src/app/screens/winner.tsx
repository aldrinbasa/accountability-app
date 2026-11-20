import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { FEED_COPY, switchedToast } from '@/domain/feed'
import type { MyGroup } from '@/domain/groups'
import { hasWinners, parseWinnerWeekStart } from '@/domain/winner'
import { useAuthSession } from '@/data/auth-session'
import { getStoredFocusedGroup } from '@/data/focused-group'
import { markWinnerSeen, useWinnerWeek } from '@/data/winner'
import { runAfterSheetClose } from '@/ui/sheet-history'
import { showToast } from '@/ui/toast'
import { searchWithGroup, useFocusedGroup } from '@/features/group/use-focused-group'
import { WinnerCard } from '@/features/winner/winner-card'
import { FeedScreen } from '@/app/screens/feed'

/** One toast id per deep-link notice, so a repeat replaces it instead of stacking. */
const GONE_TOAST_ID = 'winner-gone'
const SWITCHED_TOAST_ID = 'winner-switched'

/**
 * The card for one deep-linked week, over the Feed. A `?g=` that moved the focus says "Switched to
 * {Group}."; a malformed, unknown, unlocked, unscored or winnerless week opens the Feed with "That's
 * already wrapped up.". Shown even when this device has seen it; closing stores the seen key and
 * replaces the URL with the Feed.
 */
function WinnerLink({ group, weekParam }: { group: MyGroup; weekParam: string | undefined }) {
  const weekStart = parseWinnerWeekStart(weekParam)
  const query = useWinnerWeek(weekStart ? group.id : null, weekStart)
  const session = useAuthSession()
  const navigate = useNavigate()
  const location = useLocation()
  // Read before the shell stores the new focus (its effect runs after this first render).
  const [previousFocus] = useState(getStoredFocusedGroup)
  const [closed, setClosed] = useState(false)

  const toFeed = useCallback(() => {
    void navigate(
      { pathname: '/feed', search: searchWithGroup(location.search, group.id) },
      { replace: true, state: location.state },
    )
  }, [navigate, location.search, location.state, group.id])

  useEffect(() => {
    const linked = new URLSearchParams(location.search).get('g')
    if (linked === group.id && previousFocus !== null && previousFocus !== group.id) {
      showToast(switchedToast(group.name), { id: SWITCHED_TOAST_ID })
    }
    // Once per deep link (the component is keyed by group and week).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const gone = weekStart === null || (query.isSuccess && !hasWinners(query.data))
  const failed = query.isError && !query.data
  useEffect(() => {
    if (gone) showToast(FEED_COPY.gone, { id: GONE_TOAST_ID })
    if (gone || failed) toFeed()
  }, [gone, failed, toFeed])

  const week = !closed && hasWinners(query.data) ? query.data : null

  return (
    <WinnerCard
      week={week}
      viewerId={session.user?.id ?? ''}
      onClose={() => {
        if (week) markWinnerSeen(group.id, week.weekStart)
        setClosed(true)
        // After the card's own history entry is gone, so the Feed replaces /winner itself and back
        // never reopens the card.
        runAfterSheetClose(toFeed)
      }}
    />
  )
}

/**
 * `/winner/{weekStart}?g={groupId}` (Story 4.5): the Winner card deep link over the Feed, shown as
 * the Feed tab (the shell handles a group the member left: "You're not in {Group} anymore."). The
 * Feed handles loading and no groups; the card joins once the focused group is known.
 */
export function WinnerScreen() {
  const { group } = useFocusedGroup()
  const { weekStart } = useParams()
  return (
    <>
      <FeedScreen />
      {group ? (
        <WinnerLink key={`${group.id}:${weekStart ?? ''}`} group={group} weekParam={weekStart} />
      ) : null}
    </>
  )
}
