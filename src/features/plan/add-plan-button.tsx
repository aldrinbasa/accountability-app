import { Plus } from '@phosphor-icons/react'
import { PLAN_COPY } from '@/domain/plan'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { usePlanSheet } from '@/features/plan/plan-sheet-context'

/**
 * The Add button on Today (DESIGN.md `add-button`): a full-width ghost button reading "+ Add",
 * named "Add a habit or task". Opens the Plan sheet (from the Plan sheet host) with Habit
 * pre-selected; focus returns here when the sheet closes. Works in every group state, waiting groups
 * included (FR-4). As the one action of the "No plan here yet." Empty state it is the primary
 * button instead.
 */
export function AddPlanButton({ variant = 'ghost' }: { variant?: 'ghost' | 'primary' }) {
  const { openPlanSheet } = usePlanSheet()
  const ghost = variant === 'ghost'
  return (
    <Button
      variant={variant}
      fullWidth={ghost}
      className={ghost ? undefined : 'mt-2'}
      aria-label={PLAN_COPY.addLabel}
      aria-haspopup="dialog"
      data-plan-add=""
      onClick={() => openPlanSheet({ mode: 'add' })}
    >
      <Icon icon={Plus} size={24} />
      {PLAN_COPY.addText}
    </Button>
  )
}
