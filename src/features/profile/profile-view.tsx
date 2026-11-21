import { allTimePointsText, type MemberProfile } from '@/domain/badges'
import { planSummary } from '@/domain/board'
import { Skeleton, SkeletonBar, SkeletonBlock } from '@/ui/skeleton'
import { MemberAvatar } from '@/features/me/member-avatar'
import { BadgeGrid } from '@/features/profile/badge-grid'
import { ProfileStreaks } from '@/features/profile/profile-streaks'
import { TitleSticky } from '@/features/profile/title-sticky'

export interface ProfileHeaderProps {
  userId: string
  profile: MemberProfile
  groupName: string
  /** The member profile shows the plan summary; Me does not. */
  showPlan?: boolean
  /** The member profile's name is its h1; Me shows the name above it (h1 "Me"). */
  nameIsHeading?: boolean
}

/**
 * The top of Me and the member profile: the name, avatar, the Title sticky and "{n} all-time points
 * in {Group}" (plus the plan summary on a member profile).
 */
export function ProfileHeader({
  userId,
  profile,
  groupName,
  showPlan = false,
  nameIsHeading = false,
}: ProfileHeaderProps) {
  const plan = showPlan ? planSummary(profile.plan, profile.taskCount) : ''
  return (
    <div className="flex flex-col gap-3" data-component="profile-header">
      {nameIsHeading ? (
        <h1 tabIndex={-1} className="type-headline [overflow-wrap:anywhere]">
          {profile.displayName}
        </h1>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <MemberAvatar
          id={userId}
          name={profile.displayName}
          avatarPath={profile.avatarPath}
          size={104}
        />
        <div className="flex min-w-0 flex-1 basis-40 flex-col items-start gap-2">
          <TitleSticky titleKey={profile.titleKey} />
          <p className="type-body" data-component="all-time-points">
            {allTimePointsText(profile.allTimePoints, groupName)}
          </p>
          {plan ? <p className="type-meta text-muted [overflow-wrap:anywhere]">{plan}</p> : null}
        </div>
      </div>
    </div>
  )
}

export interface ProfileBodyProps {
  profile: MemberProfile
  viewerZone: string
}

/** The badge grid and the streaks of a current member. */
export function ProfileBody({ profile, viewerZone }: ProfileBodyProps) {
  return (
    <>
      <BadgeGrid
        badges={profile.badges}
        viewerZone={viewerZone}
        groupZone={profile.timeZone ?? viewerZone}
      />
      <ProfileStreaks streaks={profile.streaks} />
    </>
  )
}

/** Cold-load skeleton (after 300 ms): avatar circle, name bar, 6 dashed seal outlines, 2 rows. */
export function ProfileSkeleton() {
  return (
    <Skeleton>
      <div className="flex items-center gap-4">
        <div className="size-[104px] rounded-full border-[2.5px] border-dashed border-muted" />
        <SkeletonBar className="w-1/3" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="mx-auto size-[60px] rounded-blob border-[2.5px] border-dashed border-muted"
          />
        ))}
      </div>
      <SkeletonBlock />
      <SkeletonBlock />
    </Skeleton>
  )
}
