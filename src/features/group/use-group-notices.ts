import { useEffect } from 'react'
import {
  everyoneElseLeft,
  everyoneLeftText,
  removedNotices,
  removedNoticeText,
  type MyGroup,
} from '@/domain/groups'
import {
  getLastSeenCount,
  hasSeenRemovedNotice,
  markRemovedNoticeSeen,
  setLastSeenCount,
} from '@/data/group-notices'
import { useEndedMemberships } from '@/data/groups'
import { showToast } from '@/ui/toast'

/**
 * Today's one-time group notices (device-only, AD-12):
 * - "You're no longer in {Group}." once per removal that ended within the last 7 days and was not
 *   yet shown on this device (one per visit: the newest unseen one; the next shows on a later visit);
 * - "Everyone else left {Group}. Your habits still score; the leaderboard waits for a friend." when
 *   the focused group's last-seen member count was 2 or more and it is now 1. The focused group's
 *   count is stored on every visit.
 * Each notice is marked seen before its toast is raised, so a re-run never repeats it.
 */
export function useGroupNotices(focused: MyGroup | null): void {
  const { data: ended } = useEndedMemberships()

  useEffect(() => {
    if (!ended) return
    const newest = removedNotices(ended, Date.now(), hasSeenRemovedNotice)[0]
    if (!newest) return
    markRemovedNoticeSeen(newest.membershipId)
    showToast(removedNoticeText(newest.name), { id: `removed-${newest.membershipId}` })
  }, [ended])

  const focusedId = focused?.id
  const focusedName = focused?.name
  const memberCount = focused?.memberCount

  useEffect(() => {
    if (focusedId === undefined || focusedName === undefined || memberCount === undefined) return
    const lastSeen = getLastSeenCount(focusedId)
    setLastSeenCount(focusedId, memberCount)
    if (everyoneElseLeft(lastSeen, memberCount)) {
      showToast(everyoneLeftText(focusedName), { id: `everyone-left-${focusedId}` })
    }
  }, [focusedId, focusedName, memberCount])
}
