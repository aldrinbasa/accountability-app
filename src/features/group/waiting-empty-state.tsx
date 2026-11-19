import { User } from '@phosphor-icons/react'
import { GROUP_COPY, type MyGroup } from '@/domain/groups'
import { EmptyState } from '@/ui/empty-state'
import { InvitePanel } from '@/features/group/invite-panel'

/** Today in a 1-member group, with the Invite panel under it for the admin. */
export function WaitingEmptyState({ group }: { group: MyGroup }) {
  return (
    <>
      <EmptyState icon={User} line={GROUP_COPY.waitingLine} body={GROUP_COPY.waitingBody} />
      <InvitePanel key={group.id} group={group} />
    </>
  )
}
