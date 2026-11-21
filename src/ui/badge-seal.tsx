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
  /** The seal's paper when earned (DESIGN.md: fills rotate vote / sticky / sticky2). */
  fill?: 'vote' | 'sticky' | 'sticky2'
  /**
   * `earned` (default): the paper seal. `locked`: transparent with a dashed muted outline and a muted
   * name. `pending`: transparent with a dashed success outline and the `pendingChip` under the name.
   */
  status?: 'earned' | 'pending' | 'locked'
  /** The pending chip's text ("Unlocks at week lock"). */
  pendingChip?: string
  /**
   * A repeat badge's count mark ("×3"), drawn on an earned seal's corner. Decorative: the caller's
   * accessible name says the count.
   */
  count?: string | null
  className?: string
}

const FILL = { vote: 'bg-vote', sticky: 'bg-sticky', sticky2: 'bg-sticky2' } as const

/**
 * Badge seal (DESIGN.md `badge-seal`): a blob seal with the badge icon, its name below. Earned, it
 * is a light paper object in both themes (2.5px obj-ink border, obj-* tokens); locked and pending
 * seals are drawn on the page (transparent, dashed muted or success outline). The name is real
 * text; the seal drawing is decorative.
 */
export function BadgeSeal({
  icon,
  name,
  size = 60,
  fill = 'sticky',
  status = 'earned',
  pendingChip,
  count,
  className,
}: BadgeSealProps) {
  const earned = status === 'earned'
  return (
    <div
      className={cn('flex flex-col items-center gap-1.5', className)}
      data-component="badge-seal"
      data-status={status}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative flex items-center justify-center rounded-blob border-[2.5px]',
          earned
            ? cn('on-object border-obj-ink text-obj-ink', FILL[fill])
            : status === 'pending'
              ? 'border-dashed border-success bg-transparent text-ink'
              : 'border-dashed border-muted bg-transparent text-muted',
          size === 120 ? 'size-[120px]' : 'size-[60px]',
        )}
      >
        <Icon
          icon={icon}
          size={size === 120 ? 64 : 32}
          className={status === 'locked' ? 'opacity-60' : undefined}
        />
        {earned && count ? (
          <span
            className="absolute -top-1.5 -right-2.5 rounded-wob-xs border-2 border-obj-ink bg-pola px-1 type-meta font-semibold text-obj-ink tabular-nums"
            data-badge-count=""
          >
            {count}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'text-center type-nav-label',
          status === 'locked' ? 'text-muted' : 'text-ink',
        )}
      >
        {name}
      </span>
      {status === 'pending' && pendingChip ? (
        <span className="rounded-wob-xs border-2 border-dashed border-success px-1.5 py-px text-center type-meta text-ink">
          {pendingChip}
        </span>
      ) : null}
    </div>
  )
}
