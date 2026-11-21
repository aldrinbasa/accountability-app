import { Navigate, useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, CloudSlash } from '@phosphor-icons/react'
import { leftMemberText, PROFILE_COPY } from '@/domain/badges'
import { GROUP_COPY } from '@/domain/groups'
import { useAuthSession } from '@/data/auth-session'
import { useMyGroups } from '@/data/groups'
import { useMemberProfile } from '@/data/member-profile'
import { useMemberTimeZone } from '@/data/profile'
import { Button } from '@/ui/button'
import { EmptyState } from '@/ui/empty-state'
import { IconButton } from '@/ui/icon-button'
import { ProfileBody, ProfileHeader, ProfileSkeleton } from '@/features/profile/profile-view'
import { RecentCheckins } from '@/features/profile/recent-checkins'
import { cameFromBoard } from '@/features/profile/pushed-from-board'

/**
 * `/board/m/{userId}?g={groupId}` (Story 4.6, AD-10): another current member's profile in the
 * group, view-only: name, avatar, Title sticky, all-time points, plan summary, badges, streaks and
 * recent check-ins. One's own profile redirects to `/me`; a member who left or was removed shows
 * "Sam isn't in this group anymore." + Back. A `?g=` the viewer is not in is corrected to the
 * focused group by the shell (the skeleton shows until then). Back (44px) pops to the Board it came
 * from, else replaces this entry with the Board.
 */
export function MemberProfileScreen() {
  const { userId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const session = useAuthSession()
  const zone = useMemberTimeZone()
  const groupsQuery = useMyGroups()
  const groupId = new URLSearchParams(location.search).get('g')
  const group = groupsQuery.data?.find((g) => g.id === groupId) ?? null
  const own = userId === session.user?.id
  const query = useMemberProfile(own || !group ? null : group.id, userId)
  const profile = query.data

  function back() {
    if (cameFromBoard(location.state)) void navigate(-1)
    else void navigate({ pathname: '/board', search: location.search }, { replace: true })
  }

  if (own) return <Navigate to={{ pathname: '/me', search: location.search }} replace />

  const gone = profile === null || profile?.isCurrentMember === false

  return (
    <div className="flex flex-col gap-stack pt-4" data-component="member-profile">
      <div>
        <IconButton icon={ArrowLeft} label={PROFILE_COPY.back} onClick={back} />
      </div>
      {group && profile?.isCurrentMember ? (
        <>
          <ProfileHeader
            userId={userId}
            profile={profile}
            groupName={group.name}
            showPlan
            nameIsHeading
          />
          <ProfileBody profile={profile} viewerZone={zone} />
          <RecentCheckins groupId={group.id} userId={userId} />
        </>
      ) : gone ? (
        <div className="flex flex-col items-start gap-3">
          <h1 tabIndex={-1} className="type-title [overflow-wrap:anywhere]">
            {profile ? leftMemberText(profile.displayName) : PROFILE_COPY.unknownMember}
          </h1>
          <Button variant="secondary" onClick={back}>
            {PROFILE_COPY.back}
          </Button>
        </div>
      ) : query.isError || (groupsQuery.isError && !groupsQuery.data) ? (
        <EmptyState
          icon={CloudSlash}
          line={GROUP_COPY.loadFailedLine}
          body={GROUP_COPY.loadFailedBody}
          action={{
            label: GROUP_COPY.tryAgain,
            onClick: () => void (group ? query.refetch() : groupsQuery.refetch()),
          }}
        />
      ) : (
        <ProfileSkeleton />
      )}
    </div>
  )
}
