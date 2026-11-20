import { useEffect, useRef } from 'react'
import { cn } from '@/ui/lib/utils'

/**
 * Shows the captured 4:3 canvas itself (no re-encode just to look at it), filling its box. Labeled as
 * one image for assistive tech.
 */
export function CanvasPhoto({
  canvas,
  label,
  className,
}: {
  canvas: HTMLCanvasElement
  label: string
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.objectFit = 'cover'
    canvas.setAttribute('aria-hidden', 'true')
    element.appendChild(canvas)
    return () => {
      if (canvas.parentNode === element) element.removeChild(canvas)
    }
  }, [canvas])

  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      className={cn('size-full', className)}
      data-component="canvas-photo"
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
