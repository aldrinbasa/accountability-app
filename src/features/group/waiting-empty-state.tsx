import { User } from '@phosphor-icons/react'
import { GROUP_COPY } from '@/domain/groups'
import { EmptyState } from '@/ui/empty-state'

/** Today in a 1-member group. The Invite panel joins it in Story 1.7. */
export function WaitingEmptyState() {
  return <EmptyState icon={User} line={GROUP_COPY.waitingLine} body={GROUP_COPY.waitingBody} />
}
