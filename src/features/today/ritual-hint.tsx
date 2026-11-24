import { Camera } from '@phosphor-icons/react'
import { OPEN_VOTES_COPY } from '@/domain/open-votes'
import { useRitualHint } from '@/data/ritual-hint'
import { Hint } from '@/ui/hint'

/**
 * The ritual Hint on an active group's Today (Story 5.6): "The photo's a ritual, not a court
 * case. …" until "Not now", which this device remembers for the group (AD-12).
 */
export function RitualHint({ groupId }: { groupId: string }) {
  const hint = useRitualHint(groupId)
  if (!hint.visible) return null
  return (
    <Hint icon={Camera} actions={[{ label: OPEN_VOTES_COPY.notNow, onClick: hint.dismiss }]}>
      {OPEN_VOTES_COPY.ritual}
    </Hint>
  )
}
