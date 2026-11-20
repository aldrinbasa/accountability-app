import { AVATAR_COPY, type Profile } from '@/domain/profile'
import { Button } from '@/ui/button'
import { useCameraLauncher } from '@/features/camera/camera-launcher'
import { MemberAvatar } from '@/features/me/member-avatar'

/**
 * Me > Settings "Profile photo" row (Story 3.6): the member's 38px Avatar (decorative, the row says
 * what it is), the label, and "Add a photo" / "Change photo", which opens the camera in avatar mode.
 * Use photo there uploads the photo and sets `avatar_path` at once; the row then shows it.
 */
export function ProfilePhotoRow({ profile }: { profile: Profile }) {
  const { openCamera } = useCameraLauncher()
  return (
    <div className="flex min-h-row-min items-center gap-3 px-3" data-component="profile-photo-row">
      <MemberAvatar
        id={profile.id}
        name={profile.displayName}
        avatarPath={profile.avatarPath}
        size={38}
      />
      <span className="min-w-0 flex-1 type-body text-ink">{AVATAR_COPY.rowLabel}</span>
      <Button
        variant="link"
        className="shrink-0"
        onClick={(event) =>
          openCamera(
            // The profile cache is written by the save itself; the row re-renders from it.
            { mode: 'avatar', saveToProfile: true, onSaved: () => {} },
            event.currentTarget,
          )
        }
      >
        {profile.avatarPath ? AVATAR_COPY.changePhoto : AVATAR_COPY.addPhoto}
      </Button>
    </div>
  )
}
