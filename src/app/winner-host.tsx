import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router'
import { shouldAutoShowWinner, type WinnerWeek } from '@/domain/winner'
import { useAuthSession } from '@/data/auth-session'
import { isWinnerSeen, markWinnerSeen, useWinnerWeek } from '@/data/winner'
import { isSheetOpen } from '@/ui/sheet-history'
import { isCameraOpen, subscribeUpdateGuard } from '@/ui/update-guard'
import { useFocusedGroup } from '@/features/group/use-focused-group'
import { WinnerCard } from '@/features/winner/winner-card'
import { WINNER_DEEP_LINK } from '@/app/shell/tabs'

interface Shown {
  groupId: string
  week: WinnerWeek
}

/**
 * Opens the Winner card by itself (Story 4.5) over any shell screen: for the focused group's most
 * recent locked week, when it has winners, this device has not shown it yet (seen key), and the
 * member joined before that week's lock. Older unseen weeks never queue up. It waits while the
 * camera or a sheet (or the photo viewer) is open, checking again on the next screen change or
 * refetch; on the `/winner/…` deep link (which shows its own card); and while the shell shows a stale
 * group link (`paused`). Once open, the card keeps the week it opened with; closing stores the seen
 * key.
 */
export function WinnerHost({ paused }: { paused: boolean }) {
  const { pathname } = useLocation()
  const session = useAuthSession()
  const { group } = useFocusedGroup()
  const cameraOpen = useSyncExternalStore(subscribeUpdateGuard, isCameraOpen)
  const onDeepLink = WINNER_DEEP_LINK.test(pathname)
  const active = group !== null && !paused && !onDeepLink
  const { data: week } = useWinnerWeek(active ? group.id : null, null)
  const [shown, setShown] = useState<Shown | null>(null)

  const candidate: Shown | null =
    active &&
    !cameraOpen &&
    !!week &&
    shouldAutoShowWinner({
      week,
      seen: isWinnerSeen(group.id, week.weekStart),
      joinedAt: group.joinedAt,
    })
      ? { groupId: group.id, week }
      : null

  useEffect(() => {
    if (shown === null && candidate !== null && !isSheetOpen()) setShown(candidate)
    // The candidate is rebuilt every render; its group and week (and the screen) are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, candidate?.groupId, candidate?.week, pathname])

  return (
    <WinnerCard
      week={shown?.week ?? null}
      viewerId={session.user?.id ?? ''}
      onClose={() => {
        if (shown) markWinnerSeen(shown.groupId, shown.week.weekStart)
        setShown(null)
      }}
    />
  )
}
