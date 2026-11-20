import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, CloudSlash, SignOut } from '@phosphor-icons/react'
import {
  endedMembershipFor,
  GROUP_COPY,
  LEAVE_COPY,
  nextAdmin,
  type MyGroup,
} from '@/domain/groups'
import { useAuthSession } from '@/data/auth-session'
import { useEndedMemberships, useMembers, useMyGroups, useSetGroupTimeZone } from '@/data/groups'
import { EmptyState } from '@/ui/empty-state'
import { Icon } from '@/ui/icon'
import { IconButton } from '@/ui/icon-button'
import { runAfterSheetClose } from '@/ui/sheet-history'
import { InvitePanel } from '@/features/group/invite-panel'
import { GoalRow } from '@/features/goal/goal-row'
import { NotInGroupState } from '@/features/group/not-in-group-state'
import { useMoveFocusAfterLeave } from '@/features/group/use-focused-group'
import { LeaveGroupSheet } from '@/features/me/leave-group-sheet'
import { MembersList } from '@/features/me/members-list'
import { cameFromMe } from '@/features/me/pushed-from-me'
import { saveZone } from '@/features/me/save-zone'
import { TimeZoneRow, TimeZoneSheet } from '@/features/me/time-zone-sheet'

/**
 * `/me/groups/{groupId}`, pushed from Me > My groups: the group name, the Members list and the
 * Invite panel (admin only), the "Group time zone" row (admins open the picker, Story 2.7; others
 * read it) and
 * the destructive "Leave group" row, which opens the confirm Sheet. After leaving, focus moves to
 * the next current group (or the create screen) on Today.
 * A group the member left or was removed from shows "You're not in {Group} anymore." with Go to
 * Today; an id they were never in goes back to Me, keeping `?g=`. Back always shows; a failed load
 * with nothing cached shows Try again. The Group goal row (Story 4.7) sits under the time zone.
 */
export function GroupSettingsScreen() {
  const { groupId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const query = useMyGroups()
  const { data: ended } = useEndedMemberships()
  const groups = query.data
  // Set as soon as the server confirms a leave, before the refetch drops the group: the screen keeps
  // showing it (sheet included) while focus moves on, and shows neither the "not in {Group}
  // anymore" state nor the redirect to Me for the group just left.
  const [leftGroup, setLeftGroup] = useState<MyGroup | null>(null)
  const group = groups?.find((g) => g.id === groupId) ?? leftGroup ?? undefined
  const stale = groups && ended ? endedMembershipFor({ groups, ended }, groupId) : null
  const unknown = groups !== undefined && ended !== undefined && !group && !stale

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
        <GroupSettings key={group.id} group={group} onLeaving={() => setLeftGroup(group)} />
      ) : stale ? (
        <NotInGroupState ended={stale} />
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

function GroupSettings({ group, onLeaving }: { group: MyGroup; onLeaving: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const [pickingZone, setPickingZone] = useState(false)
  const setTimeZone = useSetGroupTimeZone(group.id)
  const moveFocus = useMoveFocusAfterLeave()
  const userId = useAuthSession().user?.id
  const isAdmin = group.role === 'admin'
  // The Members list reads the same query, so the next admin's name is usually there already.
  const members = useMembers(group.id, isAdmin).data
  const next = isAdmin && members && userId ? nextAdmin(members, userId) : null

  function left(remaining: MyGroup[]) {
    setLeaving(false)
    runAfterSheetClose(() => moveFocus(remaining, group.id))
  }

  return (
    <>
      <h1 tabIndex={-1} className="type-headline break-words">
        {group.name}
      </h1>
      <MembersList group={group} />
      <InvitePanel group={group} />
      <div className="card flex flex-col gap-1 p-0 pb-3">
        <TimeZoneRow
          label={GROUP_COPY.timeZoneLabel}
          zones={group}
          onOpen={isAdmin ? () => setPickingZone(true) : undefined}
        />
        <p className="px-3 type-body-sm text-muted">{GROUP_COPY.timeZoneNote}</p>
      </div>
      {isAdmin ? (
        <TimeZoneSheet
          open={pickingZone}
          onOpenChange={setPickingZone}
          title={GROUP_COPY.timeZoneLabel}
          note={GROUP_COPY.timeZoneNote}
          zones={group}
          onChoose={(zone) => saveZone((z) => setTimeZone.mutateAsync(z), zone)}
        />
      ) : null}
      <GoalRow group={group} />
      <div className="card p-0">
        <button
          type="button"
          className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-left text-miss type-body-strong press-overlay"
          onClick={() => setLeaving(true)}
        >
          <Icon icon={SignOut} size={24} />
          <span className="flex-1">{LEAVE_COPY.leaveGroup}</span>
        </button>
      </div>
      <LeaveGroupSheet
        open={leaving}
        onOpenChange={setLeaving}
        group={group}
        nextAdminName={next?.displayName ?? null}
        onLeaving={onLeaving}
        onLeft={left}
      />
    </>
  )
}
