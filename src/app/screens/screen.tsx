import type { ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

export interface ScreenProps {
  title: ReactNode
  /** Under the h1, in the heading block (Today's week line and rank chip). */
  subtitle?: ReactNode
  /**
   * Shown before the heading block, beside it (Today's Score sticker, Story 4.1); after it in reading
   * order. The block wraps under it when narrow.
   */
  leading?: ReactNode
  children?: ReactNode
}

/** A tab screen: exactly one h1 (focus target on route change), then the screen content. */
export function Screen({ title, subtitle, leading, children }: ScreenProps) {
  const heading = (
    <h1 tabIndex={-1} className="type-headline">
      {title}
    </h1>
  )
  const block =
    subtitle !== undefined ? (
      <div className="flex min-w-0 flex-col items-start gap-2">
        {heading}
        {subtitle}
      </div>
    ) : (
      heading
    )
  return (
    <div className="flex flex-col gap-stack pt-4">
      {/* One structure with or without `leading`, so the h1 (focus target) never remounts. The h1
          comes first in reading order; the sticker sits before it visually. */}
      <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-3', leading && 'pt-2 pl-1')}>
        <div className="min-w-0 flex-1 basis-40">{block}</div>
        {leading ? <div className="order-first flex-none">{leading}</div> : null}
      </div>
      {children}
    </div>
  )
}
