import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

/** A skeleton appears only when there is still no data after this long. */
export const SKELETON_DELAY_MS = 300

export interface SkeletonProps {
  /** The placeholder blocks (SkeletonBlock, SkeletonBar, SkeletonPhoto) laid out like the content. */
  children: ReactNode
  className?: string
}

/**
 * Cold-load placeholder. Render it while a region has no data: it shows nothing for 300 ms, then
 * static placeholder stickies (no shimmer) in an `aria-busy` region announced once as "Loading".
 */
export function Skeleton({ children, className }: SkeletonProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div aria-busy="true" className={cn('flex flex-col gap-stack', className)}>
      {/* A separate, non-busy live region, so "Loading" is actually announced (once). */}
      <span role="status" className="sr-only">
        Loading
      </span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  )
}

/** Card-shaped placeholder: card fill, 2.5px dashed muted outline, wob radius. */
export function SkeletonBlock({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-h-row-min flex-col gap-2 rounded-wob border-[2.5px] border-dashed border-muted bg-card p-3',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Where text will be: muted at 15%, fully rounded. */
export function SkeletonBar({ className }: { className?: string }) {
  return <div className={cn('h-3 w-2/3 rounded-full bg-muted/15', className)} />
}

/** Where a photo will be: ph1 to ph2 placeholder in a reserved 4:3 box. */
export function SkeletonPhoto({ className }: { className?: string }) {
  return <div className={cn('aspect-[4/3] w-full bg-linear-to-br from-ph1 to-ph2', className)} />
}
