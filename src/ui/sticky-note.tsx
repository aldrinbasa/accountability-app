import type { ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

export interface StickyNoteProps {
  children: ReactNode
  /** DESIGN.md: stickies tilt about ±1.5deg, alternating. */
  tilt?: 'left' | 'right'
  /**
   * `miss` (DESIGN.md `sticky-note-miss`): the `sticky2` paper; `vote` (`sticky-note-vote`): the
   * lavender `vote` paper of rulings and vote cards.
   */
  tone?: 'default' | 'miss' | 'vote'
  className?: string
}

/**
 * Sticky note (DESIGN.md `sticky-note`): a yellow `sticky` paper object (`sticky2` for a miss, `vote` for a ruling) with the `sticky` radius and
 * soft offset, `obj-ink` text in `hand-md`. Keeps its light look in dark mode (`obj-*` tokens only).
 */
export function StickyNote({
  children,
  tilt = 'left',
  tone = 'default',
  className,
}: StickyNoteProps) {
  return (
    <div
      className={cn(
        'on-object relative rounded-sticky px-[14px] pt-3 pb-[14px] type-hand-md text-obj-ink shadow-sticky',
        tone === 'miss' ? 'bg-sticky2' : tone === 'vote' ? 'bg-vote' : 'bg-sticky',
        tilt === 'left' ? '-rotate-[1.5deg]' : 'rotate-[1.5deg]',
        className,
      )}
      data-component="sticky-note"
    >
      {children}
    </div>
  )
}
