import { CloudSlash } from '@phosphor-icons/react'
import { GROUP_COPY, isWaiting } from '@/domain/groups'
import { Screen } from '@/app/screens/screen'
import { todayHeading } from '@/app/screens/today-heading'
import { EmptyState } from '@/ui/empty-state'
import { InstallNotice } from '@/features/install/install-notice'
import { CreateGroupScreen } from '@/features/group/create-group-screen'
import { useFocusedGroup } from '@/features/group/use-focused-group'
import { useGroupNotices } from '@/features/group/use-group-notices'
import { WaitingEmptyState } from '@/features/group/waiting-empty-state'
import { AddPlanButton } from '@/features/plan/add-plan-button'

/**
 * Today for the focused group. While the groups load: blank (plus the install notice). Load failed:
 * an Empty state with Try again. No current groups: the full-screen create screen. A waiting group:
 * the waiting Empty state (with the Invite panel for the admin). Every group, waiting or active, ends
 * with the Add button, which opens the Plan sheet.
 * The install notice shows in every state, and so do the one-time group notices (removed from a
 * group, everyone else left).
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

  return (
    <Screen title={todayHeading()}>
      <InstallNotice />
      {isWaiting(group) ? <WaitingEmptyState group={group} /> : null}
      <AddPlanButton key={group.id} groupId={group.id} />
    </Screen>
  )
}
