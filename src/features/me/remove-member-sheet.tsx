import { LEAVE_COPY, REMOVE_BODY, removeTitle, type GroupMember } from '@/domain/groups'
import { useRemoveMember } from '@/data/groups'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { Sheet } from '@/ui/sheet'
import { useGroupChange } from '@/features/me/confirm-group-change'

export interface RemoveMemberSheetProps {
  groupId: string
  /** The member to remove; null closes the sheet. */
  member: GroupMember | null
  onClose: () => void
  /** After a successful remove (the Members list has refreshed); closes the sheet. */
  onRemoved: () => void
}

/**
 * "Remove {Name}?" confirm Sheet (admin): the story copy and one coral "Remove" button; the close is
 * cancel. Offline or a failed call shows Inline retry and keeps the sheet open; on success it closes
 * and the Members list has already refreshed.
 */
export function RemoveMemberSheet({ groupId, member, onClose, onRemoved }: RemoveMemberSheetProps) {
  const remove = useRemoveMember(groupId)
  const change = useGroupChange(async () => {
    if (member) await remove.mutateAsync(member.userId)
  }, onRemoved)

  return (
    <Sheet
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          change.reset()
          onClose()
        }
      }}
      title={member ? removeTitle(member.displayName) : ''}
    >
      <div className="flex flex-col gap-4">
        <p className="type-body">{REMOVE_BODY}</p>
        {change.failure ? (
          <InlineRetry onRetry={() => void change.confirm()} retryLabel={LEAVE_COPY.retry}>
            {change.failure === 'offline' ? LEAVE_COPY.offline : LEAVE_COPY.failed}
          </InlineRetry>
        ) : null}
        <Button
          variant="primary"
          fullWidth
          busy={change.busy}
          busyLabel={LEAVE_COPY.saving}
          onClick={() => void change.confirm()}
        >
          {LEAVE_COPY.remove}
        </Button>
      </div>
    </Sheet>
  )
}
