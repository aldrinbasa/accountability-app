import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

export interface BadgeSealProps {
  /** The badge's glyph, drawn Duotone in obj-ink with the coral soft tone. */
  icon: PhosphorIcon
  /** The badge's name, in nav-label under the seal. */
  name: string
  /** 60px on Me and profiles (Story 4.6), 120px on the Winner card. */
  size?: 60 | 120
  /** The seal's paper (DESIGN.md: fills rotate vote / sticky / sticky2). */
  fill?: 'vote' | 'sticky' | 'sticky2'
  className?: string
}

const FILL = { vote: 'bg-vote', sticky: 'bg-sticky', sticky2: 'bg-sticky2' } as const

/**
 * Badge seal (DESIGN.md `badge-seal`), earned state: a blob seal with a 2.5px obj-ink border and
 * the badge icon, its name below. A light object in both themes (obj-* tokens). The name is real
 * text; the seal drawing is decorative.
 */
export function BadgeSeal({ icon, name, size = 60, fill = 'sticky', className }: BadgeSealProps) {
  return (
    <div
      className={cn('flex flex-col items-center gap-1.5', className)}
      data-component="badge-seal"
    >
      <span
        aria-hidden="true"
        className={cn(
          'on-object flex items-center justify-center rounded-blob border-[2.5px] border-obj-ink text-obj-ink',
          FILL[fill],
          size === 120 ? 'size-[120px]' : 'size-[60px]',
        )}
      >
        <Icon icon={icon} size={size === 120 ? 64 : 32} />
      </span>
      <span className="text-center type-nav-label text-ink">{name}</span>
    </div>
  )
}
