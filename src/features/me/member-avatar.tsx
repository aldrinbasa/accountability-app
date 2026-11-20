import { useAvatarUrl } from '@/data/photo-url'
import { Avatar, type AvatarProps } from '@/ui/avatar'

export interface MemberAvatarProps extends Omit<AvatarProps, 'src'> {
  /** The member's `profiles.avatar_path`; null shows the initial. */
  avatarPath: string | null
}

/**
 * A member's Avatar with their profile photo (Story 3.6): the photo through a 10-minute signed URL
 * from bucket `avatars`, the initial while it loads, on error, offline and without a photo.
 */
export function MemberAvatar({ avatarPath, ...props }: MemberAvatarProps) {
  const src = useAvatarUrl(avatarPath)
  return <Avatar {...props} src={src} />
}
