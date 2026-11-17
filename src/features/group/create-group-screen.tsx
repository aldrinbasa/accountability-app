import type { ReactNode } from 'react'
import { GROUP_COPY } from '@/domain/groups'
import { CreateGroupForm } from '@/features/group/create-group-form'
import { useOpenGroupOnToday } from '@/features/group/use-focused-group'

/**
 * Today with no current groups: the full-screen "Start a group" screen (no separate route). Joining
 * by code arrives with Story 1.7. On success the new group is focused and Today opens on it.
 * `notice` sits under the intro line (Today's install notice stays in every state).
 */
export function CreateGroupScreen({ notice }: { notice?: ReactNode }) {
  const openGroup = useOpenGroupOnToday()
  return (
    <div className="flex flex-col gap-stack pt-4">
      <h1 tabIndex={-1} className="type-headline">
        {GROUP_COPY.createHeading}
      </h1>
      <p className="-mt-1 type-body text-muted">{GROUP_COPY.createLine}</p>
      {notice}
      <CreateGroupForm onCreated={openGroup} />
    </div>
  )
}
