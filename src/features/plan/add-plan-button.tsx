import { useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { PLAN_COPY } from '@/domain/plan'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { PlanSheet } from '@/features/plan/plan-sheet'

/**
 * The Add button on Today (DESIGN.md `add-button`): a full-width ghost button reading "+ Add",
 * named "Add a commitment or task". Opens the Plan sheet in Commitment mode; focus returns here when
 * the sheet closes. Works in every group state, waiting groups included (FR-4).
 */
export function AddPlanButton({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        fullWidth
        aria-label={PLAN_COPY.addLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon icon={Plus} size={24} />
        {PLAN_COPY.addText}
      </Button>
      <PlanSheet open={open} onOpenChange={setOpen} groupId={groupId} />
    </>
  )
}
