import { useState, type ReactNode } from 'react'
import { avatarFill, avatarInitial, type AvatarFill } from '@/ui/avatar-fill'
import { cn } from '@/ui/lib/utils'

/** 38: Board, Feed who-lines, rows. 104: Setup and Me. */
export type AvatarSize = 38 | 104

const FILL_CLASS: Record<AvatarFill, string> = {
  primary: 'bg-primary',
  vote: 'bg-vote',
  sticky: 'bg-sticky',
  sticky2: 'bg-sticky2',
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  38: 'size-[38px] type-title-sm',
  104: 'size-[104px] type-numeral-lg',
}

export interface AvatarProps {
  /** Picks the fill, so a member keeps one color everywhere. Use the user id. */
  id: string
  /** The display name; the circle shows its initial. */
  name: string
  size?: AvatarSize
  /**
   * Accessible name (the photo's alt text, e.g. "Jo's photo"). Without it the circle and the photo
   * are decorative (the name is shown nearby).
   */
  label?: string
  /** The profile photo's URL (Story 3.6); the initial shows while it loads, on error and without. */
  src?: string | null
  /** Optional control pinned to the bottom-right edge, e.g. the "Add a photo" camera button. */
  badge?: ReactNode
  className?: string
}

/**
 * Avatar per DESIGN.md `avatar`: a full circle in one of four object fills, 2.5px `obj-ink` outline
 * with a hard `obj-ink` offset, the initial in Baloo 2 `obj-ink`. With a `src` (Story 3.6) the photo
 * covers the initial once it has loaded, never after an error; the initial is always drawn under it.
 * The 44px hit area for a tappable avatar belongs to its parent (button or row).
 */
export function Avatar({ id, name, size = 38, label, src = null, badge, className }: AvatarProps) {
  const fill = avatarFill(id)
  // The last URL that loaded (a re-signed URL keeps the photo up while it loads) and the last that failed.
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const showPhoto = src !== null && loaded !== null && failed !== src
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        data-fill={fill}
        data-photo={showPhoto ? '' : undefined}
        className={cn(
          'relative inline-flex items-center justify-center overflow-hidden rounded-full border-[2.5px] border-obj-ink text-obj-ink shadow-obj select-none',
          FILL_CLASS[fill],
          SIZE_CLASS[size],
        )}
        // One image for assistive tech: the circle (initial) until the photo shows, then the photo.
        {...(!label
          ? { 'aria-hidden': true }
          : showPhoto
            ? {}
            : { role: 'img', 'aria-label': label })}
      >
        <span aria-hidden={showPhoto || undefined}>{avatarInitial(name)}</span>
        {src !== null ? (
          <img
            src={src}
            alt={label ?? ''}
            aria-hidden={label && showPhoto ? undefined : true}
            draggable={false}
            onLoad={() => setLoaded(src)}
            onError={() => setFailed(src)}
            onContextMenu={(event) => event.preventDefault()}
            className={cn(
              'absolute inset-0 size-full object-cover',
              showPhoto ? 'opacity-100' : 'opacity-0',
            )}
          />
        ) : null}
      </span>
      {badge ? <span className="absolute -right-2 -bottom-2">{badge}</span> : null}
    </span>
  )
}
