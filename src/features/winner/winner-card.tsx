import { useEffect, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { Crown } from '@phosphor-icons/react'
import {
  joinNames,
  WINNER_COPY,
  winnerButtonLabel,
  winnerHeading,
  winnerLine,
  winnerMemberSentence,
  winnerPodiumBlocks,
  winnersOf,
  winnerPoints,
  type WinnerPodiumBlock,
  type WinnerWeek,
} from '@/domain/winner'
import { BadgeSeal } from '@/ui/badge-seal'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { cn } from '@/ui/lib/utils'
import { claimSheet, releaseSheet, type SheetHandle } from '@/ui/sheet-history'
import { MemberAvatar } from '@/features/me/member-avatar'
import { PodiumStand } from '@/features/board/podium'
import { PODIUM_PLACE } from '@/features/board/podium-place'
import { badgeIcon, WEEKLY_WINNER_ICON } from '@/features/profile/badge-icons'

/** One podium place on the card: crown on 1st, the avatars side by side, names, then the block. */
function WinnerPlace({ block }: { block: WinnerPodiumBlock }) {
  const look = PODIUM_PLACE[block.place]
  const first = block.members[0]
  return (
    <li
      className={cn('flex min-w-0 flex-col', look.order)}
      style={{ flex: `${block.members.length} 1 0%` }}
      data-place={block.place}
    >
      <span className="sr-only">{block.members.map(winnerMemberSentence).join(' ')}</span>
      <div
        aria-hidden="true"
        className="flex flex-1 flex-col items-center justify-end gap-[3px] text-center"
      >
        {block.place === 1 ? <Icon icon={Crown} size={32} /> : null}
        <span className="flex gap-1">
          {block.members.map((member) => (
            <MemberAvatar
              key={member.userId}
              id={member.userId}
              name={member.displayName}
              avatarPath={member.avatarPath}
            />
          ))}
        </span>
        <span className="w-full type-title-sm [overflow-wrap:anywhere]">
          {joinNames(block.members.map((member) => member.displayName))}
        </span>
        <PodiumStand place={block.place} points={first?.weeklyPoints ?? 0} rank={block.place} />
      </div>
    </li>
  )
}

export interface WinnerCardProps {
  /** The locked week shown; null when closed. */
  week: WinnerWeek | null
  viewerId: string
  /** Button, Esc or system back. The caller stores the seen key. */
  onClose: () => void
}

/**
 * Winner card (DESIGN.md `winner-card`, Story 4.5): a full-screen paper sheet above everything (the
 * bottom nav included) with "Last week's winner(s)" in display type, the podium (every winner on the
 * 1st block under one crown), the winners' names and points in numeral-xl ("94" or "94 each"), the
 * 120px Weekly Winner seal, the ribbing line in hand-lg and one secondary button, "Nice" for a
 * winner and "Fine." for everyone else. Focus is trapped and starts on the heading; Esc and system
 * back (its own history entry, like a sheet) close it, and focus returns to where it was. The
 * entrance rises and fades in (transform and opacity only); a tap ends it at once; reduced motion
 * shows the end state. No confetti.
 */
export function WinnerCard({ week, viewerId, onClose }: WinnerCardProps) {
  const open = week !== null
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [settled, setSettled] = useState(false)
  const latestClose = useRef(onClose)
  useEffect(() => {
    latestClose.current = onClose
  })
  const [handle] = useState<SheetHandle>(() => ({
    forceClose: () => latestClose.current(),
    onPop: () => latestClose.current(),
  }))

  useEffect(() => {
    if (!open) return
    setSettled(false)
    claimSheet(handle)
    return () => releaseSheet(handle)
  }, [open, handle])

  const winners = week ? winnersOf(week) : []
  const points = winners[0]?.weeklyPoints ?? 0

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        {week ? (
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              headingRef.current?.focus()
            }}
            // Full screen: there is no outside to tap.
            onPointerDownOutside={(event) => event.preventDefault()}
            className="paper fixed inset-0 z-(--z-photo-viewer) h-dvh overflow-y-auto text-ink outline-none"
            data-component="winner-card"
          >
            <div
              className={cn(
                'mx-auto flex min-h-full w-full max-w-content-max flex-col items-center justify-center gap-5 px-gutter pt-[calc(env(safe-area-inset-top)+24px)] pb-[calc(env(safe-area-inset-bottom)+24px)] text-center',
                !settled && 'animate-winner-rise',
              )}
              onPointerDown={() => setSettled(true)}
              onAnimationEnd={() => setSettled(true)}
            >
              <Dialog.Title asChild>
                <h2 ref={headingRef} tabIndex={-1} className="type-display outline-none">
                  {winnerHeading(winners.length)}
                </h2>
              </Dialog.Title>
              <div className="w-full" data-component="winner-podium">
                <ol
                  aria-label={WINNER_COPY.podium}
                  className="flex items-stretch justify-center gap-[6px]"
                >
                  {winnerPodiumBlocks(week).map((block) => (
                    <WinnerPlace key={block.place} block={block} />
                  ))}
                </ol>
                <div aria-hidden="true" className="h-2 rounded-[3px] bg-line" />
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="type-headline [overflow-wrap:anywhere]">
                  {joinNames(winners.map((winner) => winner.displayName))}
                </p>
                <p className="type-numeral-xl tabular-nums" data-component="winner-points">
                  <span aria-hidden="true">{winnerPoints(points, winners.length)}</span>
                  <span className="sr-only">
                    {`${points} weekly points${winners.length > 1 ? ' each' : ''}`}
                  </span>
                </p>
              </div>
              <BadgeSeal icon={badgeIcon(WEEKLY_WINNER_ICON)} name={week.badgeName} size={120} />
              <p className="type-hand-lg">{winnerLine(week, viewerId)}</p>
              <Button variant="secondary" onClick={onClose}>
                {winnerButtonLabel(week, viewerId)}
              </Button>
            </div>
          </Dialog.Content>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
