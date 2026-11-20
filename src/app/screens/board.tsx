import { CloudSlash } from '@phosphor-icons/react'
import { BOARD_COPY } from '@/domain/board'
import { GROUP_COPY } from '@/domain/groups'
import { Screen } from '@/app/screens/screen'
import { EmptyState } from '@/ui/empty-state'
import { BoardContent } from '@/features/board/board-content'
import { CreateGroupScreen } from '@/features/group/create-group-screen'
import { useFocusedGroup } from '@/features/group/use-focused-group'

/**
 * The Board tab (Story 4.3) for the focused group: the h1 "Leaderboard · {Group}" (the group name for
 * screen readers only; the switcher shows it), then the week switch, week chip and standings. While
 * the groups load: blank. Load failed: an Empty state with Try again. No current groups: the create
 * screen, as on Today and Feed.
 */
export function BoardScreen() {
  const { group, groups, query } = useFocusedGroup()

  if (groups === undefined) {
    if (!query.isError) return null
    return (
      <Screen title={BOARD_COPY.title}>
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
        />
      </Screen>
    )
  }

  if (!group) return <CreateGroupScreen />

  return (
    <Screen
      title={
        <>
          {BOARD_COPY.title} <span className="sr-only">{`· ${group.name}`}</span>
        </>
      }
    >
      <BoardContent key={group.id} group={group} />
    </Screen>
  )
}
