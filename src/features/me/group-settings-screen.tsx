import { useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, CloudSlash } from '@phosphor-icons/react'
import { GROUP_COPY } from '@/domain/groups'
import { useMyGroups } from '@/data/groups'
import { EmptyState } from '@/ui/empty-state'
import { IconButton } from '@/ui/icon-button'
import { cameFromMe } from '@/features/me/pushed-from-me'

/**
 * `/me/groups/{groupId}`, pushed from Me > My groups: the group name and a read-only "Group time
 * zone" row (editing arrives in Story 2.7). A group the member is not currently in goes back to Me,
 * keeping `?g=`. Back always shows; a failed load with nothing cached shows Try again. Members,
 * invite, goal and leave arrive with later stories.
 */
export function GroupSettingsScreen() {
  const { groupId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const query = useMyGroups()
  const groups = query.data
  const group = groups?.find((g) => g.id === groupId)
  const unknown = groups !== undefined && !group

  useEffect(() => {
    if (unknown) void navigate({ pathname: '/me', search: location.search }, { replace: true })
    // Reacts to the group turning out unknown; the location is read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknown])

  function back() {
    if (cameFromMe(location.state)) void navigate(-1)
    else void navigate({ pathname: '/me', search: location.search }, { replace: true })
  }

  return (
    <div className="flex flex-col gap-stack pt-4">
      <div>
        <IconButton icon={ArrowLeft} label="Back" onClick={back} />
      </div>
      {group ? (
        <>
          <h1 tabIndex={-1} className="type-headline break-words">
            {group.name}
          </h1>
          <div className="card flex flex-col gap-1">
            <h2 className="type-body-strong">{GROUP_COPY.timeZoneLabel}</h2>
            <p className="type-body">{group.timeZone}</p>
            <p className="type-body-sm text-muted">{GROUP_COPY.timeZoneNote}</p>
          </div>
        </>
      ) : groups === undefined && query.isError ? (
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{ label: GROUP_COPY.tryAgain, onClick: () => void query.refetch() }}
        />
      ) : null}
    </div>
  )
}
