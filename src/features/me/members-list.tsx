import { useEffect, useId, useRef, useState } from 'react'
import {
  LEAVE_COPY,
  removeLabel,
  ROLE_LABEL,
  sortMembers,
  type GroupMember,
  type MyGroup,
} from '@/domain/groups'
import { useMembers } from '@/data/groups'
import { Button } from '@/ui/button'
import { InlineRetry } from '@/ui/inline-retry'
import { RoleChip } from '@/ui/role-chip'
import { MemberAvatar } from '@/features/me/member-avatar'
import { RemoveMemberSheet } from '@/features/me/remove-member-sheet'

/**
 * The admin's Members list in group settings: each current member with a 38px Avatar, name and Role
 * chip in a 52px row; other members' rows offer "Remove", which opens the confirm Sheet. Members who
 * are not admin never see it. Nothing shows while loading; a failed load shows Inline retry.
 * After a removal the removed row (the sheet's trigger) is gone, so focus moves to the heading.
 */
export function MembersList({ group }: { group: MyGroup }) {
  const isAdmin = group.role === 'admin'
  const query = useMembers(group.id, isAdmin)
  const [removing, setRemoving] = useState<GroupMember | null>(null)
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focusHeading = useRef(false)
  const members = query.data

  useEffect(() => {
    if (removing !== null || !focusHeading.current) return
    focusHeading.current = false
    headingRef.current?.focus()
  }, [removing])

  if (!isAdmin) return null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="type-title">
        {LEAVE_COPY.members}
      </h2>
      {members ? (
        <ul className="card flex flex-col p-0">
          {sortMembers(members).map((member) => (
            <li
              key={member.membershipId}
              className="flex min-h-row-min items-center gap-3 border-b-[1.5px] border-line/18 px-3 last:border-b-0"
            >
              <MemberAvatar
                id={member.userId}
                name={member.displayName}
                avatarPath={member.avatarPath}
                size={38}
              />
              <span className="min-w-0 flex-1 truncate type-body-strong">{member.displayName}</span>
              <RoleChip variant={member.role}>{ROLE_LABEL[member.role]}</RoleChip>
              {member.role !== 'admin' ? (
                <Button
                  variant="link"
                  aria-label={removeLabel(member.displayName)}
                  onClick={() => setRemoving(member)}
                >
                  {LEAVE_COPY.remove}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <InlineRetry onRetry={() => void query.refetch()} retryLabel={LEAVE_COPY.retry}>
          {LEAVE_COPY.membersFailed}
        </InlineRetry>
      ) : null}
      <RemoveMemberSheet
        groupId={group.id}
        member={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          focusHeading.current = true
          setRemoving(null)
        }}
      />
    </section>
  )
}
