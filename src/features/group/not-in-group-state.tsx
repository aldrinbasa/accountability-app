import { useEffect } from 'react'
import { DoorOpen } from '@phosphor-icons/react'
import { LEAVE_COPY, notInGroupText, type EndedMembership } from '@/domain/groups'
import { markRemovedNoticeSeen } from '@/data/group-notices'
import { EmptyState } from '@/ui/empty-state'
import { useGoToTodayWithoutGroup } from '@/features/group/use-focused-group'

/**
 * A link (`?g=` or `/me/groups/{id}`) to a group the member left or was removed from: "You're not in
 * {Group} anymore." with "Go to Today", which opens `/today` with `?g=` dropped. For a removal this
 * is the notice, so Today's "You're no longer in {Group}." toast is marked seen and not repeated.
 */
export function NotInGroupState({ ended }: { ended: EndedMembership }) {
  const goToday = useGoToTodayWithoutGroup()
  const { endReason, membershipId } = ended

  useEffect(() => {
    if (endReason === 'removed') markRemovedNoticeSeen(membershipId)
  }, [endReason, membershipId])

  return (
    <EmptyState
      icon={DoorOpen}
      line={notInGroupText(ended.name)}
      action={{ label: LEAVE_COPY.goToday, onClick: goToday }}
    />
  )
}
