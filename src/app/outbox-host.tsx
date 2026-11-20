import { useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Streak } from '@/domain/streaks'
import { boardGroupKey, groupWeekKey } from '@/data/board'
import { checkinTargetsKey } from '@/data/checkin'
import {
  OutboxProvider,
  outboxPhotoBlob,
  useCheckinOutboxForUser,
  type SentCheckin,
} from '@/data/checkin-outbox'
import { todayKey } from '@/data/plan'
import { localPhotoUrl, setPostMoment } from '@/data/post-moment'
import { streaksKey } from '@/data/streaks'
import { setUploadRunning } from '@/ui/update-guard'

/**
 * Runs the signed-in user's check-in outbox while the shell is mounted (Story 3.3) and gives it to
 * everything below (`useCheckinOutbox`). The sender runs on mount (app start, sign-in), when the
 * window regains focus or becomes visible, and on `online`; its own backoff timer and new entries
 * wake it too. While it uploads or posts, the "Update ready" toast waits (`setUploadRunning`). Each
 * accepted send plays the post moment (also a late, background send) and refetches Today, the
 * picker, the Feed, the board and the streaks of its group.
 */
export function OutboxHost({ userId, children }: { userId: string; children: ReactNode }) {
  const queryClient = useQueryClient()

  function onSent({ entry, result }: SentCheckin) {
    // The streak before the post, for the milestone pop once the refetch shows it 1 higher.
    const streakBefore =
      queryClient
        .getQueryData<Streak[]>(streaksKey(entry.groupId))
        ?.find((streak) => streak.commitmentId === entry.commitmentId)?.currentStreak ?? null
    setPostMoment({
      checkinId: result.checkinId,
      groupId: entry.groupId,
      commitmentId: entry.commitmentId,
      title: entry.title,
      doneCount: result.doneCount,
      target: result.target,
      counted: result.counted,
      isLate: result.isLate,
      weeklyPoints: result.weeklyPoints,
      rank: result.rank,
      passedUserIds: result.passedUserIds,
      passedShownIn: null,
      streakBefore,
      streakPopped: false,
      photoUrl: entry.photos ? localPhotoUrl(outboxPhotoBlob(entry.photos[1080])) : null,
      caption: entry.caption,
      postedAt: Date.now(),
      played: false,
      announced: false,
    })
    void queryClient.invalidateQueries({ queryKey: todayKey(entry.groupId) })
    void queryClient.invalidateQueries({ queryKey: checkinTargetsKey(entry.groupId) })
    // The Feed (Story 3.4) keeps its pages under ['feed', groupId].
    void queryClient.invalidateQueries({ queryKey: ['feed', entry.groupId] })
    // The board (Story 4.1): its refetch replaces the moment's optimistic score.
    void queryClient.invalidateQueries({ queryKey: boardGroupKey(entry.groupId) })
    // A week may have turned while Today stayed open: the board then follows the new week.
    void queryClient.invalidateQueries({ queryKey: groupWeekKey(entry.groupId) })
    // Streaks (Story 4.2): the refetch shows the kept session's +1.
    void queryClient.invalidateQueries({ queryKey: streaksKey(entry.groupId) })
  }

  const outbox = useCheckinOutboxForUser(userId, { onSent, onRunningChange: setUploadRunning })

  useEffect(() => {
    const wake = () => outbox.kick()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') outbox.kick()
    }
    window.addEventListener('focus', wake)
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', wake)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', onVisibility)
      setUploadRunning(false)
    }
  }, [outbox])

  return <OutboxProvider value={outbox}>{children}</OutboxProvider>
}
