import type { ReactNode } from 'react'
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
  /** Accessible name. Without it the circle is decorative (the name is shown nearby). */
  label?: string
  /** Optional control pinned to the bottom-right edge, e.g. the "Add a photo" camera button. */
  badge?: ReactNode
  className?: string
}

/**
 * Initial avatar per DESIGN.md `avatar`: a full circle in one of four object fills, 2.5px `obj-ink`
 * outline with a hard `obj-ink` offset, the initial in Baloo 2 `obj-ink`. The photo arrives in 3.6.
 * The 44px hit area for a tappable avatar belongs to its parent (button or row).
 */
export function Avatar({ id, name, size = 38, label, badge, className }: AvatarProps) {
  const fill = avatarFill(id)
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        data-fill={fill}
        className={cn(
          'inline-flex items-center justify-center rounded-full border-[2.5px] border-obj-ink text-obj-ink shadow-obj select-none',
          FILL_CLASS[fill],
          SIZE_CLASS[size],
        )}
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      >
        {avatarInitial(name)}
      </span>
      {badge ? <span className="absolute -right-2 -bottom-2">{badge}</span> : null}
    </span>
  )
}
