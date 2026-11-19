import { Plus } from '@phosphor-icons/react'
import { PLAN_COPY } from '@/domain/plan'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { usePlanSheet } from '@/features/plan/plan-sheet-context'

/**
 * The Add button on Today (DESIGN.md `add-button`): a full-width ghost button reading "+ Add",
 * named "Add a commitment or task". Opens the Plan sheet (from the Plan sheet host) with Commitment
 * pre-selected; focus returns here when the sheet closes. Works in every group state, waiting groups
 * included (FR-4).
 */
export function AddPlanButton() {
  const { openPlanSheet } = usePlanSheet()
  return (
    <Button
      variant="ghost"
      fullWidth
      aria-label={PLAN_COPY.addLabel}
      aria-haspopup="dialog"
      onClick={() => openPlanSheet({ mode: 'add' })}
    >
      <Icon icon={Plus} size={24} />
      {PLAN_COPY.addText}
    </Button>
  )
}
