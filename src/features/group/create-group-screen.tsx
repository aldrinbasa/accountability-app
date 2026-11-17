import type { ReactNode } from 'react'
import { GROUP_COPY } from '@/domain/groups'
import { CreateGroupForm } from '@/features/group/create-group-form'
import { JoinCodeForm } from '@/features/group/join-code-form'
import { useOpenGroupOnToday, useOpenJoinScreen } from '@/features/group/use-focused-group'

/**
 * Today with no current groups: the full-screen "Start a group" screen (no separate route), with
 * joining by code under it. A created group is focused and Today opens on it; a code opens
 * `/join/{code}`.
 * `notice` sits under the intro line (Today's install notice stays in every state).
 */
export function CreateGroupScreen({ notice }: { notice?: ReactNode }) {
  const openGroup = useOpenGroupOnToday()
  const openJoin = useOpenJoinScreen()
  return (
    <div className="flex flex-col gap-stack pt-4">
      <h1 tabIndex={-1} className="type-headline">
        {GROUP_COPY.createHeading}
      </h1>
      <p className="-mt-1 type-body text-muted">{GROUP_COPY.createLine}</p>
      {notice}
      <CreateGroupForm onCreated={openGroup} />
      <JoinCodeForm onCode={openJoin} />
    </div>
  )
}
