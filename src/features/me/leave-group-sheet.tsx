import { useQueryClient } from '@tanstack/react-query'
import { LEAVE_COPY, leaveBody, leaveTitle, type MyGroup } from '@/domain/groups'
import { remainingGroups, useLeaveGroup, useMembers } from '@/data/groups'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { Sheet } from '@/ui/sheet'
import { groupChangeFailureText, useGroupChange } from '@/features/me/confirm-group-change'

export interface LeaveGroupSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: MyGroup
  /** Who becomes admin when this admin leaves (the longest-standing other member), when known. */
  nextAdminName: string | null
  /** The server confirmed the leave; runs before the groups refetch drops the group. */
  onLeaving: () => void
  /** After a successful leave, with the member's remaining current groups. */
  onLeft: (remaining: MyGroup[]) => void
}

/**
 * "Leave {Group}?" confirm Sheet: the story line, plus "{Name} becomes admin." for an admin with
 * others left, or "This deletes the group." for the last member. One coral "Leave group" button;
 * the close is cancel. Offline or a failed call shows Inline retry and keeps the sheet open.
 */
export function LeaveGroupSheet({
  open,
  onOpenChange,
  group,
  nextAdminName,
  onLeaving,
  onLeft,
}: LeaveGroupSheetProps) {
  const queryClient = useQueryClient()
  const leave = useLeaveGroup(group.id, onLeaving)
  // The admin's loaded Members list is fresher than the cached member count.
  const members = useMembers(group.id, group.role === 'admin').data
  const lastMember = (members?.length ?? group.memberCount) <= 1
  const change = useGroupChange(
    () => leave.mutateAsync(),
    () => onLeft(remainingGroups(queryClient, group.id)),
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) change.reset()
        onOpenChange(next)
      }}
      title={leaveTitle(group.name)}
    >
      <div className="flex flex-col gap-4">
        <p className="type-body">
          {leaveBody(lastMember, group.role === 'admin' ? nextAdminName : null)}
        </p>
        {change.failure ? (
          <InlineRetry onRetry={() => void change.confirm()} retryLabel={LEAVE_COPY.retry}>
            {groupChangeFailureText(change.failure)}
          </InlineRetry>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          busy={change.busy}
          busyLabel={LEAVE_COPY.saving}
          onClick={() => void change.confirm()}
        >
          {LEAVE_COPY.leaveGroup}
        </Button>
      </div>
    </Sheet>
  )
}
