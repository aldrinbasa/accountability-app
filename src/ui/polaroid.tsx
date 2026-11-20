import type { ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

export interface PolaroidProps {
  /** The 4:3 photo (an `img`, or a canvas host). Empty shows the `ph1` → `ph2` loading gradient. */
  photo?: ReactNode
  /** The caption in `hand-lg`; the row keeps its height when empty. */
  caption?: string | null
  /** Optional meta line under the caption, `meta` `obj-muted`. */
  meta?: ReactNode
  /** DESIGN.md alternating tilt: left -2.2deg, right 2deg. */
  tilt?: 'left' | 'right'
  className?: string
}

/**
 * Polaroid (DESIGN.md `polaroid`): a white `pola` frame with a 2px `obj-ink` border, 10px padding
 * (none at the bottom), a square-cornered 4:3 photo, a tape strip on top, the caption below in
 * `hand-lg` `obj-ink` and an optional `meta` line. A paper object: it keeps its light look in dark
 * mode and everything on it uses `obj-*` tokens.
 */
export function Polaroid({ photo, caption, meta, tilt = 'left', className }: PolaroidProps) {
  return (
    <figure
      className={cn(
        'on-object relative m-0 border-2 border-obj-ink bg-pola px-[10px] pt-[10px] text-obj-ink shadow-polaroid',
        tilt === 'left' ? '-rotate-[2.2deg]' : 'rotate-2',
        className,
      )}
      data-component="polaroid"
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute -top-2.5 left-1/2 z-(--z-tape) h-5 w-[74px] -translate-x-1/2',
          tilt === 'left' ? '-rotate-4 bg-tape1' : 'rotate-5 bg-tape2',
        )}
        data-polaroid-tape=""
      />
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-photo bg-linear-to-br from-ph1 to-ph2">
        {photo}
      </div>
      <figcaption className="min-h-[calc(var(--text-hand-lg)*var(--text-hand-lg--line-height)+var(--spacing-4))] py-2 break-words type-hand-lg">
        {caption}
      </figcaption>
      {meta ? <p className="-mt-1 pb-2 type-meta text-obj-muted">{meta}</p> : null}
    </figure>
  )
}
