import { useQueryClient } from '@tanstack/react-query'
import { boardGroupKey, groupWeekKey } from '@/data/board'
import { feedKey } from '@/data/feed'
import { groupGoalKey } from '@/data/goal'
import { MY_GROUPS_KEY } from '@/data/groups'
import { memberProfileGroupKey } from '@/data/member-profile'
import { planKey, todayKey } from '@/data/plan'
import { streaksKey } from '@/data/streaks'

/**
 * Every view a challenge, a freeze request or a vote outcome can change in a group (Epic 5 retro
 * A2, one list for both kinds): Today and the freeze reads under it, My plan (a frozen or
 * un-frozen session), the Feed (wall, anchored pages and Friends today), the board and its week,
 * streaks, profiles, the group goal, and the groups list (its member count picks the 2-person or
 * 3+ copy and hides Challenge when alone).
 */
export function voteOutcomeKeys(groupId: string): readonly (readonly unknown[])[] {
  return [
    todayKey(groupId),
    planKey(groupId),
    feedKey(groupId),
    boardGroupKey(groupId),
    groupWeekKey(groupId),
    streaksKey(groupId),
    memberProfileGroupKey(groupId),
    groupGoalKey(groupId),
    MY_GROUPS_KEY,
  ]
}

/**
 * Refetches every view in `voteOutcomeKeys`. Server actions never queue (AD-12): this runs after
 * the server answered, or when a vote outcome arrives on screen.
 */
export function useInvalidateVoteOutcomeViews(groupId: string): () => void {
  const queryClient = useQueryClient()
  return () => {
    for (const queryKey of voteOutcomeKeys(groupId)) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }
}
