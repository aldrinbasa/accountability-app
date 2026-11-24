import { useRef, useState } from 'react'
import { SealQuestion } from '@phosphor-icons/react'
import {
  CHALLENGE_COPY,
  canChallenge,
  challengeActionsTitle,
  challengeOverflowLabel,
} from '@/domain/challenge'
import type { FeedCheckin, FeedViewer } from '@/domain/feed'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { OverflowButton } from '@/ui/overflow-button'
import { Sheet } from '@/ui/sheet'
import { ChallengeSheet } from '@/features/challenge/challenge-sheet'

/** The check-in's host (`data-challenge-host`): the Feed article, or the mini's frame. */
function hostOf(opener: HTMLElement | null): HTMLElement | null {
  return opener?.closest<HTMLElement>('[data-challenge-host]') ?? null
}

/** The focus target in a host: the Feed article itself, or the mini's photo button. */
function hostFocus(host: HTMLElement | null): HTMLElement | null {
  if (!host?.isConnected) return null
  if (host.hasAttribute('tabindex')) return host
  return host.querySelector<HTMLElement>('button:not([data-component="overflow-button"])')
}

/** The screen's h1 (the Feed or Today heading; focusable with `tabindex="-1"`). */
function screenHeading(): HTMLElement | null {
  return document.querySelector<HTMLElement>('h1[tabindex]')
}

export interface ChallengeActionsProps {
  item: FeedCheckin
  viewer: FeedViewer
  /** Current members of the check-in's group. */
  memberCount: number
  className?: string
}

/**
 * A check-in's Overflow (Story 5.1), shown only while the viewer may challenge it ("More actions
 * for Dev's Study check-in"; Challenge is its only action). It opens a small actions Sheet whose one
 * button, Challenge, hands over to the confirm Sheet. Cancelling either returns focus to the
 * Overflow; after a challenge it goes to the check-in (the Overflow leaves on the refetch), or to the
 * screen's h1 when the check-in leaves too (a group of two rules it Fake at once).
 */
export function ChallengeActions({ item, viewer, memberCount, className }: ChallengeActionsProps) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const handedOff = useRef(false)
  const done = useRef(false)
  const ruledFake = useRef(false)
  // Captured on open: after a ruling the refetch removes the check-in, and the Overflow with it.
  const host = useRef<HTMLElement | null>(null)

  // Kept mounted while a sheet is open, so a challenge that lands mid-sheet never unmounts it.
  if (!canChallenge(item, viewer, memberCount) && !actionsOpen && !confirmOpen) return null

  function returnToOverflow(): HTMLElement | null {
    if (opener.current?.isConnected) return opener.current
    return hostFocus(host.current) ?? screenHeading()
  }

  /**
   * After a challenge: the check-in (its Overflow leaves on the refetch). A Fake ruling at once (the
   * server's answer) removes the check-in too: the screen's h1, as when it is already gone.
   */
  function afterChallenge(): HTMLElement | null {
    if (ruledFake.current) return screenHeading()
    return hostFocus(host.current) ?? screenHeading()
  }

  return (
    <>
      <OverflowButton
        ref={opener}
        onObject
        label={challengeOverflowLabel(item)}
        className={className}
        onClick={() => {
          handedOff.current = false
          done.current = false
          ruledFake.current = false
          host.current = hostOf(opener.current)
          setActionsOpen(true)
        }}
      />
      <Sheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title={challengeActionsTitle(item)}
        returnFocusTo={() => (handedOff.current ? null : returnToOverflow())}
      >
        <div className="flex flex-col gap-3 pb-2">
          <Button
            variant="secondary"
            fullWidth
            aria-haspopup="dialog"
            onClick={() => {
              handedOff.current = true
              setActionsOpen(false)
              setConfirmOpen(true)
            }}
          >
            <Icon icon={SealQuestion} size={24} />
            {CHALLENGE_COPY.challenge}
          </Button>
        </div>
      </Sheet>
      <ChallengeSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        item={item}
        memberCount={memberCount}
        returnFocusTo={() => (done.current ? afterChallenge() : returnToOverflow())}
        onDone={(fake) => {
          done.current = true
          ruledFake.current = fake
        }}
      />
    </>
  )
}
