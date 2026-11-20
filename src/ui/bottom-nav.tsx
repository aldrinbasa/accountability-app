import type { MouseEvent, ReactNode } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { Camera } from '@phosphor-icons/react'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'

/**
 * Bottom nav bar per DESIGN.md `bottom-nav`: card bar with a dashed top border, 64px tall plus the
 * bottom safe area, capped to the 480px column. Routing lives in src/app; these are the visuals.
 */
export function BottomNav({ children, label = 'Main' }: { children: ReactNode; label?: string }) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-(--z-nav) mx-auto w-full max-w-content-max border-t-[2.5px] border-dashed border-line bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
    >
      <ul className="flex min-h-nav-height items-center justify-around px-1">{children}</ul>
    </nav>
  )
}

export interface BottomNavItemProps {
  href: string
  label: string
  icon: PhosphorIcon
  active: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void
}

/** A tab: 48px tall, nav-label type; active = ink, 800 weight, 3px coral underline, aria-current. */
export function BottomNavItem({ href, label, icon, active, onNavigate }: BottomNavItemProps) {
  return (
    <li className="flex min-w-0 flex-1 justify-center">
      <a
        href={href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        className={cn(
          'flex min-h-nav-item-min w-full min-w-0 flex-col items-center justify-center gap-[3px] rounded-wob-xs py-1 text-center type-nav-label text-muted no-underline press-overlay [overflow-wrap:anywhere]',
          active && 'font-extrabold text-ink',
        )}
      >
        <Icon icon={icon} size={24} />
        <span className={cn('max-w-full', active && 'border-b-[3px] border-primary pb-px')}>
          {label}
        </span>
      </a>
    </li>
  )
}

/**
 * Camera button: 64px coral blob, 2.5px outline, hard offset, lifted 30px above the bar, 32px camera.
 * Announced "Check in, button"; it is a button outside the tab semantics.
 */
export function CameraButton({
  onClick,
}: {
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <li className="flex shrink-0 justify-center">
      <button
        type="button"
        aria-label="Check in"
        onClick={onClick}
        className="relative -top-(--spacing-camera-lift) flex size-camera-button items-center justify-center rounded-blob border-[2.5px] border-line bg-primary text-on-primary shadow-ink-lg press-offset-lg"
      >
        <Icon icon={Camera} size={32} />
      </button>
    </li>
  )
}
