import { useId, useState } from 'react'
import {
  awardCountMark,
  badgeLabel,
  earnedText,
  pendingText,
  PROFILE_COPY,
  sealFill,
  type ProfileBadge,
} from '@/domain/badges'
import { BadgeSeal } from '@/ui/badge-seal'
import { Sheet } from '@/ui/sheet'
import { badgeIcon } from '@/features/profile/badge-icons'

export interface BadgeGridProps {
  badges: readonly ProfileBadge[]
  /** The viewer's zone (earned dates). */
  viewerZone: string
  /** The group's zone (the pending seals' lock time). */
  groupZone: string
}

/** The badge Sheet: name, how it is earned, the line (not for a locked badge) and its status line. */
function BadgeSheet({
  badge,
  onClose,
  viewerZone,
  groupZone,
}: {
  badge: ProfileBadge | null
  onClose: () => void
  viewerZone: string
  groupZone: string
}) {
  return (
    <Sheet
      open={badge !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={badge?.name ?? ''}
    >
      {badge ? (
        <div className="flex flex-col gap-3 pb-2" data-component="badge-sheet">
          <p className="type-body">{badge.howEarned}</p>
          {badge.status !== 'locked' ? <p className="type-hand-md">{badge.line}</p> : null}
          {badge.status === 'earned' && badge.awardedAt ? (
            <p className="type-meta text-muted">
              {earnedText(badge.awardedAt, viewerZone, badge.awardCount)}
            </p>
          ) : null}
          {badge.status === 'pending' && badge.pendingLockAt ? (
            <p className="type-meta text-ink">
              {pendingText(badge.pendingLockAt, groupZone, viewerZone)}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}

/**
 * The 15-seal badge grid (Story 4.6): earned seals on their rotating paper, pending seals with the
 * "Unlocks at week lock" chip, locked seals dashed. Each seal is a 44px-or-larger button named
 * "{Badge}, earned 12 Nov" / "{Badge}, pending" / "{Badge}, locked" that opens the badge Sheet; a
 * repeat badge earned 2+ times carries a "×3" mark and is named "{Badge}, earned 3 times, last 12
 * Nov".
 */
export function BadgeGrid({ badges, viewerZone, groupZone }: BadgeGridProps) {
  const headingId = useId()
  const [open, setOpen] = useState<ProfileBadge | null>(null)
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
      data-component="badge-grid"
    >
      <h2 id={headingId} className="type-title">
        {PROFILE_COPY.badges}
      </h2>
      <ul className="grid grid-cols-3 gap-x-2 gap-y-3">
        {badges.map((badge, index) => (
          <li key={badge.key} className="flex">
            <button
              type="button"
              aria-label={badgeLabel(badge, viewerZone)}
              onClick={() => setOpen(badge)}
              className="flex min-h-target-min w-full flex-col items-center rounded-wob px-1 py-1.5 press-overlay"
            >
              <BadgeSeal
                icon={badgeIcon(badge.icon)}
                name={badge.name}
                status={badge.status}
                fill={sealFill(index)}
                pendingChip={PROFILE_COPY.pendingChip}
                count={awardCountMark(badge)}
              />
            </button>
          </li>
        ))}
      </ul>
      <BadgeSheet
        badge={open}
        onClose={() => setOpen(null)}
        viewerZone={viewerZone}
        groupZone={groupZone}
      />
    </section>
  )
}
