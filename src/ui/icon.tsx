import type { CSSProperties } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { cn } from '@/ui/lib/utils'

/** The only icon sizes in DESIGN.md (icon-sm, icon-md, icon-lg, icon-row, icon-empty). */
export type IconSize = 20 | 24 | 32 | 44 | 64

/** Soft-tone color: coral by default; cobalt for error icons (DESIGN.md Do's and Don'ts). */
export type IconTone = 'primary' | 'error' | 'obj-error' | 'sticky' | 'streak'

export interface IconProps {
  /** A Phosphor icon component, e.g. `Sun` from `@phosphor-icons/react`. Always drawn Duotone. */
  icon: PhosphorIcon
  size?: IconSize
  tone?: IconTone
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string
  className?: string
}

/**
 * Phosphor Duotone icon: the stroke uses the current text color (ink, or obj-ink on objects); the
 * soft tone is drawn in `tone` at about 55% opacity (see `.icon-duo` in app.css).
 */
export function Icon({ icon: Glyph, size = 24, tone = 'primary', label, className }: IconProps) {
  const style = { '--icon-tone': `var(--${tone})` } as CSSProperties
  return (
    <Glyph
      weight="duotone"
      size={size}
      className={cn('icon-duo shrink-0', className)}
      style={style}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}
