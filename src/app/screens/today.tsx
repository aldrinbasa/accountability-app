import { useState } from 'react'
import { useLocation } from 'react-router'
import { CloudSlash } from '@phosphor-icons/react'
import { GROUP_COPY, isWaiting, type MyGroup } from '@/domain/groups'
import { weekLine } from '@/domain/today'
import { useToday } from '@/data/plan'
import { nextTodayMountId } from '@/data/post-moment'
import { Screen } from '@/app/screens/screen'
import { todayHeading } from '@/app/screens/today-heading'
import { useTabNavigation } from '@/app/shell/use-tab-navigation'
import { EmptyState } from '@/ui/empty-state'
import { InstallNotice } from '@/features/install/install-notice'
import { CreateGroupScreen } from '@/features/group/create-group-screen'
import { useFocusedGroup } from '@/features/group/use-focused-group'
import { useGroupNotices } from '@/features/group/use-group-notices'
import { WaitingEmptyState } from '@/features/group/waiting-empty-state'
import { OutboxBanners } from '@/features/checkin/outbox-banners'
import { PostMoment } from '@/features/checkin/post-moment'
import { PlanSheetHost } from '@/features/plan/plan-sheet-host'
import { TodaySections } from '@/features/plan/today-sections'
import { FriendsToday } from '@/features/today/friends-today'
import { TodayRankChip, TodayScoreSticker } from '@/features/today/score-hero'
import { useTodayScore } from '@/features/today/use-today-score'

/**
 * Today for one group: the member-local day name as the one h1, the week line under it ("Week 4 of
 * the grind · 6 of 9 done", hidden when nothing is planned this week), the Score sticker beside the
 * heading and the rank chip under the week line (Story 4.1; a group of one shows the sticker, never the chip), the install
 * notice, the waiting state on top in a waiting group, then the plan sections and "+ Add" (Story
 * 2.5), then the Friends today strip (Story 3.5). The outbox's photo-waiting and rejection Banners (Story 3.3, every
 * group's entries) sit under the week line. After a post the polaroid drops as an overlay and
 * settles into the strip (Stories 3.2, 3.5).
 */
function GroupToday({ group }: { group: MyGroup }) {
  const { data } = useToday(group.id)
  const { search } = useLocation()
  const goToTab = useTabNavigation()
  // One id per open of Today: the passed rank chip lasts until the next one (Story 4.1).
  const [mountId] = useState(nextTodayMountId)
  const score = useTodayScore(group, mountId)
  const line = data ? weekLine(data.summary) : null
  return (
    <Screen
      title={todayHeading(data?.summary.memberToday)}
      leading={
        score ? (
          <TodayScoreSticker
            score={score}
            href={`/board${search}`}
            onOpen={() => goToTab('/board')}
          />
        ) : undefined
      }
      subtitle={
        <>
          {line ? <p className="type-meta text-muted">{line}</p> : null}
          <TodayRankChip groupId={group.id} mountId={mountId} score={score} />
        </>
      }
    >
      <OutboxBanners />
      {/* The last post's drop: a fixed overlay, then the strip's first mini (Story 3.5). */}
      <PostMoment groupId={group.id} />
      <InstallNotice />
      {isWaiting(group) ? <WaitingEmptyState group={group} /> : null}
      {/* One Plan sheet host per group: "+ Add" and a row's Edit open it. */}
      <PlanSheetHost key={group.id} groupId={group.id}>
        <TodaySections groupId={group.id} waiting={isWaiting(group)} />
      </PlanSheetHost>
      <FriendsToday
        groupId={group.id}
        seeAllHref={`/feed${search}`}
        onSeeAll={() => goToTab('/feed')}
      />
    </Screen>
  )
}

/**
 * Today for the focused group. While the groups load: blank (plus the install notice). Load failed:
 * an Empty state with Try again. No current groups: the full-screen create screen. Otherwise the
 * group's Today (`GroupToday`). The install notice shows in every state, and so do the one-time
 * group notices (removed from a group, everyone else left).
 */
export function TodayScreen() {
  const { group, groups, query } = useFocusedGroup()
  useGroupNotices(group)

  if (groups === undefined) {
    if (!query.isError) return <InstallNotice />
    return (
      <Screen title={todayHeading()}>
        <InstallNotice />
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
        />
      </Screen>
    )
  }

  if (!group) return <CreateGroupScreen notice={<InstallNotice />} />

  return <GroupToday key={group.id} group={group} />
}
