import { Link, useLocation } from 'react-router'
import { CaretRight, CloudSlash, GearSix, ListChecks } from '@phosphor-icons/react'
import { Screen } from '@/app/screens/screen'
import { GROUP_COPY } from '@/domain/groups'
import { MY_PLAN_COPY } from '@/domain/my-plan'
import { useAuthSession } from '@/data/auth-session'
import { useMemberProfile } from '@/data/member-profile'
import { useMemberTimeZone, useMyProfile } from '@/data/profile'
import { Icon } from '@/ui/icon'
import { EmptyState } from '@/ui/empty-state'
import { useFocusedGroup } from '@/features/group/use-focused-group'
import { MyGroupsList } from '@/features/me/my-groups-list'
import { pushedFromMeState } from '@/features/me/pushed-from-me'
import { ProfileBody, ProfileHeader, ProfileSkeleton } from '@/features/profile/profile-view'

/**
 * Me: the member's profile in the focused group (Story 4.6: name, avatar, Title sticky, all-time
 * points, the 15-seal badge grid, streak per commitment), My groups, My plan (the focused group's,
 * Story 2.6) and Settings. With no cached profile a skeleton shows after 300 ms; without a group
 * only the name shows. With no cached groups and no answer (offline), the "Can't reach Proofy right
 * now." Empty state with Try again takes the groups' place (Story 3.3).
 */
export function MeScreen() {
  const { search, state } = useLocation()
  const { data: myProfile } = useMyProfile()
  const session = useAuthSession()
  const userId = session.user?.id ?? null
  const { group, groups, query: groupsQuery } = useFocusedGroup()
  const profileQuery = useMemberProfile(group?.id ?? null, userId)
  const profile = profileQuery.data
  const zone = useMemberTimeZone()

  return (
    <Screen title="Me">
      {myProfile ? <p className="-mt-1 type-title">{myProfile.displayName}</p> : null}
      {group && userId && profile?.isCurrentMember ? (
        <>
          <ProfileHeader userId={userId} profile={profile} groupName={group.name} />
          <ProfileBody profile={profile} viewerZone={zone} />
        </>
      ) : group && profile === undefined && !profileQuery.isError ? (
        <ProfileSkeleton />
      ) : null}
      {groups ? <MyGroupsList groups={groups} /> : null}
      {!groups && groupsQuery.isError ? (
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{ label: GROUP_COPY.tryAgain, onClick: () => void groupsQuery.refetch() }}
        />
      ) : null}
      <ul className="card flex flex-col p-0">
        <li>
          <Link
            to={{ pathname: '/me/plan', search }}
            state={pushedFromMeState(state)}
            className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-ink type-body press-overlay"
          >
            <Icon icon={ListChecks} size={24} />
            <span className="flex-1">{MY_PLAN_COPY.title}</span>
            <Icon icon={CaretRight} size={20} />
          </Link>
        </li>
        <li>
          <Link
            to={{ pathname: '/me/settings', search }}
            state={pushedFromMeState(state)}
            className="flex min-h-row-min w-full items-center gap-3 rounded-wob px-3 text-ink type-body press-overlay"
          >
            <Icon icon={GearSix} size={24} />
            <span className="flex-1">Settings</span>
            <Icon icon={CaretRight} size={20} />
          </Link>
        </li>
      </ul>
    </Screen>
  )
}
